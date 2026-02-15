resource "aws_dynamodb_table" "this" {
  count = var.enabled ? 1 : 0

  name         = var.project_name
  billing_mode = var.billing_mode
  hash_key     = var.hash_key
  range_key    = var.range_key != "" ? var.range_key : null

  dynamic "attribute" {
    for_each = var.attributes
    content {
      name = attribute.value.name
      type = attribute.value.type
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}
