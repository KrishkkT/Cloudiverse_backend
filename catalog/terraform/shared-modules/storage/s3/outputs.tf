output "bucket_id" {
  value = try(aws_s3_bucket.this[0].id, "")
}

output "bucket_arn" {
  value = try(aws_s3_bucket.this[0].arn, "")
}

output "bucket_domain_name" {
  value = try(aws_s3_bucket.this[0].bucket_domain_name, "")
}
