/**
 * capabilities.js
 * Capability → canonical service mapping
 *
 * Rules:
 * - Capabilities are intent-level signals from Step 1 (from axes.js).
 * - Services are canonical IDs that exist in your infra catalog (used by cloud.js).
 * - Values from axes.js are tri-state: 'required' | 'none' | 'unknown'
 */
'use strict';

// Each capability maps to:
// - required: services always added when capability is 'required'
// - optional: services added only if opts.includeOptional = true
const CAPABILITY_TO_SERVICE = {
  // Data
  data_persistence: {
    required: ['relational_database'],
    optional: ['nosql_database', 'backup']
  },

  document_storage: {
    required: ['object_storage'],
    optional: ['cdn']
  },

  static_content: {
    required: ['object_storage', 'cdn', 'dns'],
    optional: ['waf', 'certificate_management']
  },

  // Identity & roles
  identity_access: {
    required: ['identity_auth'],
    optional: ['secrets_management', 'key_management']
  },

  multi_user_roles: {
    required: ['identity_auth'],
    optional: ['policy_governance']
  },

  // API & compute
  api_backend: {
    required: ['api_gateway', 'compute_serverless'],
    optional: ['logging', 'monitoring', 'tracing', 'waf']
  },

  realtime: {
    // generic realtime: events + compute; websocket_gateway can be added later if catalog supports it
    required: ['event_bus', 'compute_serverless'],
    optional: ['messaging_queue', 'cache']
  },

  scheduled_jobs: {
    required: ['workflow_orchestration', 'compute_serverless'],
    optional: ['messaging_queue', 'compute_container']
  },

  // Messaging/events
  messaging: {
    required: ['messaging_queue'],
    optional: ['event_bus']
  },

  eventing: {
    required: ['event_bus'],
    optional: ['messaging_queue']
  },

  // Search
  search: {
    required: ['search_engine'],
    optional: ['cache']
  },

  // Delivery/perf
  content_delivery: {
    required: ['cdn'],
    optional: ['dns']
  },

  caching: {
    required: ['cache'],
    optional: []
  },

  // Notifications
  notifications: {
    required: ['notification'],
    optional: ['messaging_queue']
  },

  // Billing / subscription (infra posture)
  billing_subscription: {
    required: ['workflow_orchestration', 'logging'],
    optional: ['messaging_queue', 'notification']
  },

  usage_tracking: {
    required: ['logging'],
    optional: ['event_stream', 'data_warehouse', 'stream_processor']
  },

  invoicing: {
    required: ['workflow_orchestration', 'object_storage', 'notification'],
    optional: ['logging']
  },

  // Payments (treat as “security posture for payment flows”, not as a cloud payment product)
  payments: {
    required: ['payments_processor', 'secrets_management', 'key_management'],
    optional: ['siem', 'policy_governance', 'waf', 'messaging_queue']
  },

  // Ops
  observability: {
    required: ['logging', 'monitoring'],
    optional: ['tracing', 'siem']
  },

  devops_automation: {
    required: ['ci_cd'],
    optional: ['container_registry', 'artifact_repository']
  },

  // Compliance / security hardening
  pci_compliant: {
    required: ['waf', 'key_management', 'logging', 'policy_governance'],
    optional: ['siem']
  },

  hipaa_compliant: {
    required: ['key_management', 'logging', 'policy_governance'],
    optional: ['siem']
  },

  gdpr_compliant: {
    required: ['key_management', 'logging', 'policy_governance'],
    optional: ['siem']
  },

  audit_logging: {
    required: ['logging'],
    optional: ['policy_governance']
  },

  key_management: {
    required: ['key_management'],
    optional: ['secrets_management', 'certificate_management']
  },

  siem: {
    required: ['siem'],
    optional: ['logging', 'monitoring']
  },

  private_networking: {
    required: ['vpc_networking', 'private_link'],
    optional: ['vpn', 'nat_gateway']
  },

  // Domains (service “bundles”)
  domain_iot: {
    required: ['iot_core', 'event_stream', 'time_series_database'],
    optional: ['stream_processor', 'object_storage']
  },

  domain_ml_heavy: {
    required: ['ml_inference'],
    optional: ['ml_training', 'feature_store', 'data_warehouse', 'object_storage', 'cache']
  },

  domain_analytics: {
    required: ['data_warehouse', 'stream_processor'],
    optional: ['object_storage']
  }
};

/**
 * Convert tri-state → boolean enabled
 */
function isCapabilityEnabled(value) {
  return value === true || value === 'required';
}

function getServicesForCapability(capability, opts = {}) {
  const row = CAPABILITY_TO_SERVICE[capability];
  if (!row) return [];

  const out = [...(row.required || [])];
  if (opts.includeOptional) out.push(...(row.optional || []));
  return out;
}

/**
 * Resolve canonical services from a capabilities object (tri-state supported).
 *
 * @param {object} capabilities like { data_persistence: 'required', payments: 'none', ... }
 * @param {object} [opts] { includeOptional: boolean }
 * @returns {string[]} unique canonical service IDs
 */
function resolveServicesFromCapabilities(capabilities, opts = {}) {
  const services = new Set();

  for (const [capability, value] of Object.entries(capabilities || {})) {
    if (!isCapabilityEnabled(value)) continue;

    const list = getServicesForCapability(capability, opts);
    list.forEach(svc => services.add(svc));
  }

  return Array.from(services);
}

/**
 * Terminal exclusions: if a capability is explicitly 'none', treat its services as blocked.
 */
function getBlockedServices(capabilities, opts = {}) {
  const blocked = new Set();

  for (const [capability, value] of Object.entries(capabilities || {})) {
    if (value !== 'none' && value !== false) continue;

    const list = getServicesForCapability(capability, opts);
    list.forEach(svc => blocked.add(svc));
  }

  return Array.from(blocked);
}

module.exports = {
  CAPABILITY_TO_SERVICE,
  getServicesForCapability,
  resolveServicesFromCapabilities,
  getBlockedServices
};
