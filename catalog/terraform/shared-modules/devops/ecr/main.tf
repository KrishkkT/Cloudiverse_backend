resource "aws_ecr_repository" "this" {
  count = var.enabled ? 1 : 0
  name  = var.project_name

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  force_delete = true

  tags = var.tags
}

resource "aws_ecr_lifecycle_policy" "this" {
  count      = var.enabled ? 1 : 0
  repository = aws_ecr_repository.this[0].name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
