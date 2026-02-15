variable "enabled" {
  description = "Enable toggle"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "allow_admin_create_user_only" {
  description = "Whether to allow admin to create users only"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
