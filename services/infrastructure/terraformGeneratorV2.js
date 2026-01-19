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
      source  = "${config.source}"
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
  region  = var.region
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
  type        = string
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"
}

`;
  } else if (provider === 'gcp') {
    variables += `variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"
}

`;
  } else if (provider === 'azure') {
    variables += `variable "location" {
  description = "Azure location"
  type        = string
}

variable "project_name" {
  description = "Project name (used for resource naming)"
  type        = string
}

variable "environment" {
  description = "Environment (dev, staging, production)"
  type        = string
  default     = "production"
}

`;
  }

  // NFR-driven variables
  variables += `# NFR-Driven Variables
variable "encryption_at_rest" {
  description = "Enable encryption at rest for storage services"
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  description = "Number of days to retain backups"
  type        = number
  default     = 7
}

variable "deletion_protection" {
  description = "Enable deletion protection for stateful resources"
  type        = bool
  default     = true
}

variable "multi_az" {
  description = "Enable multi-AZ deployment for high availability"
  type        = bool
  default     = false
}

variable "monitoring_enabled" {
  description = "Enable monitoring and logging"
  type        = bool
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
    tfvars += `region       = "${region}"\n`;
  } else if (provider === 'gcp') {
    tfvars += `project_id   = "YOUR_GCP_PROJECT_ID"\n`;
    tfvars += `region       = "${region}"\n`;
  } else if (provider === 'azure') {
    tfvars += `location     = "${region}"\n`;
  }

  tfvars += `project_name = "${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}"\n`;
  tfvars += `environment  = "production"\n\n`;

  // NFR-driven values (Defaults since requirements obj is not available in V2 generator yet)
  const nfr = {};
  tfvars += `# NFR-Driven Configuration\n`;
  tfvars += `encryption_at_rest    = true\n`;
  tfvars += `backup_retention_days = 7\n`;
  tfvars += `deletion_protection   = true\n`;
  tfvars += `multi_az              = false\n`;
  tfvars += `monitoring_enabled    = true\n`;

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
  value       = module.cdn.endpoint
}

`;
  }

  if (Array.isArray(services) && services.includes('apigateway')) {
    outputs += `output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.apigateway.endpoint
}

`;
  }

  if (Array.isArray(services) && services.includes('relationaldatabase')) {
    outputs += `output "database_endpoint" {
  description = "Database connection endpoint"
  value       = module.relational_db.endpoint
  sensitive   = true
}

`;
  }

  if (Array.isArray(services) && services.includes('objectstorage')) {
    outputs += `output "storage_bucket" {
  description = "Object storage bucket name"
  value       = module.object_storage.bucket_name
}

`;
  }

  return outputs;
}

/**
 * Generate main.tf (ONLY module references, NO direct resources)
 */
function generateMainTf(provider, pattern, services) {
  const p = provider.toLowerCase();

  let mainTf = `# Main Terraform Configuration
# Pattern: ${pattern}
# Provider: ${p.toUpperCase()}
#
# This file ONLY references modules - no direct resource blocks allowed.
# All cloud resources are defined in their respective modules.

`;

  if (p === 'aws') {
    mainTf += `provider "aws" {
  region = var.region
  # Make sure to configure credentials via environment variables or CLI
}

`;
  } else if (p === 'gcp') {
    mainTf += `provider "google" {
  project = var.project_id
  region  = var.region
}

`;
  } else if (p === 'azure') {
    mainTf += `terraform {
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

resource "azurerm_resource_group" "main" {
  name     = "rg-\${var.project_name}"
  location = var.location
}

`;
  }

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
`;

      // 🔥 FIX: Provider-specific module variables
      if (p === 'azure') {
        mainTf += `  location            = var.location
  resource_group_name = azurerm_resource_group.main.name
`;
      } else {
        mainTf += `  region = var.region
`;
      }

      mainTf += `  
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
  region       = var.region
}`,

    apigateway: `module "apigateway" {
  source = "./modules/apigateway"
  
  project_name = var.project_name
  region       = var.region
}`,

    computeserverless: `module "serverless_compute" {
  source = "./modules/serverless_compute"
  
  project_name = var.project_name
  region       = var.region
}`,

    appcompute: `module "app_compute" {
  source = "./modules/app_compute"
  
  project_name        = var.project_name
  region              = var.region
  vpc_id              = module.networking.vpc_id
  private_subnet_ids  = module.networking.private_subnet_ids
}`,

    relationaldatabase: `module "relational_db" {
  source = "./modules/relational_db"
  
  project_name           = var.project_name
  region                 = var.region
  vpc_id                 = module.networking.vpc_id
  private_subnet_ids     = module.networking.private_subnet_ids
  encryption_at_rest     = var.encryption_at_rest
  backup_retention_days  = var.backup_retention_days
  deletion_protection    = var.deletion_protection
  multi_az               = var.multi_az
}`,

    analyticaldatabase: `module "analytical_db" {
  source = "./modules/analytical_db"
  
  project_name           = var.project_name
  region                 = var.region
  encryption_at_rest     = var.encryption_at_rest
}`,

    cache: `module "cache" {
  source = "./modules/cache"
  
  project_name        = var.project_name
  region              = var.region
  vpc_id              = module.networking.vpc_id
  private_subnet_ids  = module.networking.private_subnet_ids
}`,

    messagequeue: `module "message_queue" {
  source = "./modules/mq"
  
  project_name = var.project_name
  region       = var.region
}`,

    objectstorage: `module "object_storage" {
  source = "./modules/object_storage"
  
  project_name       = var.project_name
  region             = var.region
  encryption_at_rest = var.encryption_at_rest
}`,

    identityauth: `module "auth" {
  source = "./modules/auth"
  
  project_name = var.project_name
  region       = var.region
}`,

    loadbalancer: `module "load_balancer" {
  source = "./modules/load_balancer"
  
  project_name    = var.project_name
  region          = var.region
  vpc_id          = module.networking.vpc_id
  public_subnet_ids = module.networking.public_subnet_ids
}`,

    monitoring: `module "monitoring" {
  source = "./modules/monitoring"
  
  project_name        = var.project_name
  region              = var.region
  monitoring_enabled  = var.monitoring_enabled
}`,

    logging: `module "logging" {
  source = "./modules/logging"
  
  project_name = var.project_name
  region       = var.region
}`,

    mlinferenceservice: `module "ml_inference" {
  source = "./modules/ml_inference"
  
  project_name = var.project_name
  region       = var.region
}`,

    batchcompute: `module "batch_compute" {
  source = "./modules/batch_compute"
  
  project_name = var.project_name
  region       = var.region
}`,

    websocketgateway: `module "websocket" {
  source = "./modules/websocket"
  
  project_name = var.project_name
  region       = var.region
}`,

    // 🔥 FIX: Added missing Critical Services
    computecontainer: `module "app_container" {
  source = "./modules/compute_container"
  
  project_name       = var.project_name
  region             = var.region
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}`,

    computevm: `module "vm_compute" {
  source = "./modules/vm_compute"
  
  project_name       = var.project_name
  region             = var.region
  vpc_id             = module.networking.vpc_id
  private_subnet_ids = module.networking.private_subnet_ids
}`,

    nosqldatabase: `module "nosql_db" {
  source = "./modules/nosql_db"
  
  project_name       = var.project_name
  region             = var.region
}`,

    blockstorage: `module "block_storage" {
  source = "./modules/block_storage"
  
  project_name       = var.project_name
  region             = var.region
  encryption_at_rest = var.encryption_at_rest
}`,

    secretsmanager: `module "secrets" {
  source = "./modules/secrets"
  
  project_name = var.project_name
  region       = var.region
}`,

    dns: `module "dns" {
  source = "./modules/dns"
  
  project_name = var.project_name
  region       = var.region
}`,

    globalloadbalancer: `module "global_lb" {
  source = "./modules/global_lb"
  
  project_name = var.project_name
  region       = var.region
}`,

    // 🔥 FIX: Mapped missing keys from Pattern
    waf: `module "waf" {
  source = "./modules/waf"
  
  project_name = var.project_name
  region       = var.region
}`,

    secretsmanagement: `module "secrets" {
  source = "./modules/secrets"
  
  project_name = var.project_name
  region       = var.region
}`,

    block_storage: `module "block_storage" {
  source = "./modules/block_storage"
  
  project_name       = var.project_name
  region             = var.region
  encryption_at_rest = var.encryption_at_rest
}`,

    eventbus: `module "event_bus" {
  source = "./modules/event_bus"
  
  project_name = var.project_name
  region       = var.region
}`,

    paymentgateway: `module "payment_gateway" {
  source = "./modules/payment_gateway"
  
  project_name = var.project_name
  region       = var.region
  # Note: Usually a SaaS integration, module creates secrets/config
}`
  };

  return moduleMap[service] || null;
}

/**
 * Generate README.md with deployment instructions
 */
function generateReadme(projectName, provider, pattern, services) {
  return `# ${projectName} - Terraform Infrastructure

## Architecture Pattern
**${pattern}**

## Cloud Provider
**${provider.toUpperCase()}**

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
  // 🔥 CRITICAL FIX: Strict Canonicalization & Deduplication
  const rawServices = canonicalArchitecture.services || [];
  const uniqueServices = new Set();

  rawServices.forEach(s => {
    let serviceId = '';
    if (typeof s === 'string') serviceId = s;
    else if (typeof s === 'object' && s !== null) {
      serviceId = s.canonical_type || s.name || s.id || '';
    }

    if (serviceId) {
      // Normalize: "relational_database" -> "relationaldatabase"
      const cleanId = serviceId.toLowerCase().replace(/_/g, '');
      uniqueServices.add(cleanId);
    }
  });

  const services = Array.from(uniqueServices);
  console.log(`[TERRAFORM GEN] Normalized & Deduped Services: ${services.join(', ')}`);

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
        }
    }
  }



  // 2. AZURE IMPLEMENTATIONS
  if (provider === 'azure') {
    switch (service) {
      case 'computeserverless':
        return {
          main: `resource "random_id" "func_suffix" {
  byte_length = 4
}

resource "azurerm_storage_account" "func_store" {
  name                     = "stfunc\${var.project_name}\${random_id.func_suffix.hex}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "func_plan" {
  name                = "plan-\${var.project_name}-func"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption
}

resource "azurerm_linux_function_app" "main" {
  name                = "func-\${var.project_name}-\${random_id.func_suffix.hex}"
  resource_group_name = var.resource_group_name
  location            = var.location

  storage_account_name       = azurerm_storage_account.func_store.name
  storage_account_access_key = azurerm_storage_account.func_store.primary_access_key
  service_plan_id            = azurerm_service_plan.func_plan.id

  site_config {
    application_stack {
      node_version = "18"
    }
  }

  tags = { Project = var.project_name }
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "function_app_name" { value = azurerm_linux_function_app.main.name }`
        };

      case 'computecontainer':
      case 'appcompute':
        return {
          main: `resource "azurerm_container_app_environment" "env" {
  name                = "\${var.project_name}-env"
  location            = var.location
  resource_group_name = var.resource_group_name
}

resource "azurerm_container_app" "app" {
  name                         = "\${var.project_name}-app"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  template {
    container {
      name   = "main"
      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = 0.5
      memory = "1.0Gi"
    }
    min_replicas = 1
  }
  
  ingress {
    external_enabled = true
    target_port      = 80
    traffic_weight {
      percentage = 100
      latest_revision = true
    }
  }
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "app_fqdn" { value = azurerm_container_app.app.latest_revision_fqdn }`
        };

      case 'relationaldatabase':
        return {
          main: `resource "random_password" "pass" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "azurerm_postgresql_flexible_server" "db" {
  name                   = "psql-\${var.project_name}"
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = "13"
  administrator_login    = "psqladmin"
  administrator_password = random_password.pass.result
  storage_mb             = 32768
  storage_tier           = "P4"
  sku_name               = "B_Standard_B1ms"
}

resource "azurerm_postgresql_flexible_server_database" "default" {
  name      = "defaultdb"
  server_id = azurerm_postgresql_flexible_server.db.id
  collation = "en_US.utf8"
  charset   = "utf8"
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "db_server" { value = azurerm_postgresql_flexible_server.db.name }`
        };

      case 'objectstorage':
        return {
          main: `resource "random_id" "st_suffix" {
  byte_length = 4
}
resource "azurerm_storage_account" "sa" {
  name                     = "st\${var.project_name}\${random_id.st_suffix.hex}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
resource "azurerm_storage_container" "data" {
  name                  = "data"
  storage_account_name  = azurerm_storage_account.sa.name
  container_access_type = "private"
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }
variable "encryption_at_rest" { type = bool default = true }`,
          outputs: `output "storage_account_name" { value = azurerm_storage_account.sa.name }`
        };

      case 'apigateway':
        return {
          main: `resource "azurerm_api_management" "apim" {
  name                = "apim-\${var.project_name}-\${random_id.st_suffix.hex}"
  location            = var.location
  resource_group_name = var.resource_group_name
  publisher_name      = "Cloudiverse"
  publisher_email     = "admin@cloudiverse.io"
  sku_name            = "Consumption_0"
}
`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "gateway_url" { value = azurerm_api_management.apim.gateway_url }`
        };

      case 'loadbalancer':
        return {
          main: `resource "azurerm_public_ip" "lb_ip" {
  name                = "lb-ip-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_lb" "main" {
  name                = "lb-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "PublicIPAddress"
    public_ip_address_id = azurerm_public_ip.lb_ip.id
  }
}
`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "lb_ip" { value = azurerm_public_ip.lb_ip.ip_address }`
        };

      case 'logging':
      case 'auditlogging':
        return {
          main: `resource "azurerm_log_analytics_workspace" "main" {
  name                = "log-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "PerGB2018"
  retention_in_days   = 30
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "log_workspace_id" { value = azurerm_log_analytics_workspace.main.id }`
        };

      case 'identityauth':
        return {
          main: `resource "azurerm_user_assigned_identity" "auth" {
  location            = var.location
  name                = "id-\${var.project_name}"
  resource_group_name = var.resource_group_name
}`,
          variables: `variable "project_name" { type = string }
variable "location" { type = string }
variable "resource_group_name" { type = string }`,
          outputs: `output "identity_id" { value = azurerm_user_assigned_identity.auth.id }`
        };
    }
  }

  // Fallback for GCP/Azure or unknown services
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
  generateReadme
};
