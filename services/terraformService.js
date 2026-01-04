/**
 * TERRAFORM GENERATION SERVICE
 * 
 * Generates Terraform HCL code based on:
 * - Architecture pattern (SERVERLESS_WEB_APP, STATIC_WEB_HOSTING, etc.)
 * - Cloud provider (AWS, GCP, Azure)
 * - Cost profile (cost_effective, standard, high_performance)
 * 
 * This is Step 5 in the workflow - after user feedback.
 */

const costResultModel = require('./costResultModel');

// ═══════════════════════════════════════════════════════════════════════════
// TERRAFORM TEMPLATES BY PATTERN + PROVIDER
// ═══════════════════════════════════════════════════════════════════════════

const TERRAFORM_TEMPLATES = {
    SERVERLESS_WEB_APP: {
        aws: (projectName, services) => `
# Terraform Configuration for ${projectName}
# Pattern: Serverless Web App
# Provider: AWS

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
}

# ═══════════════════════════════════════════════════════════════════════════
# S3 Bucket for Static Assets
# ═══════════════════════════════════════════════════════════════════════════
resource "aws_s3_bucket" "static_assets" {
  bucket = "\${var.project_name}-assets"
  
  tags = {
    Name        = "\${var.project_name}-assets"
    Environment = "production"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "static_assets_block" {
  bucket = aws_s3_bucket.static_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ═══════════════════════════════════════════════════════════════════════════
# CloudFront Distribution
# ═══════════════════════════════════════════════════════════════════════════
resource "aws_cloudfront_origin_access_identity" "oai" {
  comment = "\${var.project_name} OAI"
}

resource "aws_cloudfront_distribution" "cdn" {
  origin {
    domain_name = aws_s3_bucket.static_assets.bucket_regional_domain_name
    origin_id   = "S3-\${var.project_name}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.oai.cloudfront_access_identity_path
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-\${var.project_name}"

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

  tags = {
    Name = "\${var.project_name}-cdn"
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Lambda Function
# ═══════════════════════════════════════════════════════════════════════════
resource "aws_iam_role" "lambda_role" {
  name = "\${var.project_name}-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda_role.name
}

resource "aws_lambda_function" "api" {
  filename      = "lambda.zip"
  function_name = "\${var.project_name}-api"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  memory_size   = 256
  timeout       = 30

  environment {
    variables = {
      ENVIRONMENT = "production"
    }
  }

  tags = {
    Name = "\${var.project_name}-api"
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# API Gateway
# ═══════════════════════════════════════════════════════════════════════════
resource "aws_apigatewayv2_api" "api" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE"]
    allow_headers = ["Content-Type", "Authorization"]
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id           = aws_apigatewayv2_api.api.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.api.invoke_arn
}

resource "aws_apigatewayv2_route" "default" {
  api_id    = aws_apigatewayv2_api.api.id
  route_key = "ANY /{proxy+}"
  target    = "integrations/\${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "\${aws_apigatewayv2_api.api.execution_arn}/*/*"
}

# ═══════════════════════════════════════════════════════════════════════════
# Cognito User Pool
# ═══════════════════════════════════════════════════════════════════════════
resource "aws_cognito_user_pool" "main" {
  name = "\${var.project_name}-users"

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = false
    require_uppercase = true
  }

  auto_verified_attributes = ["email"]

  tags = {
    Name = "\${var.project_name}-users"
  }
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "\${var.project_name}-web-client"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
}

# ═══════════════════════════════════════════════════════════════════════════
# Outputs
# ═══════════════════════════════════════════════════════════════════════════
output "cdn_domain" {
  value = aws_cloudfront_distribution.cdn.domain_name
}

output "api_endpoint" {
  value = aws_apigatewayv2_api.api.api_endpoint
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.main.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web.id
}
`,

        gcp: (projectName, services) => `
# Terraform Configuration for ${projectName}
# Pattern: Serverless Web App
# Provider: Google Cloud Platform

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  description = "GCP Project ID"
}

variable "region" {
  default = "us-central1"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
}

# ═══════════════════════════════════════════════════════════════════════════
# Cloud Storage Bucket
# ═══════════════════════════════════════════════════════════════════════════
resource "google_storage_bucket" "static_assets" {
  name     = "\${var.project_name}-assets"
  location = var.region
  
  uniform_bucket_level_access = true

  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Cloud CDN with Load Balancer
# ═══════════════════════════════════════════════════════════════════════════
resource "google_compute_backend_bucket" "cdn_backend" {
  name        = "\${var.project_name}-cdn-backend"
  bucket_name = google_storage_bucket.static_assets.name
  enable_cdn  = true
}

# ═══════════════════════════════════════════════════════════════════════════
# Cloud Functions (Serverless API)
# ═══════════════════════════════════════════════════════════════════════════
resource "google_cloudfunctions2_function" "api" {
  name     = "\${var.project_name}-api"
  location = var.region

  build_config {
    runtime     = "nodejs18"
    entry_point = "handler"
    source {
      storage_source {
        bucket = google_storage_bucket.static_assets.name
        object = "functions.zip"
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "256M"
    timeout_seconds    = 30
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Firebase/Identity Platform (Auth)
# ═══════════════════════════════════════════════════════════════════════════
resource "google_identity_platform_config" "auth" {
  project = var.project_id
}

# Outputs
output "storage_bucket" {
  value = google_storage_bucket.static_assets.name
}

output "function_url" {
  value = google_cloudfunctions2_function.api.service_config[0].uri
}
`,

        azure: (projectName, services) => `
# Terraform Configuration for ${projectName}
# Pattern: Serverless Web App
# Provider: Microsoft Azure

terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "location" {
  default = "eastus"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '')}"
}

# ═══════════════════════════════════════════════════════════════════════════
# Resource Group
# ═══════════════════════════════════════════════════════════════════════════
resource "azurerm_resource_group" "main" {
  name     = "\${var.project_name}-rg"
  location = var.location
}

# ═══════════════════════════════════════════════════════════════════════════
# Storage Account (Blob Storage)
# ═══════════════════════════════════════════════════════════════════════════
resource "azurerm_storage_account" "main" {
  name                     = "\${var.project_name}storage"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  static_website {
    index_document = "index.html"
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Azure CDN (Front Door)
# ═══════════════════════════════════════════════════════════════════════════
resource "azurerm_cdn_profile" "main" {
  name                = "\${var.project_name}-cdn"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Standard_Microsoft"
}

resource "azurerm_cdn_endpoint" "main" {
  name                = "\${var.project_name}-endpoint"
  profile_name        = azurerm_cdn_profile.main.name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  origin {
    name      = "storage"
    host_name = azurerm_storage_account.main.primary_blob_host
  }
}

# ═══════════════════════════════════════════════════════════════════════════
# Azure Functions
# ═══════════════════════════════════════════════════════════════════════════
resource "azurerm_service_plan" "main" {
  name                = "\${var.project_name}-plan"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  os_type             = "Linux"
  sku_name            = "Y1"
}

resource "azurerm_linux_function_app" "main" {
  name                       = "\${var.project_name}-func"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  service_plan_id            = azurerm_service_plan.main.id
  storage_account_name       = azurerm_storage_account.main.name
  storage_account_access_key = azurerm_storage_account.main.primary_access_key

  site_config {
    application_stack {
      node_version = "18"
    }
  }
}

# Outputs
output "storage_url" {
  value = azurerm_storage_account.main.primary_web_endpoint
}

output "cdn_endpoint" {
  value = azurerm_cdn_endpoint.main.fqdn
}

output "function_url" {
  value = "https://\${azurerm_linux_function_app.main.default_hostname}"
}
`
    },

    STATIC_WEB_HOSTING: {
        aws: (projectName) => `
# Terraform Configuration for ${projectName}
# Pattern: Static Web Hosting
# Provider: AWS

terraform {
  required_version = ">= 1.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  default = "us-east-1"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
}

# S3 Bucket for Static Website
resource "aws_s3_bucket" "website" {
  bucket = "\${var.project_name}-website"
}

resource "aws_s3_bucket_website_configuration" "website" {
  bucket = aws_s3_bucket.website.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "error.html"
  }
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket = aws_s3_bucket.website.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "website" {
  origin {
    domain_name = aws_s3_bucket_website_configuration.website.website_endpoint
    origin_id   = "S3Website"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "http-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3Website"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
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

output "website_url" {
  value = "https://\${aws_cloudfront_distribution.website.domain_name}"
}
`,
        gcp: (projectName) => `
# Terraform Configuration for ${projectName}
# Pattern: Static Web Hosting
# Provider: Google Cloud Platform

terraform {
  required_version = ">= 1.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

variable "project_id" {
  description = "GCP Project ID"
}

variable "region" {
  default = "us-central1"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"
}

# Cloud Storage Bucket for Static Website
resource "google_storage_bucket" "website" {
  name     = "\${var.project_name}-website"
  location = var.region
  
  website {
    main_page_suffix = "index.html"
    not_found_page   = "404.html"
  }

  uniform_bucket_level_access = true
}

# Make bucket publicly accessible
resource "google_storage_bucket_iam_member" "public_read" {
  bucket = google_storage_bucket.website.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

output "website_url" {
  value = "https://storage.googleapis.com/\${google_storage_bucket.website.name}/index.html"
}
`,
        azure: (projectName) => `
# Terraform Configuration for ${projectName}
# Pattern: Static Web Hosting
# Provider: Microsoft Azure

terraform {
  required_version = ">= 1.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
}

variable "location" {
  default = "eastus"
}

variable "project_name" {
  default = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '')}"
}

# Resource Group
resource "azurerm_resource_group" "main" {
  name     = "\${var.project_name}-rg"
  location = var.location
}

# Storage Account with Static Website
resource "azurerm_storage_account" "website" {
  name                     = "\${var.project_name}web"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  static_website {
    index_document     = "index.html"
    error_404_document = "404.html"
  }
}

output "website_url" {
  value = azurerm_storage_account.website.primary_web_endpoint
}
`
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE TERRAFORM CODE
// ═══════════════════════════════════════════════════════════════════════════
function generateTerraform(infraSpec, provider, profile, projectName = 'my-project') {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';
    const providerLower = provider.toLowerCase();
    const services = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

    // Get template for pattern + provider
    const patternTemplates = TERRAFORM_TEMPLATES[pattern];
    if (!patternTemplates) {
        console.warn(`[TERRAFORM] No template for pattern: ${pattern}, using SERVERLESS_WEB_APP`);
        return TERRAFORM_TEMPLATES.SERVERLESS_WEB_APP[providerLower]?.(projectName, services) ||
            generateFallbackTemplate(projectName, provider, pattern, services);
    }

    const template = patternTemplates[providerLower];
    if (!template) {
        console.warn(`[TERRAFORM] No template for provider: ${provider}, using AWS`);
        return patternTemplates.aws?.(projectName, services) ||
            generateFallbackTemplate(projectName, provider, pattern, services);
    }

    console.log(`[TERRAFORM] Generating ${pattern} template for ${provider.toUpperCase()}`);
    return template(projectName, services);
}

// Fallback template when no specific template exists
function generateFallbackTemplate(projectName, provider, pattern, services) {
    return `
# Terraform Configuration for ${projectName}
# Pattern: ${pattern}
# Provider: ${provider.toUpperCase()}
# 
# NOTE: This is a placeholder template. 
# Custom configuration required for this pattern/provider combination.

terraform {
  required_version = ">= 1.0"
}

# Services to be configured:
${services.map(s => `# - ${s}`).join('\n')}

# TODO: Add provider-specific resources for ${pattern}
`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET TERRAFORM SERVICES LIST
// ═══════════════════════════════════════════════════════════════════════════
function getTerraformServices(infraSpec, provider) {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';
    const genericServices = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

    return genericServices.map(svc => ({
        generic_name: svc,
        cloud_service: costResultModel.SERVICE_MAP[provider.toLowerCase()]?.[svc] || svc,
        terraform_resource: getTerraformResourceType(svc, provider)
    }));
}

function getTerraformResourceType(service, provider) {
    const resourceMap = {
        aws: {
            object_storage: 'aws_s3_bucket',
            cdn: 'aws_cloudfront_distribution',
            compute_serverless: 'aws_lambda_function',
            identity_auth: 'aws_cognito_user_pool',
            api_gateway: 'aws_apigatewayv2_api'
        },
        gcp: {
            object_storage: 'google_storage_bucket',
            cdn: 'google_compute_backend_bucket',
            compute_serverless: 'google_cloudfunctions2_function',
            identity_auth: 'google_identity_platform_config',
            api_gateway: 'google_api_gateway_api'
        },
        azure: {
            object_storage: 'azurerm_storage_account',
            cdn: 'azurerm_cdn_endpoint',
            compute_serverless: 'azurerm_linux_function_app',
            identity_auth: 'azurerm_active_directory_b2c',
            api_gateway: 'azurerm_api_management'
        }
    };

    return resourceMap[provider.toLowerCase()]?.[service] || `${provider}_${service}`;
}

module.exports = {
    generateTerraform,
    getTerraformServices,
    TERRAFORM_TEMPLATES
};
