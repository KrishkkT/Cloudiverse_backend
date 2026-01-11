'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

function objectStorageModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_s3_bucket" "main" {
  bucket = "\${var.project_name}-storage"
  tags   = { Name = "\${var.project_name}-storage" }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "bucket_name" { value = aws_s3_bucket.main.id }
output "bucket_arn"  { value = aws_s3_bucket.main.arn }
`.trim()
    };
  }

  return generateMinimalModule(p, 'objectstorage');
}

module.exports = { objectStorageModule };
