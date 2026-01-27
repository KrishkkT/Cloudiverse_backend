'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function objectStorageModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_s3_bucket" "main" {
  bucket_prefix = "\${var.project_name}-"
  force_destroy = true
  
  tags = {
    Name        = "\${var.project_name}-storage"
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "bucket_name" { value = aws_s3_bucket.main.id }
output "bucket_arn"  { value = aws_s3_bucket.main.arn }
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
resource "google_storage_bucket" "main" {
  name          = "\${var.project_name}-\${var.random_suffix}"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true
  
  versioning {
    enabled = true
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}
variable "random_suffix" {
  type    = string
  default = "001"
}
`.trim(),
      outputsTf: `
output "bucket_url" { value = google_storage_bucket.main.url }
`.trim()
    };
  }

  if (p === 'azure') {
    return {
      mainTf: `
resource "azurerm_storage_account" "main" {
  name                     = replace("\${var.project_name}store", "-", "")
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_container" "main" {
  name                  = "content"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}
`.trim(),
      variablesTf: renderStandardVariables('azure'),
      outputsTf: `
output "storage_account_name" { value = azurerm_storage_account.main.name }
output "container_name" { value = azurerm_storage_container.main.name }
`.trim()
    };
  }

  return generateMinimalModule(p, 'objectstorage');
}

module.exports = { objectStorageModule };
