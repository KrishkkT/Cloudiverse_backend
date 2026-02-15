variable "enabled" {
  description = "Enable toggle"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "execution_role_arn" {
  description = "Execution role ARN from Landing Zone"
  type        = string
}

variable "handler" {
  description = "Function handler"
  type        = string
  default     = "index.handler"
}

variable "runtime" {
  description = "Lambda runtime"
  type        = string
  default     = "nodejs18.x"
}

variable "s3_bucket" {
  description = "S3 bucket containing the lambda code"
  type        = string
  default     = ""
}

variable "s3_key" {
  description = "S3 key for the lambda code"
  type        = string
  default     = ""
}

variable "environment_variables" {
  description = "Environment variables"
  type        = map(string)
  default     = {}
}

variable "memory_size" {
  description = "Memory size"
  type        = number
  default     = 128
}

variable "timeout" {
  description = "Timeout"
  type        = number
  default     = 30
}

variable "subnet_ids" {
  description = "Optional Subnet IDs for VPC integration"
  type        = list(string)
  default     = []
}

variable "security_group_ids" {
  description = "Optional Security Group IDs for VPC integration"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
