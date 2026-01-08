/**
 * CANONICAL SERVICE REGISTRY
 * Single source of truth for all canonical services
 * 
 * CRITICAL RULES:
 * 1. This is the ONLY place where services are defined
 * 2. Every service MUST have: category, kind, terraform_supported
 * 3. Service kinds:
 *    - deployable: Must have Terraform module (e.g., relational_database, app_compute)
 *    - conditional: Terraform only if explicitly enabled (e.g., message_queue, cache)
 *    - logical: Architecture-only, NO Terraform (e.g., event_bus, waf, artifact_registry)
 * 4. If terraform_supported = false, service MUST NOT reach Terraform generation
 */

const ServiceClass = {
  TERRAFORM_CORE: 'terraform_core',         // Always generate code, blocks Terraform if missing
  TERRAFORM_OPTIONAL: 'terraform_optional', // Represent but don't block Terraform
  SAAS_API_ONLY: 'saas_api_only',          // Never Terraform-blocking
  EXCLUDED: 'excluded'                     // Explicitly excluded
};

const ServiceKind = {
  DEPLOYABLE: 'deployable',      // Must have Terraform
  CONDITIONAL: 'conditional',    // Terraform only if enabled
  LOGICAL: 'logical'             // No Terraform, architecture-only
};

const CANONICAL_SERVICES = {
  // ═════════════════════════════════════════════════════════════════
  // COMPUTE SERVICES
  // ═════════════════════════════════════════════════════════════════
  app_compute: {
    category: 'compute',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Application compute service (containers/VMs)'
  },
  serverless_compute: {
    category: 'compute',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Serverless compute for application logic'
  },
  batch_compute: {
    category: 'compute',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Batch compute for long-running jobs'
  },
  compute_static: {
    category: 'compute',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Static site hosting'
  },

  // ═════════════════════════════════════════════════════════════════
  // DATABASE SERVICES
  // ═════════════════════════════════════════════════════════════════
  relational_database: {
    category: 'database',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Relational database for structured data'
  },
  nosql_database: {
    category: 'database',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'NoSQL database for flexible data storage'
  },
  analytical_database: {
    category: 'database',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Analytical database for OLAP workloads'
  },
  cache: {
    category: 'database',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'In-memory cache for performance'
  },

  // ═════════════════════════════════════════════════════════════════
  // STORAGE SERVICES
  // ═════════════════════════════════════════════════════════════════
  object_storage: {
    category: 'storage',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Object storage for static files and assets'
  },
  block_storage: {
    category: 'storage',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'Block storage for persistent volumes'
  },

  // ═════════════════════════════════════════════════════════════════
  // NETWORKING SERVICES
  // ═════════════════════════════════════════════════════════════════
  cdn: {
    category: 'networking',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Content delivery network for global distribution'
  },
  load_balancer: {
    category: 'networking',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Load balancer for traffic distribution'
  },
  api_gateway: {
    category: 'networking',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'API gateway for request routing and management'
  },
  networking: {
    category: 'networking',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'VPC / VNet, subnets, security groups, NAT'
  },
  dns: {
    category: 'networking',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'Domain routing'
  },

  // ═════════════════════════════════════════════════════════════════
  // MESSAGING SERVICES
  // ═════════════════════════════════════════════════════════════════
  message_queue: {
    category: 'messaging',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Message queue for async processing'
  },
  event_bus: {
    category: 'messaging',
    kind: ServiceKind.LOGICAL,           // 🔑 NO TERRAFORM
    terraform_supported: false,
    cost_effective: true,
    class: ServiceClass.SAAS_API_ONLY,
    blocks_terraform: false,
    description: 'Event-driven architecture bus (architectural pattern)'
  },
  websocket_gateway: {
    category: 'messaging',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'WebSocket gateway for real-time connections'
  },
  push_notification_service: {
    category: 'messaging',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'Push notification service for mobile alerts'
  },

  // ═════════════════════════════════════════════════════════════════
  // SECURITY SERVICES
  // ═════════════════════════════════════════════════════════════════
  identity_auth: {
    category: 'security',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'User authentication and identity management'
  },
  secrets_management: {
    category: 'security',
    kind: ServiceKind.CONDITIONAL,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'Secrets and key management'
  },
  waf: {
    category: 'security',
    kind: ServiceKind.LOGICAL,           // 🔑 NO TERRAFORM
    terraform_supported: false,
    cost_effective: true,
    class: ServiceClass.SAAS_API_ONLY,
    blocks_terraform: false,
    description: 'Web application firewall (policy, not deployable)'
  },

  // ═════════════════════════════════════════════════════════════════
  // OBSERVABILITY SERVICES
  // ═════════════════════════════════════════════════════════════════
  monitoring: {
    category: 'observability',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Infrastructure and application monitoring'
  },
  logging: {
    category: 'observability',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_CORE,
    blocks_terraform: true,
    description: 'Centralized logging service'
  },

  // ═════════════════════════════════════════════════════════════════
  // PAYMENTS (LOGICAL)
  // ═════════════════════════════════════════════════════════════════
  payment_gateway: {
    category: 'payments',
    kind: ServiceKind.LOGICAL,           // 🔑 NO TERRAFORM (3rd party integration)
    terraform_supported: false,
    cost_effective: true,
    class: ServiceClass.SAAS_API_ONLY,
    blocks_terraform: false,
    description: 'Payment processing integration (Stripe, PayPal)'
  },

  // ═════════════════════════════════════════════════════════════════
  // ML SERVICES
  // ═════════════════════════════════════════════════════════════════
  ml_inference_service: {
    category: 'ml',
    kind: ServiceKind.DEPLOYABLE,
    terraform_supported: true,
    cost_effective: true,
    class: ServiceClass.TERRAFORM_OPTIONAL,
    blocks_terraform: false,
    description: 'ML model inference service'
  },
  artifact_registry: {
    category: 'storage',
    kind: ServiceKind.LOGICAL,           // 🔑 NO TERRAFORM
    terraform_supported: false,
    cost_effective: true,
    class: ServiceClass.SAAS_API_ONLY,
    blocks_terraform: false,
    description: 'Artifact and model registry (policy, not infra)'
  }
};

/**
 * Get service classification by name
 * @param {string} serviceName - Canonical service name
 * @returns {object|null} Service definition or null if not found
 */
function getServiceDefinition(serviceName) {
  return CANONICAL_SERVICES[serviceName] || null;
}

/**
 * Validate if a service is deployable (can have Terraform)
 * @param {string} serviceName - Canonical service name
 * @returns {boolean} True if service can be deployed via Terraform
 */
function isDeployable(serviceName) {
  const service = CANONICAL_SERVICES[serviceName];
  return service && service.terraform_supported === true && 
         (service.class === 'terraform_core' || service.class === 'terraform_optional');
}

/**
 * Get all services by kind
 * @param {string} kind - 'deployable', 'conditional', or 'logical'
 * @returns {string[]} Array of service names
 */
function getServicesByKind(kind) {
  return Object.keys(CANONICAL_SERVICES).filter(
    name => CANONICAL_SERVICES[name].kind === kind
  );
}

/**
 * Get all services by category
 * @param {string} category - Service category
 * @returns {string[]} Array of service names
 */
function getServicesByCategory(category) {
  return Object.keys(CANONICAL_SERVICES).filter(
    name => CANONICAL_SERVICES[name].category === category
  );
}

module.exports = {
  CANONICAL_SERVICES,
  ServiceKind,
  getServiceDefinition,
  isDeployable,
  getServicesByKind,
  getServicesByCategory
};
