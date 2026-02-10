'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function cdnModule(provider) {
    const p = provider.toLowerCase();

    if (p === 'aws') {
        return {
            mainTf: `
resource "aws_cloudfront_origin_access_control" "default" {
  name                              = "\${var.project_name}-oac"
  description                       = "OAC for \${var.project_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  origin {
    domain_name              = var.bucket_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.default.id
    origin_id                = "S3-\${var.bucket_name}"
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-\${var.bucket_name}"

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name        = "\${var.project_name}-cdn"
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_s3_bucket_policy" "cdn_access" {
  bucket = var.bucket_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontServicePrincipal"
        Effect    = "Allow"
        Principal = {
          Service = "cloudfront.amazonaws.com"
        }
        Action    = "s3:GetObject"
        Resource  = "\${var.bucket_arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.main.arn
          }
        }
      }
    ]
  })
}
`.trim(),
            variablesTf: `
variable "project_name" { type = string }
variable "region" { type = string }
variable "environment" { type = string default = "production" }
variable "bucket_name" { type = string }
variable "bucket_arn" { type = string }
variable "bucket_domain_name" { type = string }
`.trim(),
            outputsTf: `
output "id" { value = aws_cloudfront_distribution.main.id }
output "arn" { value = aws_cloudfront_distribution.main.arn }
output "endpoint" { value = aws_cloudfront_distribution.main.domain_name }
`.trim()
        };
    }

    return generateMinimalModule(p, 'cdn');
}

module.exports = { cdnModule };
