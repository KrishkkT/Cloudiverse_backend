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
 */
function generateMinimalModule(provider, moduleId) {
  const p = provider.toLowerCase();
  const name = moduleId.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const cleanId = moduleId.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (p === 'aws') {
    return {
      mainTf: `
/*
 * Minimal AWS placeholder for '${cleanId}'
 */
resource "aws_eip" "${name}" {
  domain = "vpc"
  tags = {
    Name = "\${var.project_name}-${name}"
    Project = var.project_name
    Environment = var.environment
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "${name}_id" {
  value = aws_eip.${name}.id
}
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
/*
 * Minimal GCP placeholder for '${serviceId}'
 */
resource "google_compute_address" "${name}" {
  name   = "\${var.project_name}-${name}-address"
  region = var.region
}
`.trim(),
      variablesTf: renderStandardVariables('gcp'),
      outputsTf: `
output "${name}_id" {
  value = google_compute_address.${name}.id
}
`.trim()
    };
  }

  // azure
  return {
    mainTf: `
/*
 * Minimal Azure placeholder for '${serviceId}'
 */
resource "azurerm_public_ip" "${name}" {
  name                = "\${var.project_name}-${name}-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Dynamic"
}
`.trim(),
    variablesTf: renderStandardVariables('azure'),
    outputsTf: `
output "${name}_id" {
  value = azurerm_public_ip.${name}.id
}
`.trim()
  };
}

module.exports = {
  renderStandardVariables,
  generateMinimalModule
};
