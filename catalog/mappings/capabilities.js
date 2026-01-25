/**
 * capabilities.js
 * Capability → canonical service mapping
 *
 * Rules:
 * - Capabilities are intent-level signals from Step 1 (from axes.js).
 * - Services are canonical IDs that exist in your catalog packs.
 * - Values from axes.js are tri-state: 'required' | 'none' | 'unknown'
 */

'use strict';

// Each capability maps to:
// - required: services always added when capability is 'required'
// - optional: services added only if opts.includeOptional = true
const CAPABILITY_TO_SERVICE = {
  // Data
  data_persistence: {
    required: ['relationaldatabase'],
    optional: ['nosqldatabase', 'backup']
  },

  document_storage: {
    required: ['objectstorage'],
    optional: ['cdn']
  },

  static_content: {
    required: ['objectstorage', 'cdn', 'dns'],
    optional: ['waf', 'certificatemanagement']
  },

  // Identity & roles
  identity_access: {
    required: ['identityauth'],
    optional: ['secretsmanagement', 'keymanagement']
  },

  multi_user_roles: {
    required: ['identityauth'],
    optional: ['policygovernance']
  },

  // API & compute
  api_backend: {
    required: ['apigateway', 'computeserverless'],
    optional: ['logging', 'monitoring', 'tracing', 'waf']
  },

  realtime: {
    // Keep it generic: realtime is usually eventing + compute.
    // If you later add websocket_gateway to catalog, add it here.
    required: ['eventbus', 'computeserverless'],
    optional: ['messagequeue', 'cache']
  },

  scheduled_jobs: {
    required: ['workfloworchestration', 'computeserverless'],
    optional: ['messagequeue']
  },

  // Messaging/events
  messaging: {
    required: ['messagequeue'],
    optional: ['eventbus']
  },

  eventing: {
    required: ['eventbus'],
    optional: ['messagequeue']
  },

  // Search
  search: {
    required: ['searchengine'],
    optional: ['cache']
  },

  // Payments
  payments: {
    required: ['paymentgateway'],
    optional: ['logging', 'monitoring']
  },

  // Ops
  observability: {
    required: ['logging', 'monitoring'],
    optional: ['tracing', 'siem']
  },

  devops_automation: {
    required: ['cicd'],
    optional: ['containerregistry', 'artifactrepository']
  },

  // Compliance / security hardening
  pci_compliant: {
    required: ['waf', 'keymanagement', 'logging'],
    optional: ['siem', 'policygovernance']
  },

  hipaa_compliant: {
    required: ['keymanagement', 'logging'],
    optional: ['siem', 'policygovernance']
  },

  private_networking: {
    required: ['vpcnetworking', 'privatelink'],
    optional: ['vpn', 'natgateway']
  },

  // Domains
  domain_iot: {
    required: ['iotcore', 'eventstream', 'timeseriesdatabase'],
    optional: ['streamprocessor', 'objectstorage']
  },

  domain_ml_heavy: {
    required: ['mlinference'],  // 🔥 FIX: Only inference required, training is optional for LLM API apps
    optional: ['mltraining', 'featurestore', 'datawarehouse', 'objectstorage', 'vectordatabase', 'cache']
  },

  domain_analytics: {
    required: ['datawarehouse', 'streamprocessor'],
    optional: ['objectstorage']
  },

  // 🔥 FIX 1: Capability shims for complete axes → capabilities → services chain
  workflow_orchestration: {
    required: ['computecontainer'],  // Jobs → Containers (Step Functions alternative)
    optional: ['messagequeue', 'computeserverless']
  },

  cicd: {
    required: ['containerregistry'],  // DevOps → Registry
    optional: ['computecontainer', 'objectstorage']
  },

  siem: {
    required: ['logging'],  // Already covered, explicit mapping
    optional: ['monitoring', 'auditlogging']
  },

  // 🔥 FIX: Direct cache capability mapping
  cache: {
    required: ['cache'],
    optional: []
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
 * Terminal exclusions: if a capability is explicitly 'none', you can treat its services as blocked.
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
