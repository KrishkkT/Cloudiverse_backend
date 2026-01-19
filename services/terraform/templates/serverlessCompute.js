'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function serverlessComputeModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_iam_role" "lambda_role" {
  name = "\${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn  = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "main" {
  function_name = "\${var.project_name}-function"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  # Simplified for cost estimation
  s3_bucket = "lambda-placeholders"
  s3_key    = "placeholder.zip"

  tags = { Name = "\${var.project_name}-function" }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "function_name" { value = aws_lambda_function.main.function_name }
output "function_arn"  { value = aws_lambda_function.main.arn }
`.trim()
    };
  }

  if (p === 'azure') {
    return {
      mainTf: `
resource "random_id" "func_suffix" {
  byte_length = 4
}

resource "azurerm_storage_account" "func_store" {
  name                     = "stfunc\${var.project_name}\${random_id.func_suffix.hex}"
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "func_plan" {
  name                = "plan-\${var.project_name}-func"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption plan (pay-as-you-go)
}

resource "azurerm_linux_function_app" "main" {
  name                = "func-\${var.project_name}-\${random_id.func_suffix.hex}"
  resource_group_name = var.resource_group_name
  location            = var.location

  storage_account_name       = azurerm_storage_account.func_store.name
  storage_account_access_key = azurerm_storage_account.func_store.primary_access_key
  service_plan_id            = azurerm_service_plan.func_plan.id

  site_config {
    application_stack {
      node_version = "18" // Standard node version
    }
  }

  tags = {
    Project = var.project_name
  }
}
`.trim(),
      variablesTf: renderStandardVariables('azure'),
      outputsTf: `
output "function_app_name" {
  value = azurerm_linux_function_app.main.name
}
output "function_app_default_hostname" {
  value = azurerm_linux_function_app.main.default_hostname
}
`.trim()
    };
  }

  return generateMinimalModule(p, 'computeserverless');
}

module.exports = { serverlessComputeModule };
