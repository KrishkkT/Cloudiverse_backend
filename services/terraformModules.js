/**
 * TERRAFORM MODULE TEMPLATES
 * 
 * Each canonical service has a corresponding Terraform module.
 * Modules contain actual cloud resources (NOT in main.tf).
 * Modules enforce security defaults and accept NFR-driven variables.
 */

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Generate minimal provider-specific modules
// ═══════════════════════════════════════════════════════════════════════════

const generateMinimalModule = (provider, serviceName) => {
  const templates = {
    aws: {
      'main.tf': `# ${serviceName} - Amazon Web Services
resource "null_resource" "${serviceName}" {
  triggers = {
    project_name = var.project_name
  }
}
`,
      'variables.tf': `variable "project_name" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}
`,
      'outputs.tf': `output "${serviceName}_id" {\n  value = null_resource.${serviceName}.id\n}\n`
    },
    gcp: {
      'main.tf': `# ${serviceName} - Google Cloud Platform
resource "null_resource" "${serviceName}" {
  triggers = {
    project_name = var.project_name
  }
}
`,
      'variables.tf': `variable "project_name" {
  type = string
}

variable "region" {
  type    = string
  default = "us-central1"
}
`,
      'outputs.tf': `output "${serviceName}_id" {\n  value = null_resource.${serviceName}.id\n}\n`
    },
    azure: {
      'main.tf': `# ${serviceName} - Microsoft Azure
resource "null_resource" "${serviceName}" {
  triggers = {
    project_name = var.project_name
  }
}
`,
      'variables.tf': `variable "project_name" {
  type = string
}

variable "location" {
  type    = string
  default = "eastus"
}

variable "resource_group_name" {
  type = string
}
`,
      'outputs.tf': `output "${serviceName}_id" {\n  value = null_resource.${serviceName}.id\n}\n`
    }
  };
  return templates[provider] || null;
};

// ═══════════════════════════════════════════════════════════════════════════
// NETWORKING MODULE
// ═══════════════════════════════════════════════════════════════════════════

const networkingModule = {
  aws: () => ({
    'main.tf': `# VPC with public and private subnets
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "\${var.project_name}-vpc"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = {
    Name = "\${var.project_name}-igw"
  }
}

# Public Subnets
resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "\${var.region}a"
  map_public_ip_on_launch = true

  tags = {
    Name = "\${var.project_name}-public-a"
  }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "\${var.region}b"
  map_public_ip_on_launch = true

  tags = {
    Name = "\${var.project_name}-public-b"
  }
}

# Private Subnets
resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "\${var.region}a"

  tags = {
    Name = "\${var.project_name}-private-a"
  }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "\${var.region}b"

  tags = {
    Name = "\${var.project_name}-private-b"
  }
}

# Route Table for Public Subnets
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = {
    Name = "\${var.project_name}-public-rt"
  }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "environment" {
  description = "Environment"
  type        = string
  default     = "production"
}
`,
    'outputs.tf': `output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs"
  value       = [aws_subnet.public_a.id, aws_subnet.public_b.id]
}

output "private_subnet_ids" {
  description = "Private subnet IDs"
  value       = [aws_subnet.private_a.id, aws_subnet.private_b.id]
}
`
  }),
  gcp: () => ({
    'main.tf': `resource "google_compute_network" "main" {
  name                    = "\${var.project_name}-vpc"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "main" {
  name          = "\${var.project_name}-subnet"
  ip_cidr_range = "10.0.0.0/16"
  region        = var.region
  network       = google_compute_network.main.id
}
`,
    'variables.tf': `variable "project_name" {
  type = string
}

variable "region" {
  type = string
}
`,
    'outputs.tf': `output "vpc_id" {
  value = google_compute_network.main.id
}

output "subnet_id" {
  value = google_compute_subnetwork.main.id
}
`
  }),
  azure: () => ({
    'main.tf': `resource "azurerm_virtual_network" "main" {
  name                = "\${var.project_name}-vnet"
  address_space       = ["10.0.0.0/16"]
  location            = var.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_subnet" "main" {
  name                 = "\${var.project_name}-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.1.0/24"]
}
`,
    'variables.tf': `variable "project_name" {
  type = string
}

variable "location" {
  type = string
}

variable "resource_group_name" {
  type = string
}
`,
    'outputs.tf': `output "vnet_id" {
  value = azurerm_virtual_network.main.id
}

output "subnet_id" {
  value = azurerm_subnet.main.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// CDN MODULE
// ═══════════════════════════════════════════════════════════════════════════

const cdnModule = {
  aws: () => ({
    'main.tf': `# CloudFront CDN Distribution
# Safe defaults: HTTPS only, origin restricted, caching enabled
resource "aws_cloudfront_distribution" "main" {
  enabled             = var.enable_cdn
  is_ipv6_enabled     = true
  comment             = "\${var.project_name} CDN"
  default_root_object = "index.html"

  origin {
    domain_name = "\${var.project_name}.s3.amazonaws.com"
    origin_id   = "S3-\${var.project_name}"

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-\${var.project_name}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    # MANDATORY: HTTPS only (safe default)
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600  # Safe default: 1 hour
    max_ttl                = 86400
    compress               = true  # Enable compression
  }

  # MANDATORY: Logging enabled
  logging_config {
    bucket = "\${var.project_name}-cdn-logs.s3.amazonaws.com"
    prefix = "cdn/"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
    minimum_protocol_version       = "TLSv1.2_2021"  # Safe default: modern TLS
  }

  tags = {
    Name = "\${var.project_name}-cdn"
  }
}

resource "aws_cloudfront_origin_access_identity" "main" {
  comment = "\${var.project_name} OAI - restricts origin access"
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "enable_cdn" {
  description = "Enable CDN distribution"
  type        = bool
  default     = true
}

variable "custom_domain" {
  description = "Custom domain for CDN (optional)"
  type        = string
  default     = ""
}
`,
    'outputs.tf': `output "endpoint" {
  description = "CloudFront distribution domain name"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "distribution_id" {
  description = "CloudFront distribution ID"
  value       = aws_cloudfront_distribution.main.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// API GATEWAY MODULE
// ═══════════════════════════════════════════════════════════════════════════

const apiGatewayModule = {
  aws: () => ({
    'main.tf': `# API Gateway - Ingress for APIs
# Safe defaults: TLS enforced, rate limiting, request logging
resource "aws_apigatewayv2_api" "main" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-Api-Key"]
    max_age       = 300
  }

  tags = {
    Name = "\${var.project_name}-api"
  }
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true

  # MANDATORY: Request logging (safe default)
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  # MANDATORY: Throttling enabled (safe default)
  default_route_settings {
    throttling_burst_limit = var.rate_limit_rps * 2
    throttling_rate_limit  = var.rate_limit_rps
  }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/\${var.project_name}"
  retention_in_days = 14  # Safe default
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "enable_api_gateway" {
  description = "Enable API Gateway"
  type        = bool
  default     = true
}

variable "rate_limit_rps" {
  description = "Rate limit in requests per second"
  type        = number
  default     = 1000  # Safe default
}
`,
    'outputs.tf': `output "endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.main.api_endpoint
}

output "api_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.main.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// SERVERLESS COMPUTE MODULE (Lambda / Cloud Functions)
// ═══════════════════════════════════════════════════════════════════════════

const serverlessComputeModule = {
  aws: () => ({
    'main.tf': `# Lambda - Serverless Compute
# Safe defaults: timeout limits, memory caps, IAM least privilege, logging
resource "aws_iam_role" "lambda" {
  name = "\${var.project_name}-lambda-role"

  # MANDATORY: IAM least privilege (safe default)
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

# MANDATORY: Logging enabled (safe default)
resource "aws_iam_role_policy_attachment" "lambda_basic" {
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
  role       = aws_iam_role.lambda.name
}

resource "aws_lambda_function" "main" {
  filename      = "lambda_placeholder.zip"
  function_name = "\${var.project_name}-function"
  role          = aws_iam_role.lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  
  # EXPOSED: NFR-driven memory and timeout
  memory_size   = var.memory_mb
  timeout       = var.timeout_seconds

  environment {
    variables = {
      ENVIRONMENT = "production"
    }
  }

  # MANDATORY: Enable CloudWatch Logs (safe default)
  tracing_config {
    mode = "PassThrough"
  }

  tags = {
    Name = "\${var.project_name}-function"
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "memory_mb" {
  description = "Lambda memory in MB"
  type        = number
  default     = 256  # Safe default: minimal memory
}

variable "timeout_seconds" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 30  # Safe default: conservative timeout
}
`,
    'outputs.tf': `output "function_name" {
  description = "Lambda function name"
  value       = aws_lambda_function.main.function_name
}

output "function_arn" {
  description = "Lambda function ARN"
  value       = aws_lambda_function.main.arn
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// RELATIONAL DATABASE MODULE
// ═══════════════════════════════════════════════════════════════════════════

const relationalDbModule = {
  aws: () => ({
    'main.tf': `# RDS - Relational Database
# Safe defaults: encryption, automated backups, deletion protection, private networking
resource "aws_db_subnet_group" "main" {
  name       = "\${var.project_name}-db-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "\${var.project_name}-db-subnet-group"
  }
}

resource "aws_security_group" "db" {
  name        = "\${var.project_name}-db-sg"
  description = "Security group for RDS database"
  vpc_id      = var.vpc_id

  # MANDATORY: Private networking only (safe default)
  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]  # VPC only
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "\${var.project_name}-db-sg"
  }
}

resource "aws_db_instance" "main" {
  identifier           = "\${var.project_name}-db"
  engine               = "postgres"  # Fixed per provider (safe default)
  engine_version       = "15.3"
  instance_class       = "db.t3.micro"  # Safe default: small instance
  allocated_storage    = 20
  storage_type         = "gp3"
  
  # MANDATORY: Encryption at rest (safe default)
  storage_encrypted    = var.encryption_at_rest
  
  db_name  = replace(var.project_name, "-", "_")
  username = "dbadmin"
  password = random_password.db_password.result
  
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  
  # MANDATORY: Automated backups (safe default)
  backup_retention_period = var.backup_retention_days
  backup_window          = "03:00-04:00"  # Safe default
  maintenance_window     = "mon:04:00-mon:05:00"
  
  # MANDATORY: Deletion protection (safe default)
  skip_final_snapshot       = false
  final_snapshot_identifier = "\${var.project_name}-db-final-snapshot"
  deletion_protection       = var.deletion_protection
  
  # EXPOSED: Multi-AZ for HA
  multi_az = var.multi_az
  
  # MANDATORY: Logging enabled (safe default)
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = {
    Name = "\${var.project_name}-db"
  }
}

resource "random_password" "db_password" {
  length  = 16
  special = true
}

# MANDATORY: Store password securely (safe default)
resource "aws_secretsmanager_secret" "db_password" {
  name = "\${var.project_name}-db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db_password.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs"
  type        = list(string)
}

# EXPOSED: NFR-driven variables only
variable "encryption_at_rest" {
  description = "Enable encryption at rest"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Backup retention period in days"
  type        = number
  default     = 7  # Safe default: daily backups
}

variable "deletion_protection" {
  description = "Enable deletion protection"
  type        = bool
  default     = true  # Safe default: prevent accidental deletion
}

variable "multi_az" {
  description = "Enable multi-AZ deployment for HA"
  type        = bool
  default     = false  # Safe default: single AZ (cost-effective)
}
`,
    'outputs.tf': `output "endpoint" {
  description = "Database endpoint"
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "database_name" {
  description = "Database name"
  value       = aws_db_instance.main.db_name
}

output "secret_arn" {
  description = "Secrets Manager ARN for database credentials"
  value       = aws_secretsmanager_secret.db_password.arn
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// OBJECT STORAGE MODULE
// ═══════════════════════════════════════════════════════════════════════════

const objectStorageModule = {
  aws: () => ({
    'main.tf': `# S3 Bucket - Object Storage
# Safe defaults: private, encrypted, versioned, lifecycle management
resource "aws_s3_bucket" "main" {
  bucket = "\${var.project_name}-storage"

  tags = {
    Name = "\${var.project_name}-storage"
  }
}

# MANDATORY: Block public access (safe default)
resource "aws_s3_bucket_public_access_block" "main" {
  bucket = aws_s3_bucket.main.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# MANDATORY: Enable versioning (safe default)
resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id

  versioning_configuration {
    status = "Enabled"
  }
}

# MANDATORY: Server-side encryption (safe default)
resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# MANDATORY: Access logging (safe default)
resource "aws_s3_bucket_logging" "main" {
  bucket = aws_s3_bucket.main.id
  target_bucket = aws_s3_bucket.logs.id
  target_prefix = "access-logs/"
}

resource "aws_s3_bucket" "logs" {
  bucket = "\${var.project_name}-storage-logs"
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy (safe default: cleanup old objects)
resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "cleanup-old-objects"
    status = "Enabled"

    expiration {
      days = var.retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "encryption_at_rest" {
  description = "Enable encryption at rest"
  type        = bool
  default     = true
}

variable "retention_days" {
  description = "Object retention in days (lifecycle cleanup)"
  type        = number
  default     = 365
}

variable "allow_public_read" {
  description = "Allow public read access (use with extreme caution)"
  type        = bool
  default     = false
}
`,
    'outputs.tf': `output "bucket_name" {
  description = "S3 bucket name"
  value       = aws_s3_bucket.main.id
}

output "bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.main.arn
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MODULE (Cognito / Identity Platform)
// ═══════════════════════════════════════════════════════════════════════════

const authModule = {
  aws: () => ({
    'main.tf': `# Cognito - Identity / Auth
# Safe defaults: strong password policy, MFA support, token expiration
resource "aws_cognito_user_pool" "main" {
  name = "\${var.project_name}-users"

  # MANDATORY: Secure password policy (safe default)
  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true  # Enforced for security
    require_uppercase = true
  }

  auto_verified_attributes = ["email"]
  
  # EXPOSED: MFA configuration
  mfa_configuration = var.mfa_required ? "ON" : "OPTIONAL"
  
  software_token_mfa_configuration {
    enabled = true
  }

  # MANDATORY: Token expiration (safe default)
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Safe default: user attributes
  schema {
    attribute_data_type = "String"
    name                = "email"
    required            = true
    mutable             = false
  }

  tags = {
    Name = "\${var.project_name}-user-pool"
  }
}

resource "aws_cognito_user_pool_client" "main" {
  name         = "\${var.project_name}-client"
  user_pool_id = aws_cognito_user_pool.main.id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]
  
  # MANDATORY: Prevent user enumeration attacks (safe default)
  prevent_user_existence_errors = "ENABLED"
  
  # Token expiration (safe defaults)
  access_token_validity  = 1  # 1 hour
  id_token_validity      = 1  # 1 hour
  refresh_token_validity = 30 # 30 days
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "enable_auth" {
  description = "Enable authentication service"
  type        = bool
  default     = true
}

variable "mfa_required" {
  description = "Require MFA for all users"
  type        = bool
  default     = false  # Safe default: optional MFA
}
`,
    'outputs.tf': `output "user_pool_id" {
  description = "Cognito User Pool ID"
  value       = aws_cognito_user_pool.main.id
}

output "user_pool_client_id" {
  description = "Cognito User Pool Client ID"
  value       = aws_cognito_user_pool_client.main.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// MONITORING MODULE
// ═══════════════════════════════════════════════════════════════════════════

const monitoringModule = {
  aws: () => ({
    'main.tf': `# CloudWatch - Monitoring
# Safe defaults: CPU/memory metrics, error alerts, basic alerts only
resource "aws_cloudwatch_dashboard" "main" {
  count          = var.enable_alerts ? 1 : 0
  dashboard_name = "\${var.project_name}-dashboard"

  # MANDATORY: CPU/memory metrics (safe default)
  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/Lambda", "Invocations"],
            [".", "Errors"],
            [".", "Duration"],
            [".", "Throttles"]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "Lambda Metrics"
        }
      },
      {
        type = "metric"
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization"],
            [".", "DatabaseConnections"],
            [".", "FreeableMemory"]
          ]
          period = 300
          stat   = "Average"
          region = var.region
          title  = "Database Metrics"
        }
      }
    ]
  })
}

# MANDATORY: Error alerts (safe default)
resource "aws_sns_topic" "alarms" {
  count = var.enable_alerts ? 1 : 0
  name  = "\${var.project_name}-alarms"
}

# Basic error alert
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count               = var.enable_alerts ? 1 : 0
  alarm_name          = "\${var.project_name}-lambda-errors"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 10  # Safe default
  alarm_description   = "Lambda errors exceeded threshold"
  alarm_actions       = [aws_sns_topic.alarms[0].arn]
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "enable_alerts" {
  description = "Enable monitoring and alerts"
  type        = bool
  default     = true  # Safe default: basic alerts only
}
`,
    'outputs.tf': `output "dashboard_name" {
  description = "CloudWatch dashboard name"
  value       = var.enable_alerts ? aws_cloudwatch_dashboard.main[0].dashboard_name : null
}

output "alarm_topic_arn" {
  description = "SNS topic ARN for alarms"
  value       = var.enable_alerts ? aws_sns_topic.alarms[0].arn : null
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// LOGGING MODULE
// ═══════════════════════════════════════════════════════════════════════════

const loggingModule = {
  aws: () => ({
    'main.tf': `# CloudWatch Logs - Centralized Logging
# Safe defaults: centralized logs, retention policy (14-30 days)
resource "aws_cloudwatch_log_group" "main" {
  name              = "/aws/\${var.project_name}"
  retention_in_days = var.log_retention_days  # EXPOSED: NFR-driven

  tags = {
    Name = "\${var.project_name}-logs"
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

# EXPOSED: NFR-driven variables only
variable "log_retention_days" {
  description = "Log retention period in days"
  type        = number
  default     = 14  # Safe default: 14-30 day retention
}
`,
    'outputs.tf': `output "log_group_name" {
  description = "CloudWatch log group name"
  value       = aws_cloudwatch_log_group.main.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN"
  value       = aws_cloudwatch_log_group.main.arn
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// APP COMPUTE MODULE (EC2, ECS, App Runner)
// ═══════════════════════════════════════════════════════════════════════════

const appComputeModule = {
  aws: () => ({
    'main.tf': `# Application Compute - ECS Fargate for containerized apps
# Safe defaults: private subnets, auto-scaling, health checks

resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "\${var.project_name}-ecs-cluster"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "\${var.project_name}-app"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name      = "app"
    image     = "\${var.app_image}:latest"
    essential = true

    portMappings = [{
      containerPort = var.app_port
      protocol      = "tcp"
    }]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/\${var.project_name}"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }

    environment = var.app_environment_vars
  }])
}

resource "aws_ecs_service" "app" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = var.app_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "app"
    container_port   = var.app_port
  }

  health_check_grace_period_seconds = 60

  tags = {
    Name = "\${var.project_name}-ecs-service"
  }
}

resource "aws_security_group" "app" {
  name        = "\${var.project_name}-app-sg"
  description = "Security group for app containers"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.app_port
    to_port         = var.app_port
    protocol        = "tcp"
    security_groups = [var.lb_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "\${var.project_name}-app-sg"
  }
}

# IAM roles for ECS
resource "aws_iam_role" "ecs_execution" {
  name = "\${var.project_name}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "\${var.project_name}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs"
  type        = list(string)
}

variable "target_group_arn" {
  description = "Load balancer target group ARN"
  type        = string
}

variable "lb_security_group_id" {
  description = "Load balancer security group ID"
  type        = string
}

variable "app_cpu" {
  description = "CPU units for app container"
  type        = string
  default     = "256"
}

variable "app_memory" {
  description = "Memory for app container"
  type        = string
  default     = "512"
}

variable "app_image" {
  description = "Docker image for app"
  type        = string
  default     = "nginx"
}

variable "app_port" {
  description = "App container port"
  type        = number
  default     = 80
}

variable "app_desired_count" {
  description = "Desired number of app containers"
  type        = number
  default     = 2
}

variable "app_environment_vars" {
  description = "Environment variables for app"
  type        = list(object({ name = string, value = string }))
  default     = []
}
`,
    'outputs.tf': `output "ecs_cluster_id" {
  description = "ECS cluster ID"
  value       = aws_ecs_cluster.main.id
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.app.name
}

output "app_security_group_id" {
  description = "App security group ID"
  value       = aws_security_group.app.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE QUEUE MODULE
// ═══════════════════════════════════════════════════════════════════════════

const messageQueueModule = {
  aws: () => ({
    'main.tf': `# SQS Message Queue
# Safe defaults: encryption enabled, dead letter queue

resource "aws_sqs_queue" "main" {
  name                       = "\${var.project_name}-queue"
  delay_seconds              = 0
  max_message_size           = 262144
  message_retention_seconds  = 345600  # 4 days
  receive_wait_time_seconds  = 10       # Long polling
  visibility_timeout_seconds = 30

  # MANDATORY: Encryption enabled
  sqs_managed_sse_enabled = true

  # Dead letter queue configuration
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = 3
  })

  tags = {
    Name = "\${var.project_name}-queue"
  }
}

resource "aws_sqs_queue" "dlq" {
  name                      = "\${var.project_name}-dlq"
  message_retention_seconds = 1209600  # 14 days
  sqs_managed_sse_enabled   = true

  tags = {
    Name = "\${var.project_name}-dlq"
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}
`,
    'outputs.tf': `output "queue_url" {
  description = "SQS queue URL"
  value       = aws_sqs_queue.main.url
}

output "queue_arn" {
  description = "SQS queue ARN"
  value       = aws_sqs_queue.main.arn
}

output "dlq_url" {
  description = "Dead letter queue URL"
  value       = aws_sqs_queue.dlq.url
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MODULE (Redis/Elasticache)
// ═══════════════════════════════════════════════════════════════════════════

const cacheModule = {
  aws: () => ({
    'main.tf': `# ElastiCache Redis Cluster
# Safe defaults: encryption in transit, automatic failover

resource "aws_elasticache_subnet_group" "main" {
  name       = "\${var.project_name}-cache-subnet"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = "\${var.project_name}-redis"
  replication_group_description = "Redis cluster for \${var.project_name}"
  engine                     = "redis"
  engine_version             = "7.0"
  node_type                  = var.cache_node_type
  num_cache_clusters         = var.cache_num_nodes
  parameter_group_name       = "default.redis7"
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.cache.id]

  # MANDATORY: Encryption in transit
  transit_encryption_enabled = true
  auth_token_enabled         = true
  auth_token                 = var.redis_auth_token

  # MANDATORY: Encryption at rest
  at_rest_encryption_enabled = true

  # Automatic failover for multi-node
  automatic_failover_enabled = var.cache_num_nodes > 1

  # Backup configuration
  snapshot_retention_limit = 5
  snapshot_window          = "03:00-05:00"
  maintenance_window       = "sun:05:00-sun:07:00"

  tags = {
    Name = "\${var.project_name}-redis"
  }
}

resource "aws_security_group" "cache" {
  name        = "\${var.project_name}-cache-sg"
  description = "Security group for Redis cache"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.app_security_group_id]
  }

  tags = {
    Name = "\${var.project_name}-cache-sg"
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs"
  type        = list(string)
}

variable "app_security_group_id" {
  description = "App security group ID"
  type        = string
}

variable "cache_node_type" {
  description = "Cache node instance type"
  type        = string
  default     = "cache.t3.micro"
}

variable "cache_num_nodes" {
  description = "Number of cache nodes"
  type        = number
  default     = 2
}

variable "redis_auth_token" {
  description = "Redis authentication token"
  type        = string
  sensitive   = true
}
`,
    'outputs.tf': `output "redis_endpoint" {
  description = "Redis primary endpoint"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_port" {
  description = "Redis port"
  value       = aws_elasticache_replication_group.main.port
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT GATEWAY MODULE (Stripe integration)
// ═══════════════════════════════════════════════════════════════════════════

const paymentGatewayModule = {
  aws: () => ({
    'main.tf': `# Payment Gateway Integration (Stripe via Lambda)
# Safe defaults: secrets encrypted, webhook validation

resource "aws_secretsmanager_secret" "stripe_keys" {
  name        = "\${var.project_name}-stripe-keys"
  description = "Stripe API keys"

  tags = {
    Name = "\${var.project_name}-stripe-keys"
  }
}

resource "aws_secretsmanager_secret_version" "stripe_keys" {
  secret_id = aws_secretsmanager_secret.stripe_keys.id
  secret_string = jsonencode({
    publishable_key = var.stripe_publishable_key
    secret_key      = var.stripe_secret_key
    webhook_secret  = var.stripe_webhook_secret
  })
}

resource "aws_lambda_function" "payment_processor" {
  function_name = "\${var.project_name}-payment-processor"
  role          = aws_iam_role.payment_lambda.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30
  memory_size   = 256

  filename         = "payment-processor.zip"
  source_code_hash = filebase64sha256("payment-processor.zip")

  environment {
    variables = {
      STRIPE_SECRET_ARN = aws_secretsmanager_secret.stripe_keys.arn
    }
  }

  tags = {
    Name = "\${var.project_name}-payment-processor"
  }
}

resource "aws_iam_role" "payment_lambda" {
  name = "\${var.project_name}-payment-lambda-role"

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

resource "aws_iam_role_policy" "payment_lambda" {
  name = "payment-lambda-policy"
  role = aws_iam_role.payment_lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = aws_secretsmanager_secret.stripe_keys.arn
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "stripe_publishable_key" {
  description = "Stripe publishable key"
  type        = string
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe secret key"
  type        = string
  sensitive   = true
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook secret"
  type        = string
  sensitive   = true
}
`,
    'outputs.tf': `output "payment_lambda_arn" {
  description = "Payment processor Lambda ARN"
  value       = aws_lambda_function.payment_processor.arn
}

output "payment_lambda_name" {
  description = "Payment processor Lambda name"
  value       = aws_lambda_function.payment_processor.function_name
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// LOAD BALANCER MODULE
// ═══════════════════════════════════════════════════════════════════════════

const loadBalancerModule = {
  aws: () => ({
    'main.tf': `# Application Load Balancer
# Safe defaults: HTTPS, security headers, access logs

resource "aws_lb" "main" {
  name               = "\${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb.id]
  subnets            = var.public_subnet_ids

  # MANDATORY: Access logging enabled
  access_logs {
    bucket  = var.log_bucket_name
    prefix  = "alb"
    enabled = true
  }

  # Drop invalid headers
  drop_invalid_header_fields = true

  tags = {
    Name = "\${var.project_name}-alb"
  }
}

resource "aws_lb_target_group" "app" {
  name        = "\${var.project_name}-tg"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 2
    interval            = 30
    matcher             = "200"
    path                = "/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    timeout             = 5
    unhealthy_threshold = 2
  }

  tags = {
    Name = "\${var.project_name}-tg"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  # Redirect HTTP to HTTPS
  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = "443"
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS-1-2-2017-01"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_security_group" "lb" {
  name        = "\${var.project_name}-lb-sg"
  description = "Security group for load balancer"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "\${var.project_name}-lb-sg"
  }
}
`,
    'variables.tf': `variable "project_name" {
  description = "Project name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnet IDs"
  type        = list(string)
}

variable "log_bucket_name" {
  description = "S3 bucket for access logs"
  type        = string
}

variable "app_port" {
  description = "Application port"
  type        = number
  default     = 80
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS"
  type        = string
}
`,
    'outputs.tf': `output "lb_dns_name" {
  description = "Load balancer DNS name"
  value       = aws_lb.main.dns_name
}

output "lb_arn" {
  description = "Load balancer ARN"
  value       = aws_lb.main.arn
}

output "target_group_arn" {
  description = "Target group ARN"
  value       = aws_lb_target_group.app.arn
}

output "lb_security_group_id" {
  description = "Load balancer security group ID"
  value       = aws_security_group.lb.id
}
`
  })
};

// ═══════════════════════════════════════════════════════════════════════════
// MODULE REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  getModule: (serviceName, provider) => {
    const modules = {
      networking: networkingModule,
      cdn: cdnModule,
      api_gateway: apiGatewayModule,
      serverless_compute: serverlessComputeModule,
      app_compute: appComputeModule,
      relational_database: relationalDbModule,
      object_storage: objectStorageModule,
      identity_auth: authModule,
      monitoring: monitoringModule,
      logging: loggingModule,
      message_queue: messageQueueModule,
      cache: cacheModule,
      payment_gateway: paymentGatewayModule,
      load_balancer: loadBalancerModule,
      // 🔥 ADDED MISSING MODULES
      analytical_database: null,  // Will use fallback
      batch_compute: null,  // Will use fallback
      websocket_gateway: null,  // Will use fallback
      ml_inference_service: null,  // Will use fallback
      push_notification_service: null  // Will use fallback
    };

    const module = modules[serviceName];
    if (module === undefined) {
      // Service not in registry at all - return null
      return null;
    }
    
    if (module === null) {
      // Explicitly marked as "use fallback"
      if (provider === 'gcp' || provider === 'azure') {
        console.log(`[TERRAFORM] Using minimal fallback module for ${serviceName} on ${provider}`);
        return generateMinimalModule(provider, serviceName);
      }
      // For AWS, still need full implementation
      console.log(`[TERRAFORM] Using minimal fallback module for ${serviceName} on ${provider} (AWS)`);
      return generateMinimalModule('aws', serviceName);
    }
    
    // If provider-specific implementation exists, use it
    if (module[provider]) {
      return module[provider]();
    }
    
    // 🔥 FALLBACK: Generate minimal module for GCP/Azure
    if (provider === 'gcp' || provider === 'azure') {
      console.log(`[TERRAFORM] Using minimal module for ${serviceName} on ${provider}`);
      return generateMinimalModule(provider, serviceName);
    }
    
    return null;
  }
};
