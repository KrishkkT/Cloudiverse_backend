resource "aws_db_subnet_group" "this" {
  count      = var.enabled ? 1 : 0
  name       = "${var.project_name}-rds-subnets"
  subnet_ids = var.private_subnet_ids

  tags = var.tags
}

resource "aws_security_group" "this" {
  count = var.enabled ? 1 : 0
  name  = "${var.project_name}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = var.engine == "postgres" ? 5432 : 3306
    to_port         = var.engine == "postgres" ? 5432 : 3306
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = var.tags
}

resource "aws_db_instance" "this" {
  count = var.enabled ? 1 : 0

  identifier = var.project_name
  engine     = var.engine
  engine_version = var.engine_version
  instance_class = var.instance_class
  allocated_storage = var.allocated_storage
  storage_type      = "gp2"

  db_name  = var.db_name
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.this[0].name
  vpc_security_group_ids = [aws_security_group.this[0].id]
  
  multi_az               = var.multi_az
  backup_retention_period = var.backup_retention_days
  skip_final_snapshot    = true # Careful for production, usually false

  tags = var.tags
}
