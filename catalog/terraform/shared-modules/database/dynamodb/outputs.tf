output "table_arn" {
  value = try(aws_dynamodb_table.this[0].arn, "")
}

output "table_name" {
  value = try(aws_dynamodb_table.this[0].name, "")
}
