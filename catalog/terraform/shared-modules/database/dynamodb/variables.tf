variable "enabled" {
  description = "Enable toggle"
  type        = bool
  default     = true
}

variable "project_name" {
  description = "Project name"
  type        = string
}

variable "billing_mode" {
  description = "Billing mode (PAY_PER_REQUEST or PROVISIONED)"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "hash_key" {
  description = "Partition key name"
  type        = string
  default     = "id"
}

variable "range_key" {
  description = "Sort key name (optional)"
  type        = string
  default     = ""
}

variable "attributes" {
  description = "List of nested attribute definitions"
  type        = list(map(string))
  default     = [{ name = "id", type = "S" }]
}

variable "tags" {
  description = "Tags"
  type        = map(string)
  default     = {}
}
