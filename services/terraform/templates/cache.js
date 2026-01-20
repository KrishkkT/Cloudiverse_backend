'use strict';

const { renderStandardVariables } = require('./base');

const cacheModule = (provider) => {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_elasticache_subnet_group" "main" {
  name       = "\${var.project_name}-cache-subnet"
  subnet_ids = var.subnet_ids
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "\${var.project_name}-cache"
  engine               = "redis"
  node_type            = var.node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = var.security_group_ids

  tags = {
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
            variablesTf: `
${renderStandardVariables('aws')}
variable "subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "node_type" { type = string default = "cache.t3.micro" }
`.trim(),
            outputsTf: `
output "cache_endpoint" {
  value = aws_elasticache_cluster.main.cache_nodes[0].address
}
output "cache_port" {
  value = aws_elasticache_cluster.main.cache_nodes[0].port
}
`.trim()
        };
    }

    if (p === 'gcp') {
        return {
            mainTf: `
resource "google_redis_instance" "main" {
  name           = "\${var.project_name}-cache"
  memory_size_gb = 1
  region         = var.region
  tier           = "BASIC"

  authorized_network = "default" # Should be var.network_id

  labels = {
    environment = "production"
  }
}
`.trim(),
            variablesTf: renderStandardVariables('gcp'),
            outputsTf: `
output "cache_host" {
  value = google_redis_instance.main.host
}
output "cache_port" {
  value = google_redis_instance.main.port
}
`.trim()
        };
    }

    // Azure Redis
    return {
        mainTf: `
resource "azurerm_redis_cache" "main" {
  name                = "redis-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  capacity            = 0
  family              = "C"
  sku_name            = "Basic"
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
        variablesTf: renderStandardVariables('azure'),
        outputsTf: `
output "redis_hostname" {
  value = azurerm_redis_cache.main.hostname
}
output "redis_port" {
  value = azurerm_redis_cache.main.ssl_port
}
output "primary_access_key" {
  value     = azurerm_redis_cache.main.primary_access_key
  sensitive = true
}
`.trim()
    };
};

module.exports = { cacheModule };
