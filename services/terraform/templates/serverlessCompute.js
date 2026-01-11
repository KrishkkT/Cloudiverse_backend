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

  return generateMinimalModule(p, 'computeserverless');
}

module.exports = { serverlessComputeModule };
