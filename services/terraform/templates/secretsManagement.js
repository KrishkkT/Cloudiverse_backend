'use strict';

const { renderStandardVariables } = require('./base');

const secretsManagementModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_secretsmanager_secret" "main" {
  name        = "\${var.project_name}/app/secrets"
  description = "Application secrets"
  
  recovery_window_in_days = 7

  tags = {
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_secretsmanager_secret_version" "example" {
  secret_id     = aws_secretsmanager_secret.main.id
  secret_string = jsonencode({
    API_KEY = "changeme"
  })
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "secret_arn" {
  value = aws_secretsmanager_secret.main.arn
}
output "secret_name" {
  value = aws_secretsmanager_secret.main.name
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_secret_manager_secret" "main" {
  secret_id = "\${var.project_name}-app-secret"

  labels = {
    environment = "production"
  }

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "example" {
  secret      = google_secret_manager_secret.main.id
  secret_data = "changeme"
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "secret_id" {
  value = google_secret_manager_secret.main.id
}
`.trim()
        };
    }

    // Azure Key Vault
    return {
        mainTf: `
data "azurerm_client_config" "current" {}

resource "azurerm_key_vault" "main" {
  name                        = "kv-\${var.project_name}"
  location                    = var.location
  resource_group_name         = var.resource_group_name
  enabled_for_disk_encryption = true
  tenant_id                   = data.azurerm_client_config.current.tenant_id
  soft_delete_retention_days  = 7
  purge_protection_enabled    = false

  sku_name = "standard"

  access_policy {
    tenant_id = data.azurerm_client_config.current.tenant_id
    object_id = data.azurerm_client_config.current.object_id

    key_permissions = [
      "Get",
    ]

    secret_permissions = [
      "Get", "Set", "List", "Delete"
    ]

    storage_permissions = [
      "Get",
    ]
  }
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "key_vault_id" {
  value = azurerm_key_vault.main.id
}
output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}
`.trim()
    };
};

module.exports = { secretsManagementModule };
