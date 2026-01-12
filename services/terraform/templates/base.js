'use strict';

// Helper to render standard variables for each provider
const renderStandardVariables = (provider) => {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return `
variable "project_name" { type = string }
variable "region" { type = string  default = "us-east-1" }
variable "environment" { type = string default = "production" }
`.trim();
  }

  if (p === 'gcp') {
    return `
variable "project_name" { type = string }
variable "project_id"   { type = string }
variable "region"       { type = string default = "us-central1" }
`.trim();
  }

  // azure
  return `
variable "project_name"       { type = string }
variable "location"           { type = string default = "eastus" }
variable "resource_group_name" { type = string }
`.trim();
};

/**
 * Minimal module generator factory
 * 🔥 FIX 3: Uses realistic resource types instead of EIP placeholders
 */
function generateMinimalModule(provider, moduleId) {
  const p = provider.toLowerCase();
  const name = moduleId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanId = moduleId.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (p === 'aws') {
    return {
      mainTf: `
/*
 * AWS fallback module for '${cleanId}'
 * This is a minimal placeholder - implement a proper template for production
 */

# Random suffix for unique naming
resource "random_id" "${name}_suffix" {
  byte_length = 4
}

# S3 bucket as a safe fallback resource
resource "aws_s3_bucket" "${name}" {
  bucket = "\${var.project_name}-${name}-\${random_id.${name}_suffix.hex}"

  tags = {
    Name        = "\${var.project_name}-${name}"
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
    Module      = "${cleanId}"
  }
}

resource "aws_s3_bucket_versioning" "${name}" {
  bucket = aws_s3_bucket.${name}.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "${name}" {
  bucket = aws_s3_bucket.${name}.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "${name}_id" {
  value       = aws_s3_bucket.${name}.id
  description = "Fallback resource ID for ${cleanId}"
}

output "${name}_arn" {
  value       = aws_s3_bucket.${name}.arn
  description = "Fallback resource ARN for ${cleanId}"
}
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
/*
 * GCP fallback module for '${cleanId}'
 * This is a minimal placeholder - implement a proper template for production
 */

# Random suffix for unique naming
resource "random_id" "${name}_suffix" {
  byte_length = 4
}

# GCS bucket as a safe fallback resource
resource "google_storage_bucket" "${name}" {
  name          = "\${var.project_name}-${name}-\${random_id.${name}_suffix.hex}"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  labels = {
    project     = var.project_name
    environment = "production"
    managed_by  = "cloudiverse"
    module      = "${cleanId}"
  }
}
`.trim(),
      variablesTf: renderStandardVariables('gcp'),
      outputsTf: `
output "${name}_id" {
  value       = google_storage_bucket.${name}.id
  description = "Fallback resource ID for ${cleanId}"
}

output "${name}_url" {
  value       = google_storage_bucket.${name}.url
  description = "Fallback resource URL for ${cleanId}"
}
`.trim()
    };
  }

  // azure
  return {
    mainTf: `
/*
 * Azure fallback module for '${cleanId}'
 * This is a minimal placeholder - implement a proper template for production
 */

# Random suffix for unique naming
resource "random_id" "${name}_suffix" {
  byte_length = 4
}

# Storage account as a safe fallback resource
resource "azurerm_storage_account" "${name}" {
  name                     = "st${cleanId}\${random_id.${name}_suffix.hex}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  tags = {
    Project     = var.project_name
    Environment = "production"
    ManagedBy   = "Cloudiverse"
    Module      = "${cleanId}"
  }
}
`.trim(),
    variablesTf: renderStandardVariables('azure'),
    outputsTf: `
output "${name}_id" {
  value       = azurerm_storage_account.${name}.id
  description = "Fallback resource ID for ${cleanId}"
}

output "${name}_primary_blob_endpoint" {
  value       = azurerm_storage_account.${name}.primary_blob_endpoint
  description = "Fallback resource endpoint for ${cleanId}"
}
`.trim()
  };
}

module.exports = {
  renderStandardVariables,
  generateMinimalModule
};
