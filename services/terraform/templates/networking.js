'use strict';

const { renderStandardVariables, generateMinimalModule } = require('./base');

/**
 * Fallback: minimal module that creates something real and pricable
 */
function networkingModule(provider) {
  const p = provider.toLowerCase();

  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags = {
    Name = "\${var.project_name}-vpc"
    Project = var.project_name
    Environment = var.environment
  }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = { Name = "\${var.project_name}-igw" }
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "\${var.region}a"
  map_public_ip_on_launch = true
  tags = { Name = "\${var.project_name}-public-a" }
}

resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.2.0/24"
  availability_zone       = "\${var.region}b"
  map_public_ip_on_launch = true
  tags = { Name = "\${var.project_name}-public-b" }
}

resource "aws_subnet" "private_a" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.10.0/24"
  availability_zone = "\${var.region}a"
  tags = { Name = "\${var.project_name}-private-a" }
}

resource "aws_subnet" "private_b" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.11.0/24"
  availability_zone = "\${var.region}b"
  tags = { Name = "\${var.project_name}-private-b" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "\${var.project_name}-public-rt" }
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}
resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = [aws_subnet.public_a.id, aws_subnet.public_b.id] }
output "private_subnet_ids" { value = [aws_subnet.private_a.id, aws_subnet.private_b.id] }
`.trim()
    };
  }

  return generateMinimalModule(p, 'vpcnetworking');
}

module.exports = { networkingModule, renderStandardVariables, generateMinimalModule };
