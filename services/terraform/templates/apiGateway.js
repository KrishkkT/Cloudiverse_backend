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

  if (p === 'gcp') {
    return {
      mainTf: `
resource "google_api_gateway_api" "main" {
  provider = google-beta
  api_id   = "\${var.project_name}-api"
}

resource "google_api_gateway_api_config" "main" {
  provider      = google-beta
  api           = google_api_gateway_api.main.api_id
  api_config_id = "\${var.project_name}-config"

  openapi_documents {
    document {
      path     = "spec.yaml"
      contents = filebase64("spec.yaml") # Placeholder - user needs to provide this
    }
  }
}

resource "google_api_gateway_gateway" "main" {
  provider   = google-beta
  api_config = google_api_gateway_api_config.main.id
  gateway_id = "\${var.project_name}-gateway"
  region     = var.region
}
`.trim(),
      variablesTf: renderStandardVariables('gcp'),
      outputsTf: `
output "gateway_url" {
  value = google_api_gateway_gateway.main.default_hostname
}
`.trim()
    };
  }

  // Azure API Management
  return {
    mainTf: `
resource "azurerm_api_management" "main" {
  name                = "apim-\${var.project_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  publisher_name      = "Cloudiverse"
  publisher_email     = "admin@cloudiverse.io"

  sku_name = "Consumption_0"

  tags = {
    Environment = "production"
  }
}
`.trim(),
    variablesTf: renderStandardVariables('azure'),
    outputsTf: `
output "apim_ur" {
  value = azurerm_api_management.main.gateway_url
}
`.trim()
  };
}

module.exports = { apiGatewayModule };
