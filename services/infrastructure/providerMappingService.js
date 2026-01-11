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
    computeserverless: 'AWS Lambda',
    computecontainer: 'Amazon ECS / Fargate',
    computevm: 'Amazon EC2',
    computebatch: 'AWS Batch',
    apigateway: 'API Gateway',
    loadbalancer: 'Application Load Balancer',
    relationaldatabase: 'Amazon RDS (PostgreSQL)',
    nosqldatabase: 'DynamoDB',
    cache: 'Amazon ElastiCache (Redis)',
    objectstorage: 'Amazon S3',
    blockstorage: 'Amazon EBS',
    cdn: 'Amazon CloudFront',
    dns: 'Amazon Route 53',
    websocketgateway: 'API Gateway WebSocket',
    messagequeue: 'Amazon SQS',
    eventbus: 'Amazon EventBridge',
    identityauth: 'Amazon Cognito',
    paymentgateway: 'Stripe Integration',
    pushnotificationservice: 'Amazon SNS',
    logging: 'CloudWatch Logs',
    monitoring: 'CloudWatch Metrics',
    secretsmanagement: 'AWS Secrets Manager',
    vpcnetworking: 'Amazon VPC'
  },

  gcp: {
    computeserverless: 'Cloud Functions',
    computecontainer: 'Cloud Run / GKE',
    computevm: 'Compute Engine',
    computebatch: 'Cloud Batch',
    apigateway: 'Cloud Endpoints',
    loadbalancer: 'Cloud Load Balancing',
    relationaldatabase: 'Cloud SQL (PostgreSQL)',
    nosqldatabase: 'Firestore',
    cache: 'Memorystore (Redis)',
    objectstorage: 'Cloud Storage',
    blockstorage: 'Persistent Disk',
    cdn: 'Cloud CDN',
    dns: 'Cloud DNS',
    websocketgateway: 'Cloud Run WebSocket',
    messagequeue: 'Cloud Pub/Sub',
    eventbus: 'Eventarc',
    identityauth: 'Identity Platform',
    paymentgateway: 'Stripe Integration',
    pushnotificationservice: 'Firebase Cloud Messaging',
    logging: 'Cloud Logging',
    monitoring: 'Cloud Monitoring',
    secretsmanagement: 'Secret Manager',
    vpcnetworking: 'VPC Network'
  },

  azure: {
    computeserverless: 'Azure Functions',
    computecontainer: 'Azure Container Apps',
    computevm: 'Azure Virtual Machines',
    computebatch: 'Azure Batch',
    apigateway: 'Azure API Management',
    loadbalancer: 'Azure Application Gateway',
    relationaldatabase: 'Azure Database for PostgreSQL',
    nosqldatabase: 'Azure Cosmos DB',
    cache: 'Azure Cache for Redis',
    objectstorage: 'Azure Blob Storage',
    blockstorage: 'Azure Managed Disks',
    cdn: 'Azure Front Door',
    dns: 'Azure DNS',
    websocketgateway: 'Azure Web PubSub',
    messagequeue: 'Azure Service Bus',
    eventbus: 'Azure Event Grid',
    identityauth: 'Azure AD B2C / Entra ID',
    paymentgateway: 'Stripe Integration',
    pushnotificationservice: 'Azure Notification Hubs',
    logging: 'Azure Monitor Logs',
    monitoring: 'Azure Monitor',
    secretsmanagement: 'Azure Key Vault',
    vpcnetworking: 'Azure Virtual Network'
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
