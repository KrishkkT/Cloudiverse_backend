resource "aws_codebuild_project" "this" {
  count = var.enabled ? 1 : 0

  name          = var.project_name
  service_role  = var.execution_role_arn

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
    type                        = "LINUX_CONTAINER"
    image_pull_credentials_type = "CODEBUILD"
    privileged_mode             = true

    dynamic "environment_variable" {
      for_each = var.environment_variables
      content {
        name  = environment_variable.key
        value = environment_variable.value
      }
    }
  }

  source {
    type      = var.source_type
    location  = var.source_location
    buildspec = var.buildspec
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "/aws/codebuild/${var.project_name}"
  retention_in_days = 14
}
