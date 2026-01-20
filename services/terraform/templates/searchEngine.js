'use strict';

const { renderStandardVariables } = require('./base');

const searchEngineModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_opensearch_domain" "main" {
  domain_name    = "\${var.project_name}-search"
  engine_version = "OpenSearch_2.5"

  cluster_config {
    instance_type = "t3.small.search"
    instance_count = 1
  }

  ebs_options {
    ebs_enabled = true
    volume_size = 10
  }

  encrypt_at_rest {
    enabled = true
  }

  node_to_node_encryption {
    enabled = true
  }

  tags = {
    Environment = var.environment
  }
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "search_endpoint" {
  value = aws_opensearch_domain.main.endpoint
}
output "kibana_endpoint" {
  value = aws_opensearch_domain.main.dashboard_endpoint
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
# GCP Discovery Engine requires complex setup (Data Stores, Apps).
# We provision the API and a basic Data Store.

resource "google_project_service" "discovery_engine" {
  service = "discoveryengine.googleapis.com"
}

resource "google_discovery_engine_data_store" "main" {
  location                    = "global"
  data_store_id               = "\${var.project_name}-store"
  display_name                = "Main Search Store"
  industry_vertical           = "GENERIC"
  content_config              = "CONTENT_REQUIRED"
  solution_types              = ["SOLUTION_TYPE_SEARCH"]
  create_advanced_site_search = false

  depends_on = [google_project_service.discovery_engine]
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "data_store_id" {
  value = google_discovery_engine_data_store.main.data_store_id
}
`.trim()
        };
    }

    // Azure AI Search
    return {
        mainTf: `
resource "azurerm_search_service" "main" {
  name                = "search-\${var.project_name}"
  resource_group_name = var.resource_group_name
  location            = var.location
  sku                 = "standard"
  replica_count       = 1
  partition_count     = 1

  tags = {
    Environment = "production"
  }
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "search_service_id" {
  value = azurerm_search_service.main.id
}
output "search_service_key" {
  value     = azurerm_search_service.main.primary_key
  sensitive = true
}
`.trim()
    };
};

module.exports = { searchEngineModule };
