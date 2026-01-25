/**
 * cloud.js
 * Canonical service ID → provider-specific "product id" mapping with profiles.
 *
 * IMPORTANT:
 * - This is for selecting a provider product variant (e.g., ECS vs EKS).
 * - Terraform resourceType mapping should come from catalog (pricing.infracost.resourceType),
 *   but this file remains useful for "product variant" and display names. [file:52]
 */

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Provider maps (canonical → provider product id)
// ─────────────────────────────────────────────────────────────────────────────

const AWS_SERVICE_MAP = {
    // Compute
    compute_container: { COST_EFFECTIVE: 'aws_ecs_fargate', HIGH_PERFORMANCE: 'aws_eks' },
    compute_serverless: { DEFAULT: 'aws_lambda' },
    compute_vm: { DEFAULT: 'aws_instance' },
    compute_batch: { DEFAULT: 'aws_batch' },
    compute_edge: { DEFAULT: 'aws_cloudfront_functions' },

    // Data
    relational_database: {
        POSTGRES_COST: 'aws_rds_postgresql',
        POSTGRES_PERF: 'aws_aurora_postgresql',
        MYSQL_COST: 'aws_rds_mysql',
        MYSQL_PERF: 'aws_aurora_mysql',
        DEFAULT: 'aws_rds_postgresql'
    },
    nosql_database: { DEFAULT: 'aws_dynamodb' },
    cache: { DEFAULT: 'aws_elasticache_redis' },
    search_engine: { DEFAULT: 'aws_opensearch' },
    object_storage: { DEFAULT: 'aws_s3' },
    block_storage: { DEFAULT: 'aws_ebs' },
    file_storage: { DEFAULT: 'aws_efs' },
    backup: { DEFAULT: 'aws_backup' },

    // Networking / delivery
    load_balancer: { DEFAULT: 'aws_alb' },
    api_gateway: { COST_EFFECTIVE: 'aws_apigateway_v2', HIGH_PERFORMANCE: 'aws_api_gateway_rest', DEFAULT: 'aws_apigateway_v2' },
    cdn: { DEFAULT: 'aws_cloudfront' },
    dns: { DEFAULT: 'aws_route53' },
    vpc_networking: { DEFAULT: 'aws_vpc' },
    nat_gateway: { DEFAULT: 'aws_nat_gateway' },
    vpn: { DEFAULT: 'aws_vpn' },
    private_link: { DEFAULT: 'aws_privatelink' },
    service_discovery: { DEFAULT: 'aws_cloud_map' },
    service_mesh: { DEFAULT: 'aws_app_mesh' },

    // Integration
    messaging_queue: { DEFAULT: 'aws_sqs' },
    event_bus: { DEFAULT: 'aws_eventbridge' },
    workflow_orchestration: { DEFAULT: 'aws_step_functions' },
    notification: { DEFAULT: 'aws_sns' },

    // Security
    identity_auth: { DEFAULT: 'aws_cognito' },
    secrets_management: { DEFAULT: 'aws_secrets_manager' },
    key_management: { DEFAULT: 'aws_kms' },
    certificate_management: { DEFAULT: 'aws_acm' },
    waf: { DEFAULT: 'aws_waf' },
    ddos_protection: { DEFAULT: 'aws_shield' },
    policy_governance: { DEFAULT: 'aws_organizations' },

    // Observability
    monitoring: { DEFAULT: 'aws_cloudwatch' },
    logging: { DEFAULT: 'aws_cloudwatch_logs' },
    tracing: { DEFAULT: 'aws_xray' },
    siem: { DEFAULT: 'aws_security_hub' },

    // DevOps
    container_registry: { DEFAULT: 'aws_ecr' },
    ci_cd: { DEFAULT: 'aws_codepipeline' },
    artifact_repository: { DEFAULT: 'aws_codeartifact' },

    // IoT
    iot_core: { DEFAULT: 'aws_iot_core' },
    time_series_database: { DEFAULT: 'aws_timestream' },
    event_stream: { DEFAULT: 'aws_kinesis_streams' },

    // Analytics
    data_warehouse: { DEFAULT: 'aws_redshift' },
    stream_processor: { DEFAULT: 'aws_kinesis_analytics' },

    // ML
    ml_training: { DEFAULT: 'aws_sagemaker_training' },
    ml_inference: { DEFAULT: 'aws_sagemaker_endpoint' },
    feature_store: { DEFAULT: 'aws_sagemaker_feature_store' }
};

const GCP_SERVICE_MAP = {
    compute_container: { COST_EFFECTIVE: 'gcp_cloud_run', HIGH_PERFORMANCE: 'gcp_gke' },
    compute_serverless: { DEFAULT: 'gcp_cloud_functions' },
    compute_vm: { DEFAULT: 'gcp_compute_engine' },
    compute_batch: { DEFAULT: 'gcp_batch' },
    compute_edge: { DEFAULT: 'gcp_cloud_cdn_edge' },

    relational_database: {
        POSTGRES_COST: 'gcp_cloud_sql_postgres',
        POSTGRES_PERF: 'gcp_cloud_sql_postgres_ha',
        MYSQL_COST: 'gcp_cloud_sql_mysql',
        DEFAULT: 'gcp_cloud_sql_postgres'
    },
    nosql_database: { DEFAULT: 'gcp_firestore' },
    cache: { DEFAULT: 'gcp_memorystore_redis' },
    search_engine: { DEFAULT: 'gcp_elastic_cloud' },
    object_storage: { DEFAULT: 'gcp_cloud_storage' },
    block_storage: { DEFAULT: 'gcp_persistent_disk' },
    file_storage: { DEFAULT: 'gcp_filestore' },
    backup: { DEFAULT: 'gcp_backup_and_dr' },

    load_balancer: { DEFAULT: 'gcp_cloud_load_balancing' },
    api_gateway: { DEFAULT: 'gcp_api_gateway' },
    cdn: { DEFAULT: 'gcp_cloud_cdn' },
    dns: { DEFAULT: 'gcp_cloud_dns' },
    vpc_networking: { DEFAULT: 'gcp_vpc' },
    nat_gateway: { DEFAULT: 'gcp_cloud_nat' },
    vpn: { DEFAULT: 'gcp_cloud_vpn' },
    private_link: { DEFAULT: 'gcp_private_service_connect' },
    service_discovery: { DEFAULT: 'gcp_service_directory' },
    service_mesh: { DEFAULT: 'gcp_anthos_service_mesh' },

    messaging_queue: { DEFAULT: 'gcp_pubsub' },
    event_bus: { DEFAULT: 'gcp_eventarc' },
    workflow_orchestration: { DEFAULT: 'gcp_workflows' },
    notification: { DEFAULT: 'gcp_pubsub_notifications' },

    identity_auth: { DEFAULT: 'gcp_identity_platform' },
    secrets_management: { DEFAULT: 'gcp_secret_manager' },
    key_management: { DEFAULT: 'gcp_cloud_kms' },
    certificate_management: { DEFAULT: 'gcp_certificate_manager' },
    waf: { DEFAULT: 'gcp_cloud_armor' },
    ddos_protection: { DEFAULT: 'gcp_cloud_armor_ddos' },
    policy_governance: { DEFAULT: 'gcp_org_policy' },

    monitoring: { DEFAULT: 'gcp_cloud_monitoring' },
    logging: { DEFAULT: 'gcp_cloud_logging' },
    tracing: { DEFAULT: 'gcp_cloud_trace' },
    siem: { DEFAULT: 'gcp_security_command_center' },

    container_registry: { DEFAULT: 'gcp_artifact_registry' },
    ci_cd: { DEFAULT: 'gcp_cloud_build' },
    artifact_repository: { DEFAULT: 'gcp_artifact_registry' },

    iot_core: { DEFAULT: 'gcp_iot_registry_legacy' },
    time_series_database: { DEFAULT: 'gcp_bigquery_timeseries' },
    event_stream: { DEFAULT: 'gcp_pubsub' },

    data_warehouse: { DEFAULT: 'gcp_bigquery' },
    stream_processor: { DEFAULT: 'gcp_dataflow' },

    ml_training: { DEFAULT: 'gcp_vertex_ai_training' },
    ml_inference: { DEFAULT: 'gcp_vertex_ai_endpoint' },
    feature_store: { DEFAULT: 'gcp_vertex_feature_store' }
};

const AZURE_SERVICE_MAP = {
    compute_container: { COST_EFFECTIVE: 'az_container_apps', HIGH_PERFORMANCE: 'az_aks' },
    compute_serverless: { DEFAULT: 'az_functions' },
    compute_vm: { DEFAULT: 'az_virtual_machines' },
    compute_batch: { DEFAULT: 'az_batch' },
    compute_edge: { DEFAULT: 'az_front_door_edge' },

    relational_database: {
        POSTGRES_COST: 'az_postgresql_flexible',
        POSTGRES_PERF: 'az_postgresql_flexible_ha',
        MYSQL_COST: 'az_mysql_flexible',
        DEFAULT: 'az_postgresql_flexible'
    },
    nosql_database: { DEFAULT: 'az_cosmosdb' },
    cache: { DEFAULT: 'az_redis' },
    search_engine: { DEFAULT: 'az_ai_search' },
    object_storage: { DEFAULT: 'az_blob_storage' },
    block_storage: { DEFAULT: 'az_managed_disks' },
    file_storage: { DEFAULT: 'az_files' },
    backup: { DEFAULT: 'az_recovery_services' },

    load_balancer: { DEFAULT: 'az_application_gateway' },
    api_gateway: { DEFAULT: 'az_api_management' },
    cdn: { COST_EFFECTIVE: 'az_cdn', HIGH_PERFORMANCE: 'az_front_door', DEFAULT: 'az_cdn' },
    dns: { DEFAULT: 'az_dns' },
    vpc_networking: { DEFAULT: 'az_virtual_network' },
    nat_gateway: { DEFAULT: 'az_nat_gateway' },
    vpn: { DEFAULT: 'az_vpn_gateway' },
    private_link: { DEFAULT: 'az_private_endpoint' },
    service_discovery: { DEFAULT: 'az_private_dns' },
    service_mesh: { DEFAULT: 'az_service_mesh_aks' },

    messaging_queue: { DEFAULT: 'az_service_bus' },
    event_bus: { DEFAULT: 'az_event_grid' },
    workflow_orchestration: { DEFAULT: 'az_logic_apps' },
    notification: { DEFAULT: 'az_notification_hubs' },

    identity_auth: { DEFAULT: 'az_ad_b2c' },
    secrets_management: { DEFAULT: 'az_key_vault_secrets' },
    key_management: { DEFAULT: 'az_key_vault_keys' },
    certificate_management: { DEFAULT: 'az_key_vault_certs' },
    waf: { DEFAULT: 'az_waf' },
    ddos_protection: { DEFAULT: 'az_ddos_protection' },
    policy_governance: { DEFAULT: 'az_azure_policy' },

    monitoring: { DEFAULT: 'az_monitor' },
    logging: { DEFAULT: 'az_log_analytics' },
    tracing: { DEFAULT: 'az_app_insights' },
    siem: { DEFAULT: 'az_sentinel' },

    container_registry: { DEFAULT: 'az_acr' },
    ci_cd: { DEFAULT: 'az_devops' },
    artifact_repository: { DEFAULT: 'az_artifacts' },

    iot_core: { DEFAULT: 'az_iot_hub' },
    time_series_database: { DEFAULT: 'az_data_explorer' },
    event_stream: { DEFAULT: 'az_event_hubs' },

    data_warehouse: { DEFAULT: 'az_synapse' },
    stream_processor: { DEFAULT: 'az_stream_analytics' },

    ml_training: { DEFAULT: 'az_ml_training' },
    ml_inference: { DEFAULT: 'az_ml_endpoint' },
    feature_store: { DEFAULT: 'az_ml_feature_store' }
};

const CLOUD_SERVICE_MAP = {
    AWS: AWS_SERVICE_MAP,
    GCP: GCP_SERVICE_MAP,
    AZURE: AZURE_SERVICE_MAP
};

// ─────────────────────────────────────────────────────────────────────────────
// Display names (product id → readable name)
// ─────────────────────────────────────────────────────────────────────────────
const SERVICE_DISPLAY_NAMES = {
    // AWS
    aws_ecs_fargate: 'ECS Fargate',
    aws_eks: 'EKS',
    aws_lambda: 'Lambda',
    aws_instance: 'EC2',
    aws_batch: 'AWS Batch',
    aws_cloudfront_functions: 'CloudFront Functions',
    aws_rds_postgresql: 'RDS PostgreSQL',
    aws_aurora_postgresql: 'Aurora PostgreSQL',
    aws_rds_mysql: 'RDS MySQL',
    aws_aurora_mysql: 'Aurora MySQL',
    aws_dynamodb: 'DynamoDB',
    aws_elasticache_redis: 'ElastiCache (Redis)',
    aws_opensearch: 'OpenSearch',
    aws_s3: 'S3',
    aws_ebs: 'EBS',
    aws_efs: 'EFS',
    aws_backup: 'AWS Backup',
    aws_alb: 'Application Load Balancer',
    aws_apigateway_v2: 'API Gateway (HTTP)',
    aws_api_gateway_rest: 'API Gateway (REST)',
    aws_cloudfront: 'CloudFront',
    aws_route53: 'Route 53',
    aws_vpc: 'VPC',
    aws_nat_gateway: 'NAT Gateway',
    aws_vpn: 'Site-to-Site VPN',
    aws_privatelink: 'PrivateLink',
    aws_cloud_map: 'Cloud Map',
    aws_app_mesh: 'App Mesh',
    aws_sqs: 'SQS',
    aws_eventbridge: 'EventBridge',
    aws_step_functions: 'Step Functions',
    aws_sns: 'SNS',
    aws_cognito: 'Cognito',
    aws_secrets_manager: 'Secrets Manager',
    aws_kms: 'KMS',
    aws_acm: 'ACM',
    aws_waf: 'AWS WAF',
    aws_shield: 'AWS Shield',
    aws_organizations: 'Organizations/SCP',
    aws_cloudwatch: 'CloudWatch',
    aws_cloudwatch_logs: 'CloudWatch Logs',
    aws_xray: 'X-Ray',
    aws_security_hub: 'Security Hub',
    aws_ecr: 'ECR',
    aws_codepipeline: 'CodePipeline',
    aws_codeartifact: 'CodeArtifact',
    aws_iot_core: 'AWS IoT Core',
    aws_timestream: 'Timestream',
    aws_kinesis_streams: 'Kinesis Streams',
    aws_redshift: 'Redshift',
    aws_kinesis_analytics: 'Kinesis Analytics',
    aws_sagemaker_training: 'SageMaker Training',
    aws_sagemaker_endpoint: 'SageMaker Endpoint',
    aws_sagemaker_feature_store: 'SageMaker Feature Store',

    // GCP
    gcp_cloud_run: 'Cloud Run',
    gcp_gke: 'GKE',
    gcp_cloud_functions: 'Cloud Functions',
    gcp_compute_engine: 'Compute Engine',
    gcp_batch: 'Batch',
    gcp_cloud_cdn_edge: 'Cloud CDN (edge)',
    gcp_cloud_sql_postgres: 'Cloud SQL (Postgres)',
    gcp_cloud_sql_postgres_ha: 'Cloud SQL (Postgres HA)',
    gcp_cloud_sql_mysql: 'Cloud SQL (MySQL)',
    gcp_firestore: 'Firestore',
    gcp_memorystore_redis: 'Memorystore (Redis)',
    gcp_elastic_cloud: 'Elastic Cloud',
    gcp_cloud_storage: 'Cloud Storage',
    gcp_persistent_disk: 'Persistent Disk',
    gcp_filestore: 'Filestore',
    gcp_backup_and_dr: 'Backup and DR',
    gcp_cloud_load_balancing: 'Cloud Load Balancing',
    gcp_api_gateway: 'API Gateway',
    gcp_cloud_cdn: 'Cloud CDN',
    gcp_cloud_dns: 'Cloud DNS',
    gcp_vpc: 'VPC',
    gcp_cloud_nat: 'Cloud NAT',
    gcp_cloud_vpn: 'Cloud VPN',
    gcp_private_service_connect: 'Private Service Connect',
    gcp_service_directory: 'Service Directory',
    gcp_anthos_service_mesh: 'Anthos Service Mesh',
    gcp_pubsub: 'Pub/Sub',
    gcp_eventarc: 'Eventarc',
    gcp_workflows: 'Workflows',
    gcp_pubsub_notifications: 'Pub/Sub (notifications)',
    gcp_identity_platform: 'Identity Platform',
    gcp_secret_manager: 'Secret Manager',
    gcp_cloud_kms: 'Cloud KMS',
    gcp_certificate_manager: 'Certificate Manager',
    gcp_cloud_armor: 'Cloud Armor',
    gcp_cloud_armor_ddos: 'Cloud Armor (DDoS)',
    gcp_org_policy: 'Org Policy',
    gcp_cloud_monitoring: 'Cloud Monitoring',
    gcp_cloud_logging: 'Cloud Logging',
    gcp_cloud_trace: 'Cloud Trace',
    gcp_security_command_center: 'Security Command Center',
    gcp_artifact_registry: 'Artifact Registry',
    gcp_cloud_build: 'Cloud Build',
    gcp_iot_registry_legacy: 'IoT Registry (legacy/alt)',
    gcp_bigquery_timeseries: 'BigQuery (time series pattern)',
    gcp_bigquery: 'BigQuery',
    gcp_dataflow: 'Dataflow',
    gcp_vertex_ai_training: 'Vertex AI Training',
    gcp_vertex_ai_endpoint: 'Vertex AI Endpoint',
    gcp_vertex_feature_store: 'Vertex Feature Store',

    // Azure
    az_container_apps: 'Container Apps',
    az_aks: 'AKS',
    az_functions: 'Azure Functions',
    az_virtual_machines: 'Virtual Machines',
    az_batch: 'Azure Batch',
    az_front_door_edge: 'Front Door (edge)',
    az_postgresql_flexible: 'PostgreSQL Flexible',
    az_postgresql_flexible_ha: 'PostgreSQL Flexible (HA)',
    az_mysql_flexible: 'MySQL Flexible',
    az_cosmosdb: 'Cosmos DB',
    az_redis: 'Azure Cache for Redis',
    az_ai_search: 'Azure AI Search',
    az_blob_storage: 'Blob Storage',
    az_managed_disks: 'Managed Disks',
    az_files: 'Azure Files',
    az_recovery_services: 'Recovery Services Vault',
    az_application_gateway: 'Application Gateway',
    az_api_management: 'API Management',
    az_cdn: 'Azure CDN',
    az_front_door: 'Azure Front Door',
    az_dns: 'Azure DNS',
    az_virtual_network: 'Virtual Network',
    az_nat_gateway: 'NAT Gateway',
    az_vpn_gateway: 'VPN Gateway',
    az_private_endpoint: 'Private Endpoint',
    az_private_dns: 'Private DNS',
    az_service_mesh_aks: 'Service Mesh (AKS pattern)',
    az_service_bus: 'Service Bus',
    az_event_grid: 'Event Grid',
    az_logic_apps: 'Logic Apps',
    az_notification_hubs: 'Notification Hubs',
    az_ad_b2c: 'Azure AD B2C',
    az_key_vault_secrets: 'Key Vault (Secrets)',
    az_key_vault_keys: 'Key Vault (Keys)',
    az_key_vault_certs: 'Key Vault (Certs)',
    az_waf: 'Azure WAF',
    az_ddos_protection: 'Azure DDoS Protection',
    az_azure_policy: 'Azure Policy',
    az_monitor: 'Azure Monitor',
    az_log_analytics: 'Log Analytics',
    az_app_insights: 'Application Insights',
    az_sentinel: 'Microsoft Sentinel',
    az_acr: 'ACR',
    az_devops: 'Azure DevOps',
    az_artifacts: 'Azure Artifacts',
    az_iot_hub: 'IoT Hub',
    az_data_explorer: 'Azure Data Explorer',
    az_event_hubs: 'Event Hubs',
    az_synapse: 'Synapse',
    az_stream_analytics: 'Stream Analytics',
    az_ml_training: 'Azure ML Training',
    az_ml_endpoint: 'Azure ML Endpoint',
    az_ml_feature_store: 'Azure ML Feature Store'
};

function mapServiceToCloud(provider, serviceId, costProfile = 'COST_EFFECTIVE', options = {}) {
    const providerMap = CLOUD_SERVICE_MAP[String(provider || '').toUpperCase()];
    if (!providerMap) throw new Error(`Unknown provider: ${provider}`);

    const mapping = providerMap[serviceId];
    if (!mapping) return null;

    // Special handling for SQL engines
    if (serviceId === 'relational_database') {
        const raw = String(options.engine || 'postgres').toLowerCase();
        const engine = raw.includes('mysql') ? 'MYSQL' : 'POSTGRES';
        const perfKey = (String(costProfile).toUpperCase() === 'HIGH_PERFORMANCE') ? 'PERF' : 'COST';
        const key = `${engine}_${perfKey}`;
        return mapping[key] || mapping.DEFAULT || mapping.POSTGRES_COST;
    }

    const cp = String(costProfile || '').toUpperCase();
    if (mapping[cp]) return mapping[cp];

    return mapping.DEFAULT || Object.values(mapping)[0];
}

function getServiceDisplayName(productId) {
    return SERVICE_DISPLAY_NAMES[productId] || productId;
}

/**
 * Map a list of canonical services to provider products.
 * Accepts:
 * - infraSpec.deployable_services = ['api_gateway','compute_serverless',...]
 * - or infraSpec.service_classes.required_services = [{service_class:'api_gateway'}] legacy shape
 */
function mapAllServices(provider, infraSpec, costProfile = 'COST_EFFECTIVE') {
    const mapped = [];

    const deployable = infraSpec?.deployable_services || infraSpec?.canonical_architecture?.deployable_services;
    const legacy = infraSpec?.service_classes?.required_services;

    const serviceIds = Array.isArray(deployable)
        ? deployable
        : Array.isArray(legacy)
            ? legacy.map(x => x.service_class).filter(Boolean)
            : [];

    for (const serviceId of serviceIds) {
        const cloudProduct = mapServiceToCloud(provider, serviceId, costProfile, {
            engine: infraSpec?.components?.[serviceId]?.engine || infraSpec?.components?.relational_database?.engine
        });

        if (!cloudProduct) continue;

        mapped.push({
            service_id: serviceId,
            cloud_product: cloudProduct,
            display_name: getServiceDisplayName(cloudProduct)
        });
    }

    return mapped;
}

module.exports = {
    CLOUD_SERVICE_MAP,
    SERVICE_DISPLAY_NAMES,
    mapServiceToCloud,
    getServiceDisplayName,
    mapAllServices
};
