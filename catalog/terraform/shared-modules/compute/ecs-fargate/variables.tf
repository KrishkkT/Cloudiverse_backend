variable "enabled" {
  description = "Enable toggle"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "vpc_id" {
  description = "VPC ID"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs"
  type        = list(string)
}

variable "execution_role_arn" {
  description = "Execution role ARN from Landing Zone"
  type        = string
}

variable "container_image" {
  description = "Docker image to deploy"
  type        = string
}

variable "container_port" {
  description = "Port exposed by the container"
  type        = number
  default     = 80
}

variable "cpu" {
  description = "vCPU units (1024 = 1 vCPU)"
  type        = number
  default     = 256
}

variable "memory" {
  description = "Memory (MiB)"
  type        = number
  default     = 512
}

variable "desired_count" {
  description = "Number of tasks to run"
  type        = number
  default     = 1
}

variable "target_group_arn" {
  description = "Optional Target Group ARN for LB integration"
  type        = string
  default     = ""
}

variable "alb_listener_arn" {
  description = "Optional ALB Listener ARN to attach to"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
