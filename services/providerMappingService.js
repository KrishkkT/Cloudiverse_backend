/**
 * PROVIDER MAPPING SERVICE
 * 
 * Maps canonical services contract to provider-specific services
 * This enforces the canonical architecture as single source of truth
 * 
 * KEY PRINCIPLE:
 * - Input: Canonical services contract (provider-agnostic)
 * - Output: Provider-specific service names and configurations
 * - NO guessing, NO inference, NO injection
 */

// Provider-specific service mappings (static knowledge base)
const PROVIDER_SERVICE_MAP = {
  aws: {
    compute: 'AWS Lambda',
    app_compute: 'AWS Lambda / Fargate',
    compute_serverless: 'AWS Lambda',
    compute_container: 'Amazon ECS / Fargate',
    compute_vm: 'Amazon EC2',
    batch_compute: 'AWS Batch', // 🔥 FIX 2: Batch processing for analytics
    api_gateway: 'API Gateway',
    load_balancer: 'Application Load Balancer',
    relational_db: 'Amazon RDS (PostgreSQL)',
    relational_database: 'Amazon RDS (PostgreSQL)',
    analytical_database: 'Amazon Redshift', // 🔥 FIX 2: Analytics/OLAP database
    nosql_db: 'DynamoDB',
    cache: 'Amazon ElastiCache (Redis)',
    object_storage: 'Amazon S3',
    block_storage: 'Amazon EBS',
    cdn: 'Amazon CloudFront',
    dns: 'Amazon Route 53',
    websocket_gateway: 'API Gateway WebSocket',
    message_queue: 'Amazon SQS',
    event_bus: 'Amazon EventBridge',
    authentication: 'Amazon Cognito',
    identity_auth: 'Amazon Cognito',
    payment_gateway: 'Stripe Integration',
    push_notification_service: 'Amazon SNS', // 🔒 FIX 3: Mobile push notifications
    logging: 'CloudWatch Logs',
    monitoring: 'CloudWatch Metrics',
    secrets_management: 'AWS Secrets Manager',
    networking: 'Amazon VPC'
  },
  
  gcp: {
    compute: 'Cloud Functions',
    app_compute: 'Cloud Run / Cloud Functions',
    compute_serverless: 'Cloud Functions',
    compute_container: 'Cloud Run / GKE',
    compute_vm: 'Compute Engine',
    batch_compute: 'Cloud Batch', // 🔥 FIX 2: Batch processing for analytics
    api_gateway: 'Cloud Endpoints',
    load_balancer: 'Cloud Load Balancing',
    relational_db: 'Cloud SQL (PostgreSQL)',
    relational_database: 'Cloud SQL (PostgreSQL)',
    analytical_database: 'BigQuery', // 🔥 FIX 2: Analytics/OLAP database
    nosql_db: 'Firestore',
    cache: 'Memorystore (Redis)',
    object_storage: 'Cloud Storage',
    block_storage: 'Persistent Disk',
    cdn: 'Cloud CDN',
    dns: 'Cloud DNS',
    websocket_gateway: 'Cloud Run WebSocket',
    message_queue: 'Cloud Pub/Sub',
    event_bus: 'Eventarc',
    authentication: 'Identity Platform',
    identity_auth: 'Identity Platform',
    payment_gateway: 'Stripe Integration',
    push_notification_service: 'Firebase Cloud Messaging', // 🔒 FIX 3: Mobile push notifications
    logging: 'Cloud Logging',
    monitoring: 'Cloud Monitoring',
    secrets_management: 'Secret Manager',
    networking: 'VPC Network'
  },
  
  azure: {
    compute: 'Azure Functions',
    app_compute: 'Azure App Service / Functions',
    compute_serverless: 'Azure Functions',
    compute_container: 'Azure Container Apps',
    compute_vm: 'Azure Virtual Machines',
    batch_compute: 'Azure Batch', // 🔥 FIX 2: Batch processing for analytics
    api_gateway: 'Azure API Management',
    load_balancer: 'Azure Application Gateway',
    relational_db: 'Azure Database for PostgreSQL',
    relational_database: 'Azure Database for PostgreSQL',
    analytical_database: 'Azure Synapse Analytics', // 🔥 FIX 2: Analytics/OLAP database
    nosql_db: 'Azure Cosmos DB',
    cache: 'Azure Cache for Redis',
    object_storage: 'Azure Blob Storage',
    block_storage: 'Azure Managed Disks',
    cdn: 'Azure Front Door',
    dns: 'Azure DNS',
    websocket_gateway: 'Azure Web PubSub',
    message_queue: 'Azure Service Bus',
    event_bus: 'Azure Event Grid',
    authentication: 'Azure AD B2C / Entra ID',
    identity_auth: 'Azure AD B2C / Entra ID',
    payment_gateway: 'Stripe Integration',
    push_notification_service: 'Azure Notification Hubs', // 🔒 FIX 3: Mobile push notifications
    logging: 'Azure Monitor Logs',
    monitoring: 'Azure Monitor',
    secrets_management: 'Azure Key Vault',
    networking: 'Azure Virtual Network'
  }
};

/**
 * Map canonical services contract to provider-specific implementation
 * 
 * @param {Object} servicesContract - The canonical services contract
 * @param {string} provider - Target cloud provider (aws, gcp, azure)
 * @returns {Object} Provider-specific architecture
 */
function mapCanonicalToProvider(servicesContract, provider) {
  if (!servicesContract || !servicesContract.services) {
    throw new Error('[PROVIDER MAPPING] Invalid services contract - missing services array');
  }
  
  if (!servicesContract.validated || !servicesContract.complete) {
    throw new Error('[PROVIDER MAPPING] Services contract not validated or incomplete');
  }
  
  const providerLower = provider.toLowerCase();
  const providerMap = PROVIDER_SERVICE_MAP[providerLower];
  
  if (!providerMap) {
    throw new Error(`[PROVIDER MAPPING] Unsupported provider: ${provider}`);
  }
  
  console.log(`[PROVIDER MAPPING] Mapping ${servicesContract.total_services} canonical services to ${provider.toUpperCase()}`);
  
  // Map each canonical service to provider-specific service
  const providerServices = servicesContract.services.map(canonicalService => {
    const providerServiceName = providerMap[canonicalService.canonical_type];
    
    if (!providerServiceName) {
      console.warn(`[PROVIDER MAPPING] No mapping for ${canonicalService.canonical_type} on ${provider}, using generic name`);
    }
    
    return {
      id: canonicalService.id,
      canonical_type: canonicalService.canonical_type,
      provider_service: providerServiceName || `${provider} ${canonicalService.canonical_type}`,
      category: canonicalService.category,
      description: canonicalService.description,
      required: canonicalService.required,
      pattern_enforced: canonicalService.pattern_enforced
    };
  });
  
  console.log(`[PROVIDER MAPPING] Successfully mapped to ${providerServices.length} ${provider.toUpperCase()} services`);
  
  return {
    provider: provider.toUpperCase(),
    pattern: servicesContract.pattern,
    total_services: providerServices.length,
    services: providerServices,
    canonical_contract: servicesContract, // Include original for reference
    mapped_at: new Date().toISOString()
  };
}

/**
 * Generate service list for display in UI
 * 
 * @param {Object} providerArchitecture - Provider-mapped architecture
 * @returns {Array} List of services with descriptions
 */
function generateServicesList(providerArchitecture) {
  if (!providerArchitecture || !providerArchitecture.services) {
    return [];
  }
  
  return providerArchitecture.services.map(service => ({
    id: service.id,
    name: service.provider_service,
    canonical_type: service.canonical_type,
    category: service.category,
    description: service.description,
    required: service.required
  }));
}

/**
 * Validate that provider mapping is complete
 * 
 * @param {Object} providerArchitecture - Provider-mapped architecture
 * @throws {Error} If validation fails
 */
function validateProviderMapping(providerArchitecture) {
  if (!providerArchitecture.services || providerArchitecture.services.length === 0) {
    throw new Error('[VALIDATION] Provider architecture has no services');
  }
  
  const unmapped = providerArchitecture.services.filter(s => 
    !s.provider_service || s.provider_service.includes('undefined')
  );
  
  if (unmapped.length > 0) {
    const unmappedTypes = unmapped.map(s => s.canonical_type).join(', ');
    throw new Error(`[VALIDATION] Unmapped services for ${providerArchitecture.provider}: ${unmappedTypes}`);
  }
  
  console.log(`[VALIDATION] Provider mapping complete and valid for ${providerArchitecture.provider}`);
  return true;
}

module.exports = {
  mapCanonicalToProvider,
  generateServicesList,
  validateProviderMapping,
  PROVIDER_SERVICE_MAP
};
