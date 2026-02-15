resource "aws_ecs_cluster" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = var.tags
}

resource "aws_cloudwatch_log_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "/ecs/${var.project_name}"
  retention_in_days = 30
}

resource "aws_ecs_task_definition" "this" {
  count = var.enabled ? 1 : 0

  family                   = var.project_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.execution_role_arn

  container_definitions = jsonencode([
    {
      name      = var.project_name
      image     = var.container_image
      essential = true
      portMappings = [
        {
          containerPort = var.container_port
          hostPort      = var.container_port
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.this[0].name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])
}

resource "aws_lb_target_group" "this" {
  count       = (var.enabled && var.alb_listener_arn != "") ? 1 : 0
  name        = "${var.project_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 10
  }

  tags = var.tags
}

resource "aws_lb_listener_rule" "this" {
  count        = (var.enabled && var.alb_listener_arn != "") ? 1 : 0
  listener_arn = var.alb_listener_arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.this[0].arn
  }

  condition {
    path_pattern {
      values = ["/*"]
    }
  }
}

resource "aws_ecs_service" "this" {
  count = var.enabled ? 1 : 0

  name            = var.project_name
  cluster         = aws_ecs_cluster.this[0].id
  task_definition = aws_ecs_task_definition.this[0].arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = var.private_subnet_ids
    security_groups = [aws_security_group.this[0].id]
  }

  dynamic "load_balancer" {
    for_each = (var.target_group_arn != "" || var.alb_listener_arn != "") ? [1] : []
    content {
      target_group_arn = var.alb_listener_arn != "" ? aws_lb_target_group.this[0].arn : var.target_group_arn
      container_name   = var.project_name
      container_port   = var.container_port
    }
  }

  tags = var.tags
}

resource "aws_security_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-ecs-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port   = var.container_port
    to_port     = var.container_port
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Should be restricted in production to LB SG
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

data "aws_region" "current" {}
