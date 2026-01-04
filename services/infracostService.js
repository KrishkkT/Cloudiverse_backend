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
const costResultModel = require('./costResultModel');

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
  // Compute expansion
  'aws_eks_cluster': 'compute_container',
  'aws_eks_node_group': 'compute_container',
  'aws_fargate_profile': 'compute_container',

  // GCP
  'google_cloud_run_service': 'compute_container',
  'google_cloud_run_v2_service': 'compute_container',
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
  // Compute expansion
  'google_container_node_pool': 'compute_container',

  // Azure
  'azurerm_container_app': 'compute_container',
  'azurerm_container_app_environment': 'compute_container',
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
  'azurerm_servicebus_namespace': 'messaging_queue',
  // Compute expansion
  'azurerm_kubernetes_cluster_node_pool': 'compute_container',
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

  // Check for compute type - ECS Fargate (Cost Effective) vs EKS (High Performance)
  if (services.find(s => s.service_class === 'compute_container')) {
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (aws_eks/aws_ecs)");
    }

    const config = sizing.services?.compute_container || { instances: 2, cpu: 1024, memory_mb: 2048 };
    const cpu = config.cpu || (tier === 'LARGE' ? 2048 : tier === 'SMALL' ? 256 : 1024);
    const memory = config.memory_mb || (tier === 'LARGE' ? 4096 : tier === 'SMALL' ? 512 : 2048);

    if (costProfile === 'HIGH_PERFORMANCE') {
      terraform += `
resource "aws_eks_cluster" "main" {
  name     = "app-eks-cluster"
  role_arn = "arn:aws:iam::123:role/eks-role"
  vpc_config {
    subnet_ids = ["subnet-1", "subnet-2"]
  }
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "app-nodes"
  node_role_arn   = "arn:aws:iam::123:role/node-role"
  subnet_ids      = ["subnet-1", "subnet-2"]
  instance_types  = ["t3.medium"]

  scaling_config {
    desired_size = ${Math.max(2, (config.instances || 2) + 1)}
    max_size     = 10
    min_size     = 1
  }
}
`;
    } else {
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
  }

  // Lambda (serverless)
  if (services.find(s => s.service_class === 'compute_serverless')) {
    const config = sizing.services?.compute_serverless || {};
    const memorySize = config.memory_mb || (tier === 'LARGE' ? 1024 : tier === 'SMALL' ? 256 : 512);
    // High performance serverless gets more memory/concurrency (simulated via memory size here)
    const effectiveMemory = costProfile === 'HIGH_PERFORMANCE' ? memorySize * 2 : memorySize;

    terraform += `
resource "aws_lambda_function" "app" {
  function_name = "app-function"
  runtime       = "nodejs18.x"
  handler       = "index.handler"
  memory_size   = ${Math.min(10240, effectiveMemory)}
  timeout       = 30
  filename      = "dummy.zip"
}
`;
  }

  if (services.find(s => s.service_class === 'compute_vm')) {
    const config = sizing.services?.compute_vm || {};
    const instanceType = costProfile === 'HIGH_PERFORMANCE' ? 'm5.large' : (config.instance_type || 't3.medium');
    terraform += `
resource "aws_instance" "app" {
  instance_type = "${instanceType}"
  ami           = "ami-0c55b159cbfafe1f0"
}
`;
  }

  // Database - RDS vs Aurora
  if (services.find(s => s.service_class === 'relational_database')) {
    const config = sizing.services?.relational_database || {};
    const instanceClass = tier === 'LARGE' ? 'db.t3.medium' : tier === 'SMALL' ? 'db.t3.micro' : 'db.t3.small';

    if (costProfile === 'HIGH_PERFORMANCE') {
      terraform += `
resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "aurora-cluster"
  engine             = "aurora-postgresql"
  database_name      = "app_db"
  master_username    = "foo"
  master_password    = "bar"
}

resource "aws_rds_cluster_instance" "aurora_instances" {
  count              = 2
  identifier         = "aurora-instance-\${count.index}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.r5.large"
  engine             = aws_rds_cluster.aurora.engine
}
`;
    } else {
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
  }

  // Cache
  if (services.find(s => s.service_class === 'cache')) {
    const config = sizing.services?.cache || {};
    // High performance gets dedicated nodes
    const nodeType = costProfile === 'HIGH_PERFORMANCE' ? 'cache.m5.large'
      : (tier === 'LARGE' ? 'cache.t3.medium' : 'cache.t3.small');

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
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (google_container/google_cloud_run)");
    }

    if (costProfile === 'HIGH_PERFORMANCE') {
      terraform += `
resource "google_container_cluster" "primary" {
  name     = "primary-cluster"
  location = "us-central1"
  initial_node_count = 1
  node_config {
    machine_type = "e2-standard-4"
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}
`;
    } else {
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
  }

  if (services.find(s => s.service_class === 'relational_database')) {
    // High Performance uses Custom instance vs Shared Core
    const dbTier = costProfile === 'HIGH_PERFORMANCE'
      ? 'db-custom-4-16384'
      : (tier === 'LARGE' ? 'db-custom-2-4096' : tier === 'SMALL' ? 'db-f1-micro' : 'db-custom-1-3840');

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
    const cacheTier = costProfile === 'HIGH_PERFORMANCE' ? 'STANDARD_HA' : 'BASIC';

    terraform += `
resource "google_redis_instance" "cache" {
  name           = "app-cache"
  tier           = "${cacheTier}"
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
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (azurerm_kubernetes/azurerm_container_app)");
    }

    if (costProfile === 'HIGH_PERFORMANCE') {
      terraform += `
resource "azurerm_kubernetes_cluster" "aks" {
  name                = "app-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "app-aks"

  default_node_pool {
    name       = "default"
    node_count = ${tier === 'LARGE' ? 3 : 2}
    vm_size    = "Standard_DS2_v2"
  }

  identity {
    type = "SystemAssigned"
  }
}
`;
    } else {
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
  }

  if (services.find(s => s.service_class === 'relational_database')) {
    // High Performance uses Memory Optimized
    const skuName = costProfile === 'HIGH_PERFORMANCE'
      ? 'MO_Standard_E2ds_v4'
      : (tier === 'LARGE' ? 'GP_Standard_D2s_v3' : tier === 'SMALL' ? 'B_Standard_B1ms' : 'GP_Standard_D2s_v3');

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
    const family = costProfile === 'HIGH_PERFORMANCE' ? 'P' : 'C'; // Premium vs Standard
    const sku = costProfile === 'HIGH_PERFORMANCE' ? 'Premium' : 'Standard';
    const capacity = tier === 'LARGE' ? 2 : 1;

    terraform += `
resource "azurerm_redis_cache" "cache" {
  name                = "app-cache"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = ${capacity}
  family              = "${family}"
  sku_name            = "${sku}"
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
 * Generate Infracost usage file (YAML) from profile
 * Maps abstract usage (users, storage) to concrete resource usage keys
 */
function generateUsageFile(usageProfile) {
  if (!usageProfile) return null;

  // Calculate derived metrics
  const monthlyRequests = (usageProfile.monthly_users || 1000) * (usageProfile.requests_per_user || 50) * 30;
  const storageGB = usageProfile.storage_gb || 10;
  const dataTransferGB = usageProfile.data_transfer_gb || 50;

  // Initial YAML structure
  let yaml = `version: 0.1
usage:
`;

  // AWS Mappings
  yaml += `  aws_lambda_function.app:
    monthly_requests: ${monthlyRequests}
    request_duration_ms: 250
  aws_apigatewayv2_api.api:
    monthly_requests: ${monthlyRequests}
  aws_s3_bucket.storage:
    storage_gb: ${storageGB}
    monthly_data_transfer_gb: {
      "outbound_internet": ${dataTransferGB}
    }
  aws_db_instance.db:
    storage_gb: ${storageGB}
  aws_lb.alb:
    new_connections: ${monthlyRequests}
    active_connections: ${Math.round(monthlyRequests / 30 / 24 / 60)}
    processed_bytes: ${dataTransferGB * 1024 * 1024 * 1024}
`;

  // GCP Mappings
  yaml += `  google_cloud_run_service.app:
    request_count: ${monthlyRequests}
  google_storage_bucket.storage:
    storage_gb: ${storageGB}
    monthly_outbound_data_transfer_gb: ${dataTransferGB}
  google_sql_database_instance.db:
    storage_gb: ${storageGB}
`;

  // Azure Mappings
  yaml += `  azurerm_container_app.app:
    v_cpu_duration: ${monthlyRequests * 0.5} # rough estimate
  azurerm_storage_account.storage:
    storage_gb: ${storageGB}
    monthly_data_transfer_gb: ${dataTransferGB}
  azurerm_postgresql_flexible_server.db:
    storage_gb: ${storageGB}
`;

  return yaml;
}

/**
 * Run Infracost CLI and get JSON output
 * ASYNC: Uses exec with promisify to prevent blocking the event loop
 */
async function runInfracost(terraformDir, usageFilePath = null) {
  try {
    // Check if Infracost API key is set
    if (!process.env.INFRACOST_API_KEY) {
      console.warn("INFRACOST_API_KEY not set, using mock data");
      return null;
    }

    const util = require('util');
    const exec = util.promisify(require('child_process').exec);

    let command = `infracost breakdown --path "${terraformDir}" --format json`;
    if (usageFilePath && fs.existsSync(usageFilePath)) {
      command += ` --usage-file "${usageFilePath}"`;
    }

    console.log(`[INFRACOST] Executing: ${command}`);

    const { stdout, stderr } = await exec(command, {
      env: {
        ...process.env,
        INFRACOST_API_KEY: process.env.INFRACOST_API_KEY
      },
      timeout: 30000, // 30 second timeout
      maxBuffer: 1024 * 1024 * 10 // 10MB
    });

    if (stderr && stderr.includes('Error:')) {
      console.warn(`Infracost CLI error output: ${stderr}`);
    }

    return JSON.parse(stdout);

  } catch (error) {
    if (error.killed) {
      console.error(`Infracost CLI timed out for ${terraformDir}`);
    } else {
      console.error(`Infracost CLI error for ${terraformDir}:`, error.message);
    }
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
/**
 * Generate cost estimate for a single provider
 */
async function generateCostEstimate(provider, infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null) {
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

  // Generate Usage File (Layer B)
  let usageFilePath = null;
  if (usageOverrides) {
    const usageYaml = generateUsageFile(usageOverrides);
    if (usageYaml) {
      usageFilePath = path.join(providerDir, 'infracost-usage.yml');
      fs.writeFileSync(usageFilePath, usageYaml);
      console.log(`Generated Usage File for ${provider} at ${usageFilePath}`);
    }
  }

  // Try to run Infracost CLI with usage file
  const infracostResult = await runInfracost(providerDir, usageFilePath);

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
 * Calculate costs for Low/Expected/High scenarios
 */
async function calculateScenarios(infraSpec, intent, usageProfile) {
  console.log('[SCENARIOS] Building canonical cost scenarios...');

  const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';
  const genericServices = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

  console.log(`[SCENARIOS] Pattern: ${pattern}, Services: ${genericServices.join(', ')}`);

  // ═══════════════════════════════════════════════════════════════════
  // CALCULATE RAW COSTS FOR 3 PROFILES
  // ═══════════════════════════════════════════════════════════════════
  const [costEffectiveRaw, standardRaw, highPerfRaw] = await Promise.all([
    performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile?.low, true),
    performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile?.expected, true),
    performCostAnalysis(infraSpec, intent, 'HIGH_PERFORMANCE', usageProfile?.high, true)
  ]);

  // ═══════════════════════════════════════════════════════════════════
  // BUILD CANONICAL CostScenarios STRUCTURE
  // Each profile contains { aws: CostResult, gcp: CostResult, azure: CostResult }
  // ═══════════════════════════════════════════════════════════════════
  function extractCostResults(rawResult, usageData) {
    const results = {};
    const providers = ['aws', 'gcp', 'azure', 'AWS', 'GCP', 'AZURE'];

    providers.forEach(p => {
      const pLower = p.toLowerCase();
      // Try to find cost from various possible locations
      const providerData = rawResult?.provider_details?.[p] ||
        rawResult?.provider_details?.[pLower] ||
        rawResult?.cost_estimates?.[pLower] ||
        {};

      const cost = providerData?.monthly_cost ||
        providerData?.total_monthly_cost ||
        providerData?.total || 0;

      if (cost > 0 && !results[pLower]) {
        // Build canonical CostResult WITH USAGE DATA for dynamic weights
        results[pLower] = costResultModel.buildCostResult(
          pLower,
          pattern,
          cost,
          genericServices,
          usageData  // Pass usage for dynamic weight calculation
        );
        console.log(`[SCENARIOS] ${pLower.toUpperCase()}: $${cost.toFixed(2)}`);
      }
    });

    return results;
  }

  const scenarios = costResultModel.buildCostScenarios(
    extractCostResults(costEffectiveRaw, usageProfile?.low),
    extractCostResults(standardRaw, usageProfile?.expected),
    extractCostResults(highPerfRaw, usageProfile?.high)
  );

  // ═══════════════════════════════════════════════════════════════════
  // AGGREGATE AND CALCULATE RANGE/RECOMMENDED
  // ═══════════════════════════════════════════════════════════════════
  const aggregation = costResultModel.aggregateScenarios(scenarios);

  console.log(`[SCENARIOS] Cost Range: ${aggregation.cost_range.formatted}`);
  console.log(`[SCENARIOS] Recommended: ${aggregation.recommended.provider} @ ${aggregation.recommended.formatted_cost}`);

  // ═══════════════════════════════════════════════════════════════════
  // COMPUTE CONFIDENCE WITH EXPLANATION (deterministic)
  // ═══════════════════════════════════════════════════════════════════
  const confidenceResult = costResultModel.computeConfidence(infraSpec, scenarios, usageProfile?.expected);
  console.log(`[SCENARIOS] Confidence: ${confidenceResult.percentage}% - ${confidenceResult.explanation.join(', ')}`);

  return {
    // CANONICAL STRUCTURE
    scenarios,

    // Aggregated values
    cost_range: aggregation.cost_range,
    recommended: aggregation.recommended,

    // Confidence with explanation
    confidence: confidenceResult.score,
    confidence_percentage: confidenceResult.percentage,
    confidence_explanation: confidenceResult.explanation,

    // Drivers from recommended (quantified)
    drivers: aggregation.recommended.drivers || [],

    // Services from recommended (with provider-specific names)
    services: aggregation.recommended.services || [],

    // Legacy compatibility
    low: aggregation.cost_range.min,
    expected: scenarios.standard?.aws?.monthly_cost || 0,
    high: aggregation.cost_range.max,

    // Full details
    details: {
      ...standardRaw,
      scenarios,
      cost_range: aggregation.cost_range,
      recommended: aggregation.recommended,
      confidence: confidenceResult.score,
      confidence_percentage: confidenceResult.percentage,
      confidence_explanation: confidenceResult.explanation,
      drivers: aggregation.recommended.drivers,
      services: aggregation.recommended.services
    }
  };
}

/**
 * Perform full cost analysis across providers
 * Now accepts optional `usageOverrides` for deterministic behavior (Layer B)
 */


function shouldSkipProvider(provider, infraSpec) {
  return false; // MVP: Check all
}

/**
 * Generate cost estimates for all providers
 */
async function generateAllProviderEstimates(infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null) {
  const providers = ['AWS', 'GCP', 'AZURE'];

  // Parallelize provider estimates
  const estimatePromises = providers.map(provider =>
    generateCostEstimate(provider, infraSpec, intent, costProfile, usageOverrides)
  );

  const results = await Promise.all(estimatePromises);

  const estimates = {};
  providers.forEach((provider, index) => {
    estimates[provider] = results[index];
  });

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
 * Build usage profile from intent and overrides for cost engines
 */
function buildUsageProfile(infraSpec, intent, usageOverrides) {
  // Start with defaults
  const profile = {
    monthly_users: { min: 1000, expected: 5000, max: 20000 },
    requests_per_user: { min: 10, expected: 30, max: 100 },
    data_transfer_gb: { min: 10, expected: 50, max: 200 },
    storage_gb: { min: 5, expected: 20, max: 100 },
    jobs_per_day: { min: 1, expected: 5, max: 20 },
    job_duration_hours: { min: 0.5, expected: 1, max: 4 }
  };

  // Override from intent.usage_profile if exists
  if (intent?.usage_profile) {
    Object.assign(profile, intent.usage_profile);
  }

  // Override from explicit user overrides
  if (usageOverrides) {
    Object.assign(profile, usageOverrides);
  }

  return profile;
}

/**
 * Build selected services map for UI display
 */
function buildSelectedServicesMap(infraSpec) {
  const services = infraSpec.service_classes?.required_services || [];
  const map = {};

  for (const s of services) {
    const key = s.service_class || s.name || 'unknown';
    map[key] = s.display_name || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  return map;
}

/**
 * Calculate cost sensitivity based on pattern and cost structure
 */
function calculateCostSensitivity(pattern, costResult) {
  // Static sites have very low sensitivity
  if (pattern === 'STATIC_WEB_HOSTING') {
    return {
      level: 'low',
      label: 'Storage-bound',
      factor: 'bandwidth usage'
    };
  }

  // Serverless is usage-sensitive
  if (pattern === 'SERVERLESS_WEB_APP' || pattern === 'MOBILE_BACKEND_API') {
    return {
      level: 'medium',
      label: 'Usage-sensitive',
      factor: 'API request volume'
    };
  }

  // Container/VM patterns are compute-heavy
  if (pattern === 'CONTAINERIZED_WEB_APP' || pattern === 'TRADITIONAL_VM_APP') {
    return {
      level: 'high',
      label: 'Compute-heavy',
      factor: 'node count and instance size'
    };
  }

  // Pipeline is data-volume sensitive
  if (pattern === 'DATA_PROCESSING_PIPELINE') {
    return {
      level: 'high',
      label: 'Data-volume sensitive',
      factor: 'data volume and job frequency'
    };
  }

  return {
    level: 'medium',
    label: 'Standard sensitivity',
    factor: 'overall usage'
  };
}

/**
 * Build scenario analysis for what-if scenarios
 */
function buildScenarioAnalysis(pattern, costResult) {
  const baseCost = costResult.cost_estimates?.aws?.expected || 100;

  return {
    traffic_doubles: {
      estimated_increase: pattern === 'STATIC_WEB_HOSTING' ? '15%' : '30%',
      estimated_cost: Math.round(baseCost * 1.3),
      description: pattern === 'STATIC_WEB_HOSTING'
        ? 'Static sites scale well with CDN caching.'
        : 'Cost scales with API requests and compute.'
    },
    storage_doubles: {
      estimated_increase: '5%',
      estimated_cost: Math.round(baseCost * 1.05),
      description: 'Storage is generally the cheapest resource to scale.'
    },
    add_database: {
      estimated_increase: '$25-50/mo',
      description: 'Adding a managed database typically costs $25-50/month at small scale.'
    }
  };
}

/**
 * 🔒 FIX 5: DEDICATED STATIC COST ENGINE
 * Static cost is formula-based, not Terraform-based.
 */
function handleStaticWebsiteCost(infraSpec, intent, usageProfile) {
  console.log('[COST ENGINE] STATIC_ONLY triggered');

  // Use the expected usage or fallback to small defaults
  const usage = (usageProfile && usageProfile.expected) || {
    storage_gb: 2,
    data_transfer_gb: 10
  };

  const pricing = {
    AWS: {
      storage: 0.023,
      bandwidth: 0.085,
      dns: 0.5,
      cdn: 0.01 // per GB
    },
    GCP: {
      storage: 0.020,
      bandwidth: 0.080,
      dns: 0.3,
      cdn: 0.008
    },
    AZURE: {
      storage: 0.024,
      bandwidth: 0.087,
      dns: 0.4,
      cdn: 0.011
    }
  };

  const results = {};
  const providers = ["AWS", "GCP", "AZURE"];

  for (const cloud of providers) {
    const p = pricing[cloud];

    // Formula: Storage + Bandwidth + DNS + Flat CDN platform fee
    const base =
      (usage.storage_gb * p.storage) +
      (usage.data_transfer_gb * p.bandwidth) +
      (usage.data_transfer_gb * p.cdn) +
      p.dns +
      0.5; // Base platform fee

    results[cloud] = {
      provider: cloud,
      total_monthly_cost: Number(base.toFixed(2)),
      formatted_cost: `$${base.toFixed(2)}/month`,
      cost_range: {
        estimate: base,
        low: Number((base * 0.9).toFixed(2)),
        high: Number((base * 1.3).toFixed(2)),
        formatted: `$${(base * 0.9).toFixed(2)} - $${(base * 1.3).toFixed(2)}/mo`
      },
      service_count: 3,
      services: [
        { service_class: 'object_storage', display_name: 'Object Storage', cost: { monthly: Number((usage.storage_gb * p.storage).toFixed(2)) } },
        { service_class: 'cdn', display_name: 'CDN/Compute@Edge', cost: { monthly: Number((usage.data_transfer_gb * (p.bandwidth + p.cdn)).toFixed(2)) } },
        { service_class: 'dns', display_name: 'DNS', cost: { monthly: p.dns } }
      ],
      is_mock: true
    };
  }

  // Sort by cost to find cheapest
  const rankings = providers
    .map(p => ({
      provider: p,
      monthly_cost: results[p].total_monthly_cost,
      score: p === 'GCP' ? 95 : (p === 'AWS' ? 92 : 88) // Static weights
    }))
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: results[r.provider].formatted_cost,
      cost_range: results[r.provider].cost_range
    }));

  const recommendedProvider = rankings[0].provider;

  return {
    cost_profile: 'COST_EFFECTIVE',
    deployment_type: 'static',
    scale_tier: 'SMALL',
    rankings,
    provider_details: results,
    recommended_provider: recommendedProvider,
    used_real_pricing: false,
    recommended: {
      provider: recommendedProvider,
      cost_range: results[recommendedProvider].cost_range,
      service_count: 3,
      score: rankings[0].score,
      monthly_cost: results[recommendedProvider].total_monthly_cost
    },
    recommended_cost_range: results[recommendedProvider].cost_range,
    cost_profiles: {
      COST_EFFECTIVE: { total: results[recommendedProvider].total_monthly_cost, formatted: results[recommendedProvider].formatted_cost },
      HIGH_PERFORMANCE: { total: results[recommendedProvider].total_monthly_cost, formatted: results[recommendedProvider].formatted_cost }
    },
    category_breakdown: [
      { category: 'Networking & CDN', total: Number((usage.data_transfer_gb * (pricing[recommendedProvider].bandwidth + pricing[recommendedProvider].cdn) + pricing[recommendedProvider].dns).toFixed(2)), service_count: 2 },
      { category: 'Databases & Files', total: Number((usage.storage_gb * pricing[recommendedProvider].storage).toFixed(2)), service_count: 1 }
    ],
    summary: {
      cheapest: rankings[0].provider,
      most_performant: 'GCP',
      best_value: rankings[0].provider
    },
    ai_explanation: {
      confidence_score: 0.95,
      rationale: "Static hosting costs are highly predictable and calculated based on storage and transit volume."
    }
  };
}

/**
 * 🔒 DEFENSIVE KILL SWITCH
 */
function assertNoComputeForStatic(terraformContent) {
  const forbidden = [
    "aws_eks", "aws_ecs", "aws_instance", "aws_lambda",
    "google_container", "google_cloud_run", "google_compute",
    "azurerm_kubernetes", "azurerm_container_app", "azurerm_virtual_machine"
  ];

  for (const f of forbidden) {
    if (terraformContent.includes(f)) {
      throw new Error(`🔒 SECURITY VIOLATION: STATIC_WEB_HOSTING attempts to create forbidden compute resource: ${f}`);
    }
  }
}

/**
 * Aggregate costs by category for Tier 2 breakdown view
 */
function aggregateCategoryBreakdown(services) {
  const categories = {};

  for (const service of services) {
    // Standardize category casing to PascalCase for backend-frontend consistency
    let category = service.category || 'Other';
    if (category.toLowerCase() === 'compute') category = 'Compute';
    if (category.toLowerCase().includes('data')) category = 'Data & State';
    if (category.toLowerCase().includes('traffic') || category.toLowerCase().includes('networking')) category = 'Traffic & Integration';
    if (category.toLowerCase().includes('operations')) category = 'Operations';

    const cost = parseFloat(service.cost?.monthly) || 0;

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
    .filter(cat => cat.total > 0 || cat.services.length > 0) // Keep categories even if total is 0 if they have services
    .map(cat => ({
      category: cat.category,
      total: Math.round(cat.total * 100) / 100,
      formatted: `$${cat.total.toFixed(2)}`,
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
 * Perform full cost analysis across providers
 * 
 * CORE PRINCIPLE:
 *   Pattern → Cost Engine → Pricing Model
 *   AI NEVER bypasses this.
 * 
 * ENGINE TYPES:
 *   - 'formula': Pure math (STATIC_WEB_HOSTING)
 *   - 'hybrid':  Formula + optional Infracost (SERVERLESS, MOBILE)
 *   - 'infracost': Full Terraform IR (CONTAINERIZED, VM, PIPELINE)
 */
async function performCostAnalysis(infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null, onlyPrimary = false) {
  console.log(`--- STEP 3: Cost Analysis Started (Profile: ${costProfile}) ---`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: DETERMINE PATTERN (Already resolved by patternResolver)
  // ═══════════════════════════════════════════════════════════════════
  const pattern = infraSpec.service_classes?.pattern;
  console.log(`[COST ANALYSIS] Pattern: ${pattern}`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2: ROUTE TO DEDICATED COST ENGINE
  // ═══════════════════════════════════════════════════════════════════
  const costEngines = require('./costEngines');
  const engine = costEngines.getEngine(pattern);

  if (engine) {
    console.log(`[COST ANALYSIS] Dispatching to ${pattern} engine (type: ${engine.type})`);

    // Build usage profile from intent + overrides
    const usageProfile = buildUsageProfile(infraSpec, intent, usageOverrides);
    const services = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

    // ═══════════════════════════════════════════════════════════════════
    // CALL ENGINE ONCE - It internally calculates ALL providers
    // ═══════════════════════════════════════════════════════════════════
    const engineResult = engine.calculate(usageProfile, {
      costProfile,
      hasDatabase: services.some(s => ['relational_database', 'nosql_database'].includes(s))
    });

    // ═══════════════════════════════════════════════════════════════════
    // EXTRACT MULTI-CLOUD DATA FROM ENGINE RESULT
    // Engine returns: { cost_estimates: { aws: {...}, gcp: {...}, azure: {...} } }
    // ═══════════════════════════════════════════════════════════════════
    const providers = ['aws', 'gcp', 'azure'];
    const costResults = [];

    for (const provider of providers) {
      // Extract cost data for this provider (handle uppercase/lowercase keys)
      const providerData = engineResult?.cost_estimates?.[provider] ||
        engineResult?.cost_estimates?.[provider.toUpperCase()] || {};

      const numericCost = providerData.total || 0;

      // Build structured CostResult for this provider
      // Build structured CostResult for this provider
      const structuredResult = costResultModel.buildCostResult(
        provider,
        pattern,
        numericCost,
        services,
        usageProfile
      );

      costResults.push(structuredResult);
      console.log(`[COST ANALYSIS] ${pattern} engine returned: $${numericCost.toFixed(2)} (${provider.toUpperCase()})`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // AGGREGATION (MANDATORY)
    // Combine all provider results into UI-ready format
    // ═══════════════════════════════════════════════════════════════════
    const aggregated = costResultModel.aggregateCostResults(costResults);

    // Build final result with all required fields
    const result = {
      pattern,
      cost_profile: costProfile,
      deployment_type: pattern.toLowerCase().includes('static') ? 'static' :
        pattern.toLowerCase().includes('serverless') ? 'serverless' : 'compute',
      scale_tier: sizingModel.determineScaleTier(intent),
      assumption_source: usageOverrides ? 'user_provided' : 'ai_inferred',

      // Multi-cloud comparison data
      comparison: aggregated.comparison,
      rankings: costResults.map((r, idx) => ({
        provider: r.provider,
        monthly_cost: r.monthly_cost,
        formatted_cost: r.formatted_cost,
        rank: idx + 1,
        recommended: r.provider === aggregated.recommended.provider,
        confidence: r.confidence,
        score: r.score || Math.round((r.confidence || 0.75) * 100) // Ensure score is present
      })).sort((a, b) => a.monthly_cost - b.monthly_cost),

      // Recommended provider details
      recommended_provider: aggregated.recommended.provider,
      recommended: aggregated.recommended,
      recommended_cost_range: aggregated.cost_range,

      // Provider details for UI
      provider_details: aggregated.comparison,
      cost_estimates: aggregated.comparison,

      // Breakdown and drivers
      category_breakdown: aggregated.recommended.breakdown ?
        Object.entries(aggregated.recommended.breakdown).map(([cat, cost]) => ({
          category: cat.charAt(0).toUpperCase() + cat.slice(1),
          total: cost,
          service_count: 1
        })) : [],

      // Services and drivers
      selected_services: buildSelectedServicesMap(infraSpec),
      cost_sensitivity: calculateCostSensitivity(pattern, aggregated.recommended),
      scenario_analysis: buildScenarioAnalysis(pattern, aggregated.recommended),

      // Confidence (data-based, not AI-dependent)
      confidence: aggregated.confidence,
      ai_explanation: {
        confidence_score: aggregated.confidence,
        rationale: `Cost estimates based on ${pattern} pattern with ${services.length} services.`
      },

      // Summary
      summary: {
        cheapest: aggregated.recommended.provider,
        most_performant: 'GCP', // Default heuristic
        best_value: aggregated.recommended.provider,
        confidence: aggregated.confidence
      }
    };

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  // FALLBACK: Legacy Infracost path for undefined patterns
  // This should rarely trigger with proper pattern resolution
  // ═══════════════════════════════════════════════════════════════════
  console.warn(`[COST ANALYSIS] No dedicated engine for pattern: ${pattern}. Using legacy path.`);

  // Get scale tier (for non-static patterns)
  const tier = sizingModel.determineScaleTier(intent);

  // OPTIMIZATION: Only run secondary profile if comparison is needed
  let costEffectiveEstimates, highPerfEstimates;

  if (onlyPrimary) {
    const estimate = await generateAllProviderEstimates(infraSpec, intent, costProfile, usageOverrides);
    costEffectiveEstimates = costProfile === 'COST_EFFECTIVE' ? estimate : null;
    highPerfEstimates = costProfile === 'HIGH_PERFORMANCE' ? estimate : null;
  } else {
    [costEffectiveEstimates, highPerfEstimates] = await Promise.all([
      generateAllProviderEstimates(infraSpec, intent, 'COST_EFFECTIVE', usageOverrides),
      generateAllProviderEstimates(infraSpec, intent, 'HIGH_PERFORMANCE', usageOverrides)
    ]);
  }

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

    // Add recommended object for frontend clarity
    recommended: {
      provider: recommendedProvider,
      cost_range: estimates[recommendedProvider]?.cost_range,
      service_count: estimates[recommendedProvider]?.service_count,
      score: rankings[0]?.score,
      monthly_cost: estimates[recommendedProvider]?.total_monthly_cost
    },

    // FIX 3: Both profiles stored separately for comparison
    cost_profiles: {
      COST_EFFECTIVE: costEffectiveEstimates ? {
        total: costEffectiveEstimates[recommendedProvider]?.total_monthly_cost,
        formatted: costEffectiveEstimates[recommendedProvider]?.formatted_cost,
        selected_services: costEffectiveEstimates[recommendedProvider]?.selected_services,
        service_costs: costEffectiveEstimates[recommendedProvider]?.service_costs
      } : { total: estimates[recommendedProvider]?.total_monthly_cost, formatted: estimates[recommendedProvider]?.formatted_cost },
      HIGH_PERFORMANCE: highPerfEstimates ? {
        total: highPerfEstimates[recommendedProvider]?.total_monthly_cost,
        formatted: highPerfEstimates[recommendedProvider]?.formatted_cost,
        selected_services: highPerfEstimates[recommendedProvider]?.selected_services,
        service_costs: highPerfEstimates[recommendedProvider]?.service_costs
      } : { total: estimates[recommendedProvider]?.total_monthly_cost, formatted: estimates[recommendedProvider]?.formatted_cost }
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
    },

    // Ensure ai_explanation exists for frontend confidence dial
    ai_explanation: {
      confidence_score: usedRealData ? 0.92 : 0.75,
      rationale: usedRealData ? "Based on real-time provider pricing and specified usage." : "Based on historical average pricing for similar architectural patterns."
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
  calculateScenarios,
  // Exposed for testing
  generateAWSTerraform,
  generateGCPTerraform,
  generateAzureTerraform,
  runInfracost,
  normalizeInfracostOutput
};

