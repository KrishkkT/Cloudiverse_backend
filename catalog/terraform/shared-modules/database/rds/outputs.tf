output "db_endpoint" {
  value = try(aws_db_instance.this[0].endpoint, "")
}

output "db_port" {
  value = try(aws_db_instance.this[0].port, 0)
}

output "db_id" {
  value = try(aws_db_instance.this[0].id, "")
}
