output "lambda_arn" {
  value = try(aws_lambda_function.this[0].arn, "")
}

output "lambda_name" {
  value = try(aws_lambda_function.this[0].function_name, "")
}

output "invoke_arn" {
  value = try(aws_lambda_function.this[0].invoke_arn, "")
}
