provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Environment = "Production"
      ManagedBy   = "Cloudiverse"
      LandingZone = "true"
    }
  }
}

# 1. Remote State Storage
resource "aws_s3_bucket" "state" {
  bucket_prefix = "cloudiverse-state-"
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket                  = aws_s3_bucket.state.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 2. State Locking
resource "aws_dynamodb_table" "lock" {
  name         = "cloudiverse-state-lock"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# 3. Execution Role
resource "aws_iam_role" "execution" {
  name = "CloudiverseExecutionRole"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = var.trusted_entities
        }
      }
    ]
  })
}

# 4. Standardized Permissions for Execution Role
resource "aws_iam_role_policy" "execution_policy" {
  name = "CloudiverseExecutionPolicy"
  role = aws_iam_role.execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = [
          "s3:*",
          "cloudfront:*",
          "ecs:*",
          "ecr:*",
          "rds:*",
          "elasticache:*",
          "iam:PassRole",
          "acm:*",
          "route53:*",
          "logs:*",
          "ec2:*",
          "dynamodb:*"
        ]
        Effect   = "Allow"
        Resource = "*"
      }
    ]
  })
}

# 5. Baseline Encryption (Shared KMS Key)
resource "aws_kms_key" "main" {
  description             = "Cloudiverse baseline encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}

resource "aws_kms_alias" "main" {
  name          = "alias/cloudiverse-main"
  target_key_id = aws_kms_key.main.key_id
}

# 6. Baseline Logging (CloudTrail)
resource "aws_s3_bucket" "audit_logs" {
  bucket_prefix = "cloudiverse-audit-logs-"
  force_destroy = false
}

resource "aws_s3_bucket_policy" "audit_logs_policy" {
  bucket = aws_s3_bucket.audit_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.audit_logs.arn
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.audit_logs.arn}/AWSLogs/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

resource "aws_cloudtrail" "main" {
  name                          = "cloudiverse-main-trail"
  s3_bucket_name                = aws_s3_bucket.audit_logs.id
  include_global_service_events = true
  is_multi_region_trail         = true
  enable_log_file_validation    = true
  kms_key_id                    = aws_kms_key.main.arn

  depends_on = [aws_s3_bucket_policy.audit_logs_policy]
}
