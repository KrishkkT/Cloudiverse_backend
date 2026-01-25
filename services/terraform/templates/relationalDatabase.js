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

    return generateMinimalModule(p, 'relationaldatabase');
}

module.exports = { relationalDatabaseModule };
