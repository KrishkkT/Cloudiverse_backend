'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

/**
 * Compute Container Module - ECS Fargate / Cloud Run / Container Apps
 * Used for containerized workloads in stateful web platforms
 */
function computeContainerModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
# ECS Cluster for container workloads
resource "aws_ecs_cluster" "main" {
  name = "\${var.project_name}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name        = "\${var.project_name}-cluster"
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

# --- Networking & Security ---
# ALB Security Group: Allow HTTP from anywhere
resource "aws_security_group" "alb" {
  name        = "\${var.project_name}-alb-sg"
  description = "ALB Public Access"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "\${var.project_name}-alb-sg"
    Environment = var.environment
  }
}

# ECS Security Group: Allow traffic only from ALB
resource "aws_security_group" "ecs" {
  name        = "\${var.project_name}-ecs-sg"
  description = "ECS Task Access"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = var.container_port
    to_port         = var.container_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "\${var.project_name}-ecs-sg"
    Environment = var.environment
  }
}

# --- Load Balancer ---
resource "aws_lb" "main" {
  name               = "\${var.project_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids
  
  enable_deletion_protection = false

  tags = {
    Name        = "\${var.project_name}-alb"
    Environment = var.environment
  }
}

resource "aws_lb_target_group" "main" {
  name        = "\${var.project_name}-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 5
    matcher             = "200"
  }

  tags = {
    Name        = "\${var.project_name}-tg"
    Environment = var.environment
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}

# ECS Task Definition (Fargate)
resource "aws_ecs_task_definition" "app" {
  family                   = "\${var.project_name}-task"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.container_cpu
  memory                   = var.container_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_execution.arn

  container_definitions = jsonencode([{
    name      = "\${var.project_name}-container"
    image     = var.container_image
    essential = true
    portMappings = [{
      containerPort = var.container_port
      hostPort      = var.container_port
      protocol      = "tcp"
    }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = "/ecs/\${var.project_name}"
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])

  tags = {
    Name        = "\${var.project_name}-task"
    Environment = var.environment
  }
}

# ECS Execution Role
resource "aws_iam_role" "ecs_execution" {
  name = "\${var.project_name}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ecs-tasks.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# CloudWatch Log Group for ECS
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/\${var.project_name}"
  retention_in_days = 30

  tags = {
    Name        = "\${var.project_name}-ecs-logs"
    Environment = var.environment
  }
}

# ECS Service
resource "aws_ecs_service" "app" {
  name            = "\${var.project_name}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = var.public_subnet_ids # Using public subnets for Fargate to avoid NAT Gateway costs/complexity for now
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.main.arn
    container_name   = "\${var.project_name}-container"
    container_port   = var.container_port
  }

  depends_on = [aws_lb_listener.http]
}
`.trim(),
      variablesTf: `
\${renderStandardVariables('aws')}

variable "container_cpu" {
  type    = number
  default = 256
  description = "Fargate CPU units (256 = 0.25 vCPU)"
}

variable "container_memory" {
  type    = number
  default = 512
  description = "Fargate memory in MB"
}

variable "container_image" {
  type    = string
  default = "nginx:latest"
  description = "Container image to deploy"
}

variable "container_port" {
  type    = number
  default = 80
  description = "Port exposed by the container"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID for container networking"
}

variable "private_subnet_ids" {
  type        = list(string)
  default     = []
  description = "Private Subnet IDs for container networking"
}

variable "public_subnet_ids" {
  type        = list(string)
  default     = []
  description = "Public Subnet IDs for container networking"
}
`.trim(),
      outputsTf: `
output "cluster_id" {
  value       = aws_ecs_cluster.main.id
  description = "ECS Cluster ID"
}

output "cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS Cluster Name"
}

output "task_definition_arn" {
  value       = aws_ecs_task_definition.app.arn
  description = "ECS Task Definition ARN"
}

output "url" {
  value       = aws_lb.main.dns_name
  description = "Load Balancer DNS Name"
}

output "load_balancer_dns" {
  value       = aws_lb.main.dns_name
  description = "Load Balancer DNS Name"
}

output "service_endpoint" {
  value       = aws_lb.main.dns_name
  description = "Service Endpoint"
}
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
# Cloud Run Service
resource "google_cloud_run_service" "main" {
  name     = "\${var.project_name}-service"
  location = var.region
  
  template {
    spec {
      containers {
        image = var.container_image
        ports {
          container_port = var.container_port
        }
        resources {
          limits = {
            cpu    = var.container_cpu
            memory = var.container_memory
          }
        }
      }
    }
  }

  traffic {
    percent         = 100
    latest_revision = true
  }
}

# Allow unauthenticated access (optional, controlled by variable)
resource "google_cloud_run_service_iam_member" "public" {
  count    = var.allow_unauthenticated ? 1 : 0
  service  = google_cloud_run_service.main.name
  location = google_cloud_run_service.main.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}

variable "container_image" {
  type    = string
  default = "gcr.io/cloudrun/hello"
  description = "Container image to deploy"
}

variable "container_port" {
  type    = number
  default = 8080
}

variable "container_cpu" {
  type    = string
  default = "1"
}

variable "container_memory" {
  type    = string
  default = "512Mi"
}

variable "allow_unauthenticated" {
  type    = bool
  default = false
}

variable "vpc_id" {
  type        = string
  default     = ""
  description = "VPC ID (optional for Cloud Run)"
}

variable "private_subnet_ids" {
  type        = list(string)
  default     = []
  description = "Private Subnet IDs (optional for Cloud Run)"
}
`.trim(),
      outputsTf: `
output "service_url" {
  value       = google_cloud_run_service.main.status[0].url
  description = "Cloud Run service URL"
}

output "url" {
  value       = google_cloud_run_service.main.status[0].url
  description = "Standardized URL output"
}

output "service_name" {
  value       = google_cloud_run_service.main.name
  description = "Cloud Run service name"
}
`.trim()
    };
  }

  // Azure
  return {
    mainTf: `
# Container Apps Environment
resource "azurerm_container_app_environment" "main" {
  name                = "\${var.project_name}-env"
  location            = var.location
  resource_group_name = var.resource_group_name

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

# Container App
resource "azurerm_container_app" "main" {
  name                         = "\${var.project_name}-app"
  container_app_environment_id = azurerm_container_app_environment.main.id
  resource_group_name          = var.resource_group_name
  revision_mode                = "Single"

  template {
    container {
      name   = "\${var.project_name}-container"
      image  = var.container_image
      cpu    = var.container_cpu
      memory = var.container_memory

      liveness_probe {
        port      = var.container_port
        transport = "TCP"
      }
    }

    min_replicas = 1
    max_replicas = 10
  }

  ingress {
    external_enabled = true
    target_port      = var.container_port
    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}
`.trim(),
    variablesTf: `
${renderStandardVariables('azure')}

variable "container_image" {
  type    = string
  default = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "container_cpu" {
  type    = number
  default = 0.25
}

variable "container_memory" {
  type    = string
  default = "0.5Gi"
}

variable "container_port" {
  type    = number
  default = 80
}

variable "vpc_id" {
  type        = string
  default     = ""
  description = "VPC ID (optional)"
}

variable "private_subnet_ids" {
  type        = list(string)
  default     = []
  description = "Private Subnet IDs (optional)"
}
`.trim(),
    outputsTf: `
output "app_fqdn" {
  value       = azurerm_container_app.main.latest_revision_fqdn
  description = "Container App FQDN"
}

output "url" {
  value       = "https://\${azurerm_container_app.main.latest_revision_fqdn}"
  description = "Standardized URL output"
}

output "app_name" {
  value       = azurerm_container_app.main.name
  description = "Container App name"
}
`.trim()
  };
}

module.exports = { computeContainerModule };
