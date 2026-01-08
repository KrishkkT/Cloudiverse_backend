/**
 * CAPABILITY TO SERVICE MAPPING
 * Bridge between Step 1 (user intent) and Step 2 (canonical architecture)
 * 
 * CRITICAL RULES:
 * 1. Capabilities are provider-agnostic user intent (from Step 1)
 * 2. Services are canonical infrastructure components (Step 2)
 * 3. One capability can map to MULTIPLE services (alternatives/combinations)
 * 4. This mapping is deterministic and explicit
 * 5. Terminal exclusions block ALL services for a capability
 */

const CAPABILITY_TO_SERVICE = {
  // Data persistence → Database services only (NOT object storage)
  data_persistence: ['relational_database'],
  
  // Identity & Access → Authentication service
  identity_access: ['identity_auth'],
  
  // Content delivery → CDN
  content_delivery: ['cdn'],
  
  // Payments → Payment gateway (logical, no Terraform)
  payments: ['payment_gateway'],
  
  // Eventing → Event bus (logical, shows in diagram, not in Terraform)
  eventing: ['event_bus'],
  
  // Messaging → Message queue (deployable)
  messaging: ['message_queue'],
  
  // Real-time → WebSocket gateway
  realtime: ['websocket_gateway'],
  
  // Document storage → Object storage
  document_storage: ['object_storage'],
  
  // Static content → CDN + Object Storage
  static_content: ['cdn', 'object_storage'],
  
  // API backend → API Gateway + Compute
  api_backend: ['api_gateway', 'app_compute'],
  
  // Case management → Relational DB (structured workflows)
  case_management: ['relational_database'],
  
  // Multi-user roles → Identity + Auth
  multi_user_roles: ['identity_auth']
};

/**
 * Get services for a capability
 * @param {string} capability - Capability name from Step 1
 * @returns {string[]} Array of canonical service names
 */
function getServicesForCapability(capability) {
  return CAPABILITY_TO_SERVICE[capability] || [];
}

/**
 * Get all services from multiple capabilities
 * @param {object} capabilities - Capabilities object from Step 1 (e.g., { data_persistence: true, payments: false })
 * @returns {string[]} Array of canonical service names (deduplicated)
 */
function resolveServicesFromCapabilities(capabilities) {
  const services = new Set();
  
  for (const [capability, value] of Object.entries(capabilities)) {
    // Only process explicitly enabled capabilities
    if (value === true) {
      const capabilityServices = getServicesForCapability(capability);
      capabilityServices.forEach(svc => services.add(svc));
    }
  }
  
  return Array.from(services);
}

/**
 * Get services blocked by terminal exclusions
 * @param {string[]} terminalExclusions - Array of excluded capabilities from Step 1
 * @returns {string[]} Array of canonical service names that should be blocked
 */
function getBlockedServices(terminalExclusions) {
  const blocked = new Set();
  
  terminalExclusions.forEach(capability => {
    const services = getServicesForCapability(capability);
    services.forEach(svc => blocked.add(svc));
  });
  
  return Array.from(blocked);
}

module.exports = {
  CAPABILITY_TO_SERVICE,
  getServicesForCapability,
  resolveServicesFromCapabilities,
  getBlockedServices
};
