resource "aws_lb" "this" {
  count = var.enabled ? 1 : 0

  name               = "${var.project_name}-alb"
  internal           = var.internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.this[0].id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = false

  tags = var.tags
}

resource "aws_security_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-alb-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_lb_listener" "http" {
  count = var.enabled ? 1 : 0

  load_balancer_arn = aws_lb.this[0].arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not Found"
      status_code  = "404"
    }
  }
}
