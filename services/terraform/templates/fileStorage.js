'use strict';

const { renderStandardVariables } = require('./base');

const fileStorageModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_efs_file_system" "main" {
  creation_token = "\${var.project_name}-efs"
  encrypted      = true

  tags = {
    Name = "\${var.project_name}-efs"
  }
}

resource "aws_efs_mount_target" "main" {
  count           = length(var.subnet_ids)
  file_system_id  = aws_efs_file_system.main.id
  subnet_id       = var.subnet_ids[count.index]
  security_groups = var.security_group_ids
}
`.trim(),
            variablesTf: `
${renderStandardVariables('aws')}
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
`.trim(),
            outputsTf: `
output "efs_id" {
  value = aws_efs_file_system.main.id
}
output "efs_dns_name" {
  value = aws_efs_file_system.main.dns_name
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_filestore_instance" "main" {
  name = "\${var.project_name}-nfs"
  tier = "BASIC_HDD"
  zone = "\${var.region}-a"

  file_shares {
    capacity_gb = 1024
    name        = "share1"
  }

  networks {
    network = "default"
    modes   = ["MODE_IPV4"]
  }
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "nfs_ip" {
  value = google_filestore_instance.main.networks[0].ip_addresses[0]
}
`.trim()
        };
    }

    // Azure Files
    return {
        mainTf: `
resource "azurerm_storage_account" "fs" {
  name                     = "fs\${var.project_name}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_storage_share" "main" {
  name                 = "share"
  storage_account_name = azurerm_storage_account.fs.name
  quota                = 50
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "share_name" {
  value = azurerm_storage_share.main.name
}
output "storage_account_name" {
  value = azurerm_storage_account.fs.name
}
`.trim()
    };
};

module.exports = { fileStorageModule };
