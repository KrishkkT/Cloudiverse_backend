output "user_pool_id" {
  value = try(aws_cognito_user_pool.this[0].id, "")
}

output "user_pool_client_id" {
  value = try(aws_cognito_user_pool_client.this[0].id, "")
}

output "user_pool_arn" {
  value = try(aws_cognito_user_pool.this[0].arn, "")
}
