output "project_name" {
  value = try(aws_codebuild_project.this[0].name, "")
}

output "project_arn" {
  value = try(aws_codebuild_project.this[0].arn, "")
}
