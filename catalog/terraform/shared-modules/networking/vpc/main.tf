resource "aws_vpc" "this" {
  count = var.enabled ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(
    {
      Name = "${var.project_name}-vpc"
    },
    var.tags
  )
}

resource "aws_subnet" "public" {
  count = var.enabled ? length(var.public_subnet_cidrs) : 0

  vpc_id                  = aws_vpc.this[0].id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = merge(
    {
      Name = "${var.project_name}-public-${count.index}"
    },
    var.tags
  )
}

resource "aws_subnet" "private" {
  count = var.enabled ? length(var.private_subnet_cidrs) : 0

  vpc_id            = aws_vpc.this[0].id
  cidr_block        = var.private_subnet_cidrs[count.index]
  availability_zone = var.availability_zones[count.index]

  tags = merge(
    {
      Name = "${var.project_name}-private-${count.index}"
    },
    var.tags
  )
}

resource "aws_internet_gateway" "this" {
  count = var.enabled ? 1 : 0

  vpc_id = aws_vpc.this[0].id

  tags = merge(
    {
      Name = "${var.project_name}-igw"
    },
    var.tags
  )
}

resource "aws_route_table" "public" {
  count = var.enabled ? 1 : 0

  vpc_id = aws_vpc.this[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this[0].id
  }

  tags = merge(
    {
      Name = "${var.project_name}-public-rt"
    },
    var.tags
  )
}

resource "aws_route_table_association" "public" {
  count = var.enabled ? length(var.public_subnet_cidrs) : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}
