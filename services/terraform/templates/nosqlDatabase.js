'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

/**
 * NoSQL Database Module - DynamoDB / Firestore / CosmosDB
 * Used for document and key-value storage patterns
 */
function nosqlDatabaseModule(provider) {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
# DynamoDB Table
resource "aws_dynamodb_table" "main" {
  name           = "\${var.project_name}-table"
  billing_mode   = var.billing_mode
  read_capacity  = var.billing_mode == "PROVISIONED" ? var.read_capacity : null
  write_capacity = var.billing_mode == "PROVISIONED" ? var.write_capacity : null
  hash_key       = var.hash_key

  attribute {
    name = var.hash_key
    type = var.hash_key_type
  }

  dynamic "attribute" {
    for_each = var.range_key != null ? [1] : []
    content {
      name = var.range_key
      type = var.range_key_type
    }
  }

  dynamic "global_secondary_index" {
    for_each = var.global_secondary_indexes
    content {
      name               = global_secondary_index.value.name
      hash_key           = global_secondary_index.value.hash_key
      range_key          = lookup(global_secondary_index.value, "range_key", null)
      projection_type    = lookup(global_secondary_index.value, "projection_type", "ALL")
      read_capacity      = var.billing_mode == "PROVISIONED" ? lookup(global_secondary_index.value, "read_capacity", 5) : null
      write_capacity     = var.billing_mode == "PROVISIONED" ? lookup(global_secondary_index.value, "write_capacity", 5) : null
    }
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  server_side_encryption {
    enabled = var.encryption_enabled
  }

  tags = {
    Name        = "\${var.project_name}-table"
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('aws')}

variable "billing_mode" {
  type    = string
  default = "PAY_PER_REQUEST"
  description = "DynamoDB billing mode: PROVISIONED or PAY_PER_REQUEST"
}

variable "read_capacity" {
  type    = number
  default = 5
}

variable "write_capacity" {
  type    = number
  default = 5
}

variable "hash_key" {
  type    = string
  default = "id"
}

variable "hash_key_type" {
  type    = string
  default = "S"
  description = "S = String, N = Number, B = Binary"
}

variable "range_key" {
  type    = string
  default = null
}

variable "range_key_type" {
  type    = string
  default = "S"
}

variable "global_secondary_indexes" {
  type    = list(any)
  default = []
}

variable "point_in_time_recovery" {
  type    = bool
  default = true
}

variable "encryption_enabled" {
  type    = bool
  default = true
}
`.trim(),
            outputsTf: `
output "table_name" {
  value       = aws_dynamodb_table.main.name
  description = "DynamoDB table name"
}

output "table_arn" {
  value       = aws_dynamodb_table.main.arn
  description = "DynamoDB table ARN"
}

output "table_id" {
  value       = aws_dynamodb_table.main.id
  description = "DynamoDB table ID"
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
# Firestore Database
resource "google_firestore_database" "main" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  concurrency_mode            = "OPTIMISTIC"
  app_engine_integration_mode = "DISABLED"
}

# Firestore Index (example)
resource "google_firestore_index" "main" {
  project    = var.project_id
  database   = google_firestore_database.main.name
  collection = var.collection_name

  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }

  fields {
    field_path = "__name__"
    order      = "DESCENDING"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('gcp')}

variable "collection_name" {
  type    = string
  default = "documents"
  description = "Default collection name for indexing"
}
`.trim(),
            outputsTf: `
output "database_name" {
  value       = google_firestore_database.main.name
  description = "Firestore database name"
}

output "database_id" {
  value       = google_firestore_database.main.id
  description = "Firestore database ID"
}
`.trim()
        };
    }

    // Azure - Cosmos DB
    return {
        mainTf: `
# Cosmos DB Account
resource "azurerm_cosmosdb_account" "main" {
  name                = "\${var.project_name}-cosmos"
  location            = var.location
  resource_group_name = var.resource_group_name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  enable_automatic_failover = var.enable_automatic_failover

  consistency_policy {
    consistency_level       = var.consistency_level
    max_interval_in_seconds = var.consistency_level == "BoundedStaleness" ? 300 : null
    max_staleness_prefix    = var.consistency_level == "BoundedStaleness" ? 100000 : null
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  capabilities {
    name = "EnableServerless"
  }

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

# Cosmos DB SQL Database
resource "azurerm_cosmosdb_sql_database" "main" {
  name                = var.database_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.main.name
}

# Cosmos DB SQL Container
resource "azurerm_cosmosdb_sql_container" "main" {
  name                = var.container_name
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_path  = var.partition_key_path
}
`.trim(),
        variablesTf: `
${renderStandardVariables('azure')}

variable "enable_automatic_failover" {
  type    = bool
  default = false
}

variable "consistency_level" {
  type    = string
  default = "Session"
  description = "Strong, BoundedStaleness, Session, ConsistentPrefix, Eventual"
}

variable "database_name" {
  type    = string
  default = "maindb"
}

variable "container_name" {
  type    = string
  default = "documents"
}

variable "partition_key_path" {
  type    = string
  default = "/id"
}
`.trim(),
        outputsTf: `
output "account_name" {
  value       = azurerm_cosmosdb_account.main.name
  description = "Cosmos DB account name"
}

output "account_endpoint" {
  value       = azurerm_cosmosdb_account.main.endpoint
  description = "Cosmos DB endpoint"
}

output "database_name" {
  value       = azurerm_cosmosdb_sql_database.main.name
  description = "Cosmos DB database name"
}
`.trim()
    };
}

module.exports = { nosqlDatabaseModule };
