output "execution_role_arn" {
  value       = aws_iam_role.execution.arn
  description = "The ARN of the IAM role to be assumed by workloads"
}

output "state_bucket_name" {
  value       = aws_s3_bucket.state.id
  description = "The name of the S3 bucket for remote state"
}

output "lock_table_name" {
  value       = aws_dynamodb_table.lock.name
  description = "The name of the DynamoDB table for state locking"
}

output "kms_key_arn" {
  value = aws_kms_key.main.arn
}

output "kms_key_id" {
  value = aws_kms_key.main.key_id
}

output "audit_logs_bucket" {
  value = aws_s3_bucket.audit_logs.id
}

output "region" {
  value = var.region
}
