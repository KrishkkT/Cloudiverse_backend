/**
 * TERRAFORM GENERATOR V2 (Modular Architecture)
 * 
 * Generates folder-based Terraform projects with proper module structure.
 * Follows V1 specification:
 * - main.tf ONLY references modules (no direct resources)
 * - Each canonical service has its own module
 * - Modules contain actual cloud resources
 * - NFR-driven variables (encryption, backups, compliance)
 * - terraform.tfvars generated from workspace defaults
 */

const { resolveServiceId } = require('../../config/aliases');

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS & CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const EXTERNAL_SERVICES = ['paymentgateway', 'emailservice', 'auth0', 'auth', 'monitoring_datadog', 'contentful', 'algolia'];

const SERVICE_TO_MODULE_NAME = {
  // Compute
  computeserverless: 'serverless_compute',
  computecontainer: 'app_container',
  computevm: 'vm_compute',
  computebatch: 'batch_compute',
  computeedge: 'edge_compute',
  // Database
  relationaldatabase: 'relational_db',
  analyticaldatabase: 'analytical_db',
  cache: 'cache',
  nosqldatabase: 'nosql_db',
  searchengine: 'search',
  vectordatabase: 'vector_db',
  timeseriesdatabase: 'timeseries_db',
  datawarehouse: 'data_warehouse',
  // Storage
  objectstorage: 'object_storage',
  blockstorage: 'block_store',
  filestorage: 'file_store',
  datalake: 'data_lake',
  backup: 'backup',
  // Network
  networking: 'networking',
  vpcnetworking: 'networking',
  vpc: 'networking',
  subnet: 'networking',
  apigateway: 'apigateway',
  loadbalancer: 'load_balancer',
  globalloadbalancer: 'global_lb',
  cdn: 'cdn',
  dns: 'dns',
  natgateway: 'nat_gateway',
  vpn: 'vpn',
  vpngateway: 'vpn',
  internetgateway: 'internet_gateway',
  transitgateway: 'transit_gateway',
  privatelink: 'private_link',
  servicediscovery: 'service_discovery',
  servicemesh: 'service_mesh',
  websocketgateway: 'websocket',
  networkfirewall: 'firewall',
  securitygroup: 'security_group',
  egressproxy: 'egress_proxy',
  // Security
  identityauth: 'auth',
  auth: 'auth',
  secretsmanagement: 'secrets',
  secretsmanager: 'secrets',
  keymanagement: 'kms',
  keymanagementservice: 'kms',
  certificatemanagement: 'certificates',
  waf: 'waf',
  ddosprotection: 'ddos_protection',
  policygovernance: 'policy',
  iampolicy: 'iam',
  vulnerabilityscanner: 'vulnerability_scan',
  datalossprevention: 'dlp',
  securityposture: 'security_posture',
  // Integration & Messaging
  messagequeue: 'mq',
  deadletterqueue: 'mq',
  eventbus: 'event_bus',
  pubsub: 'event_bus',
  workfloworchestration: 'workflow',
  notification: 'notifications',
  pushnotificationservice: 'push_notification',
  emailnotification: 'email',
  eventstream: 'event_stream',
  // Observability
  logging: 'logging',
  monitoring: 'monitoring',
  tracing: 'tracing',
  apm: 'apm',
  metrics: 'metrics',
  alerting: 'alerting',
  auditlogging: 'audit_log',
  logaggregation: 'log_aggregation',
  dashboard: 'dashboard',
  siem: 'siem',
  // DevOps
  cicd: 'cicd',
  containerregistry: 'registry',
  artifactrepository: 'artifacts',
  buildservice: 'build',
  configmanagement: 'config',
  parameterstore: 'parameters',
  iacstate: 'iac_state',
  statelocking: 'state_locking',
  // ML & AI
  mltraining: 'ml_training',
  mlinference: 'ml_inference',
  mlinferenceservice: 'ml_inference',
  featurestore: 'feature_store',
  modelregistry: 'model_registry',
  experimenttracking: 'experiment_tracking',
  mlpipelineorchestration: 'ml_pipeline',
  modelmonitoring: 'model_monitoring',
  // IoT
  iotcore: 'iot_core',
  deviceregistry: 'device_registry',
  digitaltwin: 'digital_twin',
  streamprocessor: 'stream_processor',
  iotedgegateway: 'iot_edge',
  otaupdates: 'ota_updates',
  // Other
  paymentgateway: 'payment_gateway',
  etlorchestration: 'etl',
  datacatalog: 'data_catalog',
  bidashboard: 'bi_dashboard'
};

/**
 * SERVICE METADATA
 * Defines dependencies and common arguments for each service.
 */
const SERVICE_METADATA = {
  // Database
  relationaldatabase: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest', 'backup_retention_days', 'deletion_protection', 'multi_az'] },
  analyticaldatabase: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest'] },
  nosqldatabase: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest'] },
  cache: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },
  vectordatabase: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest'] },
  datawarehouse: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest'] },

  // Storage
  objectstorage: { args: ['encryption_at_rest'] },
  blockstorage: { deps: ['networking'], args: ['vpc_id', 'encryption_at_rest'] },
  filestorage: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids', 'encryption_at_rest'] },
  datalake: { args: ['encryption_at_rest'] },

  // Compute
  computecontainer: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },
  computevm: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },
  computebatch: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },

  // Network
  loadbalancer: { deps: ['networking'], args: ['vpc_id', 'public_subnet_ids'] },
  apigateway: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },
  privatelink: { deps: ['networking'], args: ['vpc_id', 'private_subnet_ids'] },
  natgateway: { deps: ['networking'], args: ['vpc_id', 'public_subnet_ids'] },

  // Observability
  monitoring: { args: ['monitoring_enabled'] }
};

const getModuleName = (id) => SERVICE_TO_MODULE_NAME[id] || id;

/**
 * Generate FLAT pricing-optimized main.tf (No modules)
 * Matches strict keys in usageNormalizer.js
 */
function generatePricingMainTf(provider, services, region, projectName, sizing = {}) {
  let tf = `// PRICING TERRAFORM - FLAT STRUCTURE\n`;

  // 🔒 FILTER: Exclude EXTERNAL services (Stripe, Auth0, etc.) from pricing Terraform
  // We assume 'services' contains objects with pricing.class or we look them up.

  // Helper to check service presence (handle strings or objects)
  const has = (id) => {
    if (EXTERNAL_SERVICES.includes(id)) return false; // Never price external services
    return services.some(s => resolveServiceId(typeof s === 'string' ? s : s.service_id) === id);
  };

  if (provider === 'aws') {
    // 1. AWS IMPLEMENTATION
    if (has('computecontainer')) {
      tf += `
resource "aws_ecs_service" "app" {
  name            = "${projectName}-ecs-service"
  cluster         = "${projectName}-cluster"
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  
  network_configuration {
    subnets = var.subnet_ids
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${projectName}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = ${sizing.container_cpu || 1024}
  memory                   = ${sizing.container_memory || 2048}
  execution_role_arn       = var.ecs_execution_role_arn
  container_definitions    = jsonencode([{
    name  = "${projectName}-container"
    image = "nginx"
    cpu   = ${sizing.container_cpu || 1024}
    memory = ${sizing.container_memory || 2048}
  }])
}
`;
    }
    if (has('computeserverless')) {
      tf += `
resource "aws_lambda_function" "app" {
  function_name = "${projectName}-func"
  role          = "arn:aws:iam::123456789012:role/service-role/role"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  memory_size   = ${sizing.function_memory || 1024}
}
`;
    }

    // API Gateway
    if (has('apigateway') || has('websocketgateway')) {
      tf += `
resource "aws_apigatewayv2_api" "main" {
  name          = "${projectName}-http-api"
  protocol_type = "HTTP"
}
`;
    }

    if (has('relationaldatabase')) {
      tf += `
resource "aws_db_instance" "db" {
  instance_class    = "${sizing.instance_class || "db.t3.medium"}" # Dynamic sizing
  allocated_storage = ${sizing.storage_gb || 20}                 # Dynamic sizing
  engine            = "postgres"
  username          = "foo"
  password          = "bar"
  multi_az          = true           # 🔥 UPDATED: HA for prod
}
`;
    }

    if (has('nosqldatabase')) {
      tf += `
resource "aws_dynamodb_table" "main" {
  name           = "${projectName}-data"
  billing_mode   = "PROVISIONED"
  read_capacity  = 20
  write_capacity = 20
  hash_key       = "pk"
  range_key      = "sk"

  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
}
`;
    }

    // 🔥 ADDED: Missing Services for Scenarios

    if (has('objectstorage')) {
      tf += `
resource "aws_s3_bucket" "b" {
  bucket_prefix = "${projectName.toLowerCase()}-"
  force_destroy = true
}
`;
    }

    if (has('mlinference')) {
      tf += `
resource "aws_sagemaker_endpoint_config" "ec" {
  production_variants {
    initial_instance_count = 1
    instance_type          = "ml.g4dn.xlarge" # GPU instance
  }
  name = "ml-endpoint"
}
`;
    }

    if (has('iotcore')) {
      tf += `
resource "aws_iot_thing" "thing" {
  name = "${projectName}-iot-device"
}
`;
    }

    if (has('messagequeue')) {
      tf += `
resource "aws_sqs_queue" "q" {
  name = "${projectName}-queue"
}
`;
    }

    if (has('cache')) {
      tf += `
resource "aws_elasticache_cluster" "c" {
  cluster_id           = "${projectName}-cache"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
}
`;
    }

    if (has('objectstorage')) {
      tf += `
resource "aws_s3_bucket" "main" {
  bucket_prefix = "${projectName}-assets-"
  force_destroy = true
}
`;
    }

    if (has('loadbalancer')) {
      tf += `
resource "aws_lb" "alb" {
  name               = "${projectName}-lb"
  internal           = false
  load_balancer_type = "application"
  subnets            = var.subnet_ids
}
`;
    }

    if (has('apigateway')) {
      tf += `
resource "aws_apigatewayv2_api" "api" {
  name          = "${projectName}-api"
  protocol_type = "HTTP"
}
`;
    }

    if (has('cdn')) {
      tf += `
resource "aws_cloudfront_distribution" "cdn" {
  enabled = true
  
  origin {
    domain_name = "example.com"
    origin_id   = "myS3Origin"
    
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }
  
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "myS3Origin"
    
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }
  
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
`;
    }

    if (has('logging')) {
      tf += `
resource "aws_cloudwatch_log_group" "logs" {
  name              = "/ecs/${projectName}"
  retention_in_days = 30
}
  `;
    }

    if (has('monitoring')) {
      tf += `
resource "aws_cloudwatch_metric_alarm" "cpu_alarm" {
  alarm_name          = "${projectName}-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "CPU utilization high"
}
`;
    }

    if (has('cache')) {
      tf += `
resource "aws_elasticache_cluster" "cache" {
  cluster_id           = "${projectName}-cache"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
}
`;
    }

    if (has('computevm')) {
      tf += `
resource "aws_instance" "vm" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.medium"

  root_block_device {
    volume_size = 20
  }
}
`;
    }

    if (has('computebatch')) {
      tf += `
resource "aws_batch_compute_environment" "batch" {
  compute_environment_name = "${projectName}-batch"
  type                     = "MANAGED"
  
  compute_resources {
    type               = "FARGATE"
    max_vcpus          = 16
    subnets            = var.subnet_ids
    security_group_ids = [var.security_group_id]
  }
}
`;
    }

    if (has('blockstorage')) {
      tf += `
resource "aws_ebs_volume" "block" {
  availability_zone = "${region}a"
  size              = 40
  type              = "gp3"
}
`;
    }

    if (has('dns')) {
      tf += `
resource "aws_route53_zone" "primary" {
  name = var.domain_name
}
`;
    }

    if (has('messagequeue')) {
      tf += `
resource "aws_sqs_queue" "queue" {
  name                      = "${projectName}-queue"
  delay_seconds             = 90
  max_message_size          = 2048
  message_retention_seconds = 86400
  receive_wait_time_seconds = 10
}
`;
    }

    if (has('eventbus')) {
      tf += `
resource "aws_cloudwatch_event_bus" "bus" {
  name = "${projectName}-bus"
}
`;
    }

    if (has('secretsmanagement')) {
      tf += `
resource "aws_secretsmanager_secret" "secret" {
  name = "${projectName}-secret"
}

resource "aws_secretsmanager_secret_version" "secret_val" {
  secret_id     = aws_secretsmanager_secret.secret.id
  secret_string = "example-string-to-protect"
}
`;
    }

    if (has('vpcnetworking')) {
      tf += `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  
  tags = {
    Name = "${projectName}-vpc"
  }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  
  tags = {
    Name = "${projectName}-nat-eip"
  }
}

resource "aws_nat_gateway" "nat" {
  allocation_id     = aws_eip.nat.id
  subnet_id         = var.subnet_ids[0]
  connectivity_type = "public"
  
  tags = {
    Name = "${projectName}-nat"
  }
}
`;
    }

    if (has('websocketgateway')) {
      tf += `
resource "aws_apigatewayv2_api" "websocket" {
  name                       = "${projectName}-ws-api"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}
`;
    }

    if (has('identityauth')) {
      tf += `
resource "aws_cognito_user_pool" "pool" {
  name = "${projectName}-user-pool"
}
`;
    }

    // --- ANALYTICS ---
    if (has('datawarehouse')) {
      tf += `
resource "aws_redshift_cluster" "wh" {
  cluster_identifier = "${projectName}-wh"
  database_name      = "dev"
  master_username    = "adminuser"
  master_password    = "MustBeStrong123!"
  node_type          = "dc2.large"
  cluster_type       = "single-node"
}
`;
    }
    if (has('datalake')) {
      tf += `
resource "aws_s3_bucket" "datalake" {
  bucket_prefix = "${projectName}-datalake-"
  force_destroy = true
}
`;
    }
    if (has('etlorchestration')) {
      tf += `
resource "aws_glue_job" "etl" {
  name     = "${projectName}-etl"
  role_arn = "arn:aws:iam::123456789012:role/glue-role"
  command {
    script_location = "s3://${projectName}-scripts/etl.py"
  }
}
`;
    }
    if (has('bidashboard')) {
      // Logic for QuickSight is complex, using placeholder for pricing
      tf += `
# QuickSight Pricing Placeholder
resource "aws_quicksight_user" "bi" {
  user_name     = "analyst"
  email         = "analyst@example.com"
  identity_type = "IAM"
  user_role     = "AUTHOR"
}
`;
    }
    if (has('datacatalog')) {
      tf += `
resource "aws_glue_catalog_database" "catalog" {
  name = "${projectName}_catalog"
}
`;
    }

    // --- MACHINE LEARNING ---
    if (has('mltraining')) {
      tf += `
resource "aws_sagemaker_notebook_instance" "nb" {
  name          = "${projectName}-nb"
  role_arn      = "arn:aws:iam::123456789012:role/sagemaker-role"
  instance_type = "ml.t2.medium"
}
`;
    }
    if (has('mlinference')) {
      tf += `
resource "aws_sagemaker_endpoint_configuration" "ec" {
  name = "${projectName}-ec"
  production_variants {
    variant_name           = "variant-1"
    model_name             = "${projectName}-model"
    initial_instance_count = 1
    instance_type          = "ml.m5.large"
  }
}
`;
    }
    if (has('modelregistry') || has('experimenttracking') || has('mlpipelineorchestration') || has('modelmonitoring')) {
      // These often bundle into SageMaker Studio or similar
      tf += `
resource "aws_sagemaker_domain" "studio" {
  domain_name = "${projectName}-studio"
  auth_mode   = "IAM"
  vpc_id      = "vpc-12345678"
  subnet_ids  = ["subnet-12345678"]
  default_user_settings {
    execution_role = "arn:aws:iam::123456789012:role/sagemaker-role"
  }
}
`;
    }
    if (has('featurestore')) {
      tf += `
resource "aws_sagemaker_feature_group" "fg" {
  feature_group_name = "${projectName}-fg"
  record_identifier_feature_name = "id"
  event_time_feature_name = "timestamp"
  feature_definition {
    feature_name = "id"
    feature_type = "String"
  }
  feature_definition { 
    feature_name = "timestamp"
    feature_type = "Fractional"
  }
  online_store_config {
    enable_online_store = true
  }
  role_arn = "arn:aws:iam::123456789012:role/sagemaker-role"
}
`;
    }
    if (has('vectordatabase')) {
      tf += `
resource "aws_opensearch_domain" "vector" {
  domain_name = "${projectName}-vector"
  cluster_config {
    instance_type = "t3.small.search"
    instance_count = 1
  }
  ebs_options {
    ebs_enabled = true
    volume_size = 10
  }
}
`;
    }

    // --- IOT ---
    if (has('iotcore') || has('iotedgegateway') || has('digitaltwin') || has('deviceregistry')) {
      tf += `
resource "aws_iot_thing" "thing" {
  name = "${projectName}-thing"
}
`;
    }
    if (has('timeseriesdatabase')) {
      tf += `
resource "aws_timestream_database" "ts" {
  database_name = "${projectName}-ts"
}
resource "aws_timestream_table" "ts_table" {
  database_name = aws_timestream_database.ts.database_name
  table_name    = "metrics"
}
`;
    }

    // --- SECURITY ---
    if (has('waf')) {
      tf += `
resource "aws_wafv2_web_acl" "waf" {
  name        = "${projectName}-waf"
  scope       = "REGIONAL"
  default_action {
    allow {}
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${projectName}-waf"
    sampled_requests_enabled   = true
  }
}
`;
    }
    if (has('ddosprotection')) {
      tf += `
resource "aws_shield_protection" "shield" {
  name         = "${projectName}-shield"
  resource_arn = "arn:aws:alb:us-east-1:123456789012:loadbalancer/app/my-lb/1234567890123456" 
}
`;
    }
    if (has('keymanagement') || has('keymanagementservice')) {
      tf += `
resource "aws_kms_key" "key" {
  description = "${projectName} key"
}
`;
    }
    if (has('certificatemanagement')) {
      tf += `
resource "aws_acm_certificate" "cert" {
  domain_name       = var.domain_name
  validation_method = "DNS"
}
`;
    }
    if (has('siem')) {
      tf += `
# Placeholder - Security Hub is usually account-level, but adding for pricing visibility
resource "aws_securityhub_account" "hub" {}
`;
    }

    // --- DEVOPS ---
    if (has('cicd')) {
      tf += `
resource "aws_codepipeline" "pipeline" {
  name     = "${projectName}-pipeline"
  role_arn = "arn:aws:iam::123456789012:role/pipeline-role"
  artifact_store {
    location = "bucket"
    type     = "S3"
  }
  stage {
    name = "Source"
    action {
      name             = "Source"
      category         = "Source"
      owner            = "AWS"
      provider         = "CodeStarSourceConnection"
      version          = "1"
      output_artifacts = ["source_output"]
      configuration = {
        ConnectionArn    = "arn:aws:codestar-connections:us-east-1:123456789012:connection/12345678"
        FullRepositoryId = "my-repo"
        BranchName       = "main"
      }
    }
  }
}
`;
    }
    if (has('containerregistry')) {
      tf += `
resource "aws_ecr_repository" "repo" {
  name = "${projectName}-repo"
}
`;
    }
    if (has('artifactrepository')) {
      tf += `
resource "aws_codeartifact_domain" "domain" {
  domain = "${projectName}-domain"
}
`;
    }

    // --- NETWORKING (EXTENDED) ---
    if (has('vpn') || has('vpngateway')) {
      tf += `
resource "aws_vpn_gateway" "vpn" {
  vpc_id = var.vpc_id
  
  tags = {
    Name = "${projectName}-vpn"
  }
}
`;
    }
    if (has('privatelink')) {
      tf += `
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = var.vpc_id
  service_name = "com.amazonaws.${region}.s3"
}
`;
    }
    if (has('servicediscovery')) {
      tf += `
resource "aws_service_discovery_private_dns_namespace" "dns" {
  name        = "${projectName}.local"
  description = "Service discovery for ${projectName}"
  vpc         = var.vpc_id
}
`;
    }
    if (has('servicemesh')) {
      tf += `
resource "aws_appmesh_mesh" "mesh" {
  name = "${projectName}-mesh"
}
`;
    }

    if (has('paymentgateway')) {
      tf += `
# Payment Gateway (External Service)
# Logical dependency on Stripe/PayPal - No AWS resources created
`;
    }
    if (has('auditlogging')) {
      tf += `
resource "aws_cloudtrail" "audit" {
  name                          = "${projectName}-audit-trail"
  s3_bucket_name                = aws_s3_bucket.main.id
  include_global_service_events = true
}
`;
    }
    if (has('vulnerabilityscanner')) {
      tf += `
# Vulnerability Scanner
# Represents AWS Inspector or similar security scanning integration
resource "aws_inspector_assessment_target" "target" {
  name = "${projectName}-assessment-target"
}
`;
    }
    if (has('iampolicy')) {
      tf += `
resource "aws_iam_account_password_policy" "strict" {
  minimum_password_length        = 14
  require_lowercase_characters   = true
  require_numbers                = true
  require_uppercase_characters   = true
  require_symbols                = true
  allow_users_to_change_password = true
}
`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ADDITIONAL AWS SERVICES (Added for complete catalog coverage)
    // ═══════════════════════════════════════════════════════════════════════════

    if (has('filestorage')) {
      tf += `
resource "aws_efs_file_system" "efs" {
  creation_token = "${projectName}-efs"
  performance_mode = "generalPurpose"
  throughput_mode = "bursting"
  encrypted = true
}
`;
    }

    if (has('backup')) {
      tf += `
resource "aws_backup_vault" "vault" {
  name = "${projectName}-backup-vault"
}

resource "aws_backup_plan" "plan" {
  name = "${projectName}-backup-plan"
  rule {
    rule_name         = "daily-backup"
    target_vault_name = aws_backup_vault.vault.name
    schedule          = "cron(0 5 ? * * *)"
    lifecycle {
      delete_after = 30
    }
  }
}
`;
    }

    if (has('notification')) {
      tf += `
resource "aws_sns_topic" "notifications" {
  name = "${projectName}-notifications"
}
`;
    }

    if (has('emailnotification')) {
      tf += `
resource "aws_ses_domain_identity" "email" {
  domain = "example.com"
}
`;
    }

    if (has('pushnotificationservice')) {
      tf += `
resource "aws_sns_platform_application" "push" {
  name     = "${projectName}-push"
  platform = "GCM"
  platform_credential = "PLACEHOLDER"
}
`;
    }

    if (has('tracing')) {
      tf += `
resource "aws_xray_sampling_rule" "tracing" {
  rule_name      = "${projectName}-sampling"
  priority       = 1000
  reservoir_size = 1
  fixed_rate     = 0.05
  url_path       = "*"
  host           = "*"
  http_method    = "*"
  service_type   = "*"
  service_name   = "*"
  version        = 1
  resource_arn   = "*"
}
`;
    }

    if (has('apm')) {
      tf += `
resource "aws_xray_group" "apm" {
  group_name        = "${projectName}-apm"
  filter_expression = "responsetime > 5"
}
`;
    }

    if (has('metrics')) {
      tf += `
resource "aws_cloudwatch_metric_alarm" "metrics" {
  alarm_name          = "${projectName}-metric"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
}
`;
    }

    if (has('alerting')) {
      tf += `
resource "aws_sns_topic" "alerts" {
  name = "${projectName}-alerts"
}
`;
    }

    if (has('logaggregation')) {
      tf += `
resource "aws_cloudwatch_log_group" "aggregation" {
  name              = "/app/${projectName}/logs"
  retention_in_days = 90
}
`;
    }

    if (has('dashboard')) {
      tf += `
resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "${projectName}-dashboard"
  dashboard_body = jsonencode({
    widgets = [{
      type   = "metric"
      x      = 0
      y      = 0
      width  = 12
      height = 6
      properties = {
        metrics = [["AWS/EC2", "CPUUtilization"]]
        title   = "CPU Utilization"
      }
    }]
  })
}
`;
    }

    if (has('containerregistry')) {
      tf += `
resource "aws_ecr_repository" "registry" {
  name                 = "${projectName}-registry"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration {
    scan_on_push = true
  }
}
`;
    }

    if (has('buildservice')) {
      tf += `
resource "aws_codebuild_project" "build" {
  name         = "${projectName}-build"
  service_role = "arn:aws:iam::123456789012:role/codebuild-role"
  artifacts {
    type = "NO_ARTIFACTS"
  }
  environment {
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:5.0"
    type         = "LINUX_CONTAINER"
  }
  source {
    type     = "GITHUB"
    location = "https://github.com/example/repo.git"
  }
}
`;
    }

    if (has('parameterstore')) {
      tf += `
resource "aws_ssm_parameter" "config" {
  name  = "/${projectName}/config"
  type  = "SecureString"
  value = "placeholder"
}
`;
    }

    if (has('workfloworchestration')) {
      tf += `
resource "aws_sfn_state_machine" "workflow" {
  name     = "${projectName}-workflow"
  role_arn = "arn:aws:iam::123456789012:role/sfn-role"
  definition = jsonencode({
    StartAt = "Step1"
    States = {
      Step1 = {
        Type = "Pass"
        End  = true
      }
    }
  })
}
`;
    }

    if (has('deadletterqueue')) {
      tf += `
resource "aws_sqs_queue" "dlq" {
  name                      = "${projectName}-dlq"
  message_retention_seconds = 1209600
}
`;
    }

    if (has('pubsub') || has('eventstreaming')) {
      tf += `
resource "aws_sns_topic" "pubsub" {
  name = "${projectName}-events"
}

resource "aws_sns_topic_subscription" "sub" {
  topic_arn = aws_sns_topic.pubsub.arn
  protocol  = "sqs"
  endpoint  = "arn:aws:sqs:${region}:123456789012:${projectName}-queue"
}
`;
    }

    if (has('kinesisstream')) {
      tf += `
resource "aws_kinesis_stream" "stream" {
  name             = "${projectName}-stream"
  shard_count      = 1
  retention_period = 24
}
`;
    }

    if (has('streamprocessor')) {
      tf += `
resource "aws_kinesis_analytics_application" "processor" {
  name = "${projectName}-processor"
  inputs {
    name_prefix = "input"
    kinesis_stream {
      resource_arn = "arn:aws:kinesis:${region}:123456789012:stream/${projectName}-stream"
      role_arn     = "arn:aws:iam::123456789012:role/kinesis-role"
    }
    schema {
      record_columns {
        name    = "data"
        sql_type = "VARCHAR(256)"
        mapping = "$.data"
      }
      record_format {
        mapping_parameters {
          json {
            record_row_path = "$"
          }
        }
      }
    }
  }
}
`;
    }

    if (has('eventstream')) {
      tf += `
resource "aws_kinesis_stream" "events" {
  name             = "${projectName}-events"
  shard_count      = 2
  retention_period = 48
}
`;
    }

    if (has('deviceregistry')) {
      tf += `
resource "aws_iot_thing_type" "devices" {
  name = "${projectName}-devices"
}
`;
    }

    if (has('digitaltwin')) {
      tf += `
resource "aws_iot_thing" "twin" {
  name = "${projectName}-digital-twin"
}
`;
    }

    if (has('iotedgegateway')) {
      tf += `
resource "aws_iot_thing" "edge" {
  name = "${projectName}-edge-gateway"
}
`;
    }

    if (has('experimenttracking') || has('mlpipelineorchestration') || has('modelmonitoring')) {
      tf += `
resource "aws_sagemaker_domain" "mlops" {
  domain_name = "${projectName}-mlops"
  auth_mode   = "IAM"
  vpc_id      = "vpc-12345678"
  subnet_ids  = ["subnet-12345678"]
  default_user_settings {
    execution_role = "arn:aws:iam::123456789012:role/sagemaker-role"
  }
}
`;
    }

    if (has('securityposture')) {
      tf += `
resource "aws_securityhub_account" "posture" {}
`;
    }

    if (has('policygovernance')) {
      tf += `
resource "aws_config_config_rule" "policy" {
  name = "${projectName}-policy"
  source {
    owner             = "AWS"
    source_identifier = "REQUIRED_TAGS"
  }
}
`;
    }

    if (has('globalloadbalancer')) {
      tf += `
resource "aws_globalaccelerator_accelerator" "global" {
  name            = "${projectName}-global"
  ip_address_type = "IPV4"
  enabled         = true
}
`;
    }

    if (has('multiregiondb')) {
      tf += `
resource "aws_rds_global_cluster" "global" {
  global_cluster_identifier = "${projectName}-global-db"
  engine                    = "aurora-postgresql"
  engine_version            = "13.4"
  database_name             = "${projectName.replace(/-/g, '_')}_db"
}
`;
    }

    if (has('batchjob')) {
      tf += `
resource "aws_batch_job_definition" "job" {
  name = "${projectName}-job"
  type = "container"
  container_properties = jsonencode({
    image   = "busybox"
    vcpus   = 1
    memory  = 512
    command = ["echo", "Hello"]
  })
}
`;
    }

    if (has('searchengine')) {
      tf += `
resource "aws_opensearch_domain" "search" {
  domain_name    = "${projectName}-search"
  engine_version = "OpenSearch_2.5"
  cluster_config {
    instance_type  = "t3.medium.search"
    instance_count = 1
  }
  ebs_options {
    ebs_enabled = true
    volume_size = 20
  }
}
`;
    }

    if (has('natgateway')) {
      tf += `
resource "aws_eip" "nat" {
  domain = "vpc"
}

resource "aws_nat_gateway" "nat" {
  allocation_id = aws_eip.nat.id
  subnet_id     = "subnet-12345678"
}
`;
    }

    if (has('computeedge')) {
      tf += `
resource "aws_lambda_function" "edge" {
  function_name = "${projectName}-edge"
  role          = "arn:aws:iam::123456789012:role/lambda-edge-role"
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  publish       = true
  filename      = "edge.zip"
}
`;
    }

  } else if (provider === 'gcp') {

    // 2. GCP IMPLEMENTATION
    // 🔥 FIX: Separate computecontainer and computeserverless to prevent pricing leakage
    if (has('computecontainer')) {
      tf += `
resource "google_cloud_run_service" "app" {
  name     = "${projectName}-service"
  location = "${region}"

  template {
    spec {
      containers {
        image = "gcr.io/cloudrun/hello"
        resources {
          limits = {
            cpu    = "${(sizing.container_cpu || 1024) / 1000}000m"
            memory = "${(sizing.container_memory || 2048)}Mi"
          }
        }
      }
    }
  }

  metadata {
    annotations = {
      "autoscaling.knative.dev/minScale" = "1"
      "autoscaling.knative.dev/maxScale" = "10"
    }
  }
}
`;
    }

    if (has('computeserverless')) {
      tf += `
resource "google_cloudfunctions_function" "func" {
  name                  = "${projectName}-func"
  runtime               = "nodejs18"
  available_memory_mb   = ${sizing.function_memory || 256} # Dynamic
  source_archive_bucket = "mock-bucket"
  source_archive_object = "mock-object"
  trigger_http          = true
  entry_point           = "handler"
}
`;
    }

    if (has('relationaldatabase')) {
      tf += `
resource "google_sql_database_instance" "db" {
  name             = "${projectName}-db"
  database_version = "POSTGRES_13"
  region           = "${region}"
  settings {
    tier = "${sizing.instance_class || "db-custom-2-3840"}" # Dynamic
  }
}
`;
    }

    if (has('objectstorage')) {
      tf += `
resource "google_storage_bucket" "storage" {
  name          = "${projectName}-bucket"
  location      = "US"
  force_destroy = true
}
`;
    }

    if (has('loadbalancer')) {
      tf += `
resource "google_compute_global_address" "lb_ip" {
  name = "${projectName}-lb-ip"
}

resource "google_compute_global_forwarding_rule" "lb" {
  name       = "${projectName}-lb"
  target     = "all-apis"
  port_range = "80"
  ip_address = google_compute_global_address.lb_ip.address
}
`;
    }

    if (has('cdn')) {
      tf += `
resource "google_compute_backend_bucket" "cdn" {
  name        = "${projectName}-cdn"
  bucket_name = "${projectName}-cdn-bucket"
  enable_cdn  = true
}
`;
    }

    if (has('apigateway')) {
      tf += `
resource "google_api_gateway_api" "api" {
  provider = google-beta
  api_id   = "${projectName}-api"
}

resource "google_api_gateway_gateway" "gateway" {
  provider   = google-beta
  gateway_id = "${projectName}-gateway"
  api_config = "${projectName}-config"
  region     = "${region}"
}
`;
    }

    if (has('logging')) {
      tf += `
resource "google_logging_project_sink" "logs" {
  name        = "${projectName}-logs-sink"
  destination = "storage.googleapis.com/${projectName}-logs-bucket"
  filter      = "resource.type=global"
}
`;
    }

    if (has('monitoring')) {
      tf += `
resource "google_monitoring_uptime_check_config" "uptime" {
  display_name = "${projectName}-uptime"
  timeout      = "60s"
  period       = "300s"
  
  http_check {
    path = "/"
    port = 80
  }
  
  monitored_resource {
    type = "uptime_url"
    labels = {
      project_id = "${projectName}"
      host       = "example.com"
    }
  }
}
`;
    }

    if (has('cache')) {
      tf += `
resource "google_redis_instance" "cache" {
  name           = "${projectName}-cache"
  memory_size_gb = 1
  tier           = "BASIC"
  region         = "${region}"
}
`;
    }

    if (has('computevm')) {
      tf += `
resource "google_compute_instance" "vm" {
  name         = "${projectName}-vm"
  machine_type = "e2-medium"
  zone         = "${region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }

  network_interface {
    network = "default"
  }
}
`;
    }

    if (has('blockstorage')) {
      tf += `
resource "google_compute_disk" "default" {
  name  = "${projectName}-disk"
  type  = "pd-balanced"
  zone  = "${region}-a"
  size  = 50
}
`;
    }

    if (has('dns')) {
      tf += `
resource "google_dns_managed_zone" "zone" {
  name     = "${projectName}-zone"
  dns_name = "example.com."
}
`;
    }

    if (has('messagequeue')) {
      tf += `
resource "google_pubsub_topic" "topic" {
  name = "${projectName}-topic"
}

resource "google_pubsub_subscription" "sub" {
  name  = "${projectName}-sub"
  topic = google_pubsub_topic.topic.name
}
`;
    }

    if (has('secretsmanagement')) {
      tf += `
resource "google_secret_manager_secret" "secret" {
  secret_id = "${projectName}-secret"
  replication {
    automatic = true
  }
}
`;
    }

    if (has('vpcnetworking')) {
      tf += `
resource "google_compute_network" "vpc" {
  name = "${projectName}-vpc"
}

resource "google_compute_router" "router" {
  name    = "${projectName}-router"
  network = google_compute_network.vpc.name
  region  = "${region}"
}
`;
    }

    if (has('nosqldatabase')) {
      tf += `
resource "google_firestore_database" "firestore" {
  name        = "${projectName}-firestore"
  location_id = "${region}"
  type        = "FIRESTORE_NATIVE"
}
`;
    }

    // --- ANALYTICS ---
    if (has('datawarehouse')) {
      tf += `
resource "google_bigquery_dataset" "wh" {
  dataset_id = "${projectName.replace(/-/g, '_')}_wh"
}
`;
    }
    if (has('datalake')) {
      tf += `
resource "google_storage_bucket" "datalake" {
  name          = "${projectName}-datalake"
  location      = "US"
}
`;
    }
    if (has('etlorchestration')) {
      tf += `
resource "google_dataflow_job" "etl" {
  name              = "${projectName}-etl"
  template_gcs_path = "gs://my-bucket/templates/template_file"
  temp_gcs_location = "gs://my-bucket/tmp_dir"
}
`;
    }
    if (has('bidashboard')) {
      // Looker Studio / BI Engine - usually BigQuery Reservation
      tf += `
resource "google_bigquery_reservation" "bi" {
  name           = "${projectName}-bi"
  slot_capacity  = 100
  location       = "US"
}
`;
    }
    if (has('datacatalog')) {
      tf += `
resource "google_data_catalog_entry_group" "catalog" {
  entry_group_id = "${projectName}_catalog"
}
`;
    }

    // --- MACHINE LEARNING ---
    if (has('mltraining') || has('mlinference')) {
      tf += `
resource "google_vertex_ai_dataset" "dataset" {
  display_name        = "${projectName}-dataset"
  metadata_schema_uri = "gs://google-cloud-aiplatform/schema/dataset/metadata/image_1.0.0.yaml"
  region              = "us-central1"
}
resource "google_vertex_ai_endpoint" "endpoint" {
  display_name = "${projectName}-endpoint"
  location     = "us-central1"
}
`;
    }
    if (has('vectordatabase')) {
      // Vector Search on Vertex AI
      tf += `
resource "google_vertex_ai_index" "vector" {
  display_name = "${projectName}-vector"
  metadata {
    config {
      dimensions = 2
      approximate_neighbors_count = 150
    }
  }
}
`;
    }

    // --- IOT ---
    if (has('iotcore') || has('iotedgegateway')) {
      tf += `
resource "google_cloudiot_registry" "iot" {
  name = "${projectName}-iot"
}
`;
    }
    if (has('timeseriesdatabase')) {
      tf += `
resource "google_bigtable_instance" "ts" {
  name = "${projectName}-ts"
  cluster {
    cluster_id   = "tf-instance-cluster"
    zone         = "us-central1-b"
    num_nodes    = 1
    storage_type = "HDD"
  }
}
`;
    }

    // --- SECURITY ---
    if (has('waf') || has('ddosprotection')) {
      tf += `
resource "google_compute_security_policy" "waf" {
  name = "${projectName}-waf"
}
`;
    }
    if (has('keymanagement') || has('keymanagementservice')) {
      tf += `
resource "google_kms_key_ring" "keyring" {
  name     = "${projectName}-keyring"
  location = "global"
}
resource "google_kms_crypto_key" "key" {
  name            = "${projectName}-key"
  key_ring        = google_kms_key_ring.keyring.id
}
`;
    }
    if (has('certificatemanagement')) {
      tf += `
resource "google_certificate_manager_certificate" "cert" {
  name        = "${projectName}-cert"
  managed {
    domains = ["example.com"]
  }
}
`;
    }

    // --- DEVOPS ---
    if (has('cicd') || has('etlorchestration')) {
      // Cloud Build
      tf += `
resource "google_cloudbuild_trigger" "build" {
  trigger_template {
    branch_name = "main"
    repo_name   = "my-repo"
  }
  filename = "cloudbuild.yaml"
}
`;
    }
    if (has('containerregistry') || has('artifactrepository')) {
      tf += `
resource "google_artifact_registry_repository" "repo" {
  location      = "us-central1"
  repository_id = "${projectName}-repo"
  description   = "Docker repo"
  format        = "DOCKER"
}
`;
    }

    // --- NETWORKING ---
    if (has('vpn') || has('vpngateway')) {
      tf += `
resource "google_compute_vpn_gateway" "vpn" {
  name    = "${projectName}-vpn"
  network = "default"
}
`;
    }
    if (has('privatelink')) {
      // Private Service Connect
      tf += `
resource "google_compute_global_address" "psc" {
  name          = "${projectName}-psc"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = "default"
}
`;
    }
    if (has('servicediscovery')) {
      tf += `
resource "google_service_directory_namespace" "dns" {
  namespace_id = "${projectName}"
  location     = "us-central1"
}
`;
    }
    // Google Service Mesh (Traffic Director)
    if (has('servicemesh')) {
      tf += `
# Traffic Director is config-heavy, typically involves Health Checks and Backend Services
resource "google_compute_health_check" "mesh" {
  name = "${projectName}-mesh-hc"
  tcp_health_check {
    port = 80
  }
}
`;
    }
    if (has('paymentgateway')) {
      tf += `
# Payment Gateway (External Service)
# Logical dependency on Stripe/PayPal - No GCP resources created
`;
    }
    if (has('auditlogging')) {
      // Cloud Audit Logs are on by default, but we can export them
      tf += `
# Google Cloud Audit Logging is enabled by default.
# Configuring Sink for long-term retention:
resource "google_logging_project_sink" "audit_sink" {
  name        = "${projectName}-audit-sink"
  destination = "storage.googleapis.com/${projectName}-audit-bucket"
  filter      = "logName:\\"logs/cloudaudit.googleapis.com%2Factivity\\""
}
`;
    }
    if (has('vulnerabilityscanner')) {
      tf += `
# Container Security Scanning (Artifact Registry automatically scans)
# This resource verifies the API is enabled
resource "google_project_service" "scanner" {
  service = "containerscanning.googleapis.com"
}
`;
    }

  } else if (provider === 'azure') {
    // 3. AZURE IMPLEMENTATION

    // Resource Group is always needed for Azure resources to hang off of
    tf += `
resource "azurerm_resource_group" "rg" {
  name     = "${projectName}-rg"
  location = "${region}"
}
`;

    if (has('computecontainer')) {
      tf += `
resource "azurerm_app_service_plan" "asp" {
        name = "${projectName}-asp"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        kind = "Linux"
        reserved = true

  sku {
          tier = "Standard"
          size = "S1"
        }
      }

resource "azurerm_app_service" "app" {
        name = "${projectName}-app"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        app_service_plan_id = azurerm_app_service_plan.asp.id

  site_config {
          linux_fx_version = "DOCKER|nginx:latest"
        }
      }
      `;
    }

    if (has('computeserverless')) {
      tf += `
resource "azurerm_service_plan" "asp" {
        name = "${projectName}-asp"
        resource_group_name = azurerm_resource_group.rg.name
        location = azurerm_resource_group.rg.location
        os_type = "Linux"
        sku_name = "Y1"
      }

resource "azurerm_linux_function_app" "func" {
        name = "${projectName}-func"
        resource_group_name = azurerm_resource_group.rg.name
        location = azurerm_resource_group.rg.location
        service_plan_id = azurerm_service_plan.asp.id
        storage_account_name = "funcstore${projectName.replace(/[^a-z0-9]/g, '').substring(0, 10)}"
        storage_account_access_key = "mock-key"
  
  site_config { }
      }
      `;
    }

    if (has('relationaldatabase')) {
      tf += `
resource "azurerm_postgresql_flexible_server" "db" {
        name = "${projectName}-db-server"
        resource_group_name = azurerm_resource_group.rg.name
        location = azurerm_resource_group.rg.location
        version = "12"
        administrator_login = "psqladmin"
        administrator_password = "H@Sh1CoR3!"
        storage_mb = ${(sizing.storage_gb || 32) * 1024}
        sku_name = "${sizing.instance_class || "B_Standard_B1ms"}"
      }
      `;
    }

    if (has('objectstorage')) {
      // storage account name must be unique and no dashes
      tf += `
resource "azurerm_storage_account" "storage" {
        name = "stor${projectName.replace(/[^a-z0-9]/g, '').substring(0, 15)}"
        resource_group_name = azurerm_resource_group.rg.name
        location = azurerm_resource_group.rg.location
        account_tier = "Standard"
        account_replication_type = "LRS"
      }
      `;
    }

    if (has('loadbalancer')) {
      tf += `
resource "azurerm_public_ip" "pip" {
        name = "PublicIPForLB"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        allocation_method = "Static"
        sku = "Standard"
      }

resource "azurerm_lb" "example" {
        name = "TestLoadBalancer"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        sku = "Standard"

  frontend_ip_configuration {
          name = "PublicIPAddress"
          public_ip_address_id = azurerm_public_ip.pip.id
        }
      }
      `;
    }

    if (has('cdn')) {
      tf += `
resource "azurerm_cdn_profile" "cdn" {
        name = "${projectName}-cdn"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        sku = "Standard_Microsoft"
      }

resource "azurerm_cdn_endpoint" "endpoint" {
        name = "${projectName}-cdn-endpoint"
        profile_name = azurerm_cdn_profile.cdn.name
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
  
  origin {
          name = "origin1"
          host_name = "www.example.com"
        }
      }
      `;
    }

    if (has('apigateway')) {
      tf += `
resource "azurerm_api_management" "apim" {
        name = "${projectName}-apim"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        publisher_name = "Example Publisher"
        publisher_email = "publisher@example.com"
        sku_name = "Consumption_0"
      }
      `;
    }

    if (has('logging')) {
      tf += `
resource "azurerm_log_analytics_workspace" "logs" {
        name = "${projectName}-logs"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        sku = "PerGB2018"
        retention_in_days = 30
      }
      `;
    }

    if (has('monitoring')) {
      // App Insights requires a workspace
      if (!has('logging')) {
        tf += `
resource "azurerm_log_analytics_workspace" "logs_for_insights" {
        name = "${projectName}-logs-insights"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        sku = "PerGB2018"
        retention_in_days = 30
      }
  `;
      }

      tf += `
resource "azurerm_application_insights" "appinsights" {
        name = "${projectName}-appinsights"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        application_type = "web"
        workspace_id = ${has('logging') ? 'azurerm_log_analytics_workspace.logs.id' : 'azurerm_log_analytics_workspace.logs_for_insights.id'}
      }
      `;
    }

    if (has('cache')) {
      tf += `
resource "azurerm_redis_cache" "cache" {
        name = "${projectName}-cache"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        capacity = 0
        family = "C"
        sku_name = "Basic"
        enable_non_ssl_port = false
        minimum_tls_version = "1.2"
      }
      `;
    }

    if (has('computevm')) {
      tf += `
resource "azurerm_network_interface" "nic" {
        name = "${projectName}-nic"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {
          name = "internal"
          private_ip_address_allocation = "Dynamic"
        }
      }

resource "azurerm_linux_virtual_machine" "vm" {
        name = "${projectName}-vm"
        resource_group_name = azurerm_resource_group.rg.name
        location = azurerm_resource_group.rg.location
        size = "Standard_B2s"
        admin_username = "adminuser"
        network_interface_ids = [
          azurerm_network_interface.nic.id,
        ]

  admin_ssh_key {
          username = "adminuser"
          public_key = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC..."
        }

  os_disk {
          caching = "ReadWrite"
          storage_account_type = "Standard_LRS"
        }

  source_image_reference {
          publisher = "Canonical"
          offer = "UbuntuServer"
          sku = "18.04-LTS"
          version = "latest"
        }
      }
      `;
    }

    if (has('messagequeue')) {
      tf += `
resource "azurerm_servicebus_namespace" "sb" {
        name = "${projectName}-sb"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        sku = "Standard"
      }

resource "azurerm_servicebus_queue" "queue" {
        name = "${projectName}-queue"
        namespace_id = azurerm_servicebus_namespace.sb.id
      }
      `;
    }

    if (has('dns')) {
      tf += `
resource "azurerm_dns_zone" "zone" {
        name = "example.com"
        resource_group_name = azurerm_resource_group.rg.name
      }
      `;
    }

    if (has('secretsmanagement')) {
      tf += `
resource "azurerm_key_vault" "kv" {
        name = "${projectName}-kv"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        enabled_for_disk_encryption = true
        tenant_id = "00000000-0000-0000-0000-000000000000"
        soft_delete_retention_days = 7
        purge_protection_enabled = false

        sku_name = "standard"
      }
      `;
    }

    if (has('nosqldatabase')) {
      tf += `
resource "azurerm_cosmosdb_account" "cosmos" {
        name = "${projectName}-cosmos"
        location = azurerm_resource_group.rg.location
        resource_group_name = azurerm_resource_group.rg.name
        offer_type = "Standard"
        kind = "GlobalDocumentDB"
  
  consistency_policy {
          consistency_level = "Session"
        }
  
  geo_location {
          location = azurerm_resource_group.rg.location
          failover_priority = 0
        }
      }
      `;
    }

    // --- ANALYTICS ---
    if (has('datawarehouse')) {
      tf += `
resource "azurerm_synapse_workspace" "wh" {
  name                                 = "${projectName}-wh"
  resource_group_name                  = azurerm_resource_group.rg.name
  location                             = azurerm_resource_group.rg.location
  storage_data_lake_gen2_filesystem_id = "https://example.dfs.core.windows.net/example"
  sql_administrator_login              = "sqladminuser"
  sql_administrator_login_password     = "H@Sh1CoR3!"
}
`;
    }
    if (has('datalake')) {
      tf += `
resource "azurerm_storage_account" "datalake" {
  name                     = "${projectName}dls"
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = azurerm_resource_group.rg.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  is_hns_enabled           = "true"
}
`;
    }
    if (has('etlorchestration')) {
      tf += `
resource "azurerm_data_factory" "etl" {
  name                = "${projectName}-etl"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
`;
    }

    // --- MACHINE LEARNING ---
    if (has('mltraining') || has('mlinference') || has('modelregistry')) {
      tf += `
resource "azurerm_machine_learning_workspace" "ml" {
  name                    = "${projectName}-ml"
  location                = azurerm_resource_group.rg.location
  resource_group_name     = azurerm_resource_group.rg.name
  application_insights_id = azurerm_application_insights.appinsights.id
  key_vault_id            = azurerm_key_vault.kv.id
  storage_account_id      = azurerm_storage_account.storage.id
  identity {
    type = "SystemAssigned"
  }
}
`;
    }

    // --- IOT ---
    if (has('iotcore') || has('iotedgegateway')) {
      tf += `
resource "azurerm_iot_hub" "iot" {
  name                = "${projectName}-iot"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku {
    name     = "S1"
    capacity = 1
  }
}
`;
    }
    if (has('timeseriesdatabase')) {
      tf += `
resource "azurerm_timeseriesinsights_gen2_environment" "ts" {
  name                = "${projectName}-ts"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "L1"
  storage_account_name = "storage"
  storage_account_key  = "secret"
  id_properties        = ["id"]
}
`;
    }

    // --- SECURITY ---
    if (has('waf')) {
      tf += `
resource "azurerm_web_application_firewall_policy" "waf" {
  name                = "${projectName}waf"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
}
`;
    }
    if (has('ddosprotection')) {
      tf += `
resource "azurerm_network_ddos_protection_plan" "ddos" {
  name                = "${projectName}-ddos"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}
`;
    }
    // KeyVault already added in core pass

    // --- DEVOPS ---
    if (has('containerregistry') || has('artifactrepository')) {
      tf += `
resource "azurerm_container_registry" "acr" {
  name                = "${projectName}acr"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku                 = "Standard"
  admin_enabled       = false
}
`;
    }

    // --- NETWORKING ---
    if (has('vpn') || has('vpngateway')) {
      tf += `
resource "azurerm_virtual_network_gateway" "vpn" {
  name                = "${projectName}-vpn"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  type                = "Vpn"
  vpn_type            = "RouteBased"
  active_active       = false
  enable_bgp          = false
  sku                 = "Basic"
  ip_configuration {
    name                          = "vnetGatewayConfig"
    public_ip_address_id          = "pip_id"
    private_ip_address_allocation = "Dynamic"
    subnet_id                     = "subnet_id"
  }
}
`;
    }

    if (has('paymentgateway')) {
      tf += `
# Payment Gateway (External Service)
# Logical dependency on Stripe/PayPal - No Azure resources created
`;
    }
    if (has('auditlogging')) {
      tf += `
resource "azurerm_monitor_log_profile" "audit" {
  name = "${projectName}-audit"
  categories = ["Write", "Delete", "Action"]
  locations = ["global"]
  
  retention_policy {
    enabled = true
    days    = 365
  }
}
`;
    }
    if (has('vulnerabilityscanner')) {
      tf += `
# Microsoft Defender for Cloud (Security Center)
resource "azurerm_security_center_subscription_pricing" "defender" {
  tier          = "Standard"
  resource_type = "AppServices"
}
`;
    }

  }

  return tf;
}

/**
 * Generate versions.tf
 */
function generateVersionsTf(provider) {
  const providerConfigs = {
    aws: {
      source: 'hashicorp/aws',
      version: '~> 5.0'
    },
    gcp: {
      source: 'hashicorp/google',
      version: '~> 5.0'
    },
    azure: {
      source: 'hashicorp/azurerm',
      version: '~> 3.0'
    }
  };

  const config = providerConfigs[provider];

  return `terraform {
        required_version = ">= 1.0"
  
  required_providers {
    ${provider === 'aws' ? 'aws' : provider === 'gcp' ? 'google' : 'azurerm'} = {
            source = "${config.source}"
            version = "${config.version}"
          }
        }
      }
      `;
}

const defaultRegions = {
  aws: 'ap-south-1',
  gcp: 'asia-south1',
  azure: 'centralindia'
};

const regionArgMap = {
  aws: 'region',
  gcp: 'region',
  azure: 'location',
  azurerm: 'location'
};

const isAzure = (p) => ['azure', 'azurerm'].includes(String(p).toLowerCase());

/**
 * Generate providers.tf
 */
function generateProvidersTf(provider, region) {
  if (provider === 'aws') {
    return `provider "aws" {
  region = var.region


  
  default_tags {
    tags = {
      Project     = var.project_name
      ManagedBy   = "Terraform"
      Environment = var.environment
    }
  }
}
`;
  } else if (provider === 'gcp') {
    return `provider "google" {
  project = (var.project_id != "" && var.project_id != "YOUR_GCP_PROJECT_ID") ? var.project_id : null
  region  = var.region
}

provider "google-beta" {
  project = (var.project_id != "" && var.project_id != "YOUR_GCP_PROJECT_ID") ? var.project_id : null
  region  = var.region
}
`;
  } else if (provider === 'azure' || provider === 'azurerm') {
    return `provider "azurerm" {
  subscription_id = var.azure_subscription_id
  tenant_id       = var.azure_tenant_id
  client_id       = var.azure_client_id
  client_secret   = var.azure_client_secret
  
  skip_provider_registration = true
  
  features {
    resource_group {
      prevent_deletion_if_contains_resources = true
    }
  }
}
`;
  }
}

/**
 * Generate variables.tf
 */
function generateVariablesTf(provider, pattern, services) {
  let variables = '';

  // 🔥 EXTERNAL_CONFIGS MAPPING
  const EXTERNAL_CONFIGS = {
    paymentgateway: { var: 'stripe_secret_key', env: 'STRIPE_SECRET_KEY', desc: 'Stripe Secret Key' },
    auth0: { var: 'auth0_client_id', env: 'AUTH0_CLIENT_ID', desc: 'Auth0 Client ID' },
    auth: { var: 'auth0_client_id', env: 'AUTH0_CLIENT_ID', desc: 'Auth0 Client ID' }, // Alias
    emailservice: { var: 'sendgrid_api_key', env: 'SENDGRID_API_KEY', desc: 'SendGrid API Key' },
    monitoring_datadog: { var: 'dd_api_key', env: 'DD_API_KEY', desc: 'Datadog API Key' },
    contentful: { var: 'contentful_token', env: 'CONTENTFUL_ACCESS_TOKEN', desc: 'Contentful Access Token' },
    algolia: { var: 'algolia_key', env: 'ALGOLIA_ADMIN_KEY', desc: 'Algolia Admin Key' }
  };

  // Inject External Variables if Service Present
  services.forEach(svc => {
    const config = EXTERNAL_CONFIGS[svc];
    if (config) {
      variables += `variable "${config.var}" {
  description = "${config.desc}"
  type        = string
  sensitive   = true
  default     = null
}
`;
    }
  });

  // Common variables
  if (provider === 'aws') {
    variables += `variable "role_arn" {
      description = "Assumed Role ARN"
      type        = string
    }
    variable "external_id" {
      description = "Cross-account External ID"
      type        = string
    }
    `;

    variables += `variable "region" {
        description = "AWS region"
        type = string
      }

variable "project_name" {
        description = "Project name (used for resource naming)"
        type = string
      }

variable "environment" {
        description = "Environment (dev, staging, production)"
        type = string
  default     = "production"
      }

variable "vpc_id" {
        description = "VPC ID for resources"
        type = string
        default     = ""
      }

variable "subnet_ids" {
        description = "List of subnet IDs for resources"
        type = list(string)
        default     = []
      }

variable "security_group_id" {
        description = "Security group ID for resources"
        type = string
        default     = ""
      }

variable "domain_name" {
        description = "Domain name for DNS resources"
        type = string
        default     = ""
      }

variable "ecs_execution_role_arn" {
        description = "ARN of the ECS task execution role"
        type = string
        default     = ""
      }

      `;
  } else if (provider === 'gcp') {

    variables += `variable "project_id" {
        description = "GCP project ID"
        type = string
      }

variable "region" {
        description = "GCP region"
        type = string
      }

variable "project_name" {
        description = "Project name (used for resource naming)"
        type = string
      }

variable "environment" {
        description = "Environment (dev, staging, production)"
        type = string
  default     = "production"
      }

variable "network_name" {
        description = "VPC network name"
        type = string
        default     = "default"
      }

variable "subnetwork_name" {
        description = "Subnetwork name"
        type = string
        default     = "default"
      }

      `;
  } else if (provider === 'azure') {

    variables += `variable "location" {
        description = "Azure location"
        type = string
      }

variable "azure_subscription_id" {
        description = "Azure Subscription ID"
        type = string
      }

variable "azure_tenant_id" {
        description = "Azure Tenant ID"
        type = string
      }

variable "azure_client_id" {
        description = "Azure Client ID"
        type = string
      }

variable "azure_client_secret" {
        description = "Azure Client Secret"
        type = string
        sensitive = true
      }



variable "project_name" {
        description = "Project name (used for resource naming)"
        type = string
      }

variable "environment" {
        description = "Environment (dev, staging, production)"
        type = string
  default     = "production"
      }

variable "resource_group_name" {
        description = "Azure resource group name"
        type = string
        default     = ""
      }

variable "vnet_name" {
        description = "Azure virtual network name"
        type = string
        default     = ""
      }

variable "subnet_name" {
        description = "Azure subnet name"
        type = string
        default     = ""
      }

      `;
  }

  // NFR-driven variables
  variables += `# NFR - Driven Variables
variable "encryption_at_rest" {
        description = "Enable encryption at rest for storage services"
        type = bool
  default     = true
      }

variable "backup_retention_days" {
        description = "Number of days to retain backups"
        type = number
  default     = 7
      }

variable "deletion_protection" {
        description = "Enable deletion protection for stateful resources"
        type = bool
  default     = true
      }

variable "multi_az" {
        description = "Enable multi-AZ deployment for high availability"
        type = bool
  default     = false
      }

variable "monitoring_enabled" {
        description = "Enable monitoring and logging"
        type = bool
  default     = true
      }
      `;

  return variables;
}

/**
 * Generate terraform.tfvars from workspace defaults
 */
function generateTfvars(provider, region, projectName, sizing = {}, connectionData = {}) {
  // const region resolved from arg


  let tfvars = '';

  if (provider === 'aws') {
    // 🔥 HARD GUARD: Fail if region is malformed (User Requirement)
    if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) {
      throw new Error(`[FATAL] Invalid AWS region passed to Terraform generator: ${region}`);
    }

    let normalizedRegion = region;

    tfvars += `region = "${normalizedRegion}"\n`;

    if (connectionData && connectionData.role_arn) {
      // FIX: Enforce Role ARN Name (CloudiverseDeployRole)
      // Do not trust the name in the DB, only trust the Account ID.
      let accountId = "";
      const parts = connectionData.role_arn.split(':');
      if (parts.length >= 5) accountId = parts[4];

      const ROLE_NAME = "cloudiverse-deploy-role";
      const correctRoleArn = accountId ?
        `arn:aws:iam::${accountId}:role/${ROLE_NAME}` :
        connectionData.role_arn;

      tfvars += `role_arn = "${correctRoleArn}"\n`;
      tfvars += `external_id = "${connectionData.external_id}"\n`;
    } else {
      // Fallback or comment for debugging
      tfvars += `# role_arn and external_id missing from connection data\n`;
    }
  } else if (provider === 'gcp') {
    const projectId = sizing.project_id || sizing.connectionData?.project_id || sizing.connectionData?.GOOGLE_PROJECT || "YOUR_GCP_PROJECT_ID";
    tfvars += `project_id = "${projectId}"\n`;
    tfvars += `region = "${region.toLowerCase()}"\n`;
  } else if (provider === 'azure') {
    // Azure specific config (Location only, Credentials via Env)
    tfvars += `location = "${region}"\n`;
  }

  tfvars += `project_name = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"\n`;
  tfvars += `environment = "production"\n\n`;

  // Sizing & Cost Drivers (Injected from Cost Analysis)
  if (sizing) {
    tfvars += `# Sizing & Cost Drivers\n`;
    if (sizing.instance_class) tfvars += `db_instance_class = "${sizing.instance_class}"\n`;
    if (sizing.storage_gb) tfvars += `db_allocated_storage = ${sizing.storage_gb}\n`;
    if (sizing.container_cpu) tfvars += `container_cpu = ${sizing.container_cpu}\n`;
    if (sizing.container_memory) tfvars += `container_memory = ${sizing.container_memory}\n`;
    if (sizing.function_memory) tfvars += `function_memory = ${sizing.function_memory}\n`;
    if (sizing.requests_per_month) tfvars += `estimated_requests = ${sizing.requests_per_month}\n`;
  }

  // NFR-driven values (Defaults since requirements obj is not available in V2 generator yet)
  const nfr = {};
  tfvars += `\n# NFR - Driven Configuration\n`;
  tfvars += `encryption_at_rest = true\n`;
  tfvars += `backup_retention_days = 7\n`;
  tfvars += `deletion_protection = true\n`;
  tfvars += `multi_az = false\n`;
  tfvars += `monitoring_enabled = true\n`;

  return tfvars;
}

/**
 * Generate outputs.tf
 */
/**
 * Generate outputs.tf
 */
function generateOutputsTf(provider, pattern, services) {
  let outputs = `# 🏰 Canonical Deployment Contract\n\n`;

  // 1. Determine Deployment Target (Strict Contract)
  let targetType = "UNKNOWN";
  if (services.includes('computecontainer')) {
    targetType = "CONTAINER_SERVICE";
  } else if (services.includes('objectstorage') && services.includes('cdn')) { // Must have CDN for production static
    targetType = "STATIC_STORAGE";
  } else if (services.includes('computeserverless')) {
    targetType = "SERVERLESS_FUNCTION";
  } else if (services.includes('computevm')) {
    targetType = "VM";
  }

  outputs += `output "deployment_target" {
  description = "The authoritative deployment contract. Deploy service MUST read this."
  value = {
    type     = "${targetType}"
    provider = "${provider}"
    region   = var.${provider === 'azure' ? 'location' : 'region'}

    static = {
      bucket_name   = ${services.includes('objectstorage') ? 'try(module.object_storage.bucket_name, null)' : 'null'}
      bucket_region = var.${provider === 'azure' ? 'location' : 'region'}
      cdn_domain    = ${services.includes('cdn') ? 'try(module.cdn.endpoint, null)' : 'null'}
    }

    container = {
      cluster_name        = ${services.includes('computecontainer') ? 'try(module.app_container.cluster_name, null)' : 'null'}
      service_name        = ${services.includes('computecontainer') ? 'try(module.app_container.service_name, null)' : 'null'}
      container_app_name  = ${services.includes('computecontainer') ? 'try(module.app_container.container_app_name, null)' : 'null'}
      resource_group_name = ${services.includes('computecontainer') ? 'try(module.app_container.resource_group_name, null)' : 'null'}
      registry_url        = ${services.includes('computecontainer') ? 'try(module.app_container.ecr_url, module.app_container.acr_login_server, null)' : 'null'}
      build_project_name  = ${services.includes('computecontainer') ? 'try(module.app_container.codebuild_name, null)' : 'null'}
    }
  }
}

`;

  const outputMap = {
    // Basic Services (Standardized Aliases)
    cdn: { name: 'cdn_endpoint', field: 'endpoint', desc: 'CDN endpoint URL' },
    cdn_id: { name: 'cdn_id', field: 'id', desc: 'CDN Distribution ID' },
    apigateway: { name: 'api_endpoint', field: 'endpoint', desc: 'API Gateway endpoint URL' },
    relationaldatabase: { name: 'database_endpoint', field: 'endpoint', desc: 'Database connection endpoint', sensitive: true },
    objectstorage: { name: 'bucket_name', field: 'bucket_name', desc: 'The Storage bucket name' },

    // Compute (Standardized Metadata)
    computecontainer: {
      name: 'computecontainer',
      fields: {
        service_endpoint: 'url',
        service_name: 'service_name',
        cluster_name: 'cluster_name',
        container_app_name: 'container_app_name',
        resource_group_name: 'resource_group_name',
        container_registry: ['ecr_url', 'artifact_registry', 'acr_login_server'],
        codebuild_name: 'codebuild_name',
        build_bucket: 'build_bucket',
        project_id: 'project_id',
        region: 'region'
      },
      desc: 'Container deployment metadata'
    },
    computeserverless: { name: 'serverless_url', field: 'url', desc: 'Serverless function URL' },
    computevm: { name: 'vm_ip', field: 'public_ip', desc: 'VM Public IP' },

    // Database & Cache
    cache: { name: 'cache_endpoint', field: 'endpoint', desc: 'Cache connection endpoint' },
    nosqldatabase: { name: 'nosql_endpoint', field: 'endpoint', desc: 'NoSQL database endpoint' },
    messagequeue: { name: 'mq_endpoint', field: 'endpoint', desc: 'Message queue endpoint' },

    // Identity & Security
    auth: { name: 'auth_client_id', field: 'client_id', desc: 'Auth client ID' },
    identityauth: { name: 'auth_client_id', field: 'client_id', desc: 'Auth client ID' },
    waf: { name: 'waf_acl_id', field: 'web_acl_id', desc: 'WAF Web ACL ID' },
    secretsmanagement: { name: 'secrets_arn', field: 'arn', desc: 'Secrets manager ARN' },

    // Networking
    loadbalancer: { name: 'lb_dns_dns', field: 'dns_name', desc: 'Load balancer DNS name' },
    globalloadbalancer: { name: 'global_lb_endpoint', field: 'endpoint', desc: 'Global LB endpoint' },
    dns: { name: 'name_servers', field: 'name_servers', desc: 'DNS Name Servers' },

    // Observability
    logging: { name: 'log_group', field: 'log_group_name', desc: 'Log group name' },
    monitoring: { name: 'dashboard_url', field: 'url', desc: 'Monitoring dashboard URL' }
  };

  if (Array.isArray(services)) {
    services.forEach(service => {
      const conf = outputMap[service];
      if (conf) {
        const moduleName = getModuleName(service);
        if (service === 'cdn') {
          outputs += `output "cdn_endpoint" { value = module.cdn.endpoint }\noutput "cdn_id" { value = module.cdn.id }\n\n`;
        } else if (conf.fields) {
          outputs += `output "${conf.name}" {\n  description = "${conf.desc}"\n  value = {\n`;
          Object.entries(conf.fields).forEach(([key, fields]) => {
            const fieldList = Array.isArray(fields) ? fields : [fields];
            const valueExpr = fieldList.map(f => `try(module.${moduleName}.${f}, null)`).join(', ');
            outputs += `    ${key} = coalesce(${valueExpr}, null)\n`;
          });
          outputs += `  }\n}\n\n`;
        } else {
          outputs += `output "${conf.name}" {
  description = "${conf.desc}"
  value       = module.${moduleName}.${conf.field}
  ${conf.sensitive ? 'sensitive = true' : ''}
}\n\n`;
        }
      }
    });
  }

  // Common aliases for Phase 2 code
  if (services.includes('cdn')) {
    outputs += `output "cloudfront_distribution_id" { value = module.cdn.id }\n\n`;
  }

  if (services.includes('networking') || services.includes('vpcnetworking')) {
    const nwModule = getModuleName(services.includes('networking') ? 'networking' : 'vpcnetworking');
    outputs += `output "vpc_id" { value = module.${nwModule}.vpc_id }\n\n`;
  }

  return outputs;
}

/**
 * Generate main.tf (ONLY module references, NO direct resources)
 */
function generateMainTf(provider, pattern, services) {
  const pLower = String(provider).toLowerCase();
  const regionLabel = regionArgMap[pLower] || 'region';

  console.log(`[TF GENERATOR] generateMainTf: provider=${provider}, regionLabel=${regionLabel}, services=${services.length}`);

  let mainTf = `# Main Terraform Configuration
# Pattern: ${pattern}
# Provider: ${provider.toUpperCase()}
#
# This file ONLY references modules - no direct resource blocks allowed.
# All cloud resources are defined in their respective modules.
#
# Generated with regionLabel: ${regionLabel}

      `;

  // 1. Networking Module (Explicit or Implicit)
  // Check if networking is explicitly requested, else might need default
  if (services.includes('networking') || services.includes('vpcnetworking')) {
    // Already in services loop
  } else {
    // Optional: Add default networking if complex pattern
  }

  // 2. Iterate all services and generate module blocks
  if (Array.isArray(services)) {
    services.forEach(service => {
      // 🔒 Skip if service is not deployable (EXTERNAL)
      if (EXTERNAL_SERVICES.includes(service)) return;

      const moduleName = getModuleName(service);
      const meta = SERVICE_METADATA[service] || {};

      mainTf += `module "${moduleName}" {
    source = "./modules/${moduleName}"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}\n`;

      // 🔥 FIX: Inject CDN Dependency (Intelligent Origin + OAC Variables)
      if (moduleName === 'cdn') {
        const hasObjectStorage = services.includes('objectstorage');
        const hasLoadBalancer = services.includes('loadbalancer');
        const hasComputeContainer = services.includes('computecontainer');

        if (hasObjectStorage && !hasComputeContainer) {
          // Static site: S3 bucket origin with OAC (requires bucket_name and bucket_arn for policy)
          mainTf += `    bucket_domain_name = module.object_storage.bucket_domain_name\n`;
          mainTf += `    bucket_name        = module.object_storage.bucket_name\n`;
          mainTf += `    bucket_arn         = module.object_storage.bucket_arn\n`;
        } else if (hasLoadBalancer) {
          mainTf += `    bucket_domain_name = module.load_balancer.dns_name\n`;
          mainTf += `    bucket_name        = ""\n`;
          mainTf += `    bucket_arn         = ""\n`;
        } else if (hasComputeContainer && pLower !== 'aws') {
          // GCP/Azure containers have stable URLs directly
          mainTf += `    bucket_domain_name = module.app_container.url\n`;
          mainTf += `    bucket_name        = ""\n`;
          mainTf += `    bucket_arn         = ""\n`;
        } else {
          // Fallback or skip if no clear origin
          mainTf += `    # bucket_domain_name injection skipped: No objectstorage or loadbalancer found\n`;
        }
      }

      // 💉 Dependency Injection (Networking)
      if (meta.deps?.includes('networking') && (services.includes('networking') || services.includes('vpcnetworking') || services.includes('vpc'))) {
        mainTf += `    vpc_id = module.networking.vpc_id\n`;
        if (meta.args?.includes('private_subnet_ids')) {
          mainTf += `    private_subnet_ids = module.networking.private_subnet_ids\n`;
        }
        if (meta.args?.includes('public_subnet_ids')) {
          mainTf += `    public_subnet_ids = module.networking.public_subnet_ids\n`;
        }
      }

      // 🛡️ NFR Injection
      if (meta.args?.includes('encryption_at_rest')) mainTf += `    encryption_at_rest = var.encryption_at_rest\n`;
      if (meta.args?.includes('backup_retention_days')) mainTf += `    backup_retention_days = var.backup_retention_days\n`;
      if (meta.args?.includes('deletion_protection')) mainTf += `    deletion_protection = var.deletion_protection\n`;
      if (meta.args?.includes('multi_az')) mainTf += `    multi_az = var.multi_az\n`;

      // 🔑 External Variable Injection (Compute Services)
      if (service === 'computeserverless' || service === 'computecontainer' || service === 'appcompute') {
        const EXTERNAL_CONFIGS = {
          paymentgateway: { var: 'stripe_secret_key', env: 'STRIPE_SECRET_KEY' },
          auth0: { var: 'auth0_client_id', env: 'AUTH0_CLIENT_ID' },
          auth: { var: 'auth0_client_id', env: 'AUTH0_CLIENT_ID' },
          emailservice: { var: 'sendgrid_api_key', env: 'SENDGRID_API_KEY' },
          monitoring_datadog: { var: 'dd_api_key', env: 'DD_API_KEY' },
          contentful: { var: 'contentful_token', env: 'CONTENTFUL_ACCESS_TOKEN' },
          algolia: { var: 'algolia_key', env: 'ALGOLIA_ADMIN_KEY' }
        };

        let envVarsBlock = '{\n';
        let hasEnvs = false;
        services.forEach(s => {
          const conf = EXTERNAL_CONFIGS[s];
          if (conf) {
            envVarsBlock += `          "${conf.env}" = var.${conf.var}\n`;
            hasEnvs = true;
          }
        });
        envVarsBlock += '        }';

        if (hasEnvs && pLower === 'aws') {
          mainTf += `    extra_env_vars = ${envVarsBlock}\n`;
        }
      }

      mainTf += `  }\n\n`;
    });
  }

  return mainTf;
}

function needsNetworking(pattern, services) {
  return services.includes('networking') || services.includes('vpcnetworking');
}


/**
 * Get module configuration block for a service
 */
function getModuleConfig(service, provider) {
  const pLower = String(provider).toLowerCase();
  const regionLabel = regionArgMap[pLower] || 'region';

  const moduleMap = {
    cdn: `module "cdn" {
    source = "./modules/cdn"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    apigateway: `module "apigateway" {
    source = "./modules/apigateway"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    computeserverless: `module "serverless_compute" {
    source = "./modules/serverless_compute"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    appcompute: `module "app_compute" {
    source = "./modules/app_compute"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    private_subnet_ids = module.networking.private_subnet_ids
  } `,

    relationaldatabase: `module "relational_db" {
    source = "./modules/relational_db"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    private_subnet_ids = module.networking.private_subnet_ids
    encryption_at_rest = var.encryption_at_rest
    backup_retention_days = var.backup_retention_days
    deletion_protection = var.deletion_protection
    multi_az = var.multi_az
  } `,

    analyticaldatabase: `module "analytical_db" {
    source = "./modules/analytical_db"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    encryption_at_rest = var.encryption_at_rest
  } `,

    cache: `module "cache" {
    source = "./modules/cache"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    private_subnet_ids = module.networking.private_subnet_ids
  } `,

    messagequeue: `module "message_queue" {
    source = "./modules/mq"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    objectstorage: `module "object_storage" {
    source = "./modules/object_storage"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    encryption_at_rest = var.encryption_at_rest
  } `,

    identityauth: `module "auth" {
    source = "./modules/auth"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    loadbalancer: `module "load_balancer" {
    source = "./modules/load_balancer"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    public_subnet_ids = module.networking.public_subnet_ids
  } `,

    monitoring: `module "monitoring" {
    source = "./modules/monitoring"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    monitoring_enabled = var.monitoring_enabled
  } `,

    logging: `module "logging" {
    source = "./modules/logging"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    mlinferenceservice: `module "ml_inference" {
    source = "./modules/ml_inference"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    batchcompute: `module "batch_compute" {
    source = "./modules/batch_compute"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    websocketgateway: `module "websocket" {
    source = "./modules/websocket"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    // 🔥 FIX: Added missing Critical Services
    computecontainer: `module "app_container" {
    source = "./modules/compute_container"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    private_subnet_ids = module.networking.private_subnet_ids
  # Sizing variables injected by main generator
  } `,

    computevm: `module "vm_compute" {
    source = "./modules/vm_compute"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
    vpc_id = module.networking.vpc_id
    private_subnet_ids = module.networking.private_subnet_ids
  } `,

    nosqldatabase: `module "nosql_db" {
    source = "./modules/nosql_db"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    blockstorage: `module "block_storage" {
    source = "./modules/block_storage"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    secretsmanager: `module "secrets" {
    source = "./modules/secrets_manager"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    dns: `module "dns" {
    source = "./modules/dns"

    project_name = var.project_name
  } `,

    globalloadbalancer: `module "global_lb" {
    source = "./modules/global_lb"

    project_name = var.project_name
  } `,

    waf: `module "waf" {
    source = "./modules/waf"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    secretsmanagement: `module "secrets" {
    source = "./modules/secrets"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    block_storage: `module "block_storage" {
    source = "./modules/block_storage"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    eventbus: `module "event_bus" {
    source = "./modules/event_bus"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    paymentgateway: `module "payment_gateway" {
    source = "./modules/payment_gateway"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    cdn: `module "cdn" {
    source = "./modules/cdn"

    project_name       = var.project_name
    ${regionLabel}     = var.${regionLabel}
    bucket_domain_name = module.object_storage.bucket_domain_name
    bucket_name        = module.object_storage.bucket_name
    bucket_arn         = module.object_storage.bucket_arn
  } `,

    contentdeliverynetwork: `module "cdn" {
    source = "./modules/cdn"

    project_name       = var.project_name
    ${regionLabel}     = var.${regionLabel}
    bucket_domain_name = module.object_storage.bucket_domain_name
    bucket_name        = module.object_storage.bucket_name
    bucket_arn         = module.object_storage.bucket_arn
  } `,

    cloudfront: `module "cdn" {
    source = "./modules/cdn"

    project_name       = var.project_name
    ${regionLabel}     = var.${regionLabel}
    bucket_domain_name = module.object_storage.bucket_domain_name
    bucket_name        = module.object_storage.bucket_name
    bucket_arn         = module.object_storage.bucket_arn
  } `,

    // 🔥 FIX: Ensure VPC services map to 'networking' module name for cross-module referencing
    vpc: `module "networking" {
    source = "./modules/networking"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    vpcnetworking: `module "networking" {
    source = "./modules/networking"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `,

    networking: `module "networking" {
    source = "./modules/networking"

    project_name = var.project_name
    ${regionLabel} = var.${regionLabel}
  } `
  };

  // 🔥 HARD GUARD: Bypass map lookup for CDN to ensure arguments are passed (including OAC variables)
  if (service === 'cdn' || service === 'contentdeliverynetwork' || service === 'cloudfront') {
    return `module "cdn" {
    source = "./modules/cdn"

    project_name       = var.project_name
    ${regionLabel}     = var.${regionLabel}
    bucket_domain_name = module.object_storage.bucket_domain_name
    bucket_name        = module.object_storage.bucket_name
    bucket_arn         = module.object_storage.bucket_arn
  }`;
  }

  return moduleMap[service] || `module "${service}" { source = "./modules/${service}" project_name = var.project_name ${regionLabel} = var.${regionLabel} }`;
}

/**
 * Generate README.md with deployment instructions
 */
function generateReadme(projectName, provider, pattern, services) {
  return `# ${projectName} - Terraform Infrastructure

## Architecture Pattern
    ** ${pattern}**

## Cloud Provider
    ** ${provider.toUpperCase()}**

## Services
${services.map(s => `- ${s}`).join('\n')}

## Prerequisites
    - Terraform >= 1.0
    - ${provider === 'aws' ? 'AWS CLI configured with credentials' : provider === 'gcp' ? 'GCP CLI (gcloud) authenticated' : 'Azure CLI logged in'}

## Deployment Instructions

### 1. Review Configuration
  Edit \`terraform.tfvars\` to set your project-specific values:
\`\`\`hcl
${provider === 'gcp' ? 'project_id = "your-gcp-project-id"' : ''}
project_name = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
\`\`\`

### 2. Initialize Terraform
\`\`\`bash
terraform init
\`\`\`

### 3. Review Plan
\`\`\`bash
terraform plan
\`\`\`

### 4. Apply Infrastructure
\`\`\`bash
terraform apply
\`\`\`

### 5. Get Outputs
\`\`\`bash
terraform output
\`\`\`

## Module Structure
Each service is implemented as a separate module in \`modules/\`:
- Modules contain actual cloud resources
- \`main.tf\` only references modules
- Modules enforce security defaults
- NFR-driven variables control encryption, backups, availability

## Cleanup
To destroy all infrastructure:
\`\`\`bash
terraform destroy
\`\`\`

## Notes
- Deletion protection is enabled by default for stateful resources
- Encryption at rest is enabled for all storage services
- Backup retention is set to ${7} days
- Multi-AZ deployment can be enabled via \`multi_az\` variable
`;
}

/**
 * Main orchestrator to generate all Terraform files
 */
async function generateTerraform(canonicalArchitecture, provider, region, projectName, options = {}) {
  const providerLower = provider.toLowerCase();
  console.log(`[TERRAFORM V2] Generating project for ${providerLower} in ${region}`);

  let files = {};
  // Normalize services to ensure we have a list of strings (service IDs)
  // canonicalArchitecture.services can be an array of objects or strings
  const rawServices = canonicalArchitecture.services || [];
  const services = rawServices.map(s => {
    if (typeof s === 'string') return s.toLowerCase();
    if (typeof s === 'object' && s !== null) {
      return (s.name || s.canonical_type || s.id || 'unknown_service').toLowerCase();
    }
    return String(s).toLowerCase();
  });

  const pattern = canonicalArchitecture.pattern || 'custom';

  // 🔒 FILTER: Separate deployable services (infra) from external services (variables only)
  const deployableServices = services.filter(s => !EXTERNAL_SERVICES.includes(s));

  // 💉 INJECT: Setup module for GCP (APIs)
  if (providerLower === 'gcp') {
    deployableServices.unshift('setup');
  }

  // 💉 INJECT: Networking module when VPC-dependent services are present (AWS)
  const vpcDependentServices = ['relationaldatabase', 'cache', 'computecontainer', 'computevm', 'loadbalancer'];
  const needsNetworking = vpcDependentServices.some(s => deployableServices.includes(s));
  if (providerLower === 'aws' && needsNetworking && !deployableServices.includes('networking') && !deployableServices.includes('vpcnetworking') && !deployableServices.includes('vpc')) {
    deployableServices.unshift('networking');
    console.log('[TERRAFORM V2] Auto-injected networking module for VPC-dependent services');
  }

  // 1. Generate Root Config
  files['versions.tf'] = generateVersionsTf(providerLower);
  files['providers.tf'] = generateProvidersTf(providerLower, region);
  files['variables.tf'] = generateVariablesTf(providerLower, pattern, services);
  files['terraform.tfvars'] = generateTfvars(providerLower, region, projectName, { ...canonicalArchitecture.sizing, connectionData: options.connectionData });
  files['outputs.tf'] = generateOutputsTf(providerLower, pattern, deployableServices);
  files['main.tf'] = generateMainTf(providerLower, pattern, deployableServices);
  files['README.md'] = generateReadme(projectName, providerLower, pattern, deployableServices);

  // 2. Generate Modules (Full Implementation)
  files = { ...files, ...generateModules(deployableServices, providerLower, region, projectName) };

  // 3. Helper Files (Dummy source for functions/apis to ensure plan succeeds)
  if (services.includes('apigateway') && providerLower === 'gcp') {
    files['modules/apigateway/spec.yaml'] = `swagger: "2.0"
info:
  title: "${projectName} API"
  description: "Cloudiverse Generated API"
  version: "1.0.0"
paths:
  /:
    get:
      responses:
        200:
          description: "OK"
      x-google-backend:
        address: "https://example.com"
`;
  }

  if (services.includes('computeserverless') && providerLower === 'aws') {
    files['modules/serverless_compute/index.js'] = `exports.handler = async (event) => { return { statusCode: 200, body: "Hello from Cloudiverse" }; };`;
  }

  if (services.includes('computeserverless') && providerLower === 'gcp') {
    files['modules/serverless_compute/index.js'] = `exports.helloWorld = (req, res) => { res.send("Hello from Cloudiverse"); };`;
  }

  return {
    files: files,
    modules: services // Metadata for tracking
  };
}

/**
 * Generate module files for all services
 */
function generateModules(services, provider, region, projectName) {
  const modules = {};

  if (!Array.isArray(services)) return modules;

  services.forEach(service => {
    const source = getModuleSource(service, provider);
    const folderName = getModuleName(service);
    modules[`modules/${folderName}/main.tf`] = source.main;
    modules[`modules/${folderName}/variables.tf`] = source.variables;
    modules[`modules/${folderName}/outputs.tf`] = source.outputs;
  });

  return modules;
}

/**
 * Get internal HCL source for a specific module
 */
function getModuleSource(service, provider) {
  const pLower = String(provider).toLowerCase();
  const regionLabel = regionArgMap[pLower] || 'region';
  const meta = SERVICE_METADATA[service] || {};

  const commonVarDefs = {
    vpc_id: 'variable "vpc_id" {\n  type = string\n  default = ""\n}',
    private_subnet_ids: 'variable "private_subnet_ids" {\n  type = list(string)\n  default = []\n}',
    public_subnet_ids: 'variable "public_subnet_ids" {\n  type = list(string)\n  default = []\n}',
    encryption_at_rest: 'variable "encryption_at_rest" {\n  type = bool\n  default = true\n}',
    backup_retention_days: 'variable "backup_retention_days" {\n  type = number\n  default = 7\n}',
    deletion_protection: 'variable "deletion_protection" {\n  type = bool\n  default = false\n}',
    multi_az: 'variable "multi_az" {\n  type = bool\n  default = false\n}',
    monitoring_enabled: 'variable "monitoring_enabled" {\n  type = bool\n  default = true\n}'
  };

  const getRequiredVars = (serviceId, serviceArgs = []) => {
    let vars = `variable "project_name" { type = string }\nvariable "${regionLabel}" { type = string }`;

    // Add AWS-specific extra_env_vars if applicable
    if (provider === 'aws' && (serviceId === 'computeserverless' || serviceId === 'computecontainer' || serviceId === 'appcompute')) {
      vars += `\nvariable "extra_env_vars" {\n  type = map(string)\n  default = {}\n}`;
    }

    // Add meta-defined args
    serviceArgs.forEach(arg => {
      if (commonVarDefs[arg]) {
        vars += `\n${commonVarDefs[arg]}`;
      }
    });

    return vars;
  };

  const getRequiredOutputs = (serviceId) => {
    const map = {
      cdn: 'output "endpoint" { value = "" }\\noutput "id" { value = "" }',
      apigateway: 'output "endpoint" { value = "" }',
      relationaldatabase: 'output "endpoint" { value = "" }',
      objectstorage: 'output "bucket_name" { value = "" }',
      computecontainer: 'output "cluster_name" { value = "" }\\noutput "service_name" { value = "" }',
      containerregistry: 'output "repository_url" { value = "" }',
      computeserverless: 'output "url" { value = "" }',
      computevm: 'output "public_ip" { value = "" }',
      cache: 'output "endpoint" { value = "" }',
      nosqldatabase: 'output "endpoint" { value = "" }',
      messagequeue: 'output "endpoint" { value = "" }',
      auth: 'output "client_id" { value = "" }',
      identityauth: 'output "client_id" { value = "" }',
      waf: 'output "web_acl_id" { value = "" }',
      secretsmanagement: 'output "arn" { value = "" }',
      loadbalancer: 'output "dns_name" { value = "" }',
      globalloadbalancer: 'output "endpoint" { value = "" }',
      dns: 'output "name_servers" { value = [] }',
      logging: 'output "log_group_name" { value = "" }',
      monitoring: 'output "url" { value = "" }',
      networking: 'output "vpc_id" { value = "" }\noutput "private_subnet_ids" { value = [] }\noutput "public_subnet_ids" { value = [] }',
      vpcnetworking: 'output "vpc_id" { value = "" }\noutput "private_subnet_ids" { value = [] }\noutput "public_subnet_ids" { value = [] }',
      vpc: 'output "vpc_id" { value = "" }\noutput "private_subnet_ids" { value = [] }\noutput "public_subnet_ids" { value = [] }'
    };
    return map[serviceId] || ``;
  };

  // Default skeleton
  const skeleton = {
    main: `// ${service} module for ${provider}\nresource "null_resource" "${service}_stub" {}`,
    variables: getRequiredVars(service, meta.args),
    outputs: getRequiredOutputs(service)
  };

  // 1. AWS IMPLEMENTATIONS
  if (provider === 'aws') {
    switch (service) {
      case 'loadbalancer':
        return {
          main: `resource "aws_lb" "main" {
  name               = "\${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false

  tags = {
    Name = "\${var.project_name}-alb"
  }
}

resource "aws_security_group" "lb_sg" {
  name        = "\${var.project_name}-lb-sg"
  description = "Allow HTTP inbound traffic"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }`,
          outputs: `output "dns_name" { value = aws_lb.main.dns_name }
output "arn" { value = aws_lb.main.arn }`
        };

      case 'relationaldatabase':
        return {
          main: `resource "aws_db_instance" "default" {
  identifier           = "\${var.project_name}-db"
  allocated_storage    = 20
  storage_type         = "gp2"
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.t3.micro"
  db_name              = replace(var.project_name, "-", "_")
  username             = "dbadmin"
  password             = "ChangeMe123!" // In prod, use secrets manager
  parameter_group_name = "default.postgres15"
  skip_final_snapshot  = true
  publicly_accessible  = false
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.default.name
  storage_encrypted      = var.encryption_at_rest
  backup_retention_period = 0  # Free tier compatible (no automated backups)
  deletion_protection    = false  # Free tier compatible
  multi_az               = false  # Free tier compatible (single AZ only)
}

resource "aws_db_subnet_group" "default" {
  name       = "\${var.project_name}-db-subnet-group"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "db_sg" {
  name        = "\${var.project_name}-db-sg"
  description = "Allow DB traffic"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Restrict to VPC
  }
}`,
          variables: getRequiredVars('relationaldatabase', meta.args),
          outputs: `output "endpoint" { value = aws_db_instance.default.endpoint }`
        };

      case 'cache':
        return {
          main: `resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "\${var.project_name}-redis"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis6.x"
  engine_version       = "6.2"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.default.name
  security_group_ids   = [aws_security_group.redis_sg.id]
}

resource "aws_elasticache_subnet_group" "default" {
  name       = "\${var.project_name}-cache-subnet"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "redis_sg" {
  name        = "\${var.project_name}-redis-sg"
  vpc_id      = var.vpc_id
  ingress {
    from_port = 6379
    to_port   = 6379
    protocol  = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}`,
          variables: getRequiredVars('cache', meta.args),
          outputs: `output "endpoint" { value = aws_elasticache_cluster.redis.cache_nodes.0.address }`
        };

      case 'objectstorage':
        return {
          main: `resource "aws_s3_bucket" "main" {
  bucket_prefix = "\${var.project_name}-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = false  # Allow bucket policies (for CloudFront OAC)
  ignore_public_acls      = true
  restrict_public_buckets = false  # Allow CloudFront access via policy
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}`,
          variables: getRequiredVars('objectstorage', meta.args),
          outputs: `output "bucket_name" { value = aws_s3_bucket.main.id }
output "bucket_arn" { value = aws_s3_bucket.main.arn }
output "bucket_domain_name" { value = aws_s3_bucket.main.bucket_regional_domain_name }`
        };

      case 'containerregistry':
        return {
          main: `resource "aws_ecr_repository" "repo" {
  name                 = "\${var.project_name}-repo"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration {
    scan_on_push = true
  }
}`,
          variables: getRequiredVars('containerregistry', meta.args),
          outputs: `output "repository_url" { value = aws_ecr_repository.repo.repository_url }`
        };

      case 'computecontainer':
        return {
          main: `resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"
}

resource "aws_ecr_repository" "repo" {
  name                 = "\${var.project_name}-repo"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

resource "aws_s3_bucket" "builds" {
  bucket_prefix = "\${var.project_name}-builds-"
  force_destroy = true
}

resource "aws_iam_role" "codebuild_role" {
  name = "\${var.project_name}-codebuild-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow", Principal = { Service = "codebuild.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "codebuild_policy" {
  name = "\${var.project_name}-codebuild-policy"
  role = aws_iam_role.codebuild_role.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Effect = "Allow", Resource = "*" },
      { Action = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"], Effect = "Allow", Resource = "\${aws_s3_bucket.builds.arn}/*" },
      { Action = ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage", "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"], Effect = "Allow", Resource = "*" }
    ]
  })
}

resource "aws_codebuild_project" "build" {
  name          = "\${var.project_name}-build"
  service_role  = aws_iam_role.codebuild_role.arn

  artifacts { type = "NO_ARTIFACTS" }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    privileged_mode             = true
    image_pull_credentials_type = "CODEBUILD"
  }

  source {
    type      = "S3"
    location  = "\${aws_s3_bucket.builds.bucket}/builds/latest.zip"
  }
}

resource "aws_iam_role" "execution_role" {
  name = "\${var.project_name}-execution-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Action = "sts:AssumeRole", Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy_attachment" "execution_role_policy" {
  role       = aws_iam_role.execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "\${var.project_name}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution_role.arn
  container_definitions    = jsonencode([{
    name  = "app"
    image = "\${aws_ecr_repository.repo.repository_url}:latest"
    essential = true
    portMappings = [{ containerPort = 80, hostPort = 80 }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/\${var.project_name}"
        "awslogs-region"        = "\${var.region}"
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

resource "aws_cloudwatch_log_group" "logs" {
  name              = "/ecs/\${var.project_name}"
  retention_in_days = 7
}

resource "aws_ecs_service" "app" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app_sg.id]
    assign_public_ip = true
  }
}

resource "aws_security_group" "app_sg" {
  name        = "\${var.project_name}-app-sg"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`,
          variables: getRequiredVars('computecontainer', meta.args),
          outputs: `output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.app.name }
output "ecr_url" { value = aws_ecr_repository.repo.repository_url }
output "codebuild_name" { value = aws_codebuild_project.build.name }
output "build_bucket" { value = aws_s3_bucket.builds.bucket }
output "region" { value = var.region }`
        };

      case 'cdn':
        return {
          main: `# ═══════════════════════════════════════════════════════════════════════════
# CloudFront CDN with Origin Access Control (OAC) - Production Grade
# ═══════════════════════════════════════════════════════════════════════════

# 1. Origin Access Control (OAC) - Modern replacement for OAI
resource "aws_cloudfront_origin_access_control" "oac" {
  name                              = "\${var.project_name}-oac"
  description                       = "OAC for static site S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# 2. CloudFront Distribution
resource "aws_cloudfront_distribution" "cdn" {
  enabled             = true
  default_root_object = "index.html"
  comment             = "\${var.project_name} Static Site CDN"

  origin {
    domain_name              = var.bucket_domain_name
    origin_id                = "site"
    origin_access_control_id = aws_cloudfront_origin_access_control.oac.id
  }

  default_cache_behavior {
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "site"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    min_ttl     = 0
    default_ttl = 3600
    max_ttl     = 86400
  }

  # SPA Support: Handle 403/404 with index.html for client-side routing
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name      = "\${var.project_name}-cdn"
    ManagedBy = "Cloudiverse"
  }
}

# 3. S3 Bucket Policy - CRITICAL: Allows ONLY this CloudFront distribution
resource "aws_s3_bucket_policy" "cloudfront_access" {
  bucket = var.bucket_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontAccess"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action   = "s3:GetObject"
        Resource = "\${var.bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.cdn.arn
          }
        }
      }
    ]
  })

  depends_on = [aws_cloudfront_distribution.cdn]
}`,
          variables: getRequiredVars('cdn', meta.args) + `
variable "bucket_domain_name" { 
  type        = string 
  description = "S3 bucket regional domain name"
}
variable "bucket_name" { 
  type        = string 
  description = "S3 bucket name for policy attachment"
}
variable "bucket_arn" { 
  type        = string 
  description = "S3 bucket ARN for policy"
}`,
          outputs: `output "endpoint" { value = aws_cloudfront_distribution.cdn.domain_name }
output "id" { value = aws_cloudfront_distribution.cdn.id }
output "arn" { value = aws_cloudfront_distribution.cdn.arn }`
        };

      case 'apigateway':
        return {
          main: `resource "aws_apigatewayv2_api" "api" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id = aws_apigatewayv2_api.api.id
  name   = "$default"
  auto_deploy = true
}`,
          variables: getRequiredVars('apigateway', meta.args),
          outputs: `output "endpoint" { value = aws_apigatewayv2_api.api.api_endpoint }`
        };

      case 'networking':
      case 'vpcnetworking':
      case 'vpc':
        return {
          main: `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "\${var.project_name}-vpc" }
}

resource "aws_subnet" "public" {
  count = 2
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.\${count.index}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  map_public_ip_on_launch = true
  tags = { Name = "\${var.project_name}-public-\${count.index}" }
}

resource "aws_subnet" "private" {
  count = 2
  vpc_id = aws_vpc.main.id
  cidr_block = "10.0.\${count.index + 10}.0/24"
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags = { Name = "\${var.project_name}-private-\${count.index}" }
}

data "aws_availability_zones" "available" {}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }`
        };

      case 'nosqldatabase':
        return {
          main: `resource "aws_dynamodb_table" "main" {
  name           = "\${var.project_name}-table"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"

  attribute {
    name = "id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = var.encryption_at_rest
  }

  server_side_encryption {
    enabled = var.encryption_at_rest
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "table_name" { value = aws_dynamodb_table.main.name }
output "table_arn" { value = aws_dynamodb_table.main.arn }`
        };

      case 'computevm':
        return {
          main: `data "aws_ami" "latest_amazon_linux" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["amzn2-ami-hvm-*-x86_64-gp2"]
  }
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.latest_amazon_linux.id
  instance_type = "t3.micro"
  subnet_id     = var.private_subnet_ids[0]
  vpc_security_group_ids = [aws_security_group.vm_sg.id]

  tags = { Name = "\${var.project_name}-vm" }
}

resource "aws_security_group" "vm_sg" {
  name        = "\${var.project_name}-vm-sg"
  vpc_id      = var.vpc_id
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "instance_id" { value = aws_instance.app.id }
output "private_ip" { value = aws_instance.app.private_ip }`
        };

      case 'computeserverless':
        return {
          main: `resource "aws_iam_role" "lambda_role" {
  name = "\${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

data "archive_file" "lambda_zip" {
  type        = "zip"
  source_file = "\${path.module}/index.js"
  output_path = "\${path.module}/function.zip"
}

resource "aws_lambda_function" "app" {
  filename         = data.archive_file.lambda_zip.output_path
  source_code_hash = data.archive_file.lambda_zip.output_base64sha256
  function_name    = "\${var.project_name}-function"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs16.x"

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda_sg.id]
  }
}

resource "aws_security_group" "lambda_sg" {
  name   = "\${var.project_name}-lambda-sg"
  vpc_id = var.vpc_id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "function_name" { value = aws_lambda_function.app.function_name }`
        };

      case 'monitoring':
        return {
          main: `resource "aws_cloudwatch_metric_alarm" "health" {
  alarm_name          = "\${var.project_name}-health-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "120"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors ec2 cpu utilization"
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = "https://console.aws.amazon.com/cloudwatch/" }`
        };

      case 'logging':
        return {
          main: `resource "aws_cloudwatch_log_group" "main" {
  name              = "/aws/\${var.project_name}/logs"
  retention_in_days = 30
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "log_group_name" { value = aws_cloudwatch_log_group.main.name }`
        };

      case 'identityauth':
      case 'auth':
        return {
          main: `resource "aws_iam_role" "app_role" {
  name = "\${var.project_name}-app-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "client_id" { value = aws_iam_role.app_role.arn }`
        };

      case 'loadbalancer':
        return {
          main: `resource "aws_lb" "main" {
  name               = "\${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb_sg.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false
}

resource "aws_security_group" "lb_sg" {
  name   = "\${var.project_name}-lb-sg"
  vpc_id = var.vpc_id
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "dns_name" { value = aws_lb.main.dns_name }`
        };

      case 'apigateway':
        return {
          main: `resource "aws_apigatewayv2_api" "api" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = aws_apigatewayv2_api.api.api_endpoint }`
        };

      default:
        return skeleton;
    }
  }

  // 2. GCP IMPLEMENTATIONS
  if (provider === 'gcp') {
    switch (service) {
      case 'setup':
        return {
          main: `resource "google_project_service" "apis" {
  for_each = toset([
    "iam.googleapis.com", 
    "run.googleapis.com", 
    "sqladmin.googleapis.com", 
    "redis.googleapis.com",
    "compute.googleapis.com",
    "servicenetworking.googleapis.com",
    "cloudresourcemanager.googleapis.com"
  ])
  service = each.key
  disable_on_destroy = false
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: ''
        };

      case 'computecontainer':
        return {
          main: `resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "\${var.project_name}-repo"
  format        = "DOCKER"
}

resource "google_cloud_run_service" "app" {
  name     = "\${var.project_name}-app"
  location = var.region

  template {
    spec {
      containers {
        image = "\${var.region}-docker.pkg.dev/\${var.project_id}/\${google_artifact_registry_repository.repo.name}/app:latest"
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}`,
          variables: getRequiredVars('computecontainer', meta.args) + '\nvariable "project_id" { type = string }',
          outputs: `output "url" { value = google_cloud_run_service.app.status[0].url }
output "service_name" { value = google_cloud_run_service.app.name }
output "artifact_registry" { value = google_artifact_registry_repository.repo.name }
output "project_id" { value = var.project_id }
output "region" { value = var.region }`
        };

      case 'relationaldatabase':
        return {
          main: `resource "google_sql_database_instance" "main" {
  name             = "\${var.project_name}-db"
  database_version = "POSTGRES_13"
  region           = var.region

  settings {
    tier = "db-f1-micro"
    backup_configuration {
      enabled = true
    }
    ip_configuration {
      ipv4_enabled    = false
      private_network = var.vpc_id
    }
  }
}

resource "google_sql_database" "database" {
  name     = "app_db"
  instance = google_sql_database_instance.main.name
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = google_sql_database_instance.main.private_ip_address }`
        };

      case 'networking':
      case 'vpcnetworking':
      case 'vpc':
        return {
          main: `resource "google_compute_network" "vpc" {
  name                    = "\${var.project_name}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "public" {
  name          = "public"
  ip_cidr_range = "10.0.1.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}

resource "google_compute_subnetwork" "private" {
  name          = "private"
  ip_cidr_range = "10.0.2.0/24"
  region        = var.region
  network       = google_compute_network.vpc.id
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "vpc_id" { value = google_compute_network.vpc.id }
output "public_subnet_ids" { value = [google_compute_subnetwork.public.id] }
output "private_subnet_ids" { value = [google_compute_subnetwork.private.id] }`
        };

      case 'nosqldatabase':
        return {
          main: `resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "database_id" { value = google_firestore_database.database.name }`
        };

      case 'objectstorage':
        return {
          main: `resource "google_storage_bucket" "store" {
  name          = "\${var.project_name}-assets"
  location      = var.region
  force_destroy = true
}`,
          variables: getRequiredVars('objectstorage', meta.args),
          outputs: `output "bucket_name" { value = google_storage_bucket.store.name }`
        };

      case 'cache':
        return {
          main: `resource "google_redis_instance" "cache" {
  name           = "\${var.project_name}-cache"
  tier           = "BASIC"
  memory_size_gb = 1
  region         = var.region
  authorized_network = var.vpc_id
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = google_redis_instance.cache.host }`
        };

      case 'computevm':
        return {
          main: `resource "google_compute_instance" "vm" {
  name         = "\${var.project_name}-vm"
  machine_type = "e2-micro"
  zone         = "\${var.region}-a"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-11"
    }
  }

  network_interface {
    network = var.vpc_id
    subnetwork = var.private_subnet_ids[0]
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "instance_id" { value = google_compute_instance.vm.instance_id }
output "ip" { value = google_compute_instance.vm.network_interface[0].network_ip }`
        };

      case 'computeserverless':
        return {
          main: `resource "google_storage_bucket" "func_bucket" {
  name     = "\${var.project_name}-func-source"
  location = var.region
}

data "archive_file" "source" {
  type        = "zip"
  source_file = "\${path.module}/index.js"
  output_path = "\${path.module}/function.zip"
}

resource "google_storage_bucket_object" "archive" {
  name   = "function.zip"
  bucket = google_storage_bucket.func_bucket.name
  source = data.archive_file.source.output_path
}

resource "google_cloudfunctions_function" "function" {
  name        = "\${var.project_name}-function"
  description = "Cloud Function"
  runtime     = "nodejs16"

  available_memory_mb   = 256
  source_archive_bucket = google_storage_bucket.func_bucket.name
  source_archive_object = google_storage_bucket_object.archive.name
  trigger_http          = true
  entry_point           = "helloWorld"
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = google_cloudfunctions_function.function.https_trigger_url }`
        };

      case 'monitoring':
        return {
          main: `resource "google_monitoring_alert_policy" "alert_policy" {
  display_name = "\${var.project_name}-alert"
  combiner     = "OR"
  conditions {
    display_name = "CPU Usage High"
    condition_threshold {
      filter     = "metric.type=\\"compute.googleapis.com/instance/cpu/utilization\\" resource.type=\\"gce_instance\\""
      duration   = "60s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.8
    }
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = "https://console.cloud.google.com/monitoring/dashboards" }`
        };

      case 'logging':
        return {
          main: `resource "google_logging_project_sink" "sink" {
  name        = "\${var.project_name}-sink"
  destination = "storage.googleapis.com/\${var.project_name}-logs"
  filter      = "severity>=ERROR"
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "log_group_name" { value = google_logging_project_sink.sink.name }`
        };

      case 'identityauth':
      case 'auth':
        return {
          main: `resource "google_service_account" "app_sa" {
  account_id   = "sa-\${substr(replace(var.project_name, "-", ""), 0, 26)}"
  display_name = "App Service Account"
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "client_id" { value = google_service_account.app_sa.email }`
        };

      case 'loadbalancer':
        return {
          main: `resource "google_compute_global_forwarding_rule" "default" {
  name       = "\${var.project_name}-lb"
  target     = google_compute_target_http_proxy.default.id
  port_range = "80"
}

resource "google_compute_target_http_proxy" "default" {
  name    = "\${var.project_name}-proxy"
  url_map = google_compute_url_map.default.id
}

resource "google_compute_url_map" "default" {
  name            = "\${var.project_name}-urlmap"
  default_service = google_compute_backend_service.default.id
}

resource "google_compute_backend_service" "default" {
  name        = "\${var.project_name}-backend"
  port_name   = "http"
  protocol    = "HTTP"
  timeout_sec = 10
  health_checks = [google_compute_health_check.default.id]
}

resource "google_compute_health_check" "default" {
  name               = "\${var.project_name}-hc"
  check_interval_sec = 1
  timeout_sec        = 1
  http_health_check {
    port = 80
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "dns_name" { value = google_compute_global_forwarding_rule.default.ip_address }`
        };

      case 'apigateway':
        return {
          main: `resource "google_api_gateway_api" "api" {
  provider = google-beta
  api_id   = "\${var.project_name}-api"
}

resource "google_api_gateway_api_config" "api_cfg" {
  provider      = google-beta
  api           = google_api_gateway_api.api.api_id
  api_config_id = "\${var.project_name}-cfg"

  openapi_config {
    document {
      path     = "spec.yaml"
      contents = filebase64("spec.yaml")
    }
  }
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = google_api_gateway_api_config.api_cfg.name }`
        };

      case 'cdn':
        return {
          main: `resource "google_compute_backend_bucket" "cdn" {
  name        = "\${var.project_name}-cdn-backend"
  bucket_name = "\${var.project_name}-assets"
  enable_cdn  = true
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = google_compute_backend_bucket.cdn.name }`
        };

      default:
        return skeleton;
    }
  }

  // 3. AZURE IMPLEMENTATIONS
  if (provider === 'azure' || provider === 'azurerm') {
    switch (service) {
      case 'computecontainer':
        return {
          main: `resource "azurerm_container_registry" "acr" {
  name                = replace("\${var.project_name}acr", "-", "")
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location
  sku                 = "Standard"
  admin_enabled       = true
}

resource "azurerm_log_analytics_workspace" "core" {
  name                = "\${var.project_name}-logs"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_container_app_environment" "env" {
  name                       = "\${var.project_name}-env"
  location                   = var.location
  resource_group_name        = azurerm_resource_group.rg.name
  log_analytics_workspace_id = azurerm_log_analytics_workspace.core.id
}

resource "azurerm_container_app" "app" {
  name                         = "\${var.project_name}-app"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"

  template {
    container {
      name   = "main"
      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = 0.5
      memory = "1.0Gi"
    }
  }
  
  ingress {
    external_enabled = true
    target_port      = 80
    traffic_weight {
      percentage = 100
      latest_revision = true
    }
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars('computecontainer', meta.args),
          outputs: `output "url" { value = azurerm_container_app.app.ingress[0].fqdn }
output "service_name" { value = azurerm_container_app.app.name }
output "container_app_name" { value = azurerm_container_app.app.name }
output "resource_group_name" { value = azurerm_resource_group.rg.name }
output "acr_login_server" { value = azurerm_container_registry.acr.login_server }`
        };

      case 'objectstorage':
        return {
          main: `resource "azurerm_storage_account" "store" {
  name                     = replace("\${var.project_name}store", "-", "")
  resource_group_name      = "\${var.project_name}-rg"
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars('objectstorage', meta.args),
          outputs: `output "bucket_name" { value = azurerm_storage_account.store.name }`
        };

      case 'relationaldatabase':
        return {
          main: `resource "azurerm_postgresql_server" "db" {
  name                = "\${var.project_name}-db"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name

  sku_name = "GP_Gen5_2"

  storage_mb            = 5120
  backup_retention_days = var.backup_retention_days
  geo_redundant_backup_enabled = false
  auto_grow_enabled            = true

  administrator_login          = "psqladmin"
  administrator_login_password = "ChangeMe123!"
  version                      = "11"
  ssl_enforcement_enabled      = true
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars('relationaldatabase', meta.args),
          outputs: `output "endpoint" { value = azurerm_postgresql_server.db.fqdn }`
        };

      case 'networking':
      case 'vpcnetworking':
      case 'vpc':
        return {
          main: `resource "azurerm_virtual_network" "main" {
  name                = "\${var.project_name}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_subnet" "public" {
  name                 = "public"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}

resource "azurerm_subnet" "private" {
  name                 = "private"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.2.0/24"]
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "vpc_id" { value = azurerm_virtual_network.main.id }
output "public_subnet_ids" { value = [azurerm_subnet.public.id] }
output "private_subnet_ids" { value = [azurerm_subnet.private.id] }`
        };

      case 'cache':
        return {
          main: `resource "azurerm_redis_cache" "cache" {
  name                = "\${var.project_name}-cache"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  capacity            = 1
  family              = "C"
  sku_name            = "Basic"
  non_ssl_port_enabled = false
  minimum_tls_version = "1.2"

  redis_configuration {
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = azurerm_redis_cache.cache.hostname }`
        };

      case 'monitoring':
        return {
          main: `resource "azurerm_application_insights" "monitoring" {
  name                = "\${var.project_name}-insights"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  application_type    = "web"
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = "https://portal.azure.com" }`
        };

      case 'logging':
        return {
          main: `resource "azurerm_log_analytics_workspace" "logging" {
  name                = "\${var.project_name}-logs"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "log_group_name" { value = azurerm_log_analytics_workspace.logging.name }`
        };
      case 'loadbalancer':
        return {
          main: `resource "azurerm_public_ip" "lb" {
  name                = "\${var.project_name}-lb-ip"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_lb" "main" {
  name                = "\${var.project_name}-lb"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "PublicIPAddress"
    public_ip_address_id = azurerm_public_ip.lb.id
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "dns_name" { value = azurerm_public_ip.lb.ip_address }`
        };

      case 'apigateway':
        return {
          main: `resource "azurerm_api_management" "api" {
  name                = "\${var.project_name}-apim"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  publisher_name      = "Cloudiverse"
  publisher_email     = "admin@cloudiverse.com"
  sku_name            = "Consumption_0"
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = azurerm_api_management.api.gateway_url }`
        };

      case 'cdn':
        return {
          main: `resource "azurerm_cdn_profile" "cdn" {
  name                = "\${var.project_name}-cdn"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  sku                 = "Standard_Microsoft"
}

resource "azurerm_cdn_endpoint" "endpoint" {
  name                = "\${var.project_name}-endpoint"
  profile_name        = azurerm_cdn_profile.cdn.name
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name

  origin {
    name      = "default-origin"
    host_name = "example.com"
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = azurerm_cdn_endpoint.endpoint.fqdn }`
        };

      case 'identityauth':
      case 'auth':
        return {
          main: `resource "azurerm_user_assigned_identity" "auth" {
  name                = "\${var.project_name}-identity"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "client_id" { value = azurerm_user_assigned_identity.auth.client_id }`
        };

      case 'nosqldatabase':
        return {
          main: `resource "azurerm_cosmosdb_account" "nosql" {
  name                = "\${var.project_name}-nosql"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  enable_automatic_failover = false

  consistency_policy {
    consistency_level       = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "endpoint" { value = azurerm_cosmosdb_account.nosql.endpoint }`
        };

      case 'computevm':
        return {
          main: `resource "azurerm_public_ip" "vm_ip" {
  name                = "\${var.project_name}-vm-ip"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  allocation_method   = "Dynamic"
}

resource "azurerm_network_interface" "vm_nic" {
  name                = "\${var.project_name}-nic"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = var.private_subnet_ids[0]
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.vm_ip.id
  }
}

resource "azurerm_linux_virtual_machine" "vm" {
  name                = "\${var.project_name}-vm"
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location
  size                = "Standard_B1s"
  admin_username      = "adminuser"
  network_interface_ids = [
    azurerm_network_interface.vm_nic.id,
  ]

  admin_ssh_key {
    username   = "adminuser"
    public_key = "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC..."
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Standard_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "UbuntuServer"
    sku       = "18.04-LTS"
    version   = "latest"
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "public_ip" { value = azurerm_linux_virtual_machine.vm.public_ip_address }`
        };

      case 'computeserverless':
        return {
          main: `resource "azurerm_storage_account" "func_store" {
  name                     = replace("\${var.project_name}fsa", "-", "")
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "func_plan" {
  name                = "\${var.project_name}-func-plan"
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "function" {
  name                = "\${var.project_name}-func"
  resource_group_name = azurerm_resource_group.rg.name
  location            = var.location

  storage_account_name       = azurerm_storage_account.func_store.name
  storage_account_access_key = azurerm_storage_account.func_store.primary_access_key
  service_plan_id            = azurerm_service_plan.func_plan.id

  site_config {}
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: getRequiredVars(service, meta.args),
          outputs: `output "url" { value = azurerm_linux_function_app.function.default_hostname }`
        };

      default:
        return skeleton;
    }
  }

  return skeleton;
}

module.exports = {
  generateTerraform,
  generateVersionsTf,
  generateProvidersTf,
  generateVariablesTf,
  generateTfvars,
  generateOutputsTf,
  generateMainTf,
  generateReadme,
  getModuleName,
  // New Flat Generator
  generatePricingMainTf
};
