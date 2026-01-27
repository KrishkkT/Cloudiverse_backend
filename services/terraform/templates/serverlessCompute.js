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
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "main" {
  function_name = "\${var.project_name}-function"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  memory_size   = var.function_memory
  timeout       = 10

  # Simplified for cost estimation
  s3_bucket = "lambda-placeholders"
  s3_key    = "placeholder.zip"

  tags = { Name = "\${var.project_name}-function" }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}
variable "function_memory" {
  type    = number
  default = 128
  description = "Memory size in MB"
}
`.trim(),
      outputsTf: `
output "function_name" { value = aws_lambda_function.main.function_name }
output "function_arn"  { value = aws_lambda_function.main.arn }
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
resource "google_cloudfunctions2_function" "main" {
  name        = "\${var.project_name}-func"
  location    = var.region
  description = "Cloud Function"

  build_config {
    runtime     = "nodejs18"
    entry_point = "helloHttp"
    source {
      storage_source {
        bucket = "placeholder-bucket"
        object = "placeholder-object"
      }
    }
  }

  service_config {
    max_instance_count = 10
    available_memory   = "\${var.function_memory}M"
    timeout_seconds    = 60
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}
variable "function_memory" {
  type    = number
  default = 256
  description = "Memory size in MB"
}
`.trim(),
      outputsTf: `
output "function_uri" { value = google_cloudfunctions2_function.main.service_config[0].uri }
`.trim()
    };
  }

  if (p === 'azure') {
    return {
      mainTf: `
resource "azurerm_storage_account" "func" {
  name                     = replace("\${var.project_name}funcsa", "-", "")
  resource_group_name      = var.resource_group_name
  location                 = var.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}

resource "azurerm_service_plan" "func" {
  name                = "\${var.project_name}-plan"
  resource_group_name = var.resource_group_name
  location            = var.location
  os_type             = "Linux"
  sku_name            = "Y1" # Consumption plan
}

resource "azurerm_linux_function_app" "main" {
  name                = "\${var.project_name}-func"
  resource_group_name = var.resource_group_name
  location            = var.location

  storage_account_name       = azurerm_storage_account.func.name
  storage_account_access_key = azurerm_storage_account.func.primary_access_key
  service_plan_id            = azurerm_service_plan.func.id

  site_config {}
}
`.trim(),
      variablesTf: `
${renderStandardVariables('azure')}
// Azure Consumption plan doesn't really have configurable memory per function in the same way, usually dynamic up to 1.5GB
variable "function_memory" {
  type    = number
  default = 128
  description = "Unused for Consumption Plan but kept for consistency"
}
`.trim(),
      outputsTf: `
output "function_app_name" { value = azurerm_linux_function_app.main.name }
`.trim()
    };
  }

  return generateMinimalModule(p, 'computeserverless');
}

module.exports = { serverlessComputeModule };
