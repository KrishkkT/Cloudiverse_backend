/**
 * backend/terraform/modules.js
 *
 * Terraform Module Registry (SSOT-driven)
 * ------------------------------------------------------------
 * Goal:
 * - Select the right Terraform module generator using ONLY the catalog:
 *     catalog[serviceId].terraform.moduleId
 * - No hardcoded SUPPORTED_SERVICES list.
 * - Graceful fallback to minimal modules so new services don't crash the system.
 *
 * Contract:
 * - Each module generator returns:
 *    { mainTf: string, variablesTf: string, outputsTf: string }
 *
 * Notes:
 * - This file should NOT contain service lists. Only module families.
 * - Service -> module family mapping lives in catalog.
 */

'use strict';

const path = require('path');

const catalog = require('./services');

const SUPPORTED_PROVIDERS = ['aws', 'gcp', 'azure'];

function assertProvider(provider) {
  const p = String(provider || '').toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(p)) {
    throw new Error(`Unsupported provider '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
  }
  return p;
}

function tfSafeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function renderStandardVariables(provider) {
  if (provider === 'aws') {
    return `
variable "project_name" { type = string }
variable "region" { type = string  default = "us-east-1" }
variable "environment" { type = string default = "production" }
`.trim();
  }

  if (provider === 'gcp') {
    return `
variable "project_name" { type = string }
variable "project_id"   { type = string }
variable "region"       { type = string default = "us-central1" }
`.trim();
  }

  // azure
  return `
variable "project_name"       { type = string }
variable "location"           { type = string default = "eastus" }
variable "resource_group_name" { type = string }
`.trim();
}

/**
 * Fallback: minimal module that creates something real and pricable,
 * but not "wrong" for any specific service.
 *
 * This mirrors your idea in paste.txt: create a minimal resource for each provider. [file:56]
 */
function generateMinimalModule(provider, serviceId) {
  const p = assertProvider(provider);
  const name = tfSafeName(serviceId);

  if (p === 'aws') {
    return {
      mainTf: `
/*
 * Minimal AWS placeholder for '${serviceId}'
 * Used when no dedicated module exists yet.
 */
resource "aws_eip" "${name}" {
  domain = "vpc"
  tags = {
    Name = "\${var.project_name}-${name}"
    Project = var.project_name
    Environment = var.environment
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "${name}_id" {
  value = aws_eip.${name}.id
}
`.trim()
    };
  }

  if (p === 'gcp') {
    return {
      mainTf: `
/*
 * Minimal GCP placeholder for '${serviceId}'
 */
resource "google_compute_address" "${name}" {
  name   = "\${var.project_name}-${name}-address"
  region = var.region
}
`.trim(),
      variablesTf: renderStandardVariables('gcp'),
      outputsTf: `
output "${name}_id" {
  value = google_compute_address.${name}.id
}
`.trim()
    };
  }

  // azure
  return {
    mainTf: `
/*
 * Minimal Azure placeholder for '${serviceId}'
 */
resource "azurerm_public_ip" "${name}" {
  name                = "\${var.project_name}-${name}-ip"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Dynamic"
}
`.trim(),
    variablesTf: renderStandardVariables('azure'),
    outputsTf: `
output "${name}_id" {
  value = azurerm_public_ip.${name}.id
}
`.trim()
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core module families (AWS implemented richly; GCP/Azure minimal or partial)
// Expand over time without touching service lists.
// ─────────────────────────────────────────────────────────────────────────────

function module_networking(provider) {
  const p = assertProvider(provider);

  // AWS: VPC + public/private subnets baseline (based on your draft) [file:56]
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

  // For now: fallback minimal for gcp/azure (upgrade later)
  return generateMinimalModule(p, 'networking');
}

function module_api_gateway(provider) {
  const p = assertProvider(provider);

  // AWS API Gateway v2 baseline (based on your draft) [file:56]
  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_apigatewayv2_api" "main" {
  name          = "\${var.project_name}-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    allow_headers = ["Content-Type", "Authorization", "X-Api-Key"]
    max_age       = 300
  }

  tags = { Name = "\${var.project_name}-api" }
}

resource "aws_cloudwatch_log_group" "api_logs" {
  name              = "/aws/apigateway/\${var.project_name}"
  retention_in_days = 14
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_logs.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
    })
  }

  default_route_settings {
    throttling_burst_limit = var.rate_limit_rps * 2
    throttling_rate_limit  = var.rate_limit_rps
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}

variable "rate_limit_rps" { type = number default = 1000 }
`.trim(),
      outputsTf: `
output "api_endpoint" { value = aws_apigatewayv2_api.main.api_endpoint }
output "api_id" { value = aws_apigatewayv2_api.main.id }
`.trim()
    };
  }

  return generateMinimalModule(p, 'api_gateway');
}

function module_serverless_compute(provider) {
  const p = assertProvider(provider);

  // AWS Lambda baseline (based on your draft) [file:56]
  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_iam_role" "lambda_role" {
  name = "\${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda_role.name
  policy_arn  = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "main" {
  function_name = "\${var.project_name}-function"
  role          = aws_iam_role.lambda_role.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"

  filename      = "lambda-placeholder.zip"
  source_code_hash = filebase64sha256("lambda-placeholder.zip")

  memory_size   = var.memory_mb
  timeout       = var.timeout_seconds

  environment {
    variables = {
      ENVIRONMENT = var.environment
    }
  }

  tags = { Name = "\${var.project_name}-function" }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}
variable "memory_mb" { type = number default = 256 }
variable "timeout_seconds" { type = number default = 30 }
`.trim(),
      outputsTf: `
output "function_name" { value = aws_lambda_function.main.function_name }
output "function_arn"  { value = aws_lambda_function.main.arn }
`.trim()
    };
  }

  return generateMinimalModule(p, 'compute_serverless');
}

function module_object_storage(provider) {
  const p = assertProvider(provider);

  // AWS S3 hardened baseline (based on your draft) [file:56]
  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_s3_bucket" "main" {
  bucket = "\${var.project_name}-storage"
  tags   = { Name = "\${var.project_name}-storage" }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
    bucket_key_enabled = true
  }
}
`.trim(),
      variablesTf: renderStandardVariables('aws'),
      outputsTf: `
output "bucket_name" { value = aws_s3_bucket.main.id }
output "bucket_arn"  { value = aws_s3_bucket.main.arn }
`.trim()
    };
  }

  return generateMinimalModule(p, 'object_storage');
}

function module_relational_database(provider) {
  const p = assertProvider(provider);

  // AWS RDS hardened baseline (based on your draft) [file:56]
  if (p === 'aws') {
    return {
      mainTf: `
resource "aws_db_subnet_group" "main" {
  name       = "\${var.project_name}-db-subnets"
  subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "db" {
  name        = "\${var.project_name}-db-sg"
  description = "DB access"
  vpc_id      = var.vpc_id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "random_password" "db" {
  length  = 16
  special = true
}

resource "aws_db_instance" "main" {
  identifier             = "\${var.project_name}-db"
  engine                 = "postgres"
  engine_version         = "15.3"
  instance_class         = var.instance_class
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = var.encryption_at_rest
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  username               = "dbadmin"
  password               = random_password.db.result
  backup_retention_period = var.backup_retention_days
  deletion_protection    = var.deletion_protection
  multi_az               = var.multi_az

  skip_final_snapshot    = false
  final_snapshot_identifier = "\${var.project_name}-db-final"
}

resource "aws_secretsmanager_secret" "db_password" {
  name = "\${var.project_name}-db-password"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = aws_db_instance.main.username
    password = random_password.db.result
    engine   = "postgres"
    host     = aws_db_instance.main.address
    port     = aws_db_instance.main.port
    dbname   = aws_db_instance.main.db_name
  })
}
`.trim(),
      variablesTf: `
${renderStandardVariables('aws')}
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = list(string) }

variable "instance_class" { type = string default = "db.t3.micro" }
variable "encryption_at_rest" { type = bool default = true }
variable "backup_retention_days" { type = number default = 7 }
variable "deletion_protection" { type = bool default = true }
variable "multi_az" { type = bool default = false }
`.trim(),
      outputsTf: `
output "db_endpoint" { value = aws_db_instance.main.endpoint sensitive = true }
output "db_name" { value = aws_db_instance.main.db_name }
output "db_secret_arn" { value = aws_secretsmanager_secret.db_password.arn }
`.trim()
    };
  }

  return generateMinimalModule(p, 'relational_database');
}

// ─────────────────────────────────────────────────────────────────────────────
// Module registry keyed by moduleId from catalog service definitions.
// Add more module families here over time.
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_FAMILIES = {
  // Core families (implemented above)
  networking: module_networking,
  apigateway: module_api_gateway,
  computeserverless: module_serverless_compute,
  objectstorage: module_object_storage,
  relationaldatabase: module_relational_database,

  // Common aliases
  computecontainer: (p) => generateMinimalModule(p, 'computecontainer'),
  appcompute: (p) => generateMinimalModule(p, 'computecontainer'),
  loadbalancer: (p) => generateMinimalModule(p, 'loadbalancer'),
  cdn: (p) => generateMinimalModule(p, 'cdn'),
  dns: (p) => generateMinimalModule(p, 'dns'),
  cache: (p) => generateMinimalModule(p, 'cache'),
  messagequeue: (p) => generateMinimalModule(p, 'messagequeue'),
  eventbus: (p) => generateMinimalModule(p, 'eventbus'),
  workfloworchestration: (p) => generateMinimalModule(p, 'workfloworchestration'),
  identityauth: (p) => generateMinimalModule(p, 'identityauth'),
  auth: (p) => generateMinimalModule(p, 'identityauth'),
  logging: (p) => generateMinimalModule(p, 'logging'),
  monitoring: (p) => generateMinimalModule(p, 'monitoring'),

  // Security extended
  secretsmanagement: (p) => generateMinimalModule(p, 'secretsmanagement'),
  keymanagement: (p) => generateMinimalModule(p, 'keymanagement'),
  certificatemanagement: (p) => generateMinimalModule(p, 'certificatemanagement'),
  waf: (p) => generateMinimalModule(p, 'waf'),
  ddosprotection: (p) => generateMinimalModule(p, 'ddosprotection'),
  policygovernance: (p) => generateMinimalModule(p, 'policygovernance'),

  // DevOps
  containerregistry: (p) => generateMinimalModule(p, 'containerregistry'),
  cicd: (p) => generateMinimalModule(p, 'cicd'),
  artifactrepository: (p) => generateMinimalModule(p, 'artifactrepository'),

  // Domain: IoT / ML / Analytics
  iotcore: (p) => generateMinimalModule(p, 'iotcore'),
  eventstream: (p) => generateMinimalModule(p, 'eventstream'),
  timeseriesdatabase: (p) => generateMinimalModule(p, 'timeseriesdatabase'),
  streamprocessor: (p) => generateMinimalModule(p, 'streamprocessor'),

  mltraining: (p) => generateMinimalModule(p, 'mltraining'),
  mlinference: (p) => generateMinimalModule(p, 'mlinference'),
  featurestore: (p) => generateMinimalModule(p, 'featurestore'),

  datawarehouse: (p) => generateMinimalModule(p, 'datawarehouse')
};

/**
 * Main entry: get a Terraform module generator for a service (catalog-driven).
 */
function getModuleForService(serviceId, provider) {
  const p = assertProvider(provider);

  const def = catalog[serviceId];
  if (!def) {
    console.warn(`[TF-MODULES] Unknown serviceId '${serviceId}' - using minimal module`);
    return () => generateMinimalModule(p, serviceId);
  }

  const moduleId = def?.terraform?.moduleId;
  if (!moduleId) {
    console.warn(`[TF-MODULES] Service '${serviceId}' has no terraform.moduleId - using minimal module`);
    return () => generateMinimalModule(p, serviceId);
  }

  const generator = MODULE_FAMILIES[moduleId];
  if (!generator) {
    console.warn(`[TF-MODULES] No module family '${moduleId}' for service '${serviceId}' - using minimal module`);
    return () => generateMinimalModule(p, serviceId);
  }

  return () => generator(p);
}

/**
 * Generate module files (main.tf, variables.tf, outputs.tf) for a service.
 */
function generateModuleFiles(serviceId, provider) {
  const fn = getModuleForService(serviceId, provider);
  const files = fn();

  if (!files || !files.mainTf || !files.variablesTf || !files.outputsTf) {
    throw new Error(`Invalid module generator output for service '${serviceId}'`);
  }

  return files;
}

module.exports = {
  SUPPORTED_PROVIDERS,
  MODULE_FAMILIES,
  generateMinimalModule,
  getModuleForService,
  generateModuleFiles
};
