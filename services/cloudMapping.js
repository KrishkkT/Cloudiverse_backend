/**
 * STEP 3 — CLOUD SERVICE MAPPING
 * Maps 21 provider-agnostic service classes to cloud-specific services
 * Supports AWS, GCP, and Azure with cost profile variants
 */

// AWS Service Mapping
const AWS_SERVICE_MAP = {
    // 1️⃣ COMPUTE (only one active per project)
    compute_container: {
        COST_EFFECTIVE: "aws_ecs_fargate",
        HIGH_PERFORMANCE: "aws_eks"
    },
    compute_serverless: {
        DEFAULT: "aws_lambda"
    },
    compute_vm: {
        DEFAULT: "aws_instance"
    },
    compute_static: {
        DEFAULT: "aws_s3_website"
    },

    // 2️⃣ DATA & STATE
    relational_database: {
        POSTGRES_COST: "aws_rds_postgresql",
        POSTGRES_PERF: "aws_aurora_postgresql",
        MYSQL_COST: "aws_rds_mysql",
        MYSQL_PERF: "aws_aurora_mysql"
    },
    nosql_database: { DEFAULT: "aws_dynamodb" },
    cache: { DEFAULT: "aws_elasticache_redis" },
    object_storage: { DEFAULT: "aws_s3" },
    block_storage: { DEFAULT: "aws_ebs" },

    // 3️⃣ TRAFFIC & INTEGRATION
    load_balancer: { DEFAULT: "aws_alb" },
    api_gateway: {
        COST_EFFECTIVE: "aws_apigateway_v2",
        HIGH_PERFORMANCE: "aws_api_gateway_rest"
    },
    messaging_queue: { DEFAULT: "aws_sqs" },
    event_bus: { DEFAULT: "aws_eventbridge" },
    search_engine: { DEFAULT: "aws_opensearch" },
    cdn: { DEFAULT: "aws_cloudfront" },

    // 4️⃣ PLATFORM ESSENTIALS
    networking: { DEFAULT: "aws_vpc" },
    identity_auth: { DEFAULT: "aws_cognito" },
    dns: { DEFAULT: "aws_route53" },

    // 5️⃣ OPERATIONS
    monitoring: { DEFAULT: "aws_cloudwatch" },
    logging: { DEFAULT: "aws_cloudwatch_logs" },
    secrets_management: { DEFAULT: "aws_secrets_manager" }
};

// GCP Service Mapping
const GCP_SERVICE_MAP = {
    // 1️⃣ COMPUTE
    compute_container: {
        COST_EFFECTIVE: "google_cloud_run",
        HIGH_PERFORMANCE: "google_gke"
    },
    compute_serverless: { DEFAULT: "google_cloud_functions" },
    compute_vm: { DEFAULT: "google_compute_instance" },
    compute_static: { DEFAULT: "google_cloud_storage_website" },

    // 2️⃣ DATA & STATE
    relational_database: {
        POSTGRES_COST: "google_cloud_sql_postgres",
        POSTGRES_PERF: "google_cloud_sql_postgres_ha",
        MYSQL_COST: "google_cloud_sql_mysql"
    },
    nosql_database: { DEFAULT: "google_firestore" },
    cache: { DEFAULT: "google_memorystore_redis" },
    object_storage: { DEFAULT: "google_cloud_storage" },
    block_storage: { DEFAULT: "google_persistent_disk" },

    // 3️⃣ TRAFFIC & INTEGRATION
    load_balancer: { DEFAULT: "google_cloud_load_balancer" },
    api_gateway: { DEFAULT: "google_api_gateway" },
    messaging_queue: { DEFAULT: "google_pubsub" },
    event_bus: { DEFAULT: "google_eventarc" },
    search_engine: { DEFAULT: "elastic_cloud_on_gcp" },
    cdn: { DEFAULT: "google_cloud_cdn" },

    // 4️⃣ PLATFORM ESSENTIALS
    networking: { DEFAULT: "google_compute_network" },
    identity_auth: { DEFAULT: "google_identity_platform" },
    dns: { DEFAULT: "google_cloud_dns" },

    // 5️⃣ OPERATIONS
    monitoring: { DEFAULT: "google_cloud_monitoring" },
    logging: { DEFAULT: "google_cloud_logging" },
    secrets_management: { DEFAULT: "google_secret_manager" }
};

// Azure Service Mapping
const AZURE_SERVICE_MAP = {
    // 1️⃣ COMPUTE
    compute_container: {
        COST_EFFECTIVE: "azure_container_apps",
        HIGH_PERFORMANCE: "azure_aks"
    },
    compute_serverless: { DEFAULT: "azure_functions" },
    compute_vm: { DEFAULT: "azure_virtual_machine" },
    compute_static: { DEFAULT: "azure_static_web_apps" },

    // 2️⃣ DATA & STATE
    relational_database: {
        POSTGRES_COST: "azure_postgresql_flexible",
        POSTGRES_PERF: "azure_postgresql_flexible_ha",
        MYSQL_COST: "azure_mysql_flexible"
    },
    nosql_database: { DEFAULT: "azure_cosmosdb" },
    cache: { DEFAULT: "azure_cache_redis" },
    object_storage: { DEFAULT: "azure_blob_storage" },
    block_storage: { DEFAULT: "azure_managed_disk" },

    // 3️⃣ TRAFFIC & INTEGRATION
    load_balancer: { DEFAULT: "azure_application_gateway" },
    api_gateway: { DEFAULT: "azure_api_management" },
    messaging_queue: { DEFAULT: "azure_service_bus" },
    event_bus: { DEFAULT: "azure_event_grid" },
    search_engine: { DEFAULT: "azure_cognitive_search" },
    cdn: {
        COST_EFFECTIVE: "azure_cdn_standard",
        HIGH_PERFORMANCE: "azure_front_door"
    },

    // 4️⃣ PLATFORM ESSENTIALS
    networking: { DEFAULT: "azure_virtual_network" },
    identity_auth: { DEFAULT: "azure_ad_b2c" },
    dns: { DEFAULT: "azure_dns" },

    // 5️⃣ OPERATIONS
    monitoring: { DEFAULT: "azure_monitor" },
    logging: { DEFAULT: "azure_log_analytics" },
    secrets_management: { DEFAULT: "azure_key_vault" }
};

// Combined mapping
const CLOUD_SERVICE_MAP = {
    AWS: AWS_SERVICE_MAP,
    GCP: GCP_SERVICE_MAP,
    AZURE: AZURE_SERVICE_MAP
};

// Human-readable service names
const SERVICE_DISPLAY_NAMES = {
    // AWS
    aws_ecs_fargate: "ECS Fargate",
    aws_eks: "Elastic Kubernetes Service (EKS)",
    aws_lambda: "Lambda",
    aws_instance: "EC2",
    aws_s3_website: "S3 Static Hosting",
    aws_rds_postgresql: "RDS PostgreSQL",
    aws_aurora_postgresql: "Aurora PostgreSQL",
    aws_rds_mysql: "RDS MySQL",
    aws_aurora_mysql: "Aurora MySQL",
    aws_dynamodb: "DynamoDB",
    aws_elasticache_redis: "ElastiCache Redis",
    aws_s3: "S3",
    aws_ebs: "EBS",
    aws_alb: "Application Load Balancer",
    aws_apigateway_v2: "API Gateway HTTP",
    aws_api_gateway_rest: "API Gateway REST",
    aws_sqs: "SQS",
    aws_eventbridge: "EventBridge",
    aws_opensearch: "OpenSearch",
    aws_cloudfront: "CloudFront",
    aws_vpc: "VPC",
    aws_cognito: "Cognito",
    aws_route53: "Route 53",
    aws_cloudwatch: "CloudWatch",
    aws_cloudwatch_logs: "CloudWatch Logs",
    aws_secrets_manager: "Secrets Manager",

    // GCP
    google_cloud_run: "Cloud Run",
    google_gke: "Google Kubernetes Engine (GKE)",
    google_cloud_functions: "Cloud Functions",
    google_compute_instance: "Compute Engine",
    google_cloud_storage_website: "Cloud Storage Static",
    google_cloud_sql_postgres: "Cloud SQL PostgreSQL",
    google_cloud_sql_postgres_ha: "Cloud SQL PostgreSQL HA",
    google_cloud_sql_mysql: "Cloud SQL MySQL",
    google_firestore: "Firestore",
    google_memorystore_redis: "Memorystore Redis",
    google_cloud_storage: "Cloud Storage",
    google_persistent_disk: "Persistent Disk",
    google_cloud_load_balancer: "Cloud Load Balancer",
    google_api_gateway: "API Gateway",
    google_pubsub: "Pub/Sub",
    google_eventarc: "Eventarc",
    elastic_cloud_on_gcp: "Elastic Cloud",
    google_cloud_cdn: "Cloud CDN",
    google_compute_network: "VPC",
    google_identity_platform: "Identity Platform",
    google_cloud_dns: "Cloud DNS",
    google_cloud_monitoring: "Cloud Monitoring",
    google_cloud_logging: "Cloud Logging",
    google_secret_manager: "Secret Manager",

    // Azure
    azure_container_apps: "Container Apps",
    azure_aks: "Azure Kubernetes Service (AKS)",
    azure_functions: "Azure Functions",
    azure_virtual_machine: "Virtual Machines",
    azure_static_web_apps: "Static Web Apps",
    azure_postgresql_flexible: "PostgreSQL Flexible Server",
    azure_postgresql_flexible_ha: "PostgreSQL Flexible Server HA",
    azure_mysql_flexible: "MySQL Flexible Server",
    azure_cosmosdb: "Cosmos DB",
    azure_cache_redis: "Azure Cache for Redis",
    azure_blob_storage: "Blob Storage",
    azure_managed_disk: "Managed Disks",
    azure_application_gateway: "Application Gateway",
    azure_api_management: "API Management",
    azure_service_bus: "Service Bus",
    azure_event_grid: "Event Grid",
    azure_cognitive_search: "Cognitive Search",
    azure_cdn_standard: "Azure CDN",
    azure_front_door: "Azure Front Door",
    azure_virtual_network: "Virtual Network",
    azure_ad_b2c: "Azure AD B2C",
    azure_dns: "Azure DNS",
    azure_monitor: "Azure Monitor",
    azure_log_analytics: "Log Analytics",
    azure_key_vault: "Key Vault"
};

/**
 * Get the cloud-specific service for a service class
 * @param {string} provider - AWS, GCP, or AZURE
 * @param {string} serviceClass - One of the 21 service classes
 * @param {string} costProfile - COST_EFFECTIVE or HIGH_PERFORMANCE
 * @param {object} options - Additional options (e.g., database engine)
 * @returns {string} Cloud-specific service identifier
 */
function mapServiceToCloud(provider, serviceClass, costProfile = 'COST_EFFECTIVE', options = {}) {
    const providerMap = CLOUD_SERVICE_MAP[provider];
    if (!providerMap) {
        throw new Error(`Unknown provider: ${provider}`);
    }

    const serviceMapping = providerMap[serviceClass];
    if (!serviceMapping) {
        return null; // Service not required
    }

    // Handle database engine variants
    if (serviceClass === 'relational_database') {
        const engine = options.engine || 'postgres';
        const perfKey = costProfile === 'HIGH_PERFORMANCE' ? 'PERF' : 'COST';
        const key = `${engine.toUpperCase()}_${perfKey}`;
        return serviceMapping[key] || serviceMapping[`${engine.toUpperCase()}_COST`] || serviceMapping.DEFAULT;
    }

    // Check for cost profile specific mapping
    if (serviceMapping[costProfile]) {
        return serviceMapping[costProfile];
    }

    // Fall back to DEFAULT
    return serviceMapping.DEFAULT || Object.values(serviceMapping)[0];
}

/**
 * Get display name for a cloud service
 */
function getServiceDisplayName(serviceId) {
    return SERVICE_DISPLAY_NAMES[serviceId] || serviceId;
}

/**
 * Map all required services for a provider
 * @param {string} provider - AWS, GCP, or AZURE
 * @param {object} infraSpec - The InfraSpec from Step 2
 * @param {string} costProfile - COST_EFFECTIVE or HIGH_PERFORMANCE
 * @returns {array} List of mapped services with details
 */
function mapAllServices(provider, infraSpec, costProfile = 'COST_EFFECTIVE') {
    const mappedServices = [];
    const requiredServices = infraSpec.service_classes?.required_services || [];
    const components = infraSpec.components || {};

    for (const service of requiredServices) {
        const serviceClass = service.service_class;
        const componentConfig = components[serviceClass] || {};

        const cloudService = mapServiceToCloud(provider, serviceClass, costProfile, {
            engine: componentConfig.engine || 'postgresql'
        });

        if (cloudService) {
            mappedServices.push({
                service_class: serviceClass,
                cloud_service: cloudService,
                display_name: getServiceDisplayName(cloudService),
                category: getCategoryForServiceClass(serviceClass),
                config: componentConfig
            });
        }
    }

    return mappedServices;
}

/**
 * Get category for a service class
 */
function getCategoryForServiceClass(serviceClass) {
    const categories = {
        compute_container: 'Compute',
        compute_serverless: 'Compute',
        compute_vm: 'Compute',
        compute_static: 'Compute',
        relational_database: 'Data & State',
        nosql_database: 'Data & State',
        cache: 'Data & State',
        object_storage: 'Data & State',
        block_storage: 'Data & State',
        load_balancer: 'Traffic & Integration',
        api_gateway: 'Traffic & Integration',
        messaging_queue: 'Traffic & Integration',
        event_bus: 'Traffic & Integration',
        search_engine: 'Traffic & Integration',
        cdn: 'Traffic & Integration',
        networking: 'Platform Essentials',
        identity_auth: 'Platform Essentials',
        dns: 'Platform Essentials',
        monitoring: 'Operations',
        logging: 'Operations',
        secrets_management: 'Operations'
    };
    return categories[serviceClass] || 'Other';
}

module.exports = {
    CLOUD_SERVICE_MAP,
    SERVICE_DISPLAY_NAMES,
    mapServiceToCloud,
    getServiceDisplayName,
    mapAllServices,
    getCategoryForServiceClass
};
