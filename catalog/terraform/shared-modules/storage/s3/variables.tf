variable "enabled" {
  description = "Enable toggle"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "bucket_prefix" {
  description = "Bucket prefix"
  type        = string
  default     = ""
}

variable "force_destroy" {
  description = "Enable force destroy"
  type        = bool
  default     = false
}

variable "versioning" {
  description = "Enable versioning"
  type        = bool
  default     = true
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
