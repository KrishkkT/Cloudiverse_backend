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
function generateTfvars(provider, projectName, requirements = {}) {
  const region = requirements.region?.primary_region || (provider === 'aws' ? 'us-east-1' : provider === 'gcp' ? 'us-central1' : 'eastus');
  
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

  // NFR-driven values
  const nfr = requirements.nfr || {};
  tfvars += `# NFR-Driven Configuration\n`;
  tfvars += `encryption_at_rest    = ${nfr.security_level === 'maximum' || nfr.security_level === 'high' ? 'true' : 'true'}\n`;
  tfvars += `backup_retention_days = ${nfr.backup_retention || 7}\n`;
  tfvars += `deletion_protection   = true\n`;
  tfvars += `multi_az              = ${requirements.region?.multi_region ? 'true' : 'false'}\n`;
  tfvars += `monitoring_enabled    = ${requirements.observability?.metrics ? 'true' : 'true'}\n`;

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

  if (Array.isArray(services) && services.includes('api_gateway')) {
    outputs += `output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = module.api_gateway.endpoint
}

`;
  }

  if (Array.isArray(services) && services.includes('relational_database')) {
    outputs += `output "database_endpoint" {
  description = "Database connection endpoint"
  value       = module.relational_db.endpoint
  sensitive   = true
}

`;
  }

  if (Array.isArray(services) && services.includes('object_storage')) {
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
  let mainTf = `# Main Terraform Configuration
# Pattern: ${pattern}
# Provider: ${provider.toUpperCase()}
#
# This file ONLY references modules - no direct resource blocks allowed.
# All cloud resources are defined in their respective modules.

`;

  // Add networking module if needed
  if (needsNetworking(pattern, services)) {
    mainTf += `module "networking" {
  source = "./modules/networking"
  
  project_name = var.project_name
  region       = var.region
  environment  = var.environment
}

`;
  }

  // Add modules for each service
  if (Array.isArray(services)) {
    services.forEach(service => {
      const moduleConfig = getModuleConfig(service, provider);
      if (moduleConfig) {
        mainTf += moduleConfig + '\n\n';
      }
    });
  }

  return mainTf;
}

/**
 * Check if pattern needs networking module
 */
function needsNetworking(pattern, services) {
  const patternsNeedingVPC = [
    'STATEFUL_WEB_PLATFORM',
    'HYBRID_PLATFORM',
    'MOBILE_BACKEND_PLATFORM',
    'CONTAINERIZED_WEB_APP',
    'DATA_PLATFORM',
    'REALTIME_PLATFORM'
  ];
  return patternsNeedingVPC.includes(pattern);
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
    
    api_gateway: `module "api_gateway" {
  source = "./modules/api_gateway"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    serverless_compute: `module "serverless_compute" {
  source = "./modules/serverless_compute"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    app_compute: `module "app_compute" {
  source = "./modules/app_compute"
  
  project_name        = var.project_name
  region              = var.region
  vpc_id              = module.networking.vpc_id
  private_subnet_ids  = module.networking.private_subnet_ids
}`,
    
    relational_database: `module "relational_db" {
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
    
    analytical_database: `module "analytical_db" {
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
    
    message_queue: `module "message_queue" {
  source = "./modules/message_queue"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    object_storage: `module "object_storage" {
  source = "./modules/object_storage"
  
  project_name       = var.project_name
  region             = var.region
  encryption_at_rest = var.encryption_at_rest
}`,
    
    identity_auth: `module "auth" {
  source = "./modules/auth"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    load_balancer: `module "load_balancer" {
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
    
    ml_inference_service: `module "ml_inference" {
  source = "./modules/ml_inference"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    batch_compute: `module "batch_compute" {
  source = "./modules/batch_compute"
  
  project_name = var.project_name
  region       = var.region
}`,
    
    websocket_gateway: `module "websocket" {
  source = "./modules/websocket"
  
  project_name = var.project_name
  region       = var.region
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

module.exports = {
  generateVersionsTf,
  generateProvidersTf,
  generateVariablesTf,
  generateTfvars,
  generateOutputsTf,
  generateMainTf,
  generateReadme
};
