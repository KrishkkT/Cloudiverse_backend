resource "aws_lambda_function" "this" {
  count = var.enabled ? 1 : 0

  function_name = var.project_name
  role          = var.execution_role_arn
  handler       = var.handler
  runtime       = var.runtime
  memory_size   = var.memory_size
  timeout       = var.timeout

  s3_bucket = var.s3_bucket
  s3_key    = var.s3_key

  dynamic "environment" {
    for_each = length(var.environment_variables) > 0 ? [1] : []
    content {
      variables = var.environment_variables
    }
  }

  dynamic "vpc_config" {
    for_each = length(var.subnet_ids) > 0 ? [1] : []
    content {
      subnet_ids         = var.subnet_ids
      security_group_ids = var.security_group_ids
    }
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "/aws/lambda/${var.project_name}"
  retention_in_days = 14
}
