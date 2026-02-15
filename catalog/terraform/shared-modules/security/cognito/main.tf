resource "aws_cognito_user_pool" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-user-pool"

  admin_create_user_config {
    allow_admin_create_user_only = var.allow_admin_create_user_only
  }

  password_policy {
    minimum_length    = 8
    require_lowercase = true
    require_numbers   = true
    require_symbols   = true
    require_uppercase = true
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-client"

  user_pool_id = aws_cognito_user_pool.this[0].id

  explicit_auth_flows = [
    "ALLOW_USER_PASSWORD_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH"
  ]

  prevent_user_existence_errors = "ENABLED"
}
