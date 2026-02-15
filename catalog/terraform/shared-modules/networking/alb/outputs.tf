output "alb_arn" {
  value = try(aws_lb.this[0].arn, "")
}

output "alb_dns_name" {
  value = try(aws_lb.this[0].dns_name, "")
}

output "http_listener_arn" {
  value = try(aws_lb_listener.http[0].arn, "")
}

output "alb_security_group_id" {
  value = try(aws_security_group.this[0].id, "")
}
