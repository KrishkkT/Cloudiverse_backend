variable "region" {
  type        = string
  description = "AWS region for the landing zone"
  default     = "ap-south-1"
}

variable "trusted_entities" {
  type        = list(string)
  description = "ARNs of users or roles that can assume the execution role"
}
