'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function relationalDatabaseModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_db_instance" "main" {
  identifier             = "\${var.project_name}-db"
  engine                 = "postgres"
  engine_version         = "15.3"
  instance_class         = var.db_instance_class
  allocated_storage      = var.db_allocated_storage
  storage_type           = "gp3"
  username               = "dbadmin"
  password               = "placeholder_password"
  skip_final_snapshot    = true
  publicly_accessible    = false
  multi_az               = var.multi_az
  db_subnet_group_name   = aws_db_subnet_group.default.name
  vpc_security_group_ids = [aws_security_group.db.id]
  
  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_db_subnet_group" "default" {
  name       = "\${var.project_name}-db-subnet-group"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "\${var.project_name}-db-subnet-group"
  }
}

resource "aws_security_group" "db" {
  name        = "\${var.project_name}-db-sg"
  description = "Allow inbound traffic from application"
  vpc_id      = var.vpc_id

  ingress {
    description = "PostgreSQL from VPC"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"] # Should ideally be specific subnets or SG refs
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "\${var.project_name}-db-sg"
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}

variable "vpc_id" {
  type        = string
  description = "VPC ID where the database will be deployed"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "List of private subnet IDs for the DB subnet group"
}

variable "db_instance_class" {
  type    = string
  default = "db.t3.micro"
  description = "RDS instance class"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
  description = "Storage size in GB"
}

variable "multi_az" {
  type    = bool
  default = false
}
`.trim(),
      outputsTf: `
output "db_endpoint" { value = aws_db_instance.main.endpoint }
output "db_name" { value = aws_db_instance.main.identifier }

# Standardized Outputs
output "endpoint" { value = aws_db_instance.main.address }
output "port" { value = aws_db_instance.main.port }
output "name" { value = aws_db_instance.main.db_name }
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
resource "google_sql_database_instance" "main" {
  name             = "\${var.project_name}-db"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = var.db_instance_class // e.g., db-f1-micro or db-custom-1-3840

    disk_size = var.db_allocated_storage
    disk_type = "PD_SSD"
    
    ip_configuration {
      ipv4_enabled = true
    }
    
    backup_configuration {
      enabled = true
    }
  }

  deletion_protection = false // For demo purposes
}

resource "google_sql_database" "database" {
  name     = "\${var.project_name}-schema"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "users" {
  name     = "dbadmin"
  instance = google_sql_database_instance.main.name
  password = "placeholder_password"
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}

variable "db_instance_class" {
  type    = string
  default = "db-f1-micro"
  description = "Cloud SQL tier"
}

variable "db_allocated_storage" {
  type    = number
  default = 10
  description = "Storage size in GB"
}
`.trim(),
      outputsTf: `
output "connection_name" { value = google_sql_database_instance.main.connection_name }
output "public_ip" { value = google_sql_database_instance.main.public_ip_address }
`.trim()
    };
  }

  if (p === 'azure') {
    return {
      mainTf: `
resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "\${var.project_name}-db-server"
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = "15"
  
  // Azure expects skuname like B_Standard_B1ms
  sku_name               = var.db_instance_class 
  storage_mb             = var.db_allocated_storage * 1024 

  administrator_login    = "dbadmin"
  administrator_password = "placeholder_password"
  zone                   = "1"

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "\${var.project_name}-db"
  server_id = azurerm_postgresql_flexible_server.main.id
  collation = "en_US.utf8"
  charset   = "utf8"
}
`.trim(),
      variablesTf: `
${renderStandardVariables('azure')}

variable "db_instance_class" {
  type    = string
  default = "B_Standard_B1ms" // Pricing tier
  description = "Azure PostgreSQL SKU"
}

variable "db_allocated_storage" {
  type    = number
  default = 32 // Min size for flexible server
  description = "Storage size in GB"
}
`.trim(),
      outputsTf: `
output "server_fqdn" { value = azurerm_postgresql_flexible_server.main.fqdn }
output "server_name" { value = azurerm_postgresql_flexible_server.main.name }
`.trim()
    };
  }

  return generateMinimalModule(p, 'relationaldatabase');
}

module.exports = { relationalDatabaseModule };
