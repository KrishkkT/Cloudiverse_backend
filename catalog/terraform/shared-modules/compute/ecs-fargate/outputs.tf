output "cluster_name" {
  value = try(aws_ecs_cluster.this[0].name, "")
}

output "service_name" {
  value = try(aws_ecs_service.this[0].name, "")
}

output "task_definition_arn" {
  value = try(aws_ecs_task_definition.this[0].arn, "")
}
