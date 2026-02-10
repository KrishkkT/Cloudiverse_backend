'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function cacheModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_elasticache_subnet_group" "main" {
  name       = "\${var.project_name}-cache-subnet"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name        = "\${var.project_name}-cache-subnet"
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_security_group" "cache" {
  name        = "\${var.project_name}-cache-sg"
  description = "Allow inbound traffic to Redis"
  vpc_id      = var.vpc_id

  ingress {
    description = "Redis from VPC"
    from_port   = 6379
    to_port     = 6379
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "\${var.project_name}-cache-sg"
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_elasticache_cluster" "main" {
  cluster_id           = "\${var.project_name}-cache"
  engine               = "redis"
  node_type            = var.cache_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.cache.id]

  tags = {
    Name        = "\${var.project_name}-cache"
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}

variable "cache_node_type" {
  type    = string
  default = "cache.t3.micro"
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}
`.trim(),
      outputsTf: `
output "cache_endpoint" { value = aws_elasticache_cluster.main.cache_nodes[0].address }
output "cache_port" { value = aws_elasticache_cluster.main.cache_nodes[0].port }

# Standardized Outputs
output "endpoint" { value = aws_elasticache_cluster.main.cache_nodes[0].address }
output "port" { value = aws_elasticache_cluster.main.cache_nodes[0].port }
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

  redis_version = "REDIS_6_X"
  display_name  = "\${var.project_name}-cache"

  labels = {
    environment = "production"
    managed_by  = "cloudiverse"
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}
`.trim(),
      outputsTf: `
output "endpoint" { value = google_redis_instance.main.host }
output "port" { value = google_redis_instance.main.port }
`.trim()
    };
  }

  if (p === 'azure') {
    return {
      mainTf: `
resource "azurerm_redis_cache" "main" {
  name                = "\${var.project_name}-cache"
  location            = var.location
  resource_group_name = var.resource_group_name
  capacity            = 0
  family              = "C"
  sku_name            = "Basic"
  enable_non_ssl_port = false
  minimum_tls_version = "1.2"
}
`.trim(),
      variablesTf: `
${renderStandardVariables('azure')}
`.trim(),
      outputsTf: `
output "endpoint" { value = azurerm_redis_cache.main.hostname }
output "port" { value = azurerm_redis_cache.main.ssl_port }
`.trim()
    };
  }

  return generateMinimalModule(p, 'cache');
}

module.exports = { cacheModule };
