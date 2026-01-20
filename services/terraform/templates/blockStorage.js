'use strict';

const { renderStandardVariables } = require('./base');

const blockStorageModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_ebs_volume" "main" {
  availability_zone = "\${var.region}a"
  size              = var.volume_size
  type              = "gp3"
  encrypted         = true

  tags = {
    Name        = "\${var.project_name}-data"
    Environment = var.environment
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('aws')}
variable "volume_size" { type = number default = 100 }
`.trim(),
            outputsTf: `
output "volume_id" {
  value = aws_ebs_volume.main.id
}
output "volume_arn" {
  value = aws_ebs_volume.main.arn
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_compute_disk" "main" {
  name  = "\${var.project_name}-disk"
  type  = "pd-balanced"
  zone  = "\${var.region}-a"
  size  = var.volume_size

  labels = {
    environment = "production"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('gcp')}
variable "volume_size" { type = number default = 100 }
`.trim(),
            outputsTf: `
output "disk_self_link" {
  value = google_compute_disk.main.self_link
}
`.trim()
        };
    }

    return {
        mainTf: `
resource "azurerm_managed_disk" "main" {
  name                 = "disk-\${var.project_name}"
  location             = var.location
  resource_group_name  = var.resource_group_name
  storage_account_type = "StandardSSD_LRS"
  create_option        = "Empty"
  disk_size_gb         = var.volume_size

  tags = {
    Environment = "production"
  }
}
`.trim(),
        variablesTf: `
${renderStandardVariables('azure')}
variable "volume_size" { type = number default = 100 }
`.trim(),
        outputsTf: `
output "disk_id" {
  value = azurerm_managed_disk.main.id
}
`.trim()
    };
};

module.exports = { blockStorageModule };
