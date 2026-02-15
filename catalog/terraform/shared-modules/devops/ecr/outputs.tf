output "repository_url" {
  value = try(aws_ecr_repository.this[0].repository_url, "")
}

output "repository_name" {
  value = try(aws_ecr_repository.this[0].name, "")
}

output "repository_arn" {
  value = try(aws_ecr_repository.this[0].arn, "")
}
