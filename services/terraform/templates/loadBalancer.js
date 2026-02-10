'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

/**
 * Load Balancer Module - ALB / Cloud Load Balancing / Azure LB
 * Used for distributing traffic across compute instances
 */
function loadBalancerModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
# Application Load Balancer
resource "aws_lb" "main" {
  name               = "\${var.project_name}-alb"
  internal           = var.internal
  load_balancer_type = "application"
  security_groups    = [aws_security_group.lb.id]
  subnets            = var.public_subnet_ids

  enable_deletion_protection = var.enable_deletion_protection

  tags = {
    Name        = "\${var.project_name}-alb"
    Environment = var.environment
    ManagedBy   = "Cloudiverse"
  }
}

resource "aws_security_group" "lb" {
  name        = "\${var.project_name}-lb-sg"
  description = "Allow inbound traffic for ALB"
  vpc_id      = var.vpc_id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from anywhere"
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

  tags = {
    Name        = "\${var.project_name}-lb-sg"
  }
}

# Target Group
resource "aws_lb_target_group" "main" {
  name        = "\${var.project_name}-tg"
  port        = var.target_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = var.target_type

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    path                = var.health_check_path
    matcher             = "200-399"
  }

  tags = {
    Name        = "\${var.project_name}-tg"
    Environment = var.environment
  }
}

# HTTP Listener
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = var.redirect_to_https ? "redirect" : "forward"

    dynamic "redirect" {
      for_each = var.redirect_to_https ? [1] : []
      content {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }

    dynamic "forward" {
      for_each = var.redirect_to_https ? [] : [1]
      content {
        target_group {
          arn = aws_lb_target_group.main.arn
        }
      }
    }
  }
}

# HTTPS Listener (optional)
resource "aws_lb_listener" "https" {
  count             = var.certificate_arn != null ? 1 : 0
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.main.arn
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}

variable "internal" {
  type    = bool
  default = false
  description = "Whether the load balancer is internal"
}

variable "public_subnet_ids" {
  type    = list(string)
  default = []
  description = "Subnet IDs for the ALB"
}

variable "vpc_id" {
  type    = string
  description = "VPC ID for the target group"
}

variable "target_port" {
  type    = number
  default = 80
}

variable "target_type" {
  type    = string
  default = "ip"
  description = "instance, ip, or lambda"
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "enable_deletion_protection" {
  type    = bool
  default = false
}

variable "redirect_to_https" {
  type    = bool
  default = false
}

variable "certificate_arn" {
  type    = string
  default = null
  description = "ACM certificate ARN for HTTPS"
}
`.trim(),
      outputsTf: `
output "alb_arn" {
  value       = aws_lb.main.arn
  description = "ALB ARN"
}

output "alb_dns_name" {
  value       = aws_lb.main.dns_name
  description = "ALB DNS name"
}

output "target_group_arn" {
  value       = aws_lb_target_group.main.arn
  description = "Target group ARN"
}
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
# Global HTTP(S) Load Balancer components

# Backend Service
resource "google_compute_backend_service" "main" {
  name        = "\${var.project_name}-backend"
  protocol    = "HTTP"
  port_name   = "http"
  timeout_sec = 30

  health_checks = [google_compute_health_check.main.id]

  backend {
    group = var.instance_group
  }
}

# Health Check
resource "google_compute_health_check" "main" {
  name = "\${var.project_name}-health-check"

  http_health_check {
    port         = var.health_check_port
    request_path = var.health_check_path
  }

  check_interval_sec  = 10
  timeout_sec         = 5
  healthy_threshold   = 2
  unhealthy_threshold = 3
}

# URL Map
resource "google_compute_url_map" "main" {
  name            = "\${var.project_name}-url-map"
  default_service = google_compute_backend_service.main.id
}

# HTTP Proxy
resource "google_compute_target_http_proxy" "main" {
  name    = "\${var.project_name}-http-proxy"
  url_map = google_compute_url_map.main.id
}

# Global Forwarding Rule
resource "google_compute_global_forwarding_rule" "main" {
  name       = "\${var.project_name}-forwarding-rule"
  target     = google_compute_target_http_proxy.main.id
  port_range = "80"
}
`.trim(),
      variablesTf: `
${renderStandardVariables('gcp')}

variable "instance_group" {
  type        = string
  description = "Instance group URL for backend"
}

variable "health_check_port" {
  type    = number
  default = 80
}

variable "health_check_path" {
  type    = string
  default = "/health"
}
`.trim(),
      outputsTf: `
output "load_balancer_ip" {
  value       = google_compute_global_forwarding_rule.main.ip_address
  description = "Load balancer IP address"
}

output "backend_service_id" {
  value       = google_compute_backend_service.main.id
  description = "Backend service ID"
}
`.trim()
    };
  }

  // Azure
  return {
    mainTf: `
# Public IP for Load Balancer
resource "azurerm_public_ip" "lb" {
  name                = "\${var.project_name}-lb-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

# Load Balancer
resource "azurerm_lb" "main" {
  name                = "\${var.project_name}-lb"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "PublicIPAddress"
    public_ip_address_id = azurerm_public_ip.lb.id
  }

  tags = {
    Environment = "production"
    ManagedBy   = "Cloudiverse"
  }
}

# Backend Address Pool
resource "azurerm_lb_backend_address_pool" "main" {
  loadbalancer_id = azurerm_lb.main.id
  name            = "\${var.project_name}-backend-pool"
}

# Health Probe
resource "azurerm_lb_probe" "main" {
  loadbalancer_id = azurerm_lb.main.id
  name            = "\${var.project_name}-health-probe"
  protocol        = "Http"
  port            = var.health_check_port
  request_path    = var.health_check_path
}

# Load Balancing Rule
resource "azurerm_lb_rule" "main" {
  loadbalancer_id                = azurerm_lb.main.id
  name                           = "\${var.project_name}-lb-rule"
  protocol                       = "Tcp"
  frontend_port                  = 80
  backend_port                   = var.backend_port
  frontend_ip_configuration_name = "PublicIPAddress"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.main.id]
  probe_id                       = azurerm_lb_probe.main.id
}
`.trim(),
    variablesTf: `
${renderStandardVariables('azure')}

variable "health_check_port" {
  type    = number
  default = 80
}

variable "health_check_path" {
  type    = string
  default = "/health"
}

variable "backend_port" {
  type    = number
  default = 80
}
`.trim(),
    outputsTf: `
output "lb_id" {
  value       = azurerm_lb.main.id
  description = "Load balancer ID"
}

output "lb_public_ip" {
  value       = azurerm_public_ip.lb.ip_address
  description = "Load balancer public IP"
}

output "backend_pool_id" {
  value       = azurerm_lb_backend_address_pool.main.id
  description = "Backend address pool ID"
}
`.trim()
  };
}

module.exports = { loadBalancerModule };
