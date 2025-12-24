/**
 * STEP 3 — INFRACOST SERVICE
 * Generates real cost estimates using Infracost CLI
 * 
 * Flow:
 * 1. Generate Terraform dynamically from service mapping + sizing
 * 2. Run Infracost CLI for each cloud (AWS, GCP, Azure)
 * 3. Parse and normalize JSON output
 * 4. Return structured cost data
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const cloudMapping = require('./cloudMapping');
const sizingModel = require('./sizingModel');

// Base temp directory for Terraform files
const INFRACOST_BASE_DIR = path.join(os.tmpdir(), 'infracost');

// Performance scores per provider (static backend knowledge)
const PROVIDER_PERFORMANCE_SCORES = {
  AWS: { compute: 95, database: 92, networking: 90, overall: 92 },
  GCP: { compute: 93, database: 88, networking: 92, overall: 90 },
  AZURE: { compute: 90, database: 90, networking: 88, overall: 89 }
};

// Resource name to SERVICE CLASS mapping (must match cloudMapping.js keys)
const RESOURCE_CATEGORY_MAP = {
  // AWS
  'aws_ecs_service': 'compute_container',
  'aws_ecs_task_definition': 'compute_container',
  'aws_ecs_cluster': 'compute_container',
  'aws_lambda_function': 'compute_serverless',
  'aws_instance': 'compute_vm',
  'aws_db_instance': 'relational_database',
  'aws_rds_cluster': 'relational_database',
  'aws_dynamodb_table': 'nosql_database',
  'aws_elasticache_cluster': 'cache',
  'aws_elasticache_replication_group': 'cache',
  'aws_lb': 'load_balancer',
  'aws_alb': 'load_balancer',
  'aws_api_gateway_rest_api': 'api_gateway',
  'aws_apigatewayv2_api': 'api_gateway',
  'aws_s3_bucket': 'object_storage',
  'aws_ebs_volume': 'block_storage',
  'aws_cloudfront_distribution': 'cdn',
  'aws_vpc': 'networking',
  'aws_nat_gateway': 'networking',
  'aws_cognito_user_pool': 'identity_auth',
  'aws_route53_zone': 'dns',
  'aws_cloudwatch_log_group': 'logging',
  'aws_cloudwatch_metric_alarm': 'monitoring',
  'aws_secretsmanager_secret': 'secrets_management',
  'aws_sqs_queue': 'messaging_queue',
  'aws_sns_topic': 'messaging_queue',
  'aws_cloudwatch_event_rule': 'event_bus',
  'aws_opensearch_domain': 'search_engine',

  // GCP
  'google_cloud_run_service': 'compute_container',
  'google_container_cluster': 'compute_container',
  'google_cloudfunctions_function': 'compute_serverless',
  'google_compute_instance': 'compute_vm',
  'google_sql_database_instance': 'relational_database',
  'google_firestore_database': 'nosql_database',
  'google_redis_instance': 'cache',
  'google_compute_forwarding_rule': 'load_balancer',
  'google_compute_backend_service': 'load_balancer',
  'google_storage_bucket': 'object_storage',
  'google_compute_disk': 'block_storage',
  'google_compute_network': 'networking',
  'google_compute_router_nat': 'networking',
  'google_dns_managed_zone': 'dns',
  'google_logging_project_sink': 'logging',
  'google_monitoring_alert_policy': 'monitoring',
  'google_secret_manager_secret': 'secrets_management',
  'google_pubsub_topic': 'messaging_queue',

  // Azure
  'azurerm_container_app': 'compute_container',
  'azurerm_kubernetes_cluster': 'compute_container',
  'azurerm_function_app': 'compute_serverless',
  'azurerm_virtual_machine': 'compute_vm',
  'azurerm_postgresql_flexible_server': 'relational_database',
  'azurerm_mysql_flexible_server': 'relational_database',
  'azurerm_cosmosdb_account': 'nosql_database',
  'azurerm_redis_cache': 'cache',
  'azurerm_application_gateway': 'load_balancer',
  'azurerm_lb': 'load_balancer',
  'azurerm_storage_account': 'object_storage',
  'azurerm_managed_disk': 'block_storage',
  'azurerm_virtual_network': 'networking',
  'azurerm_nat_gateway': 'networking',
  'azurerm_dns_zone': 'dns',
  'azurerm_log_analytics_workspace': 'logging',
  'azurerm_monitor_metric_alert': 'monitoring',
  'azurerm_key_vault': 'secrets_management',
  'azurerm_servicebus_namespace': 'messaging_queue'
};

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Generate AWS Terraform code from InfraSpec
 */
function generateAWSTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const components = infraSpec.components || {};
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated AWS Terraform for Infracost
provider "aws" {
  region = "us-east-1"
}

`;

  // Check for compute type - ECS Fargate
  if (services.find(s => s.service_class === 'compute_container')) {
    const config = sizing.services?.compute_container || { instances: 2, cpu: 1024, memory_mb: 2048 };
    const cpu = config.cpu || (tier === 'LARGE' ? 2048 : tier === 'SMALL' ? 256 : 1024);
    const memory = config.memory_mb || (tier === 'LARGE' ? 4096 : tier === 'SMALL' ? 512 : 2048);

    terraform += `
resource "aws_ecs_cluster" "main" {
  name = "app-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "app-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "${cpu}"
  memory                   = "${memory}"
  
  container_definitions = jsonencode([{
    name  = "app"
    image = "nginx:latest"
    cpu   = ${cpu}
    memory = ${memory}
  }])
}

resource "aws_ecs_service" "app" {
  name            = "app-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = ${config.instances || 2}
  launch_type     = "FARGATE"
}
`;
  }

  // Lambda (serverless)
  if (services.find(s => s.service_class === 'compute_serverless')) {
    const config = sizing.services?.compute_serverless || {};
    const memorySize = config.memory_mb || (tier === 'LARGE' ? 1024 : tier === 'SMALL' ? 256 : 512);
    terraform += `
resource "aws_lambda_function" "app" {
  function_name = "app-function"
  runtime       = "nodejs18.x"
  handler       = "index.handler"
  memory_size   = ${memorySize}
  timeout       = 30
  filename      = "dummy.zip"
  
  # Monthly invocations estimate for Infracost
  # infracost_usage:
  #   monthly_requests: 1000000
  #   request_duration_ms: 200
}
`;
  }

  if (services.find(s => s.service_class === 'compute_vm')) {
    const config = sizing.services?.compute_vm || {};
    terraform += `
resource "aws_instance" "app" {
  instance_type = "${config.instance_type || 't3.medium'}"
  ami           = "ami-0c55b159cbfafe1f0"
}
`;
  }

  // Database
  if (services.find(s => s.service_class === 'relational_database')) {
    const config = sizing.services?.relational_database || {};
    const instanceClass = tier === 'LARGE' ? 'db.t3.medium' : tier === 'SMALL' ? 'db.t3.micro' : 'db.t3.small';
    terraform += `
resource "aws_db_instance" "db" {
  engine               = "postgres"
  instance_class       = "${instanceClass}"
  allocated_storage    = ${config.storage_gb || 100}
  publicly_accessible  = false
  skip_final_snapshot  = true
}
`;
  }

  // Cache
  if (services.find(s => s.service_class === 'cache')) {
    const config = sizing.services?.cache || {};
    const nodeType = tier === 'LARGE' ? 'cache.t3.medium' : 'cache.t3.small';
    terraform += `
resource "aws_elasticache_cluster" "cache" {
  engine           = "redis"
  node_type        = "${nodeType}"
  num_cache_nodes  = ${config.nodes || 1}
  cluster_id       = "app-cache"
}
`;
  }

  // Load Balancer
  if (services.find(s => s.service_class === 'load_balancer')) {
    terraform += `
resource "aws_lb" "alb" {
  name               = "app-alb"
  load_balancer_type = "application"
}
`;
  }

  // Object Storage
  if (services.find(s => s.service_class === 'object_storage')) {
    terraform += `
resource "aws_s3_bucket" "storage" {
  bucket = "infracost-estimate-bucket"
}
`;
  }

  // API Gateway
  if (services.find(s => s.service_class === 'api_gateway')) {
    terraform += `
resource "aws_apigatewayv2_api" "api" {
  name          = "app-api"
  protocol_type = "HTTP"
}
`;
  }

  // Messaging Queue
  if (services.find(s => s.service_class === 'messaging_queue')) {
    terraform += `
resource "aws_sqs_queue" "queue" {
  name = "app-queue"
}
`;
  }

  // Secrets Management
  if (services.find(s => s.service_class === 'secrets_management')) {
    terraform += `
resource "aws_secretsmanager_secret" "secret" {
  name = "app-secrets"
}
`;
  }

  return terraform;
}

/**
 * Generate GCP Terraform code from InfraSpec
 */
function generateGCPTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated GCP Terraform for Infracost
provider "google" {
  project = "example-project"
  region  = "us-central1"
}

`;

  if (services.find(s => s.service_class === 'compute_container')) {
    terraform += `
resource "google_cloud_run_service" "app" {
  name     = "app-service"
  location = "us-central1"
  
  template {
    spec {
      containers {
        image = "gcr.io/example/app"
        resources {
          limits = {
            cpu    = "${tier === 'LARGE' ? '2' : '1'}"
            memory = "${tier === 'LARGE' ? '4Gi' : '2Gi'}"
          }
        }
      }
    }
  }
}
`;
  }

  if (services.find(s => s.service_class === 'relational_database')) {
    const dbTier = tier === 'LARGE' ? 'db-custom-2-4096' : tier === 'SMALL' ? 'db-f1-micro' : 'db-custom-1-3840';
    terraform += `
resource "google_sql_database_instance" "db" {
  name             = "app-db"
  database_version = "POSTGRES_14"
  region           = "us-central1"
  
  settings {
    tier = "${dbTier}"
  }
  
  deletion_protection = false
}
`;
  }

  if (services.find(s => s.service_class === 'cache')) {
    const memorySize = tier === 'LARGE' ? 5 : tier === 'SMALL' ? 1 : 2;
    terraform += `
resource "google_redis_instance" "cache" {
  name           = "app-cache"
  tier           = "BASIC"
  memory_size_gb = ${memorySize}
  region         = "us-central1"
}
`;
  }

  if (services.find(s => s.service_class === 'object_storage')) {
    terraform += `
resource "google_storage_bucket" "storage" {
  name     = "infracost-estimate-bucket-gcp"
  location = "US"
}
`;
  }

  if (services.find(s => s.service_class === 'load_balancer')) {
    terraform += `
resource "google_compute_backend_service" "lb" {
  name        = "app-backend"
  protocol    = "HTTP"
  timeout_sec = 30
}
`;
  }

  return terraform;
}

/**
 * Generate Azure Terraform code from InfraSpec
 */
function generateAzureTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated Azure Terraform for Infracost
provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = "infracost-rg"
  location = "East US"
}

`;

  if (services.find(s => s.service_class === 'compute_container')) {
    terraform += `
resource "azurerm_container_app" "app" {
  name                         = "app-container"
  container_app_environment_id = "placeholder"
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  
  template {
    container {
      name   = "app"
      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = ${tier === 'LARGE' ? 2 : 1}
      memory = "${tier === 'LARGE' ? '4Gi' : '2Gi'}"
    }
  }
}
`;
  }

  if (services.find(s => s.service_class === 'relational_database')) {
    const skuName = tier === 'LARGE' ? 'GP_Standard_D2s_v3' : tier === 'SMALL' ? 'B_Standard_B1ms' : 'GP_Standard_D2s_v3';
    terraform += `
resource "azurerm_postgresql_flexible_server" "db" {
  name                   = "app-db-server"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "14"
  sku_name               = "${skuName}"
  storage_mb             = ${tier === 'LARGE' ? 524288 : 131072}
  
  administrator_login    = "adminuser"
  administrator_password = "H@Sh1CoR3!"
}
`;
  }

  if (services.find(s => s.service_class === 'cache')) {
    const family = tier === 'LARGE' ? 'C' : 'C';
    const capacity = tier === 'LARGE' ? 2 : 1;
    terraform += `
resource "azurerm_redis_cache" "cache" {
  name                = "app-cache"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = ${capacity}
  family              = "${family}"
  sku_name            = "Standard"
}
`;
  }

  if (services.find(s => s.service_class === 'object_storage')) {
    terraform += `
resource "azurerm_storage_account" "storage" {
  name                     = "infracoststorage"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`;
  }

  if (services.find(s => s.service_class === 'load_balancer')) {
    terraform += `
resource "azurerm_application_gateway" "lb" {
  name                = "app-gateway"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  
  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = 2
  }
  
  gateway_ip_configuration {
    name      = "gateway-ip"
    subnet_id = "placeholder"
  }
  
  frontend_port {
    name = "http"
    port = 80
  }
  
  frontend_ip_configuration {
    name = "frontend"
  }
  
  backend_address_pool {
    name = "backend"
  }
  
  backend_http_settings {
    name                  = "http-settings"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 30
  }
  
  http_listener {
    name                           = "listener"
    frontend_ip_configuration_name = "frontend"
    frontend_port_name             = "http"
    protocol                       = "Http"
  }
  
  request_routing_rule {
    name                       = "rule"
    rule_type                  = "Basic"
    http_listener_name         = "listener"
    backend_address_pool_name  = "backend"
    backend_http_settings_name = "http-settings"
    priority                   = 100
  }
}
`;
  }

  return terraform;
}

/**
 * Run Infracost CLI and get JSON output
 * FIX 5: Use spawnSync with timeout to prevent blocking the request thread
 */
function runInfracost(terraformDir) {
  try {
    // Check if Infracost API key is set
    if (!process.env.INFRACOST_API_KEY) {
      console.warn("INFRACOST_API_KEY not set, using mock data");
      return null;
    }

    const { spawnSync } = require('child_process');

    // Use spawnSync with timeout instead of execSync for better control
    const result = spawnSync('infracost', [
      'breakdown',
      '--path', terraformDir,
      '--format', 'json'
    ], {
      env: {
        ...process.env,
        INFRACOST_API_KEY: process.env.INFRACOST_API_KEY
      },
      encoding: 'utf-8',
      timeout: 30000, // 30 second timeout (reduced for faster fallback)
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    if (result.error) {
      console.warn(`Infracost process error: ${result.error.message}`);
      return null;
    }

    if (result.status !== 0) {
      console.warn(`Infracost exited with code ${result.status}: ${result.stderr}`);
      return null;
    }

    return JSON.parse(result.stdout);

  } catch (error) {
    console.error(`Infracost CLI error for ${terraformDir}:`, error.message);
    return null;
  }
}

/**
 * Normalize Infracost output to internal format
 * FIXED: Properly parse resources, map to service classes, aggregate costs
 */
function normalizeInfracostOutput(infracostJson, provider, infraSpec, costProfile = 'COST_EFFECTIVE') {
  if (!infracostJson || !infracostJson.projects || infracostJson.projects.length === 0) {
    console.log('[INFRACOST] No projects in output');
    return null;
  }

  const project = infracostJson.projects[0];
  const breakdown = project.breakdown || {};
  const resources = breakdown.resources || [];
  const totalCost = parseFloat(breakdown.totalMonthlyCost) || 0;

  console.log(`[INFRACOST] Parsed ${resources.length} resources, total: $${totalCost}`);

  // FIX #2: Map TF resources to service classes using RESOURCE_CATEGORY_MAP
  const serviceCosts = {};        // service_class -> total cost
  const selectedServices = {};    // service_class -> cloud service id
  const serviceDetails = [];

  for (const resource of resources) {
    const resourceType = resource.name?.split('.')[0] || '';
    const serviceClass = RESOURCE_CATEGORY_MAP[resourceType] || null;
    const cost = parseFloat(resource.monthlyCost) || 0;

    if (!serviceClass) {
      console.log(`[INFRACOST] Unknown resource type: ${resourceType}`);
      continue;
    }

    // Aggregate cost per service class
    serviceCosts[serviceClass] = (serviceCosts[serviceClass] || 0) + cost;

    // Map to cloud service (first occurrence wins)
    if (!selectedServices[serviceClass]) {
      // Get the proper cloud service name from cloudMapping
      const cloudService = cloudMapping.mapServiceToCloud(provider, serviceClass, costProfile)
        || `${provider.toLowerCase()}_${serviceClass}`;
      selectedServices[serviceClass] = cloudService;
    }

    serviceDetails.push({
      resource_name: resource.name,
      resource_type: resourceType,
      service_class: serviceClass,
      category: cloudMapping.getCategoryForServiceClass(serviceClass) || 'Other',
      monthly_cost: cost,
      formatted_cost: `$${cost.toFixed(2)}/mo`
    });
  }

  console.log(`[INFRACOST] Aggregated service costs:`, serviceCosts);
  console.log(`[INFRACOST] Selected services:`, selectedServices);

  // Build the services array in same format as mock data
  const services = Object.entries(serviceCosts).map(([serviceClass, cost]) => {
    const cloudService = selectedServices[serviceClass];
    const displayName = cloudMapping.getServiceDisplayName(cloudService)
      || serviceClass.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
      service_class: serviceClass,
      cloud_service: cloudService,
      display_name: displayName,
      category: cloudMapping.getCategoryForServiceClass(serviceClass) || 'Other',
      sizing: costProfile === 'HIGH_PERFORMANCE' ? 'Performance' : 'Standard',
      cost: {
        monthly: Math.round(cost * 100) / 100,
        formatted: `$${cost.toFixed(2)}/mo`
      }
    };
  });

  return {
    provider,
    total_monthly_cost: Math.round(totalCost * 100) / 100,
    formatted_cost: `$${totalCost.toFixed(2)}/month`,
    service_count: services.length,
    services,

    // FIX #3: Persist selected services
    selected_services: selectedServices,

    // FIX #2: Aggregated costs per service class
    service_costs: serviceCosts,

    performance_score: PROVIDER_PERFORMANCE_SCORES[provider]?.overall || 85,
    is_mock: false,
    resource_count: resources.length
  };
}

/**
 * Generate fallback mock data when Infracost CLI is not available
 * FIX 1: selected_services uses service_class as key
 * FIX 4: Profile divergence - HIGH_PERFORMANCE costs more
 */
function generateMockCostData(provider, infraSpec, sizing, costProfile = 'COST_EFFECTIVE') {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';
  const tierMultiplier = tier === 'LARGE' ? 2.5 : tier === 'SMALL' ? 0.5 : 1;

  // FIX 4: Profile divergence - HIGH_PERFORMANCE costs 35-50% more
  const profileMultiplier = costProfile === 'HIGH_PERFORMANCE' ? 1.4 : 1.0;

  // Base costs per service class
  const baseCosts = {
    compute_container: 80,
    compute_serverless: 30,
    compute_vm: 60,
    compute_static: 5,
    relational_database: 100,
    nosql_database: 40,
    cache: 50,
    load_balancer: 25,
    api_gateway: 15,
    object_storage: 10,
    block_storage: 15,
    messaging_queue: 5,
    event_bus: 8,
    search_engine: 60,
    cdn: 20,
    networking: 35,
    identity_auth: 5,
    dns: 2,
    monitoring: 10,
    logging: 15,
    secrets_management: 3
  };

  // FIX 4: HIGH_PERFORMANCE uses premium services with higher base costs
  const performanceMultipliers = {
    compute_container: 1.5,  // EKS vs Fargate
    relational_database: 1.6, // Aurora vs RDS
    cache: 1.3,              // larger cache size
    load_balancer: 1.2,
    monitoring: 1.4
  };

  // Provider cost adjustments
  const providerAdjustment = {
    AWS: 1.0,
    GCP: 0.92,
    AZURE: 0.95
  };

  const adjustment = providerAdjustment[provider] || 1;
  let totalCost = 0;
  const serviceDetails = [];

  // FIX 1: Persist selected services (using service_class as key, not category)
  const selectedServices = {};

  // FIX 2: Aggregate costs per service class
  const serviceCosts = {};

  for (const service of services) {
    let baseCost = baseCosts[service.service_class] || 20;

    // FIX 4: Apply performance multiplier for specific services
    if (costProfile === 'HIGH_PERFORMANCE' && performanceMultipliers[service.service_class]) {
      baseCost *= performanceMultipliers[service.service_class];
    }

    const cost = Math.round(baseCost * tierMultiplier * profileMultiplier * adjustment * 100) / 100;
    totalCost += cost;

    const mappedService = cloudMapping.mapServiceToCloud(provider, service.service_class, costProfile);
    const category = cloudMapping.getCategoryForServiceClass(service.service_class);

    // DEBUG: Log service mapping
    console.log(`[COST] Service: ${service.service_class} -> ${mappedService} ($${cost})`);

    // Handle case where mappedService is null (use service_class as fallback)
    const cloudServiceId = mappedService || `${provider.toLowerCase()}_${service.service_class}`;
    const displayName = cloudMapping.getServiceDisplayName(mappedService) || service.service_class.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // FIX 1: Store selected cloud service by SERVICE CLASS
    selectedServices[service.service_class] = cloudServiceId;

    // FIX 2: Aggregate cost per service class
    serviceCosts[service.service_class] = (serviceCosts[service.service_class] || 0) + cost;

    serviceDetails.push({
      service_class: service.service_class,
      cloud_service: cloudServiceId,
      display_name: displayName,
      category: category,
      sizing: costProfile === 'HIGH_PERFORMANCE' ? 'Performance' : 'Standard',
      cost: {
        monthly: cost,
        formatted: `$${cost.toFixed(2)}/mo`
      }
    });
  }

  // Round service costs
  for (const key of Object.keys(serviceCosts)) {
    serviceCosts[key] = Math.round(serviceCosts[key] * 100) / 100;
  }

  return {
    provider,
    tier,
    cost_profile: costProfile,
    total_monthly_cost: Math.round(totalCost * 100) / 100,
    formatted_cost: `$${totalCost.toFixed(2)}/month`,
    service_count: serviceDetails.length,
    services: serviceDetails,

    // FIX 1: Selected cloud services by service_class
    selected_services: selectedServices,

    // FIX 2: Aggregated costs per service_class
    service_costs: serviceCosts,

    performance_score: PROVIDER_PERFORMANCE_SCORES[provider]?.overall || 85,
    is_mock: true
  };
}

/**
 * Generate cost estimate for a single provider
 */
async function generateCostEstimate(provider, infraSpec, intent, costProfile = 'COST_EFFECTIVE') {
  const sizing = sizingModel.getSizingForInfraSpec(infraSpec, intent);
  const tier = sizing.tier;

  // Create provider directory
  const providerDir = path.join(INFRACOST_BASE_DIR, provider.toLowerCase());
  ensureDir(providerDir);

  // Generate Terraform
  let terraform;
  switch (provider) {
    case 'AWS':
      terraform = generateAWSTerraform(infraSpec, sizing, costProfile);
      break;
    case 'GCP':
      terraform = generateGCPTerraform(infraSpec, sizing, costProfile);
      break;
    case 'AZURE':
      terraform = generateAzureTerraform(infraSpec, sizing, costProfile);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  // Write Terraform file
  const tfPath = path.join(providerDir, 'main.tf');
  fs.writeFileSync(tfPath, terraform);
  console.log(`Generated Terraform for ${provider} at ${tfPath}`);

  // Try to run Infracost CLI
  const infracostResult = runInfracost(providerDir);

  if (infracostResult) {
    // Normalize real Infracost data with proper service class mapping
    const normalized = normalizeInfracostOutput(infracostResult, provider, infraSpec, costProfile);
    if (normalized) {
      console.log(`[INFRACOST] Successfully normalized ${provider} with ${normalized.service_count} services`);
      return {
        ...normalized,
        tier,
        cost_profile: costProfile
      };
    }
  }

  // Fallback to mock data
  console.log(`Using mock cost data for ${provider}`);
  return generateMockCostData(provider, infraSpec, sizing, costProfile);
}

/**
 * Generate cost estimates for all providers
 */
async function generateAllProviderEstimates(infraSpec, intent, costProfile = 'COST_EFFECTIVE') {
  const providers = ['AWS', 'GCP', 'AZURE'];
  const estimates = {};

  for (const provider of providers) {
    estimates[provider] = await generateCostEstimate(provider, infraSpec, intent, costProfile);
  }

  return estimates;
}

/**
 * Rank providers based on cost profile
 */
function rankProviders(estimates, costProfile = 'COST_EFFECTIVE') {
  const providers = Object.keys(estimates);

  // Get costs for normalization
  const costs = providers.map(p => estimates[p].total_monthly_cost);
  const maxCost = Math.max(...costs);
  const minCost = Math.min(...costs);
  const costRange = maxCost - minCost || 1;

  // Calculate scores
  const rankings = providers.map(provider => {
    const estimate = estimates[provider];
    const normalizedCost = 100 - ((estimate.total_monthly_cost - minCost) / costRange * 100);
    const perfScore = estimate.performance_score || 85;

    let finalScore;
    if (costProfile === 'HIGH_PERFORMANCE') {
      finalScore = (normalizedCost * 0.4) + (perfScore * 0.6);
    } else {
      finalScore = (normalizedCost * 0.7) + (perfScore * 0.3);
    }

    return {
      provider,
      score: Math.round(finalScore),
      cost_score: Math.round(normalizedCost),
      performance_score: perfScore,
      monthly_cost: estimate.total_monthly_cost,
      formatted_cost: estimate.formatted_cost,
      service_count: estimate.service_count,
      is_mock: estimate.is_mock || false
    };
  });

  // Sort by score (descending)
  rankings.sort((a, b) => b.score - a.score);

  // Add ranking position
  rankings.forEach((r, idx) => {
    r.rank = idx + 1;
    r.recommended = idx === 0;
  });

  return rankings;
}

/**
 * Calculate cost range based on tier, cost profile, and statefulness
 * Returns ±20-30% range with confidence level
 */
function calculateCostRange(baseCost, tier, costProfile, intent) {
  // Determine range percentage based on factors
  let rangePercent = 0.20; // Base ±20%

  // Increase uncertainty for larger scale
  if (tier === 'LARGE') rangePercent += 0.05;
  if (tier === 'SMALL') rangePercent -= 0.05;

  // Increase uncertainty for high-performance profile (more variable)
  if (costProfile === 'HIGH_PERFORMANCE') rangePercent += 0.05;

  // Statefulness adds uncertainty
  const statefulness = intent?.semantic_signals?.statefulness;
  if (statefulness === 'stateful') rangePercent += 0.05;

  // Cap at 30%
  rangePercent = Math.min(rangePercent, 0.30);

  const low = Math.round(baseCost * (1 - rangePercent));
  const high = Math.round(baseCost * (1 + rangePercent));

  // Confidence based on range
  let confidence;
  if (rangePercent <= 0.20) confidence = 'high';
  else if (rangePercent <= 0.25) confidence = 'medium';
  else confidence = 'low';

  return {
    estimate: Math.round(baseCost),
    range: { low, high },
    range_percent: Math.round(rangePercent * 100),
    confidence,
    formatted: `$${low} - $${high}/month`
  };
}

/**
 * Aggregate costs by category for Tier 2 breakdown view
 */
function aggregateCategoryBreakdown(services) {
  const categories = {};

  for (const service of services) {
    const category = service.category || 'Other';
    const cost = service.cost?.monthly || 0;

    if (!categories[category]) {
      categories[category] = {
        category,
        total: 0,
        services: []
      };
    }

    categories[category].total += cost;
    categories[category].services.push({
      name: service.display_name,
      cost: cost
    });
  }

  // Convert to sorted array
  return Object.values(categories)
    .map(cat => ({
      category: cat.category,
      total: Math.round(cat.total * 100) / 100,
      formatted: `$${cat.total.toFixed(0)}`,
      service_count: cat.services.length,
      services: cat.services
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Identify missing components that could add future cost
 * Based on optional services not included
 */
function identifyMissingComponents(infraSpec) {
  const allServiceClasses = [
    'compute_container', 'compute_serverless', 'compute_vm', 'compute_static',
    'relational_database', 'nosql_database', 'cache', 'object_storage', 'block_storage',
    'load_balancer', 'api_gateway', 'messaging_queue', 'event_bus', 'search_engine', 'cdn',
    'networking', 'identity_auth', 'dns',
    'monitoring', 'logging', 'secrets_management'
  ];

  const requiredServices = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

  // Common additions that often get added later
  const futureRiskServices = {
    messaging_queue: { name: 'Async Processing', impact: 'low', reason: 'Adding async processing or background jobs later' },
    event_bus: { name: 'Event-Driven Architecture', impact: 'medium', reason: 'Migrating to event-driven patterns later' },
    search_engine: { name: 'Full-Text Search', impact: 'high', reason: 'Adding search functionality later' },
    cache: { name: 'Caching Layer', impact: 'medium', reason: 'Adding caching for performance optimization' },
    cdn: { name: 'CDN', impact: 'low', reason: 'Adding global content delivery later' }
  };

  const missing = [];

  for (const [serviceClass, info] of Object.entries(futureRiskServices)) {
    if (!requiredServices.includes(serviceClass)) {
      missing.push({
        service_class: serviceClass,
        name: info.name,
        impact: info.impact,
        estimated_additional_cost: info.impact === 'high' ? '$50-100' : info.impact === 'medium' ? '$20-50' : '$5-20',
        warning: info.reason + ' may increase monthly cost.'
      });
    }
  }

  return missing;
}

/**
 * Main function: Generate complete cost analysis for Step 3
 * FIX 3: Now runs BOTH profiles and stores them separately
 * FIX 5: Special handling for STATIC_WEB_HOSTING
 */
async function performCostAnalysis(infraSpec, intent, costProfile = 'COST_EFFECTIVE') {
  console.log("--- STEP 3: Infracost Analysis Started ---");
  console.log(`Primary Profile: ${costProfile}`);

  // 🔒 FIX 5: STATIC_WEB_HOSTING cost override
  // For static hosting, we use fixed cost ranges (no compute or DB to price)
  const pattern = infraSpec.service_classes?.pattern;
  if (pattern === 'STATIC_WEB_HOSTING') {
    console.log('[FIX 5] STATIC_WEB_HOSTING detected - using fixed cost presentation');

    // Fixed static hosting costs per provider
    const staticCosts = {
      AWS: { min: 1, max: 8 },
      GCP: { min: 1, max: 6 },
      AZURE: { min: 2, max: 9 }
    };

    const rankings = [
      { rank: 1, provider: 'GCP', score: 95, monthly_cost: 3, formatted_cost: '$1-6/month', recommended: true, cost_range: { low: 1, high: 6, confidence: 'low' } },
      { rank: 2, provider: 'AWS', score: 92, monthly_cost: 4, formatted_cost: '$1-8/month', recommended: false, cost_range: { low: 1, high: 8, confidence: 'low' } },
      { rank: 3, provider: 'AZURE', score: 88, monthly_cost: 5, formatted_cost: '$2-9/month', recommended: false, cost_range: { low: 2, high: 9, confidence: 'low' } }
    ];

    return {
      cost_profile: 'COST_EFFECTIVE',  // Static always uses cost-effective
      deployment_type: 'static',
      scale_tier: 'SMALL',
      rankings,
      provider_details: {
        AWS: {
          provider: 'AWS',
          total_monthly_cost: 4,
          formatted_cost: '$1-8/month',
          services: [
            { service_class: 'object_storage', display_name: 'S3', category: 'Storage', cost: { monthly: 1, formatted: '$1/mo' } },
            { service_class: 'cdn', display_name: 'CloudFront', category: 'CDN', cost: { monthly: 2, formatted: '$2/mo' } },
            { service_class: 'dns', display_name: 'Route 53', category: 'DNS', cost: { monthly: 1, formatted: '$1/mo' } }
          ],
          selected_services: { object_storage: 's3', cdn: 'cloudfront', dns: 'route53' },
          service_costs: { object_storage: 1, cdn: 2, dns: 1 },
          is_mock: true
        },
        GCP: {
          provider: 'GCP',
          total_monthly_cost: 3,
          formatted_cost: '$1-6/month',
          services: [
            { service_class: 'object_storage', display_name: 'Cloud Storage', category: 'Storage', cost: { monthly: 1, formatted: '$1/mo' } },
            { service_class: 'cdn', display_name: 'Cloud CDN', category: 'CDN', cost: { monthly: 1, formatted: '$1/mo' } },
            { service_class: 'dns', display_name: 'Cloud DNS', category: 'DNS', cost: { monthly: 1, formatted: '$1/mo' } }
          ],
          selected_services: { object_storage: 'gcs', cdn: 'cloud_cdn', dns: 'cloud_dns' },
          service_costs: { object_storage: 1, cdn: 1, dns: 1 },
          is_mock: true
        },
        AZURE: {
          provider: 'AZURE',
          total_monthly_cost: 5,
          formatted_cost: '$2-9/month',
          services: [
            { service_class: 'object_storage', display_name: 'Blob Storage', category: 'Storage', cost: { monthly: 2, formatted: '$2/mo' } },
            { service_class: 'cdn', display_name: 'Azure CDN', category: 'CDN', cost: { monthly: 2, formatted: '$2/mo' } },
            { service_class: 'dns', display_name: 'Azure DNS', category: 'DNS', cost: { monthly: 1, formatted: '$1/mo' } }
          ],
          selected_services: { object_storage: 'blob', cdn: 'azure_cdn', dns: 'azure_dns' },
          service_costs: { object_storage: 2, cdn: 2, dns: 1 },
          is_mock: true
        }
      },
      recommended_provider: 'GCP',
      used_real_pricing: false,

      // FIX 5: Low confidence + note for static hosting
      recommended_cost_range: {
        estimate: 3,
        range: { low: 1, high: 10 },
        range_percent: 70,
        confidence: 'low',
        formatted: '$1 - $10/month',
        note: 'Based on storage and CDN usage. Traffic not yet specified.'
      },

      cost_profiles: {
        COST_EFFECTIVE: { total: 3, formatted: '$1-6/month' },
        HIGH_PERFORMANCE: { total: 3, formatted: '$1-6/month' }  // Same for static
      },

      category_breakdown: [
        { category: 'CDN', total: 2, formatted: '$2', service_count: 1 },
        { category: 'Storage', total: 1, formatted: '$1', service_count: 1 },
        { category: 'DNS', total: 1, formatted: '$1', service_count: 1 }
      ],

      missing_components: [],  // Static doesn't have missing components
      future_cost_warning: null,

      summary: {
        cheapest: 'GCP',
        most_performant: 'GCP',
        best_value: 'GCP'
      },

      // FIX 5: Static hosting specific messaging
      static_hosting_note: 'Static websites have minimal infrastructure costs. Final cost depends on traffic and storage usage.'
    };
  }

  // Get scale tier (for non-static patterns)
  const tier = sizingModel.determineScaleTier(intent);
  console.log(`Scale Tier: ${tier}`);

  // FIX 3: Run BOTH profiles for accurate comparison
  const [costEffectiveEstimates, highPerfEstimates] = await Promise.all([
    generateAllProviderEstimates(infraSpec, intent, 'COST_EFFECTIVE'),
    generateAllProviderEstimates(infraSpec, intent, 'HIGH_PERFORMANCE')
  ]);

  // Use the selected profile for primary results
  const estimates = costProfile === 'HIGH_PERFORMANCE' ? highPerfEstimates : costEffectiveEstimates;

  // Check if any used real Infracost data
  const usedRealData = Object.values(estimates).some(e => !e.is_mock);
  console.log(`Using ${usedRealData ? 'REAL Infracost' : 'MOCK'} pricing data`);

  // Enhance estimates with cost ranges and category breakdown
  for (const provider of Object.keys(estimates)) {
    const estimate = estimates[provider];

    // Add cost range
    estimate.cost_range = calculateCostRange(
      estimate.total_monthly_cost,
      tier,
      costProfile,
      intent
    );

    // Add category breakdown
    estimate.category_breakdown = aggregateCategoryBreakdown(estimate.services || []);
  }

  // Rank providers
  const rankings = rankProviders(estimates, costProfile);
  console.log(`Rankings: ${rankings.map(r => `${r.rank}. ${r.provider}`).join(', ')}`);

  // Add cost range to rankings
  rankings.forEach(r => {
    r.cost_range = estimates[r.provider].cost_range;
  });

  // Determine deployment type
  const computeServices = ['compute_container', 'compute_serverless', 'compute_vm', 'compute_static'];
  const activeCompute = infraSpec.service_classes?.required_services?.find(s =>
    computeServices.includes(s.service_class)
  );
  const deploymentType = activeCompute?.service_class?.replace('compute_', '') || 'container';

  // Identify missing components (future cost risks)
  const missingComponents = identifyMissingComponents(infraSpec);
  console.log(`Missing Components: ${missingComponents.length} potential future additions`);

  const recommendedProvider = rankings[0]?.provider || 'AWS';

  return {
    cost_profile: costProfile,
    deployment_type: deploymentType,
    scale_tier: tier,
    rankings,
    provider_details: estimates,
    recommended_provider: recommendedProvider,
    used_real_pricing: usedRealData,

    // FIX 3: Both profiles stored separately for comparison
    cost_profiles: {
      COST_EFFECTIVE: {
        total: costEffectiveEstimates[recommendedProvider]?.total_monthly_cost,
        formatted: costEffectiveEstimates[recommendedProvider]?.formatted_cost,
        selected_services: costEffectiveEstimates[recommendedProvider]?.selected_services,
        service_costs: costEffectiveEstimates[recommendedProvider]?.service_costs
      },
      HIGH_PERFORMANCE: {
        total: highPerfEstimates[recommendedProvider]?.total_monthly_cost,
        formatted: highPerfEstimates[recommendedProvider]?.formatted_cost,
        selected_services: highPerfEstimates[recommendedProvider]?.selected_services,
        service_costs: highPerfEstimates[recommendedProvider]?.service_costs
      }
    },

    // NEW: Cost range for recommended
    recommended_cost_range: estimates[rankings[0]?.provider]?.cost_range,

    // NEW: Category breakdown for recommended
    category_breakdown: estimates[rankings[0]?.provider]?.category_breakdown,

    // NEW: Missing components as future cost risks
    missing_components: missingComponents,
    future_cost_warning: missingComponents.length > 0
      ? `${missingComponents.length} optional services not included may add cost if added later.`
      : null,

    summary: {
      cheapest: rankings.reduce((a, b) => a.monthly_cost < b.monthly_cost ? a : b).provider,
      most_performant: rankings.reduce((a, b) => a.performance_score > b.performance_score ? a : b).provider,
      best_value: rankings[0].provider
    }
  };
}

module.exports = {
  generateCostEstimate,
  generateAllProviderEstimates,
  rankProviders,
  performCostAnalysis,
  calculateCostRange,
  aggregateCategoryBreakdown,
  identifyMissingComponents,
  PROVIDER_PERFORMANCE_SCORES,
  // Exposed for testing
  generateAWSTerraform,
  generateGCPTerraform,
  generateAzureTerraform,
  runInfracost,
  normalizeInfracostOutput
};

