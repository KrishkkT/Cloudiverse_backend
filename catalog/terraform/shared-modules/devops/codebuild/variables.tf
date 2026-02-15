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

variable "source_location" {
  description = "Source code location (S3 or Github URL)"
  type        = string
}

variable "source_type" {
  description = "Source type (S3 or GITHUB)"
  type        = string
  default     = "GITHUB"
}

variable "buildspec" {
  description = "Buildspec file or inline definition"
  type        = string
  default     = "buildspec.yml"
}

variable "environment_variables" {
  description = "Environment variables for the build"
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
