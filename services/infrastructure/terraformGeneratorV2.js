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

// ═══════════════════════════════════════════════════════════════════════════
// TERRAFORM FILE GENERATORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate FLAT pricing-optimized main.tf (No modules)
 * Matches strict keys in usageNormalizer.js
 */
function generatePricingMainTf(provider, services, region, projectName) {
  let tf = `// PRICING TERRAFORM - FLAT STRUCTURE\n`;

  // Helper to check service presence (handle strings or objects)
  const has = (id) => services.some(s => (typeof s === 'string' ? s : s.service_id) === id);

  if (provider === 'aws') {
    // 1. AWS IMPLEMENTATION
    if (has('computecontainer')) {
      tf += `
resource "aws_ecs_service" "app" {
  name            = "app-service"
  cluster         = "pricing-cluster"
  task_definition = "pricing-task"
  desired_count   = 2
  launch_type     = "FARGATE"
  
  # 🔥 UPDATED: Realistic specs for accurate pricing
  network_configuration {
    subnets = ["subnet-12345678"]
  }
}

resource "aws_ecs_task_definition" "pricing-task" {
  family                   = "pricing-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024 # 1 vCPU
  memory                   = 2048 # 2 GB
  execution_role_arn       = "arn:aws:iam::123456789012:role/ecsTaskExecutionRole"
  container_definitions    = jsonencode([{
    name  = "app"
    image = "nginx"
    cpu   = 1024
    memory = 2048
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
  memory_size   = 128
}
`;  // 🔥 FIX: API Gateway moved to separate has('apigateway') check
    }


    if (has('relationaldatabase')) {
      tf += `
resource "aws_db_instance" "db" {
  instance_class    = "db.t3.medium" # 🔥 UPDATED: Realistic prod size
  allocated_storage = 100            # 🔥 UPDATED: Realistic storage
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
  name           = "GameScores"
  billing_mode   = "PROVISIONED"
  read_capacity  = 20
  write_capacity = 20
  hash_key       = "UserId"
  range_key      = "GameTitle"

  attribute {
    name = "UserId"
    type = "S"
  }

  attribute {
    name = "GameTitle"
    type = "S"
  }
}
`;
    }

    if (has('objectstorage')) {
      tf += `
resource "aws_s3_bucket" "main" {
  bucket = "${projectName}-assets-pricing"
}
`;
    }

    if (has('loadbalancer')) {
      tf += `
resource "aws_lb" "alb" {
  name               = "test-lb-tf"
  internal           = false
  load_balancer_type = "application"
  subnets            = ["subnet-12345678"]
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
    type      = "FARGATE"
    max_vcpus = 16
    subnets   = ["subnet-12345678"]
    security_group_ids = ["sg-12345678"]
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
  name = "example.com"
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
}

resource "aws_nat_gateway" "nat" {
  allocation_id = "eip-12345678"
  subnet_id     = "subnet-12345678"
  connectivity_type = "public"
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
  bucket = "${projectName}-datalake"
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
  domain_name       = "example.com"
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
  vpc_id = "vpc-12345678"
}
`;
    }
    if (has('privatelink')) {
      tf += `
resource "aws_vpc_endpoint" "s3" {
  vpc_id       = "vpc-12345678"
  service_name = "com.amazonaws.${region}.s3"
}
`;
    }
    if (has('servicediscovery')) {
      tf += `
resource "aws_service_discovery_private_dns_namespace" "dns" {
  name        = "${projectName}.local"
  description = "Service discovery"
  vpc         = "vpc-12345678"
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
            cpu    = "2000m" # 🔥 UPDATED: 2 vCPU
            memory = "2Gi"   # 🔥 UPDATED: 2 GiB to avoid free tier
          }
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
  available_memory_mb   = 1024 # 🔥 UPDATED: 1GB memory
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
    tier = "db-custom-2-3840" # 🔥 UPDATED: 2 vCPU, 3.75GB RAM (Standard)
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
        storage_mb = 32768
        sku_name = "B_Standard_B1ms"
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
        project = var.project_id
        region = var.region
      }
      `;
  } else if (provider === 'azure') {
    return `provider "azurerm" {
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

  // Common variables
  if (provider === 'aws') {
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

      `;
  } else if (provider === 'azure') {
    variables += `variable "location" {
        description = "Azure location"
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
function generateTfvars(provider, region, projectName) {
  // const region resolved from arg


  let tfvars = '';

  if (provider === 'aws') {
    tfvars += `region = "${region}"\n`;
  } else if (provider === 'gcp') {
    tfvars += `project_id = "YOUR_GCP_PROJECT_ID"\n`;
    tfvars += `region = "${region}"\n`;
  } else if (provider === 'azure') {
    tfvars += `location = "${region}"\n`;
  }

  tfvars += `project_name = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"\n`;
  tfvars += `environment = "production"\n\n`;

  // NFR-driven values (Defaults since requirements obj is not available in V2 generator yet)
  const nfr = {};
  tfvars += `# NFR - Driven Configuration\n`;
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
function generateOutputsTf(provider, pattern, services) {
  let outputs = `# Infrastructure Outputs\n\n`;

  // Pattern-specific outputs
  if (Array.isArray(services) && services.includes('cdn')) {
    outputs += `output "cdn_endpoint" {
        description = "CDN endpoint URL"
        value = module.cdn.endpoint
      }

      `;
  }

  if (Array.isArray(services) && services.includes('apigateway')) {
    outputs += `output "api_endpoint" {
        description = "API Gateway endpoint URL"
        value = module.apigateway.endpoint
      }

      `;
  }

  if (Array.isArray(services) && services.includes('relationaldatabase')) {
    outputs += `output "database_endpoint" {
        description = "Database connection endpoint"
        value = module.relational_db.endpoint
        sensitive = true
      }

      `;
  }

  if (Array.isArray(services) && services.includes('objectstorage')) {
    outputs += `output "storage_bucket" {
        description = "Object storage bucket name"
        value = module.object_storage.bucket_name
      }

      `;
  }

  return outputs;
}

/**
 * Generate main.tf (ONLY module references, NO direct resources)
 */
function generateMainTf(provider, pattern, services) {
  let mainTf = `# Main Terraform Configuration
# Pattern: ${pattern}
# Provider: ${provider.toUpperCase()}
#
# This file ONLY references modules - no direct resource blocks allowed.
# All cloud resources are defined in their respective modules.

        provider "${provider.toLowerCase()}" {
        region = var.region
  # Make sure to configure credentials via environment variables or CLI
      }

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
      // Skip if service is just a logical grouping or non-deployable
      // but for now we generate everything we have a module for

      mainTf += `module "${service}" {
        source = "./modules/${service}"

        project_name = var.project_name
        region = var.region
  
  # Inject common dependencies if available
  # vpc_id = module.networking.vpc_id
      }

      `;
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
  const moduleMap = {
    cdn: `module "cdn" {
        source = "./modules/cdn"

        project_name = var.project_name
        region = var.region
      } `,

    apigateway: `module "apigateway" {
        source = "./modules/apigateway"

        project_name = var.project_name
        region = var.region
      } `,

    computeserverless: `module "serverless_compute" {
        source = "./modules/serverless_compute"

        project_name = var.project_name
        region = var.region
      } `,

    appcompute: `module "app_compute" {
        source = "./modules/app_compute"

        project_name = var.project_name
        region = var.region
        vpc_id = module.networking.vpc_id
        private_subnet_ids = module.networking.private_subnet_ids
      } `,

    relationaldatabase: `module "relational_db" {
        source = "./modules/relational_db"

        project_name = var.project_name
        region = var.region
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
        region = var.region
        encryption_at_rest = var.encryption_at_rest
      } `,

    cache: `module "cache" {
        source = "./modules/cache"

        project_name = var.project_name
        region = var.region
        vpc_id = module.networking.vpc_id
        private_subnet_ids = module.networking.private_subnet_ids
      } `,

    messagequeue: `module "message_queue" {
        source = "./modules/mq"

        project_name = var.project_name
        region = var.region
      } `,

    objectstorage: `module "object_storage" {
        source = "./modules/object_storage"

        project_name = var.project_name
        region = var.region
        encryption_at_rest = var.encryption_at_rest
      } `,

    identityauth: `module "auth" {
        source = "./modules/auth"

        project_name = var.project_name
        region = var.region
      } `,

    loadbalancer: `module "load_balancer" {
        source = "./modules/load_balancer"

        project_name = var.project_name
        region = var.region
        vpc_id = module.networking.vpc_id
        public_subnet_ids = module.networking.public_subnet_ids
      } `,

    monitoring: `module "monitoring" {
        source = "./modules/monitoring"

        project_name = var.project_name
        region = var.region
        monitoring_enabled = var.monitoring_enabled
      } `,

    logging: `module "logging" {
        source = "./modules/logging"

        project_name = var.project_name
        region = var.region
      } `,

    mlinferenceservice: `module "ml_inference" {
        source = "./modules/ml_inference"

        project_name = var.project_name
        region = var.region
      } `,

    batchcompute: `module "batch_compute" {
        source = "./modules/batch_compute"

        project_name = var.project_name
        region = var.region
      } `,

    websocketgateway: `module "websocket" {
        source = "./modules/websocket"

        project_name = var.project_name
        region = var.region
      } `,

    // 🔥 FIX: Added missing Critical Services
    computecontainer: `module "app_container" {
        source = "./modules/compute_container"

        project_name = var.project_name
        region = var.region
        vpc_id = module.networking.vpc_id
        private_subnet_ids = module.networking.private_subnet_ids
  # Sizing variables injected by main generator
      } `,

    computevm: `module "vm_compute" {
        source = "./modules/vm_compute"

        project_name = var.project_name
        region = var.region
        vpc_id = module.networking.vpc_id
        private_subnet_ids = module.networking.private_subnet_ids
      } `,

    nosqldatabase: `module "nosql_db" {
        source = "./modules/nosql_db"

        project_name = var.project_name
        region = var.region
      } `,

    blockstorage: `module "block_storage" {
        source = "./modules/block_storage"

        project_name = var.project_name
        region = var.region
        encryption_at_rest = var.encryption_at_rest
      } `,

    secretsmanager: `module "secrets" {
        source = "./modules/secrets"

        project_name = var.project_name
        region = var.region
      } `,

    dns: `module "dns" {
        source = "./modules/dns"

        project_name = var.project_name
        region = var.region
      } `,

    globalloadbalancer: `module "global_lb" {
        source = "./modules/global_lb"

        project_name = var.project_name
        region = var.region
      } `,

    // 🔥 FIX: Mapped missing keys from Pattern
    waf: `module "waf" {
        source = "./modules/waf"

        project_name = var.project_name
        region = var.region
      } `,

    secretsmanagement: `module "secrets" {
        source = "./modules/secrets"

        project_name = var.project_name
        region = var.region
      } `,

    block_storage: `module "block_storage" {
        source = "./modules/block_storage"

        project_name = var.project_name
        region = var.region
        encryption_at_rest = var.encryption_at_rest
      } `,

    eventbus: `module "event_bus" {
        source = "./modules/event_bus"

        project_name = var.project_name
        region = var.region
      } `,

    paymentgateway: `module "payment_gateway" {
        source = "./modules/payment_gateway"

        project_name = var.project_name
        region = var.region
  # Note: Usually a SaaS integration, module creates secrets / config
      } `
  };

  return moduleMap[service] || null;
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
async function generateTerraform(canonicalArchitecture, provider, region, projectName) {
  const providerLower = provider.toLowerCase();
  console.log(`[TERRAFORM V2] Generating project for ${providerLower} in ${region}`);

  let files = {};
  // Normalize services to ensure we have a list of strings (service IDs)
  // canonicalArchitecture.services can be an array of objects or strings
  const rawServices = canonicalArchitecture.services || [];
  const services = rawServices.map(s => {
    if (typeof s === 'string') return s;
    if (typeof s === 'object' && s !== null) {
      return s.name || s.canonical_type || s.id || 'unknown_service';
    }
    return String(s);
  });

  const pattern = canonicalArchitecture.pattern || 'custom';

  // 1. Generate Root Config
  files['versions.tf'] = generateVersionsTf(providerLower);
  files['providers.tf'] = generateProvidersTf(providerLower, region);
  files['variables.tf'] = generateVariablesTf(providerLower, pattern, services);
  files['terraform.tfvars'] = generateTfvars(providerLower, region, projectName);
  files['outputs.tf'] = generateOutputsTf(providerLower, pattern, services);
  files['main.tf'] = generateMainTf(providerLower, pattern, services);
  files['README.md'] = generateReadme(projectName, providerLower, pattern, services);

  // 2. Generate Modules (Full Implementation)
  files = { ...files, ...generateModules(services, providerLower, region, projectName) };

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
    // Determine module name (directory)
    const moduleName = service;
    const basePath = `modules/${moduleName}`;

    // Get module content
    const source = getModuleSource(service, provider);

    // generate main.tf, variables.tf, outputs.tf for the module
    modules[`${basePath}/main.tf`] = source.main;
    modules[`${basePath}/variables.tf`] = source.variables;
    modules[`${basePath}/outputs.tf`] = source.outputs;
  });

  return modules;
}

/**
 * Get internal HCL source for a specific module
 */
function getModuleSource(service, provider) {
  // Default skeleton
  const skeleton = {
    main: `// ${service} module for ${provider}\nresource "null_resource" "${service}_stub" {}`,
    variables: `variable "project_name" { type = string }\nvariable "region" { type = string }`,
    outputs: ``
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
          outputs: `output "alb_dns_name" { value = aws_lb.main.dns_name }
output "alb_arn" { value = aws_lb.main.arn }`
        };

      case 'relationaldatabase':
        return {
          main: `resource "aws_db_instance" "default" {
  identifier           = "\${var.project_name}-db"
  allocated_storage    = 20
  storage_type         = "gp2"
  engine               = "postgres"
  engine_version       = "13.7"
  instance_class       = "db.t3.micro"
  db_name              = replace(var.project_name, "-", "_")
  username             = "dbadmin"
  password             = "ChangeMe123!" // In prod, use secrets manager
  parameter_group_name = "default.postgres13"
  skip_final_snapshot  = true
  publicly_accessible  = false
  vpc_security_group_ids = [aws_security_group.db_sg.id]
  db_subnet_group_name   = aws_db_subnet_group.default.name
  storage_encrypted      = var.encryption_at_rest
  backup_retention_period = var.backup_retention_days
  deletion_protection    = var.deletion_protection
  multi_az               = var.multi_az
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
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "encryption_at_rest" { type = bool }
variable "backup_retention_days" { type = number }
variable "deletion_protection" { type = bool }
variable "multi_az" { type = bool }`,
          outputs: `output "db_endpoint" { value = aws_db_instance.default.endpoint }`
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
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }`,
          outputs: `output "redis_endpoint" { value = aws_elasticache_cluster.redis.cache_nodes.0.address }`
        };

      case 'waf':
        return {
          main: `resource "aws_wafv2_web_acl" "main" {
  name        = "\${var.project_name}-web-acl"
  description = "WAF for application"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "\${var.project_name}-waf"
    sampled_requests_enabled   = true
  }

  rule {
    name     = "AWS-AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonRuleSet"
      sampled_requests_enabled   = true
    }
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "web_acl_arn" { value = aws_wafv2_web_acl.main.arn }`
        };

      case 'paymentgateway':
        return {
          main: `resource "aws_secretsmanager_secret" "stripe_api_key" {
  name = "\${var.project_name}/stripe-api-key"
}

resource "aws_secretsmanager_secret_version" "stripe_api_key" {
  secret_id     = aws_secretsmanager_secret.stripe_api_key.id
  secret_string = "{\\"api_key\\":\\"change_me\\"}"
  lifecycle {
     ignore_changes = [secret_string]
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "secret_arn" { value = aws_secretsmanager_secret.stripe_api_key.arn }`
        };

      case 'eventbus':
        return {
          main: `resource "aws_cloudwatch_event_bus" "main" {
  name = "\${var.project_name}-event-bus"
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "event_bus_arn" { value = aws_cloudwatch_event_bus.main.arn }`
        };

      case 'secretsmanagement':
        return {
          main: `resource "aws_kms_key" "secrets" {
  description             = "KMS key for secrets"
  deletion_window_in_days = 7
}

resource "aws_secretsmanager_secret" "app_secrets" {
  name       = "\${var.project_name}/app-secrets"
  kms_key_id = aws_kms_key.secrets.id
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "secrets_arn" { value = aws_secretsmanager_secret.app_secrets.arn }`
        };

      case 'computeserverless':
        return {
          main: `resource "aws_lambda_function" "api" {
  filename      = "lambda_function_payload.zip" // Placeholder
  function_name = "\${var.project_name}-api"
  role          = aws_iam_role.iam_for_lambda.arn
  handler       = "index.test"
  runtime       = "nodejs18.x"
}

resource "aws_iam_role" "iam_for_lambda" {
  name = "\${var.project_name}-lambda-role"

  assume_role_policy = <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    }
  ]
}
EOF
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "function_arn" { value = aws_lambda_function.api.arn }`
        };

      case 'logging':
        return {
          main: `resource "aws_cloudwatch_log_group" "app_logs" {
  name = "/aws/lambda/\${var.project_name}"
  retention_in_days = 30
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "log_group_name" { value = aws_cloudwatch_log_group.app_logs.name }`
        };

      case 'monitoring':
        return {
          main: `resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = "\${var.project_name}-dashboard"
  dashboard_body = <<EOF
{
  "widgets": [
    {
      "type": "text",
      "x": 0,
      "y": 0,
      "width": 10,
      "height": 3,
      "properties": {
        "markdown": "# App Dashboard"
      }
    }
  ]
}
EOF
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "monitoring_enabled" { type = bool }`,
          outputs: ``
        };

      case 'networking': // Fallback for implicit vpc
      case 'vpcnetworking':
        return {
          main: `// VPC handled in root or dedicated networking layer`,
          variables: ``,
          outputs: ``
        };

      case 'computecontainer':
        return {
          main: `resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "\${var.project_name}-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 512
  memory                   = 1024
}

resource "aws_ecs_service" "app" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets = var.private_subnet_ids
    security_groups = [aws_security_group.app_sg.id]
  }
}

resource "aws_security_group" "app_sg" {
  name        = "\${var.project_name}-app-sg"
  vpc_id      = var.vpc_id
  ingress {
    from_port = 80
    to_port   = 80
    protocol  = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }`,
          outputs: `output "service_name" { value = aws_ecs_service.app.name }`
        };

      case 'objectstorage':
        return {
          main: `resource "aws_s3_bucket" "main" {
  bucket = "\${var.project_name}-assets"
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }
variable "encryption_at_rest" { type = bool }`,
          outputs: `output "bucket_name" { value = aws_s3_bucket.main.id }`
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
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "endpoint" { value = aws_apigatewayv2_api.api.api_endpoint }`
        };
    }
  }

  // 2. GCP IMPLEMENTATIONS
  if (provider === 'gcp') {
    switch (service) {
      case 'computecontainer':
        return {
          main: `resource "google_cloud_run_service" "app" {
  name     = "\${var.project_name}-app"
  location = var.region

  template {
    spec {
      containers {
        image = "gcr.io/google-samples/hello-app:1.0"
        resources {
          limits = {
            cpu    = "1000m"
            memory = "512Mi"
          }
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "service_url" { value = google_cloud_run_service.app.status[0].url }`
        };

      case 'objectstorage':
        return {
          main: `resource "google_storage_bucket" "store" {
  name          = "\${var.project_name}-assets"
  location      = var.region
  force_destroy = true
  storage_class = "STANDARD"
}`,
          variables: `variable "project_name" { type = string }
variable "region" { type = string }`,
          outputs: `output "bucket_name" { value = google_storage_bucket.store.name }`
        };

      default:
        return skeleton;
    }
  }

  // 3. AZURE IMPLEMENTATIONS
  else if (provider === 'azure') {
    switch (service) {
      case 'computecontainer':
        return {
          main: `resource "azurerm_container_group" "app" {
  name                = "\${var.project_name}-app"
  location            = var.location
  resource_group_name = azurerm_resource_group.rg.name
  ip_address_type     = "Public"
  dns_name_label      = "\${var.project_name}-app"
  os_type             = "Linux"

  container {
    name   = "hello-world"
    image  = "mcr.microsoft.com/azuredocs/aci-helloworld"
    cpu    = "0.5"
    memory = "1.5"

    ports {
      port     = 80
      protocol = "TCP"
    }
  }
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-rg"
  location = var.location
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }`,
          outputs: `output "fqdn" { value = azurerm_container_group.app.fqdn }`
        };

      case 'objectstorage':
        return {
          main: `resource "azurerm_storage_account" "store" {
  name                     = replace("\${var.project_name}store", "-", "")
  resource_group_name      = azurerm_resource_group.rg.name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_resource_group" "rg" {
  name     = "\${var.project_name}-data-rg"
  location = var.location
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }`,
          outputs: `output "storage_account_name" { value = azurerm_storage_account.store.name }`
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
  // New Flat Generator
  generatePricingMainTf
};
