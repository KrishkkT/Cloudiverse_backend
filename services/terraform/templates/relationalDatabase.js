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
  instance_class         = "db.t3.micro"
  allocated_storage      = 20
  storage_type           = "gp3"
  username               = "dbadmin"
  password               = "placeholder_password"
  skip_final_snapshot    = true
}
`.trim(),
            variablesTf: renderStandardVariables('aws'),
            outputsTf: `
output "db_endpoint" { value = aws_db_instance.main.endpoint }
output "db_name" { value = aws_db_instance.main.identifier }
`.trim()
        };
    }

    if (p === 'azure') {
        return {
            mainTf: `
resource "random_password" "password" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "psql-\${var.project_name}"
  resource_group_name    = var.resource_group_name
  location               = var.location
  version                = "13"
  administrator_login    = "psqladmin"
  administrator_password = random_password.password.result
  
  storage_mb   = 32768
  storage_tier = "P4"
  sku_name     = "B_Standard_B1ms" # Burstable 1 vCore

  tags = {
    Project = var.project_name
  }
}

resource "azurerm_postgresql_flexible_server_configuration" "postgres_off" {
  name      = "require_secure_transport"
  server_id = azurerm_postgresql_flexible_server.main.id
  value     = "off"
}
`.trim(),
            variablesTf: renderStandardVariables('azure'),
            outputsTf: `
output "db_server_name" {
  value = azurerm_postgresql_flexible_server.main.name
}
output "db_fqdn" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}
`.trim()
        };
    }

    return generateMinimalModule(p, 'relationaldatabase');
}

module.exports = { relationalDatabaseModule };
