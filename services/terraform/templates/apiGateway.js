'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function apiGatewayModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_apigatewayv2_api" "main" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-Api-Key"]
    max_age       = 300
  }

  tags = { Name = "\${var.project_name}-api" }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/\${var.project_name}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "api_endpoint" { value = aws_apigatewayv2_api.main.api_endpoint }
output "api_id" { value = aws_apigatewayv2_api.main.id }
`.trim()
    };
  }

  return generateMinimalModule(p, 'apigateway');
}

module.exports = { apiGatewayModule };
