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
    computecontainer: { COST_EFFECTIVE: 'aws_ecs_fargate', HIGH_PERFORMANCE: 'aws_eks' },
    computeserverless: { DEFAULT: 'aws_lambda' },
    computevm: { DEFAULT: 'aws_instance' },
    computebatch: { DEFAULT: 'aws_batch' },
    computeedge: { DEFAULT: 'aws_cloudfront_functions' },

    // Data
    relationaldatabase: {
        POSTGRES_COST: 'aws_rds_postgresql',
        POSTGRES_PERF: 'aws_aurora_postgresql',
        MYSQL_COST: 'aws_rds_mysql',
        MYSQL_PERF: 'aws_aurora_mysql',
        DEFAULT: 'aws_rds_postgresql'
    },
    nosqldatabase: { DEFAULT: 'aws_dynamodb' },
    cache: { DEFAULT: 'aws_elasticache_redis' },
    searchengine: { DEFAULT: 'aws_opensearch' },
    objectstorage: { DEFAULT: 'aws_s3' },
    blockstorage: { DEFAULT: 'aws_ebs' },
    filestorage: { DEFAULT: 'aws_efs' },
    backup: { DEFAULT: 'aws_backup' },

    // Networking / delivery
    loadbalancer: { DEFAULT: 'aws_alb' },
    apigateway: { COST_EFFECTIVE: 'aws_apigateway_v2', HIGH_PERFORMANCE: 'aws_api_gateway_rest', DEFAULT: 'aws_apigateway_v2' },
    cdn: { DEFAULT: 'aws_cloudfront' },
    dns: { DEFAULT: 'aws_route53' },
    vpcnetworking: { DEFAULT: 'aws_vpc' },
    natgateway: { DEFAULT: 'aws_nat_gateway' },
    vpn: { DEFAULT: 'aws_vpn' },
    privatelink: { DEFAULT: 'aws_privatelink' },
    servicediscovery: { DEFAULT: 'aws_cloud_map' },
    servicemesh: { DEFAULT: 'aws_app_mesh' },
    websocketgateway: { DEFAULT: 'aws_apigateway_v2' },
    globalloadbalancer: { DEFAULT: 'aws_globalaccelerator' },

    // Integration
    messagequeue: { DEFAULT: 'aws_sqs' },
    eventbus: { DEFAULT: 'aws_eventbridge' },
    workfloworchestration: { DEFAULT: 'aws_step_functions' },
    notification: { DEFAULT: 'aws_sns' },
    pushnotificationservice: { DEFAULT: 'aws_sns' },
    emailnotification: { DEFAULT: 'aws_ses' },

    // Security
    identityauth: { DEFAULT: 'aws_cognito' },
    secretsmanagement: { DEFAULT: 'aws_secrets_manager' },
    keymanagement: { DEFAULT: 'aws_kms' },
    certificatemanagement: { DEFAULT: 'aws_acm' },
    waf: { DEFAULT: 'aws_waf' },
    ddosprotection: { DEFAULT: 'aws_shield' },
    policygovernance: { DEFAULT: 'aws_organizations' },

    // Observability
    monitoring: { DEFAULT: 'aws_cloudwatch' },
    logging: { DEFAULT: 'aws_cloudwatch_logs' },
    tracing: { DEFAULT: 'aws_xray' },
    siem: { DEFAULT: 'aws_security_hub' },

    // DevOps
    containerregistry: { DEFAULT: 'aws_ecr' },
    cicd: { DEFAULT: 'aws_codepipeline' },
    artifactrepository: { DEFAULT: 'aws_codeartifact' },

    // IoT
    iotcore: { DEFAULT: 'aws_iot_core' },
    timeseriesdatabase: { DEFAULT: 'aws_timestream' },
    eventstream: { DEFAULT: 'aws_kinesis_streams' },
    iotedgegateway: { DEFAULT: 'aws_greengrass' },
    deviceregistry: { DEFAULT: 'aws_iot_core' },
    digitaltwin: { DEFAULT: 'aws_iottwinmaker' },
    otaupdates: { DEFAULT: 'aws_iot_jobs' },

    // Analytics
    datawarehouse: { DEFAULT: 'aws_redshift' },
    streamprocessor: { DEFAULT: 'aws_kinesis_analytics' },

    // ML
    mltraining: { DEFAULT: 'aws_sagemaker_training' },
    mlinference: { DEFAULT: 'aws_sagemaker_endpoint' },
    featurestore: { DEFAULT: 'aws_sagemaker_feature_store' },
    modelregistry: { DEFAULT: 'aws_sagemaker_domain' },
    experimenttracking: { DEFAULT: 'aws_sagemaker_domain' },
    mlpipelineorchestration: { DEFAULT: 'aws_sagemaker_pipelines' },
    vectordatabase: { DEFAULT: 'aws_opensearch' },
    modelmonitoring: { DEFAULT: 'aws_sagemaker_model_monitor' }
};

const GCP_SERVICE_MAP = {
    computecontainer: { COST_EFFECTIVE: 'gcp_cloud_run', HIGH_PERFORMANCE: 'gcp_gke' },
    computeserverless: { DEFAULT: 'gcp_cloud_functions' },
    computevm: { DEFAULT: 'gcp_compute_engine' },
    computebatch: { DEFAULT: 'gcp_batch' },
    computeedge: { DEFAULT: 'gcp_cloud_cdn_edge' },

    relationaldatabase: {
        POSTGRES_COST: 'gcp_cloud_sql_postgres',
        POSTGRES_PERF: 'gcp_cloud_sql_postgres_ha',
        MYSQL_COST: 'gcp_cloud_sql_mysql',
        DEFAULT: 'gcp_cloud_sql_postgres'
    },
    nosqldatabase: { DEFAULT: 'gcp_firestore' },
    cache: { DEFAULT: 'gcp_memorystore_redis' },
    searchengine: { DEFAULT: 'gcp_elastic_cloud' },
    objectstorage: { DEFAULT: 'gcp_cloud_storage' },
    blockstorage: { DEFAULT: 'gcp_persistent_disk' },
    filestorage: { DEFAULT: 'gcp_filestore' },
    backup: { DEFAULT: 'gcp_backup_and_dr' },

    loadbalancer: { DEFAULT: 'gcp_cloud_load_balancing' },
    apigateway: { DEFAULT: 'gcp_api_gateway' },
    cdn: { DEFAULT: 'gcp_cloud_cdn' },
    dns: { DEFAULT: 'gcp_cloud_dns' },
    vpcnetworking: { DEFAULT: 'gcp_vpc' },
    natgateway: { DEFAULT: 'gcp_cloud_nat' },
    vpn: { DEFAULT: 'gcp_cloud_vpn' },
    privatelink: { DEFAULT: 'gcp_private_service_connect' },
    servicediscovery: { DEFAULT: 'gcp_service_directory' },
    servicemesh: { DEFAULT: 'gcp_anthos_service_mesh' },
    websocketgateway: { DEFAULT: 'gcp_api_gateway' }, // Limited support
    globalloadbalancer: { DEFAULT: 'gcp_cloud_load_balancing' },

    messagequeue: { DEFAULT: 'gcp_pubsub' },
    eventbus: { DEFAULT: 'gcp_eventarc' },
    workfloworchestration: { DEFAULT: 'gcp_workflows' },
    notification: { DEFAULT: 'gcp_pubsub_notifications' },
    pushnotificationservice: { DEFAULT: 'gcp_firebase' },
    emailnotification: { DEFAULT: 'gcp_sendgrid_integration' },

    identityauth: { DEFAULT: 'gcp_identity_platform' },
    secretsmanagement: { DEFAULT: 'gcp_secret_manager' },
    keymanagement: { DEFAULT: 'gcp_cloud_kms' },
    certificatemanagement: { DEFAULT: 'gcp_certificate_manager' },
    waf: { DEFAULT: 'gcp_cloud_armor' },
    ddosprotection: { DEFAULT: 'gcp_cloud_armor_ddos' },
    policygovernance: { DEFAULT: 'gcp_org_policy' },

    monitoring: { DEFAULT: 'gcp_cloud_monitoring' },
    logging: { DEFAULT: 'gcp_cloud_logging' },
    tracing: { DEFAULT: 'gcp_cloud_trace' },
    siem: { DEFAULT: 'gcp_security_command_center' },

    containerregistry: { DEFAULT: 'gcp_artifact_registry' },
    cicd: { DEFAULT: 'gcp_cloud_build' },
    artifactrepository: { DEFAULT: 'gcp_artifact_registry' },

    iotcore: { DEFAULT: 'gcp_iot_registry_legacy' },
    timeseriesdatabase: { DEFAULT: 'gcp_bigquery_timeseries' },
    eventstream: { DEFAULT: 'gcp_pubsub' },
    deviceregistry: { DEFAULT: 'gcp_iot_registry_legacy' }, // Legacy/retired
    iotedgegateway: { DEFAULT: 'gcp_iot_edge' },
    digitaltwin: { DEFAULT: 'gcp_virtual_twin' },
    otaupdates: { DEFAULT: 'gcp_iot_jobs' },

    datawarehouse: { DEFAULT: 'gcp_bigquery' },
    streamprocessor: { DEFAULT: 'gcp_dataflow' },

    mltraining: { DEFAULT: 'gcp_vertex_ai_training' },
    mlinference: { DEFAULT: 'gcp_vertex_ai_endpoint' },
    featurestore: { DEFAULT: 'gcp_vertex_feature_store' },
    modelregistry: { DEFAULT: 'gcp_vertex_model_registry' },
    experimenttracking: { DEFAULT: 'gcp_vertex_experiments' },
    mlpipelineorchestration: { DEFAULT: 'gcp_vertex_pipelines' },
    vectordatabase: { DEFAULT: 'gcp_vertex_vector_search' },
    modelmonitoring: { DEFAULT: 'gcp_vertex_model_monitoring' }
};

const AZURE_SERVICE_MAP = {
    computecontainer: { COST_EFFECTIVE: 'az_container_apps', HIGH_PERFORMANCE: 'az_aks' },
    computeserverless: { DEFAULT: 'az_functions' },
    computevm: { DEFAULT: 'az_virtual_machines' },
    computebatch: { DEFAULT: 'az_batch' },
    computeedge: { DEFAULT: 'az_front_door_edge' },

    relationaldatabase: {
        POSTGRES_COST: 'az_postgresql_flexible',
        POSTGRES_PERF: 'az_postgresql_flexible_ha',
        MYSQL_COST: 'az_mysql_flexible',
        DEFAULT: 'az_postgresql_flexible'
    },
    nosqldatabase: { DEFAULT: 'az_cosmosdb' },
    cache: { DEFAULT: 'az_redis' },
    searchengine: { DEFAULT: 'az_ai_search' },
    objectstorage: { DEFAULT: 'az_blob_storage' },
    blockstorage: { DEFAULT: 'az_managed_disks' },
    filestorage: { DEFAULT: 'az_files' },
    backup: { DEFAULT: 'az_recovery_services' },

    loadbalancer: { DEFAULT: 'az_application_gateway' },
    apigateway: { DEFAULT: 'az_api_management' },
    cdn: { COST_EFFECTIVE: 'az_cdn', HIGH_PERFORMANCE: 'az_front_door', DEFAULT: 'az_cdn' },
    dns: { DEFAULT: 'az_dns' },
    vpcnetworking: { DEFAULT: 'az_virtual_network' },
    natgateway: { DEFAULT: 'az_nat_gateway' },
    vpn: { DEFAULT: 'az_vpn_gateway' },
    privatelink: { DEFAULT: 'az_private_endpoint' },
    servicediscovery: { DEFAULT: 'az_private_dns' },
    servicemesh: { DEFAULT: 'az_service_mesh_aks' },
    websocketgateway: { DEFAULT: 'az_web_pubsub' },
    globalloadbalancer: { DEFAULT: 'az_front_door' },

    messagequeue: { DEFAULT: 'az_service_bus' },
    eventbus: { DEFAULT: 'az_event_grid' },
    workfloworchestration: { DEFAULT: 'az_logic_apps' },
    notification: { DEFAULT: 'az_notification_hubs' },
    pushnotificationservice: { DEFAULT: 'az_notification_hubs' },
    emailnotification: { DEFAULT: 'az_communication_services' },

    identityauth: { DEFAULT: 'az_ad_b2c' },
    secretsmanagement: { DEFAULT: 'az_key_vault_secrets' },
    keymanagement: { DEFAULT: 'az_key_vault_keys' },
    certificatemanagement: { DEFAULT: 'az_key_vault_certs' },
    waf: { DEFAULT: 'az_waf' },
    ddosprotection: { DEFAULT: 'az_ddos_protection' },
    policygovernance: { DEFAULT: 'az_azure_policy' },

    monitoring: { DEFAULT: 'az_monitor' },
    logging: { DEFAULT: 'az_log_analytics' },
    tracing: { DEFAULT: 'az_app_insights' },
    siem: { DEFAULT: 'az_sentinel' },

    containerregistry: { DEFAULT: 'az_acr' },
    cicd: { DEFAULT: 'az_devops' },
    artifactrepository: { DEFAULT: 'az_artifacts' },

    iotcore: { DEFAULT: 'az_iot_hub' },
    timeseriesdatabase: { DEFAULT: 'az_data_explorer' },
    eventstream: { DEFAULT: 'az_event_hubs' },
    deviceregistry: { DEFAULT: 'az_iot_hub_dps' },
    iotedgegateway: { DEFAULT: 'az_iot_edge' },
    digitaltwin: { DEFAULT: 'az_digital_twins' },
    otaupdates: { DEFAULT: 'az_device_update' },

    datawarehouse: { DEFAULT: 'az_synapse' },
    streamprocessor: { DEFAULT: 'az_stream_analytics' },

    mltraining: { DEFAULT: 'az_ml_training' },
    mlinference: { DEFAULT: 'az_ml_endpoint' },
    featurestore: { DEFAULT: 'az_ml_feature_store' },
    modelregistry: { DEFAULT: 'az_ml_registry' },
    experimenttracking: { DEFAULT: 'az_ml_experiments' },
    mlpipelineorchestration: { DEFAULT: 'az_ml_pipelines' },
    vectordatabase: { DEFAULT: 'az_ai_search_vector' },
    modelmonitoring: { DEFAULT: 'az_monitor' }
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

    // Additional AWS display names for coverage
    aws_greengrass: 'IoT Greengrass',
    aws_iottwinmaker: 'IoT TwinMaker',
    aws_iot_jobs: 'IoT Device Management',
    aws_sagemaker_domain: 'SageMaker Domain',
    aws_sagemaker_pipelines: 'SageMaker Pipelines',
    aws_sagemaker_model_monitor: 'SageMaker Model Monitor',
    aws_globalaccelerator: 'Global Accelerator',
    aws_ses: 'Simple Email Service (SES)',

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
    gcp_firebase: 'Firebase Cloud Messaging',
    gcp_sendgrid_integration: 'SendGrid (via Marketplace)',
    gcp_iot_edge: 'IoT Edge (Solution)',
    gcp_virtual_twin: 'Virtual Twin (Solution)',
    gcp_iot_jobs: 'IoT Jobs (Solution)',
    gcp_vertex_model_registry: 'Vertex Model Registry',
    gcp_vertex_experiments: 'Vertex Experiments',
    gcp_vertex_pipelines: 'Vertex Pipelines',
    gcp_vertex_vector_search: 'Vertex AI Vector Search',
    gcp_vertex_model_monitoring: 'Vertex Model Monitoring',


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
    az_ml_feature_store: 'Azure ML Feature Store',
    az_web_pubsub: 'Web PubSub',
    az_communication_services: 'Communication Services',
    az_iot_hub_dps: 'Device Provisioning Service',
    az_iot_edge: 'IoT Edge',
    az_digital_twins: 'Digital Twins',
    az_device_update: 'Device Update for IoT Hub',
    az_ml_registry: 'Azure ML Registry',
    az_ml_experiments: 'Azure ML Experiments',
    az_ml_pipelines: 'Azure ML Pipelines',
    az_ai_search_vector: 'AI Search (Vector)',
};

function mapServiceToCloud(provider, serviceId, costProfile = 'COST_EFFECTIVE', options = {}) {
    const providerMap = CLOUD_SERVICE_MAP[String(provider || '').toUpperCase()];
    if (!providerMap) throw new Error(`Unknown provider: ${provider}`);

    const mapping = providerMap[serviceId];
    if (!mapping) return null;

    // Special handling for SQL engines
    if (serviceId === 'relationaldatabase') {
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
 * - infraSpec.deployable_services = ['apigateway','computeserverless',...]
 * - or infraSpec.service_classes.required_services = [{service_class:'apigateway'}] legacy shape
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
            engine: infraSpec?.components?.[serviceId]?.engine || infraSpec?.components?.relationaldatabase?.engine
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
