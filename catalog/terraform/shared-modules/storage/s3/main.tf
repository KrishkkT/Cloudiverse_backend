resource "aws_s3_bucket" "this" {
  count = var.enabled ? 1 : 0

  bucket_prefix = var.bucket_prefix != "" ? var.bucket_prefix : "${var.project_name}-"
  force_destroy = var.force_destroy

  tags = var.tags
}

resource "aws_s3_bucket_versioning" "this" {
  count = var.enabled ? 1 : 0
  bucket = aws_s3_bucket.this[0].id
  versioning_configuration {
    status = var.versioning ? "Enabled" : "Disabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  count = var.enabled ? 1 : 0
  bucket = aws_s3_bucket.this[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  count = var.enabled ? 1 : 0
  bucket = aws_s3_bucket.this[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
