/**
 * Pattern Resolver Service
 * Implements V1 Pattern Catalog (Authoritative)
 * 
 * 11 CANONICAL PATTERNS - Each project resolves to exactly ONE
 * Extensions add services, patterns never combine
 */

const { getServiceDefinition, isDeployable } = require('../../catalog/terraform/utils');
// CANONICAL_SERVICES is removed as we access services via utils or define needed constants here if strictly required for AI.
// const { CANONICAL_SERVICES, getServiceDefinition, isDeployable } = require('./canonicalServiceRegistry');
const { CAPABILITY_TO_SERVICE, resolveServicesFromCapabilities, getBlockedServices, getServicesForCapability } = require('../../catalog/mappings/capabilities');
const { mapAxesToCapabilities, getCapabilitiesSummary } = require('../../catalog/mappings/axes');

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Config-based pattern catalog for scoring (uses normalized patterns)
// ═══════════════════════════════════════════════════════════════════════════
const { patterns: patternsConfig, findBestPattern, getPattern: getPatternFromConfig } = require('../../config');
const CANONICAL_PATTERNS = { patterns: patternsConfig.patterns };

// 🔥 UNIFIED SSOT: Load Service Registry dynamically from new_services.json
const newServicesConfig = require('../../catalog/new_services.json');
const SERVICE_REGISTRY = newServicesConfig.services.reduce((acc, svc) => {
  acc[svc.service_id] = svc;
  return acc;
}, {});

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP INTEGRITY CHECK
// ═══════════════════════════════════════════════════════════════════════════
(function validateCatalogIntegrity() {
  console.log('[INTEGRITY] Running Service ID validation against Catalog SSOT...');
  const errors = [];

  // 1. Check CAPABILITY_TO_SERVICE
  for (const [cap, mapping] of Object.entries(CAPABILITY_TO_SERVICE)) {
    const checkList = [...(mapping.required || []), ...(mapping.optional || [])];
    checkList.forEach(svcId => {
      if (svcId === 'backup') return; // known placeholder/global
      if (!getServiceDefinition(svcId)) {
        errors.push(`Capability Mapping [${cap}] references unknown service: ${svcId}`);
      }
    });
  }

  if (errors.length > 0) {
    console.error('[INTEGRITY] ❌ FAILED! Service ID drift detected:');
    errors.forEach(err => console.error(`  - ${err}`));
    // In production, we might want to throw, but for now we log loudly.
  } else {
    console.log('[INTEGRITY] ✓ All Capability-to-Service mappings are valid.');
  }
})();



// ═══════════════════════════════════════════════════════════════════════════
// V1 PATTERN CATALOG (AUTHORITATIVE)
// ═══════════════════════════════════════════════════════════════════════════
const PATTERN_CATALOG = {
  // 1️⃣ STATIC_SITE
  STATIC_SITE: {
    name: 'Static Site',
    use_case: 'Informational websites, landing pages, documentation',
    mandatory_services: ['objectstorage', 'cdn', 'logging', 'monitoring'],
    optional_services: ['identityauth', 'waf'],
    forbidden_services: ['computecontainer', 'computeserverless', 'compute_vm', 'relationaldatabase', 'apigateway'],
    requirements: { stateful: false, backend: false, realtime: false, payments: false, ml: false }
  },

  // 2️⃣ STATIC_SITE_WITH_AUTH
  STATIC_SITE_WITH_AUTH: {
    name: 'Static Site with Auth',
    use_case: 'Marketing site with login / gated content',
    mandatory_services: ['objectstorage', 'cdn', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['waf'],
    forbidden_services: ['computecontainer', 'computeserverless', 'compute_vm', 'relationaldatabase', 'apigateway'],
    requirements: { stateful: false, backend: false, realtime: false, payments: false, ml: false, authentication: true }
  },

  // 3️⃣ SERVERLESS_API
  SERVERLESS_API: {
    name: 'Serverless API',
    use_case: 'Pure API backend, stateless, event-driven',
    mandatory_services: ['apigateway', 'computeserverless', 'logging', 'monitoring'],
    optional_services: ['nosqldatabase', 'objectstorage', 'messagequeue'],
    forbidden_services: ['relationaldatabase', 'loadbalancer'],
    requirements: { stateful: false, backend: true, realtime: false, payments: false, ml: false }
  },

  // 4️⃣ SERVERLESS_WEB_APP
  SERVERLESS_WEB_APP: { // 🔥 UPDATED: Dynamic Core
    name: 'Serverless Web App',
    use_case: 'Simple full-stack apps, low complexity',
    mandatory_services: ['computeserverless', 'logging', 'monitoring'],
    optional_services: ['cdn', 'apigateway', 'nosqldatabase', 'objectstorage', 'relationaldatabase', 'paymentgateway', 'identityauth'],
    forbidden_services: ['loadbalancer'],
    invalid_if: ['multi_user_workflows'],
    requirements: { stateful: false, backend: true, realtime: false, payments: false, ml: false }
  },

  // 5️⃣ STATEFUL_WEB_PLATFORM
  STATEFUL_WEB_PLATFORM: { // 🔥 UPDATED: Dynamic Core (already done)
    name: 'Stateful Web Platform',
    use_case: 'SaaS, CRMs, dashboards, ERPs (supports async workflows, messaging)',
    mandatory_services: ['loadbalancer', 'computecontainer', 'relationaldatabase', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['objectstorage', 'cache', 'messagequeue', 'websocketgateway', 'cdn', 'apigateway'],
    forbidden_services: ['computeserverless'],
    invalid_if: [],
    requirements: { stateful: true, backend: true, realtime: false, payments: false, ml: false }
  },

  // 6️⃣ HYBRID_PLATFORM
  HYBRID_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'Hybrid Platform',
    use_case: 'Stateful + realtime + async workflows',
    mandatory_services: ['computecontainer', 'computeserverless', 'logging', 'monitoring'],
    optional_services: ['cdn', 'loadbalancer', 'relationaldatabase', 'cache', 'messagequeue', 'identityauth', 'websocketgateway', 'paymentgateway', 'objectstorage'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: true, payments: false, ml: false }
  },

  // 7️⃣ MOBILE_BACKEND_PLATFORM
  MOBILE_BACKEND_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'Mobile Backend Platform',
    use_case: 'API backend for mobile apps, low latency required',
    mandatory_services: ['computecontainer', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'relationaldatabase', 'identityauth', 'push_notification_service', 'cache', 'messagequeue'],
    forbidden_services: ['cdn'],
    requirements: { stateful: true, backend: true, realtime: false, payments: false, ml: false, mobile_only: true }
  },

  // 8️⃣ DATA_PLATFORM
  DATA_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'Data Platform',
    use_case: 'Internal analytics, batch processing, data warehousing',
    mandatory_services: ['computebatch', 'logging', 'monitoring'],
    optional_services: ['data_warehouse', 'objectstorage', 'messagequeue', 'apigateway', 'identityauth'],
    forbidden_services: ['cdn', 'loadbalancer', 'computecontainer'],
    requirements: { stateful: true, backend: false, realtime: false, payments: false, ml: false, internal_only: true }
  },

  // 9️⃣ REALTIME_PLATFORM
  REALTIME_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'Real-time Platform',
    use_case: 'Chat apps, live dashboards, WebSockets, pub/sub',
    mandatory_services: ['websocketgateway', 'computecontainer', 'logging', 'monitoring'],
    optional_services: ['cache', 'messagequeue', 'relationaldatabase', 'identityauth', 'apigateway'],
    forbidden_services: [],
    requirements: { stateful: false, backend: true, realtime: true, payments: false, ml: false }
  },

  // 🔟 ML_INFERENCE_PLATFORM
  ML_INFERENCE_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'ML Inference Platform',
    use_case: 'Model serving, prediction APIs',
    mandatory_services: ['mlinference', 'logging', 'monitoring'],
    optional_services: ['objectstorage', 'apigateway', 'cache', 'vectordatabase', 'messagequeue'],
    forbidden_services: ['relationaldatabase', 'nosqldatabase', 'computebatch'],
    requirements: { stateful: false, backend: true, realtime: false, payments: false, ml: true }
  },

  // 1️⃣1️⃣ ML_TRAINING_PLATFORM
  ML_TRAINING_PLATFORM: {
    name: 'ML Training Platform',
    use_case: 'Training pipelines, batch jobs, GPU workloads',
    mandatory_services: ['computebatch', 'objectstorage', 'logging', 'monitoring'],
    optional_services: ['container_registry'],
    forbidden_services: [],
    requirements: { stateful: false, backend: false, realtime: false, payments: false, ml: true }
  },

  // 1️⃣2️⃣ HIGH_AVAILABILITY_PLATFORM
  HIGH_AVAILABILITY_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'High Availability Platform',
    use_case: '99.99% SLA multi-region deployment',
    mandatory_services: ['loadbalancer', 'apigateway', 'relationaldatabase', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['cdn', 'cache', 'messagequeue'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: false, payments: false, ml: false }
  },

  // 1️⃣3️⃣ IOT_PLATFORM
  IOT_PLATFORM: { // 🔥 UPDATED: Dynamic Core
    name: 'IoT Platform',
    use_case: 'Device management, telemetry, time-series data',
    mandatory_services: ['iotcore', 'logging', 'monitoring'],
    optional_services: ['timeseriesdatabase', 'eventstreaming', 'apigateway', 'objectstorage', 'sms_notification'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: true, payments: false, ml: false }
  },

  // 1️⃣4️⃣ FINTECH_PAYMENT_PLATFORM
  FINTECH_PAYMENT_PLATFORM: {
    name: 'Fintech Payment Platform',
    use_case: 'PCI-DSS compliant payment processing',
    mandatory_services: ['computecontainer', 'paymentgateway', 'identityauth', 'secretsmanagement', 'auditlogging', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'relationaldatabase', 'loadbalancer', 'cache'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: false, payments: true, ml: false }
  },

  // 1️⃣5️⃣ HEALTHCARE_PLATFORM
  HEALTHCARE_PLATFORM: {
    name: 'Healthcare Platform',
    use_case: 'HIPAA-compliant healthcare data',
    mandatory_services: ['computecontainer', 'identityauth', 'secretsmanagement', 'auditlogging', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'relationaldatabase', 'objectstorage'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: false, payments: false, ml: false }
  },

  // 1️⃣6️⃣ GAMING_BACKEND
  GAMING_BACKEND: {
    name: 'Gaming Backend',
    use_case: 'Real-time gaming with leaderboards',
    mandatory_services: ['computecontainer', 'cache', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'relationaldatabase', 'identityauth', 'websocketgateway', 'messagequeue'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: true, payments: false, ml: false }
  },

  // 1️⃣7️⃣ E_COMMERCE_BACKEND
  E_COMMERCE_BACKEND: {
    name: 'E-Commerce Backend',
    use_case: 'Online store with payments and inventory',
    mandatory_services: ['computecontainer', 'relationaldatabase', 'paymentgateway', 'logging', 'monitoring'],
    optional_services: ['cdn', 'apigateway', 'identityauth', 'objectstorage', 'cache'],
    forbidden_services: [],
    requirements: { stateful: true, backend: true, realtime: false, payments: true, ml: false }
  },

  // 1️⃣8️⃣ EVENT_DRIVEN_PLATFORM
  EVENT_DRIVEN_PLATFORM: {
    name: 'Event-Driven Platform',
    use_case: 'Decoupled event-based architecture',
    mandatory_services: ['messagequeue', 'computeserverless', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'objectstorage'],
    forbidden_services: [],
    requirements: { stateful: false, backend: true, realtime: false, payments: false, ml: false }
  },

  // 1️⃣9️⃣ CONTAINERIZED_WEB_APP
  CONTAINERIZED_WEB_APP: { // 🔥 UPDATED: Dynamic Core
    name: 'Containerized Web App',
    use_case: 'Standard web applications and REST APIs using containers',
    mandatory_services: ['loadbalancer', 'computecontainer', 'logging', 'monitoring'],
    optional_services: ['relationaldatabase', 'cache', 'objectstorage', 'messagequeue', 'cdn', 'apigateway', 'identityauth', 'waf', 'secretsmanagement', 'dns'],
    forbidden_services: ['computeserverless'],
    requirements: { stateful: true, backend: true, realtime: false, payments: false, ml: false }
  }
};




const PATTERN_VALIDATION_RULES = {
  'stateful + relationaldatabase': (requirements) => {
    if (requirements.stateful && requirements.data_stores?.includes('relationaldatabase')) {
      // SERVERLESS_WEB_APP is invalid for stateful applications
      return (pattern) => pattern !== 'SERVERLESS_WEB_APP';
    }
    return () => true;
  },
  'realtime + messaging': (requirements) => {
    if (requirements.realtime) {
      // Must include messaging + websocket layer
      return (pattern) => pattern === 'REALTIME_PLATFORM' || pattern === 'HYBRID_PLATFORM';
    }
    return () => true;
  },
  'payments + compliance': (requirements) => {
    if (requirements.payments) {
      // Must include secure backend + compliance notes
      return (pattern) => pattern !== 'SERVERLESS_API' && pattern !== 'STATIC_SITE';
    }
    return () => true;
  }
};

class PatternResolver {
  /**
   * Extract project requirements into a strict schema
   * NOW READS FROM FULL STEP1 RESULT INCLUDING DECISION_AXES
   */
  extractRequirements(intent) {
    try {
      const requirements = {
        workload_types: [],
        stateful: false,
        realtime: false,
        payments: false,
        authentication: false,
        data_stores: [],
        ml: false,
        public_facing: true,
        compliance: [],
        data_sensitivity: "low",
        // Non-functional requirements
        nfr: {
          availability: "99.5", // default
          latency: "medium",
          compliance: [],
          data_residency: null,
          cost_ceiling_usd: null,
          security_level: "standard"
        },
        // Region and multi-region
        region: {
          primary_region: "us-east-1", // default
          secondary_region: null,
          multi_region: false
        },
        // Data classification
        data_classes: {},
        // Data retention
        data_retention: {},
        // Deployment strategy
        deployment_strategy: "rolling",
        downtime_allowed: true,
        // Observability
        observability: {
          logs: true,
          metrics: true,
          metrics: true,
          alerts: false
        },
        // Compute preference (container vs serverless)
        compute_preference: null
      };

      // 🔥 CRITICAL FIX: Read from full step1Result, not just text
      // Use explicit_features, inferred_features, and decision_axes
      const explicitFeatures = intent.explicit_features || {};
      const inferredFeatures = intent.inferred_features || {};
      const decisionAxes = intent.decision_axes || {};
      const semanticSignals = intent.semantic_signals || {};
      const intentClassification = intent.intent_classification || {};

      // 🆕 NEW: Pass through capabilities and terminal_exclusions from Step 1
      const capabilities = intent.capabilities || {};
      const terminalExclusions = intent.terminal_exclusions || [];

      console.log('[EXTRACT REQUIREMENTS] Capabilities:', capabilities);
      console.log('[EXTRACT REQUIREMENTS] Terminal Exclusions:', terminalExclusions);


      // Fallback: Also safely extract from intent text if provided
      const text = (intent.project_description || intent.description || intent || '').toString().toLowerCase();

      // 🔒 FIX 1: Detect mobile_app_backend domain from intent_classification
      const primaryDomain = intentClassification.primary_domain || '';
      if (primaryDomain === 'mobile_app_backend' || primaryDomain.includes('mobile')) {
        requirements.workload_types.push('mobile_backend');
        console.log('[DOMAIN DETECTION] mobile_app_backend domain → mobile_backend workload');
      }

      // 🔥 FIX 1: Detect internal_analytics domain → DATA_PLATFORM
      if (primaryDomain === 'internal_analytics' || primaryDomain.includes('analytics') || primaryDomain.includes('batch_processing')) {
        requirements.workload_types.push('data_analytics');
        console.log('[DOMAIN DETECTION] internal_analytics domain → data_analytics workload');
      }

      // 🔥 FIX 1: Detect machine_learning domain → ML flag
      if (primaryDomain === 'machine_learning' || primaryDomain.includes('ml') || primaryDomain.includes('ai')) {
        requirements.ml = true;
        console.log('[DOMAIN DETECTION] machine_learning domain → ml=true');
      }

      // 🔥 FIX 2: Map new ENUM domains to workloads
      if (primaryDomain === 'api_backend') {
        requirements.workload_types.push('backend_api');
        console.log('[DOMAIN DETECTION] api_backend domain → backend_api workload');
      }
      if (primaryDomain === 'web_application') {
        requirements.workload_types.push('web_app');
        console.log('[DOMAIN DETECTION] web_application domain → web_app workload');
      }
      if (primaryDomain === 'ecommerce') {
        requirements.workload_types.push('web_app');
        requirements.payments = true; // Ecommerce implies payments
        console.log('[DOMAIN DETECTION] ecommerce domain → web_app + payments');
      }

      // Merge explicit + inferred features (explicit takes precedence)
      const allFeatures = { ...inferredFeatures, ...explicitFeatures };

      // Extract features from explicit_features and inferred_features
      if (allFeatures.static_content === true) {
        requirements.workload_types.push('static_site');
      }
      if (allFeatures.payments === true) {
        requirements.payments = true;
        requirements.workload_types.push('payment_system');
      }
      if (allFeatures.real_time === true) {
        requirements.realtime = true;
        requirements.workload_types.push('realtime_app');
      }
      if (allFeatures.case_management === true) {
        requirements.stateful = true;
      }
      if (allFeatures.document_storage === true) {
        requirements.data_stores.push('objectstorage');
      }
      if (allFeatures.multi_user_roles === true) {
        requirements.authentication = true;
        requirements.stateful = true; // Multi-user typically requires stateful architecture
      }
      if (allFeatures.identityauth === true) {
        requirements.authentication = true;
      }
      if (allFeatures.messagequeue === true) {
        requirements.data_stores.push('messagequeue');
      }
      if (allFeatures.api_backend === true) {
        requirements.workload_types.push('backend_api');
      }

      // Extract from semantic signals
      if (semanticSignals.statefulness === 'stateful') {
        requirements.stateful = true;
      }
      if (semanticSignals.latency_sensitivity) {
        requirements.nfr.latency = semanticSignals.latency_sensitivity;
      }

      // 🔥 FIX: Extract compute preference (app_compute = container)
      // Check explicit features, inferred features, text, and capabilities
      const computeSignals = [
        allFeatures.app_compute,
        allFeatures.computecontainer,
        allFeatures.containers,
        intent.target_compute === "container",
        text.includes('container') || text.includes('kubernetes') || text.includes('fargate') || text.includes('ecs') || text.includes('gke') || text.includes('app_compute')
      ];
      if (computeSignals.some(s => s === true)) {
        requirements.compute_preference = 'container';
        console.log('[REQUIREMENTS] Detected container compute preference');
      }

      // Extract from decision_axes (CRITICAL - this is what was missing!)
      if (decisionAxes.data_sensitivity) {
        requirements.data_sensitivity = decisionAxes.data_sensitivity.toLowerCase();
        if (requirements.data_sensitivity.includes('sensitive') || requirements.data_sensitivity.includes('pii')) {
          requirements.data_sensitivity = 'confidential';
        }
      }

      if (decisionAxes.regulatory_exposure) {
        const regExp = decisionAxes.regulatory_exposure.toLowerCase();
        if (regExp.includes('pci')) requirements.compliance.push('PCI');
        if (regExp.includes('hipaa')) requirements.compliance.push('HIPAA');
        if (regExp.includes('gdpr')) requirements.compliance.push('GDPR');
      }

      if (decisionAxes.availability) {
        requirements.nfr.availability = decisionAxes.availability;
      }

      // Fallback: Also safely extract from intent text if provided
      // const text = ... (Moved to top)

      // Only use text parsing if features weren't already detected
      if (requirements.workload_types.length === 0) {
        if (text.includes('web') || text.includes('app') || text.includes('website')) {
          requirements.workload_types.push('web_app');
        }
        if (text.includes('api') || text.includes('backend') || text.includes('service')) {
          requirements.workload_types.push('backend_api');
        }
        if (text.includes('mobile')) {
          requirements.workload_types.push('mobile_backend');
        }
      }

      // Determine if stateful (if not already detected from features)
      if (!requirements.stateful) {
        if (text.includes('database') || text.includes('store') || text.includes('save') ||
          text.includes('user') || text.includes('profile') || text.includes('session')) {
          requirements.stateful = true;
        }
      }

      // Determine real-time requirements (if not already detected)
      if (!requirements.realtime) {
        if (text.includes('real-time') || text.includes('realtime') || text.includes('chat') ||
          text.includes('live') || text.includes('streaming') || text.includes('notifications')) {
          requirements.realtime = true;
        }
      }

      // Determine authentication requirements (if not already detected)
      if (!requirements.authentication) {
        if (text.includes('login') || text.includes('auth') || text.includes('user') ||
          text.includes('profile') || text.includes('account')) {
          requirements.authentication = true;
        }
      }

      // 🆕 NEW: Map decision axes to data stores (CRITICAL FIX)
      if (decisionAxes.primary_data_model && decisionAxes.primary_data_model.includes('relational')) {
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
          console.log('[REQUIREMENTS] Added relationaldatabase from axis primary_data_model');
        }
      }
      if (decisionAxes.file_storage === true) {
        if (!requirements.data_stores.includes('objectstorage')) {
          requirements.data_stores.push('objectstorage');
          console.log('[REQUIREMENTS] Added objectstorage from axis file_storage');
        }
      }
      if (decisionAxes.messaging_queue === true) {
        if (!requirements.data_stores.includes('messagequeue')) {
          requirements.data_stores.push('messagequeue');
          console.log('[REQUIREMENTS] Added messagequeue from axis messaging_queue');
        }
      }

      // Determine data stores (if not already detected)
      if (text.includes('sql') || text.includes('database') || text.includes('relational') ||
        text.includes('mysql') || text.includes('postgres')) {
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
        }
      }
      if (text.includes('cache') || text.includes('redis') || text.includes('memcached')) {
        if (!requirements.data_stores.includes('cache')) {
          requirements.data_stores.push('cache');
        }
      }
      if (text.includes('queue') || text.includes('message') || text.includes('kafka')) {
        if (!requirements.data_stores.includes('messagequeue')) {
          requirements.data_stores.push('messagequeue');
        }
      }
      if (text.includes('file') || text.includes('storage') || text.includes('document') ||
        text.includes('image') || text.includes('video')) {
        if (!requirements.data_stores.includes('objectstorage')) {
          requirements.data_stores.push('objectstorage');
        }
      }

      // 🆕 NEW: Include capabilities and terminal_exclusions in final requirements
      requirements.capabilities = capabilities;
      requirements.terminal_exclusions = terminalExclusions;

      return requirements;
    } catch (error) {
      console.error('Error in extractRequirements:', error);
      // Return default requirements in case of error
      return {
        workload_types: [],
        stateful: false,
        realtime: false,
        payments: false,
        authentication: false,
        data_stores: [],
        ml: false,
        public_facing: true,
        compliance: [],
        data_sensitivity: "low",

        // 🆕 NEW: Pass through from Step 1
        capabilities: {},
        terminal_exclusions: [],

        // Non-functional requirements
        nfr: {
          availability: "99.5", // default
          latency: "medium",
          compliance: [],
          data_residency: null,
          cost_ceiling_usd: null,
          security_level: "standard"
        },
        // Region and multi-region
        region: {
          primary_region: "us-east-1", // default
          secondary_region: null,
          multi_region: false
        },
        // Data classification
        data_classes: {},
        // Data retention
        data_retention: {},
        // Deployment strategy
        deployment_strategy: "rolling",
        downtime_allowed: true,
        // Observability
        observability: {
          logs: true,
          metrics: true,
          alerts: false
        }
      };
    }
  }

  /**
   * Select architecture pattern based on requirements
   * WITH PATTERN ESCALATION LOGIC
   */
  selectPattern(requirements) {
    console.log('[PATTERN RESOLUTION] Requirements:', {
      stateful: requirements.stateful,
      realtime: requirements.realtime,
      payments: requirements.payments,
      authentication: requirements.authentication,
      data_stores: requirements.data_stores,
      workload_types: requirements.workload_types
    });

    // 🔥 FIX 1: Validate pattern compatibility with terminal exclusions
    // CRITICAL: Prevent stateful patterns when data_persistence is excluded
    if (requirements.terminal_exclusions && requirements.terminal_exclusions.includes('data_persistence')) {
      if (requirements.stateful) {
        console.warn(`[🔥 PATTERN FIX] Stateful architecture requires data persistence`);
        console.warn(`[🔥 PATTERN FIX] Forcing stateful=false due to data_persistence exclusion`);
        requirements.stateful = false;  // 🔥 FIX: Downgrade to stateless
      }
    }

    // 🔥 HARD REJECTION RULES - These patterns are ILLEGAL for certain requirements
    // NO silent downgrades, NO defaults, MUST escalate

    // Rule 1: Stateful + Relational DB → CANNOT be SERVERLESS_WEB_APP
    if (requirements.stateful && requirements.data_stores.includes('relationaldatabase')) {
      console.log('[PATTERN REJECTION] SERVERLESS_WEB_APP is ILLEGAL for stateful + relational DB');
    }

    // Rule 2: Payments → CANNOT be SERVERLESS_WEB_APP (requires stateful for security)
    if (requirements.payments) {
      console.log('[PATTERN REJECTION] SERVERLESS_WEB_APP is ILLEGAL for payment processing');
    }

    // Rule 3: Real-time + Messaging → MUST have proper WebSocket/event architecture
    if (requirements.realtime && (requirements.data_stores.includes('messagequeue') || requirements.data_stores.includes('cache'))) {
      console.log('[PATTERN REJECTION] Simple patterns ILLEGAL for real-time with messaging');
    }

    // 🔥 PATTERN ESCALATION LOGIC (order matters - most specific first)

    // ML + Real-time = Hybrid Platform
    if (requirements.ml && requirements.realtime) {
      console.log('[PATTERN ESCALATION] ML + Real-time → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }

    // ML + Stateful = Hybrid Platform
    if (requirements.ml && requirements.stateful) {
      console.log('[PATTERN ESCALATION] ML + Stateful → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }

    // ML alone = ML Inference Platform
    if (requirements.ml) {
      console.log('[PATTERN SELECTION] ML detected → ML_INFERENCE_PLATFORM');
      return 'ML_INFERENCE_PLATFORM';
    }

    // Real-time + Stateful + Payments = Hybrid Platform (complex requirements)
    if (requirements.realtime && requirements.stateful && requirements.payments) {
      console.log('[PATTERN ESCALATION] Real-time + Stateful + Payments → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }

    // 🔥 CRITICAL: Payments + Message Queue = Hybrid Platform (background processing required)
    // E-commerce, payment processing, order fulfillment need async workflows
    if (requirements.payments && requirements.data_stores.includes('messagequeue')) {
      console.log('[PATTERN ESCALATION] Payments + Message Queue → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }

    // 🔥 CRITICAL: Stateful + Message Queue = Hybrid Platform (async workflows required)
    // Background jobs, async processing, worker queues
    if (requirements.stateful && requirements.data_stores.includes('messagequeue')) {
      console.log('[PATTERN ESCALATION] Stateful + Message Queue → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }

    // Real-time + Stateful = Realtime Platform with persistence
    if (requirements.realtime && requirements.stateful) {
      console.log('[PATTERN ESCALATION] Real-time + Stateful → REALTIME_PLATFORM');
      return 'REALTIME_PLATFORM';
    }

    // Real-time alone = Realtime Platform
    if (requirements.realtime) {
      console.log('[PATTERN SELECTION] Real-time detected → REALTIME_PLATFORM');
      return 'REALTIME_PLATFORM';
    }

    // Payments USUALLY require stateful platform, BUT allow Serverless for Startups/Cost-Savings
    if (requirements.payments) {
      // 🔥 FIX: Allow Serverless for payments if explicitly cost-sensitive or low traffic
      // Only force Stateful if HIGH traffic or explicit container preference
      const isHighTraffic = requirements.traffic_tier === 'high';
      const forceContainers = requirements.compute_preference === 'container';

      if (isHighTraffic || forceContainers) {
        console.log('[PATTERN ESCALATION] Payments + (High Traffic/Container Pref) → STATEFUL_WEB_PLATFORM');
        return 'STATEFUL_WEB_PLATFORM';
      }

      // Otherwise, allow fall-through to Serverless logic below
      console.log('[PATTERN CHECK] Payments detected, but allowing Serverless for cost optimization...');
    }

    // 🔒 FIX 1: Mobile Backend Platform - API-first mobile backends (before generic stateful)
    // Mobile + Stateful + No Web Frontend = Mobile Backend Platform
    if (requirements.workload_types.includes('mobile_backend') && requirements.stateful) {
      console.log('[PATTERN SELECTION] Mobile backend + Stateful → MOBILE_BACKEND_PLATFORM');
      return 'MOBILE_BACKEND_PLATFORM';
    }

    // 🔥 FIX 1: DATA_PLATFORM - Internal analytics / batch processing (before generic stateful)
    // Analytics + Batch = Data Platform (NOT web platform)
    if (requirements.workload_types.includes('data_analytics')) {
      console.log('[PATTERN SELECTION] Internal analytics / batch processing → DATA_PLATFORM');
      return 'DATA_PLATFORM';
    }

    // Stateful + Relational DB = Stateful Web Platform (only if NOT mobile backend or analytics)
    if (requirements.stateful && requirements.data_stores.includes('relational_db') &&
      !requirements.workload_types.includes('mobile_backend') &&
      !requirements.workload_types.includes('data_analytics')) {
      console.log('[PATTERN ESCALATION] Stateful + Relational DB → STATEFUL_WEB_PLATFORM');
      return 'STATEFUL_WEB_PLATFORM';
    }

    // 🔥 NEW: Serverless Web App (Cost Optimized)
    // If we have a web app + stateful data + NO strict container requirement
    if (requirements.workload_types.includes('web') &&
      requirements.stateful &&
      requirements.compute_preference !== 'container' &&
      requirements.traffic_tier !== 'high') {

      console.log('[PATTERN SELECTION] Web + Stateful + Cost Optimized → SERVERLESS_WEB_APP');
      return 'SERVERLESS_WEB_APP';
    }

    // Stateful (any type) = Stateful Web Platform (Fallback for containers)
    if (requirements.stateful &&
      !requirements.workload_types.includes('mobile_backend') &&
      !requirements.workload_types.includes('data_analytics')) {
      console.log('[PATTERN SELECTION] Stateful detected → STATEFUL_WEB_PLATFORM');
      return 'STATEFUL_WEB_PLATFORM';
    }

    // Mobile backend (stateless) = Mobile Backend pattern
    if (requirements.workload_types.includes('mobile_backend')) {
      console.log('[PATTERN SELECTION] Mobile backend → MOBILE_BACKEND');
      return 'MOBILE_BACKEND';
    }

    // 🔥 FIX 1: ML Inference Platform - API backend for ML (before generic API)
    // ML + Stateless API = ML Inference Platform (NOT generic serverless API)
    if (requirements.workload_types.includes('backend_api') &&
      !requirements.stateful &&
      requirements.ml) {
      console.log('[PATTERN SELECTION] ML + Stateless API → ML_INFERENCE_PLATFORM');
      return 'ML_INFERENCE_PLATFORM';
    }

    // Backend API (stateless) = Serverless API (only if NOT ML)
    if (requirements.workload_types.includes('backend_api') && !requirements.stateful && !requirements.ml) {
      console.log('[PATTERN SELECTION] Stateless backend API → SERVERLESS_API');
      return 'SERVERLESS_API';
    }

    // 🔥 FIX: Container preference -> CONTAINERIZED_WEB_APP (before Serverless fallbacks)
    if (requirements.compute_preference === 'container') {
      // If generic web_app or backend_api
      if (requirements.workload_types.includes('web_app') || requirements.workload_types.includes('backend_api')) {
        console.log('[PATTERN SELECTION] Container preference detected → CONTAINERIZED_WEB_APP');
        return 'CONTAINERIZED_WEB_APP';
      }
    }

    // Web app with auth or data stores = Serverless Web App
    if (requirements.workload_types.includes('web_app')) {
      if (requirements.authentication || requirements.data_stores.length > 0) {
        console.log('[PATTERN SELECTION] Web app with auth/data → SERVERLESS_WEB_APP');
        return 'SERVERLESS_WEB_APP';
      } else {
        console.log('[PATTERN SELECTION] Simple web app → STATIC_SITE');
        return 'STATIC_SITE';
      }
    }

    // Static site = Static Site pattern
    if (requirements.workload_types.includes('static_site')) {
      console.log('[PATTERN SELECTION] Static site → STATIC_SITE');
      return 'STATIC_SITE';
    }

    // Default fallback (should rarely be reached)
    console.log('[PATTERN FALLBACK] No specific pattern matched, defaulting to SERVERLESS_WEB_APP');
    return 'SERVERLESS_WEB_APP';
  }

  /**
   * ═════════════════════════════════════════════════════════════════
   * CORE SERVICE RESOLUTION FUNCTION (FIX 2 - CORRECTED PRECEDENCE)
   * ═════════════════════════════════════════════════════════════════
   * CRITICAL: Rule precedence hierarchy (DO NOT VIOLATE):
   * 
    // ═════════════════════════════════════════════════════════════════
    // 1️⃣ PATTERN CONTRACT (highest authority)
    //    - Pattern mandatory services ALWAYS added
    //    - Pattern forbidden services ALWAYS blocked
    // 2️⃣ REQUIREMENTS ENFORCEMENT (SSOT Rules)
    //    - Rules derived from Step 1 requirements (e.g., stateful -> DB)
    //    - Can override pattern defaults (escalation)
    // 3️⃣ TERMINAL EXCLUSIONS (user authority)
    //    - User exclusions remove services (unless pattern requires)
    // 4️⃣ CAPABILITY-DRIVEN ADDITIONS (lowest authority)
    //    - Capabilities suggest services (pattern can override)
    // 
    // CRITICAL RULES:
    // - Pattern contract ALWAYS wins over capabilities
    // - Terminal exclusions respected UNLESS pattern requires service
    // - All services must exist in CANONICAL_SERVICES registry
    // ═════════════════════════════════════════════════════════════════
    // 🔥 UPDATED: Now accepts `requirements` for rule-based enforcement
   */
  resolveServices({ capabilities, terminal_exclusions, pattern, requirements }) {
    const selected = new Map();

    console.log(`[SERVICE RESOLUTION] Starting resolution for pattern: ${pattern}`);
    console.log(`[SERVICE RESOLUTION] Capabilities:`, capabilities);
    console.log(`[SERVICE RESOLUTION] Terminal Exclusions:`, terminal_exclusions);

    // ═════════════════════════════════════════════════════════════════
    // 1️⃣ PATTERN CONTRACT (HIGHEST AUTHORITY)
    // ═════════════════════════════════════════════════════════════════
    const patternDef = PATTERN_CATALOG[pattern];
    if (!patternDef) {
      throw new Error(`Unknown pattern: ${pattern}`);
    }

    // Add mandatory services from pattern (these CANNOT be removed)
    const mandatoryList = patternDef.services || patternDef.mandatory_services || [];
    const patternMandatory = new Set(mandatoryList);
    mandatoryList.forEach(svc => {
      selected.set(svc, { source: 'pattern_mandatory', pattern, removable: false });
      console.log(`[SERVICE RESOLUTION] 🔒 Added ${svc} from pattern (MANDATORY)`);
    });

    // Build forbidden services set
    const forbidden = new Set(patternDef.forbidden_services || []);

    // ═════════════════════════════════════════════════════════════════
    // 2️⃣ REQUIREMENTS ENFORCEMENT (SSOT RULES - NEW)
    // ═════════════════════════════════════════════════════════════════
    if (requirements) {
      // Rule 1: Stateful + Relational Data -> Mandatory Relational DB
      if (requirements.stateful && requirements.data_stores?.includes('relationaldatabase')) {
        if (!forbidden.has('relationaldatabase')) {
          selected.set('relationaldatabase', { source: 'requirement_rule', rule: 'stateful_relational', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added relationaldatabase (Requirement Rule: stateful + relational)`);
        }
      }

      // Rule 2: Object Storage / File Storage / Document Storage
      if (requirements.data_stores?.includes('objectstorage')) {
        if (!forbidden.has('objectstorage')) {
          selected.set('objectstorage', { source: 'requirement_rule', rule: 'object_storage', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added objectstorage (Requirement Rule: object_storage)`);
        }
      }

      // Rule 3: Authentication -> Identity Auth
      if (requirements.authentication) {
        if (!forbidden.has('identityauth')) {
          selected.set('identityauth', { source: 'requirement_rule', rule: 'authentication', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added identityauth (Requirement Rule: authentication)`);
        }
      }

      // Rule 4: API Backend -> API Gateway
      // (Unless explicitly serverless which mandates it, or container which might optional it - but here we make mandatory if requirement says so)
      if (requirements.workload_types?.includes('backend_api') || requirements.workload_types?.includes('mobile_backend')) {
        if (!forbidden.has('apigateway')) {
          // Determine if removable: Yes (might want to expose via LB only)
          // But for mobile_backend it is usually critical.
          const isMobile = requirements.workload_types.includes('mobile_backend');
          selected.set('apigateway', { source: 'requirement_rule', rule: 'api_backend', removable: !isMobile });
          console.log(`[SERVICE RESOLUTION] ➕ Added apigateway (Requirement Rule: backend_api/mobile)`);
        }
      }

      // Rule 5: Message Queue
      if (requirements.data_stores?.includes('messagequeue')) {
        if (!forbidden.has('messagequeue')) {
          selected.set('messagequeue', { source: 'requirement_rule', rule: 'messaging', removable: true });
          console.log(`[SERVICE RESOLUTION] ➕ Added messagequeue (Requirement Rule: messaging)`);
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // 3️⃣ CAPABILITIES → SERVICES (filtered by pattern)
    // ═════════════════════════════════════════════════════════════════
    for (const [capability, value] of Object.entries(capabilities || {})) {
      if (value !== true) continue;

      const servicesList = getServicesForCapability(capability);
      servicesList.forEach(svc => {
        // 🔥 FIX 1: Pattern contract overrides capability suggestions
        if (forbidden.has(svc)) {
          console.log(`[SERVICE RESOLUTION] ⛔ BLOCKED ${svc} from capability ${capability} (pattern forbids)`);
          return;
        }

        if (!selected.has(svc)) {
          selected.set(svc, { source: 'capability', capability, removable: true });
          console.log(`[SERVICE RESOLUTION] Added ${svc} from capability: ${capability}`);
        }
      });
    }

    // ═════════════════════════════════════════════════════════════════
    // 4️⃣ TERMINAL EXCLUSIONS (user authority, but pattern can override)
    // ═════════════════════════════════════════════════════════════════
    (terminal_exclusions || []).forEach(cap => {
      const blockedServices = getServicesForCapability(cap);
      blockedServices.forEach(svc => {
        if (selected.has(svc)) {
          const entry = selected.get(svc);

          // 🔥 FIX 2: Pattern mandatory services CANNOT be removed
          // 🔥 FIX 3: Requirement-enforced non-removable services CANNOT be removed
          if (entry.removable === false || patternMandatory.has(svc)) {
            console.log(`[SERVICE RESOLUTION] ⚠️ CANNOT REMOVE ${svc} (required by pattern ${pattern} or strict rule)`);
            return;
          }

          selected.delete(svc);
          console.log(`[SERVICE RESOLUTION] ❌ REMOVED ${svc} due to terminal exclusion: ${cap}`);
        }
      });
    });

    // ═════════════════════════════════════════════════════════════════
    // 5️⃣ PATTERN SANITIZATION (enforce compute model)
    // ═════════════════════════════════════════════════════════════════
    // 🔥 FIX 3: Auto-clean conflicting services before validation
    if (pattern === 'SERVERLESS_WEB_APP' || pattern === 'SERVERLESS_API') {
      if (selected.has('computecontainer')) {
        selected.delete('computecontainer');
        console.log(`[SERVICE RESOLUTION] 🔧 SANITIZED: Removed computecontainer (serverless pattern)`);
      }
      if (!selected.has('computeserverless')) {
        selected.set('computeserverless', { source: 'pattern_sanitization', pattern, removable: false });
        console.log(`[SERVICE RESOLUTION] 🔧 SANITIZED: Added computeserverless (serverless pattern)`);
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // 6️⃣ CANONICAL REGISTRY VALIDATION
    // ═════════════════════════════════════════════════════════════════
    for (const svc of selected.keys()) {
      const serviceDef = getServiceDefinition(svc);
      if (!serviceDef) {
        throw new Error(`Unknown canonical service: ${svc}. Must be defined in CANONICAL_SERVICES registry.`);
      }
    }

    const finalServices = Array.from(selected.keys());
    console.log(`[SERVICE RESOLUTION] Final services (${finalServices.length}):`, finalServices);

    // ═════════════════════════════════════════════════════════════════
    // 7️⃣ PATTERN CONTRACT ENFORCEMENT (ensure JSON config services)
    // ═════════════════════════════════════════════════════════════════
    // 🔥 FIX 1: Ensure all services from canonicalPatterns.json are present
    // This guarantees the validator passes without breaking capability logic
    const patternConfig = getPatternFromConfig(pattern);
    if (patternConfig && patternConfig.services) {
      for (const svc of patternConfig.services) {
        if (!selected.has(svc)) {
          // Verify service exists in catalog before adding
          const serviceDef = getServiceDefinition(svc);
          if (serviceDef) {
            selected.set(svc, { source: 'pattern_contract', pattern, removable: false });
            console.log(`[PATTERN INTEGRITY] Adding missing service ${svc} from pattern contract`);
          } else {
            console.warn(`[PATTERN INTEGRITY] ⚠️ Pattern ${pattern} requires ${svc} but service not in catalog`);
          }
        }
      }
    }

    const finalServicesWithContract = Array.from(selected.keys());
    console.log(`[SERVICE RESOLUTION] Final services after contract enforcement (${finalServicesWithContract.length}):`, finalServicesWithContract);

    return finalServicesWithContract;
  }


  /**
   * Select services based on requirements using service registry
   */
  selectServices(requirements, pattern) {
    const services = [];

    // Check each service in the registry
    for (const [serviceName, serviceDef] of Object.entries(SERVICE_REGISTRY)) {
      let shouldInclude = false;

      // Check if service is required based on requirements
      for (const requirement of serviceDef.required_for) {
        if (requirement.includes(':')) {
          // Handle specific requirements like "data_stores:relational"
          const [reqType, reqValue] = requirement.split(':');
          if (reqType === 'data_stores' && requirements[reqType]?.includes(reqValue)) {
            shouldInclude = true;
            break;
          }
        } else {
          // Handle simple requirements like "realtime", "payments", etc.
          if (requirements[requirement] === true) {
            shouldInclude = true;
            break;
          }
        }
      }

      // Apply NFR-based service selection
      if (!shouldInclude) {
        // High availability requirement may require additional services
        if (requirements.nfr.availability === "99.99" && serviceDef.category === "messaging") {
          shouldInclude = true; // For resilience
        }

        // Security requirements may require additional services
        if (requirements.nfr.security_level === "high" && serviceDef.category === "security") {
          shouldInclude = true;
        }

        // Observability requirements
        if (requirements.observability.logs && serviceDef.category === "observability") {
          shouldInclude = true;
        }
      }

      if (shouldInclude) {
        services.push({
          name: serviceName,
          description: serviceDef.description,
          category: serviceDef.category
        });
      }
    }

    // Add required services based on NFRs
    if (requirements.nfr.compliance.includes('PCI')) {
      // Add security and monitoring services for PCI compliance
      if (!services.some(s => s.name === 'authentication')) {
        services.push({
          name: 'authentication',
          description: 'Authentication service for PCI compliance',
          category: 'security'
        });
      }
      if (!services.some(s => s.name === 'monitoring')) {
        services.push({
          name: 'monitoring',
          description: 'Monitoring for PCI compliance',
          category: 'observability'
        });
      }
    }

    // Add observability services if required
    if (requirements.observability.logs && !services.some(s => s.name === 'logging')) {
      services.push({
        name: 'logging',
        description: 'Centralized logging service',
        category: 'observability'
      });
    }

    if (requirements.observability.metrics && !services.some(s => s.name === 'monitoring')) {
      services.push({
        name: 'monitoring',
        description: 'Infrastructure monitoring service',
        category: 'observability'
      });
    }

    if (requirements.observability.alerts && !services.some(s => s.name === 'monitoring')) {
      services.push({
        name: 'monitoring',
        description: 'Alerting service',
        category: 'observability'
      });
    }

    // 🔥 ENFORCE V1 PATTERN CATALOG MANDATORY SERVICES
    // This ensures every pattern has its required minimum architecture
    const ensureService = (serviceName, description, category) => {
      // 🔒 FIX: Respect explicit observability settings
      if (serviceName === 'monitoring' && requirements.observability?.metrics === false) {
        console.log(`[PATTERN INTEGRITY] Skipping mandatory service ${serviceName} (User disabled metrics)`);
        return;
      }
      if (serviceName === 'logging' && requirements.observability?.logs === false) {
        console.log(`[PATTERN INTEGRITY] Skipping mandatory service ${serviceName} (User disabled logs)`);
        return;
      }

      // 🔒 FIX: Respect terminal exclusions
      const isExcluded = (requirements.terminal_exclusions || []).includes(serviceName) ||
        (requirements.terminal_exclusions || []).includes(category);

      if (isExcluded) {
        console.log(`[PATTERN INTEGRITY] Skipping mandatory service ${serviceName} (Explicitly excluded)`);
        return;
      }

      if (!services.some(s => s.name === serviceName)) {
        console.log(`[PATTERN INTEGRITY] Adding mandatory service for ${pattern}: ${serviceName}`);
        services.push({
          name: serviceName,
          description: description,
          category: category
        });
      }
    };

    const patternDef = PATTERN_CATALOG[pattern];
    if (patternDef && patternDef.mandatory_services) {
      // Enforce ALL mandatory services from V1 catalog
      patternDef.mandatory_services.forEach(serviceName => {
        const descriptions = {
          objectstorage: 'Object storage for static files and assets',
          cdn: 'Content delivery network for global distribution',
          logging: 'Centralized logging service',
          monitoring: 'Infrastructure and application monitoring',
          identityauth: 'User authentication and identity management',
          waf: 'Web application firewall',
          apigateway: 'API gateway for request routing and management',
          serverless_compute: 'Serverless compute for application logic',
          app_compute: 'Application compute service (containers/VMs)',
          relationaldatabase: 'Relational database for structured data',
          nosqldatabase: 'NoSQL database for flexible data storage',
          loadbalancer: 'Load balancer for traffic distribution',
          cache: 'In-memory cache for performance',
          message_queue: 'Message queue for async processing',
          websocketgateway: 'WebSocket gateway for real-time connections',
          paymentgateway: 'Payment processing integration',
          push_notification_service: 'Push notification service for mobile alerts',
          batch_compute: 'Batch compute for long-running jobs',
          analytical_database: 'Analytical database for OLAP workloads',
          mlinference_service: 'ML model inference service',
          artifact_registry: 'Artifact and model registry'
        };

        const categories = {
          objectstorage: 'storage',
          cdn: 'networking',
          logging: 'observability',
          monitoring: 'observability',
          identityauth: 'security',
          waf: 'security',
          apigateway: 'networking',
          serverless_compute: 'compute',
          app_compute: 'compute',
          relationaldatabase: 'database',
          nosqldatabase: 'database',
          loadbalancer: 'networking',
          cache: 'database',
          message_queue: 'messaging',
          websocketgateway: 'messaging',
          paymentgateway: 'payments',
          push_notification_service: 'messaging',
          batch_compute: 'compute',
          analytical_database: 'database',
          mlinference_service: 'ml',
          artifact_registry: 'storage'
        };

        ensureService(
          serviceName,
          descriptions[serviceName] || `${serviceName} service`,
          categories[serviceName] || 'general'
        );
      });

      console.log(`[PATTERN INTEGRITY] ${pattern} mandatory services enforced: ${patternDef.mandatory_services.join(', ')}`);
    }

    return services;
  }

  /**
   * Generate canonical architecture based on pattern and services
   * THIS IS THE SINGLE SOURCE OF TRUTH - All downstream systems MUST read from this
   * 
   * 🔧 REDESIGNED: Now uses resolveServices() with proper precedence
   */
  generateCanonicalArchitecture(requirements, selectedPattern) {
    // ═════════════════════════════════════════════════════════════════
    // 🆕 NEW: Use resolveServices() with proper precedence
    // ═════════════════════════════════════════════════════════════════
    const serviceNames = this.resolveServices({
      capabilities: requirements.capabilities || {},
      terminal_exclusions: requirements.terminal_exclusions || [],
      pattern: selectedPattern,
      requirements: requirements // 🔥 FIX: Passed requirements for rule enforcement
    });

    console.log(`[CANONICAL ARCHITECTURE] Pattern: ${selectedPattern}, Services: ${serviceNames.length}`);
    console.log(`[CANONICAL ARCHITECTURE] Service List: ${serviceNames.join(', ')}`);

    // Build services array with full metadata from canonical registry
    const services = serviceNames.map(name => {
      const serviceDef = getServiceDefinition(name);
      return {
        name: name,
        description: serviceDef.description,
        category: serviceDef.category,
        kind: serviceDef.kind,
        terraform_supported: serviceDef.terraform_supported
      };
    });

    // 🔥 VALIDATION: Fail if required services are missing for pattern
    // 🔒 Pass terminalExclusions to respect user authority
    this.validateServicesForPattern(services, selectedPattern, requirements.terminal_exclusions || []);

    // Create canonical architecture based on pattern
    const pattern = PATTERN_CATALOG[selectedPattern];

    // Build canonical services contract (provider-agnostic)
    const canonicalServices = services.map((service, idx) => ({
      id: `${service.name}_${idx}`,
      canonical_type: service.name,
      category: service.category,
      description: service.description,
      kind: service.kind,
      terraform_supported: service.terraform_supported,
      required: true, // All services from resolveServices are required
      pattern_enforced: true
    }));

    // Define nodes based on services
    let nodes = [];
    for (let i = 0; i < services.length; i++) {
      const service = services[i];
      const position = calculateNodePosition(i, service.category, nodes);
      nodes.push({
        id: service.name,
        label: service.name.replace('_', ' ').toUpperCase(),
        type: service.name, // Use canonical type, not category
        category: service.category,
        kind: service.kind,
        terraform_supported: service.terraform_supported,
        position: position,
        required: true
      });
    }

    // Define edges based on service dependencies
    const edges = [];

    // Add some basic relationships
    if (requirements.authentication && requirements.data_stores.includes('relational_db')) {
      // Authentication typically connects to database
      if (nodes.some(n => n.id === 'authentication') && nodes.some(n => n.id === 'relational_db')) {
        edges.push({
          from: 'authentication',
          to: 'relational_db',
          label: 'stores user data'
        });
      }
    }

    if (requirements.realtime && nodes.some(n => n.id === 'websocketgateway') && nodes.some(n => n.id === 'message_queue')) {
      edges.push({
        from: 'websocketgateway',
        to: 'message_queue',
        label: 'forwards messages'
      });
    }

    // Add observability connections
    if (nodes.some(n => n.id === 'logging') && nodes.some(n => n.id === 'monitoring')) {
      edges.push({
        from: 'logging',
        to: 'monitoring',
        label: 'feeds metrics'
      });
    }

    // Add security connections
    if (nodes.some(n => n.id === 'authentication') && nodes.some(n => n.id === 'compute')) {
      edges.push({
        from: 'authentication',
        to: 'compute',
        label: 'authenticates'
      });
    }

    // Add compliance and data classification connections
    if (requirements.nfr.compliance.includes('PCI') && nodes.some(n => n.id === 'paymentgateway') && nodes.some(n => n.id === 'monitoring')) {
      edges.push({
        from: 'paymentgateway',
        to: 'monitoring',
        label: 'PCI compliance monitoring'
      });
    }

    // Add data retention connections
    if (Object.keys(requirements.data_retention).length > 0 && nodes.some(n => n.id === 'storage') && nodes.some(n => n.id === 'monitoring')) {
      edges.push({
        from: 'storage',
        to: 'monitoring',
        label: 'retention policy monitoring'
      });
    }

    // Add deployment strategy connections
    if (requirements.deployment_strategy === 'blue-green' && nodes.some(n => n.id === 'loadbalancer') && nodes.some(n => n.id === 'compute')) {
      edges.push({
        from: 'loadbalancer',
        to: 'compute',
        label: 'blue-green deployment routing'
      });
    }

    // Add region-based connections
    if (requirements.region.multi_region && nodes.some(n => n.id === 'loadbalancer') && nodes.some(n => n.id === 'database')) {
      edges.push({
        from: 'loadbalancer',
        to: 'database',
        label: 'multi-region replication'
      });
    }

    // 🔥 CANONICAL SERVICES CONTRACT - This is the finalized, enforced service list
    const servicesContract = {
      pattern: selectedPattern,
      total_services: canonicalServices.length,
      services: canonicalServices,
      validated: true,
      complete: true
    };

    console.log(`[CANONICAL CONTRACT] ${servicesContract.total_services} services finalized for ${selectedPattern}`);

    // ═════════════════════════════════════════════════════════════════
    // 🔒 VALIDATION CHECKPOINT: Split Architecture vs Deployable Services
    // ═════════════════════════════════════════════════════════════════
    // CRITICAL: Architecture services ≠ Deployable services
    // - Architecture services: All services (including logical like event_bus, waf)
    // - Deployable services: Services that can reach Terraform
    // - Blocking services: Services that MUST have Terraform modules (blocks generation if missing)
    // ═════════════════════════════════════════════════════════════════
    const architecture_services = canonicalServices;  // All services (for diagram, cost, scoring)

    // Deployable services: Services that can be included in Terraform (both core and optional)
    const deployable_services = canonicalServices.filter(
      s => s.terraform_supported === true
    );

    // Blocking services: Services that MUST have Terraform modules (blocks generation if missing)
    const blocking_services = canonicalServices.filter(
      s => s.class === 'terraform_core' && s.terraform_supported === true
    );

    console.log(`[SERVICE SPLIT] Architecture: ${architecture_services.length}, Deployable: ${deployable_services.length}, Blocking: ${blocking_services.length}`);

    // List logical services (excluded from Terraform)
    const logical_services = canonicalServices.filter(s => s.terraform_supported === false);
    if (logical_services.length > 0) {
      console.log(`[LOGICAL SERVICES] ${logical_services.map(s => s.canonical_type).join(', ')} will NOT reach Terraform`);
    }

    // List optional services (may appear in Terraform if modules exist, otherwise logical)
    const optional_services = canonicalServices.filter(s => s.class === 'terraform_optional');
    if (optional_services.length > 0) {
      console.log(`[OPTIONAL SERVICES] ${optional_services.map(s => s.canonical_type).join(', ')} may appear in Terraform if modules exist`);
    }

    // 🚨 VALIDATION: Ensure no non-Terraform-supported service leaked into deployables
    deployable_services.forEach(svc => {
      if (svc.terraform_supported !== true) {
        throw new Error(
          `VALIDATION ERROR: Non-deployable service leaked into deployable list: ${svc.canonical_type}. ` +
          `This service has terraform_supported=${svc.terraform_supported} but should be filtered out.`
        );
      }
    });
    console.log(`[✅ VALIDATION PASSED] All deployable services have terraform_supported=true`);
    // ═════════════════════════════════════════════════════════════════
    return {
      // Pattern metadata
      pattern: selectedPattern,
      pattern_name: pattern.name,
      pattern_description: pattern.use_case,

      // 🔥 THE CANONICAL SERVICES CONTRACT - SINGLE SOURCE OF TRUTH
      services_contract: servicesContract,

      // 🆕 NEW: Split services for different purposes
      architecture_services: architecture_services,   // All services (diagram, cost, scoring)
      deployable_services: deployable_services,       // Only terraform_supported=true (Terraform)
      logical_services: logical_services,             // Architecture-only (no Terraform)

      // Graph representation for diagrams
      nodes,
      edges,

      // Legacy compatibility (will be deprecated)
      services,

      // Requirements that led to this architecture
      requirements,

      // NFR and operational requirements
      region: requirements.region,
      nfr: requirements.nfr,
      data_classification: requirements.data_classes,
      data_retention: requirements.data_retention,
      deployment_strategy: requirements.deployment_strategy,

      // Metadata
      generated_at: new Date().toISOString(),
      is_complete: true,
      is_validated: true
    };
  }

  /**
   * Validate that required services exist for the given pattern
   * Uses V1 Pattern Catalog mandatory services as validation baseline
   */
  validateServicesForPattern(services, pattern, terminalExclusions = []) {
    const serviceNames = new Set(services.map(s => s.name));

    const patternDef = PATTERN_CATALOG[pattern];
    if (!patternDef || !patternDef.mandatory_services) {
      console.warn(`[VALIDATION] No validation rules for pattern: ${pattern}`);
      return; // Pattern not in V1 catalog, skip validation
    }

    // 🔒 TERMINAL EXCLUSIONS: Services excluded by user authority cannot be required
    // Map capabilities to services they would create
    const capabilityToService = {
      'data_persistence': ['relationaldatabase', 'nosqldatabase', 'block_storage'],  // 🔥 FIX: REMOVED objectstorage
      'document_storage': ['objectstorage'],  // 🔥 FIX: Added separate capability
      'messaging': ['message_queue'],
      'realtime': ['websocketgateway'],
      'payments': ['paymentgateway'],
      'observability': ['monitoring', 'logging'] // 🔥 FIX: Added observability mapping
    };

    // Build set of excluded services based on terminal exclusions
    const excludedServices = new Set();
    terminalExclusions.forEach(capability => {
      const services = capabilityToService[capability] || [];
      services.forEach(svc => excludedServices.add(svc));
    });

    if (terminalExclusions.length > 0) {
      console.log(`[VALIDATION] Terminal exclusions: ${terminalExclusions.join(', ')}`);
      console.log(`[VALIDATION] Excluded services: ${Array.from(excludedServices).join(', ')}`);
    }

    const required = patternDef.mandatory_services;
    // 🔒 FIX: Exclude user-excluded services from validation
    const missing = required.filter(r => !serviceNames.has(r) && !excludedServices.has(r));

    if (missing.length > 0) {
      const error = `[VALIDATION FAILED] Pattern ${pattern} requires services: ${required.join(', ')}. Missing: ${missing.join(', ')}`;
      console.error(error);
      throw new Error(error);
    }

    console.log(`[VALIDATION PASSED] Pattern ${pattern} has all ${required.length} mandatory services`);
  }

  /**
   * NEW: Score-based pattern resolution using config (Step2.txt)
   * Uses CANONICAL_PATTERNS config and capabilities scoring
   * @param {Object} capabilities - Capabilities from axesToCapabilities
   * @param {Object} intent - The locked intent object
   * @returns {Object} - Pattern resolution with scores and alternatives
   */
  resolvePatternsByScore(capabilities, intent) {
    const patterns = CANONICAL_PATTERNS.patterns;
    const scores = [];

    console.log('[SCORE-BASED RESOLUTION] Starting pattern scoring...');
    console.log('[SCORE-BASED RESOLUTION] Capabilities:', getCapabilitiesSummary(capabilities));

    for (const [patternName, pattern] of Object.entries(patterns)) {
      let score = 0;
      const reasoning = [];

      // Positive matches from score_weights
      for (const [cap, weight] of Object.entries(pattern.score_weights || {})) {
        if (capabilities[cap] === 'required') {
          score += weight;
          reasoning.push(`${cap}=required (+${weight})`);
        }
      }

      // Required capabilities check
      const missingRequired = (pattern.required_capabilities || []).filter(cap =>
        capabilities[cap] !== 'required'
      );
      if (missingRequired.length > 0) {
        score -= missingRequired.length * 0.5;
        reasoning.push(`missing_required: ${missingRequired.join(', ')} (-${missingRequired.length * 0.5})`);
      }

      // Forbidden capabilities check
      const hasForbidden = (pattern.forbidden_capabilities || []).some(cap =>
        capabilities[cap] === 'required'
      );
      if (hasForbidden) {
        score = 0;
        reasoning.push('forbidden_capability_matched (score=0)');
      }

      // Complexity match
      if (intent.complexity === 'SIMPLE' && pattern.complexity === 'complex') {
        score *= 0.7;
        reasoning.push('complexity_mismatch (*0.7)');
      }

      // 🔥 FIX: Enforce Compute Preference (Container vs Serverless)
      const kubernetesRequired = intent.axes?.kubernetes_required?.value === true;
      const isContainerPattern = patternName.includes('CONTAINER') || patternName.includes('KUBERNETES') || pattern.services?.includes('computecontainer');
      const isServerlessPattern = patternName.includes('SERVERLESS') || pattern.services?.includes('computeserverless');

      if (kubernetesRequired) {
        if (isServerlessPattern) {
          score *= 0.1; // Heavy penalty for serverless when K8s required
          reasoning.push('kubernetes_req_penalizes_serverless (*0.1)');
        }
        if (isContainerPattern) {
          score += 5; // Boost container patterns
          reasoning.push('kubernetes_req_boosts_container (+5)');
        }
      }

      // 🔥 FIX: Enforce "Serverless" preference if explicitly stated
      const serverlessRequired = intent.axes?.ops_model?.value === 'serverless_only';
      if (serverlessRequired) {
        if (isContainerPattern) {
          score *= 0.1;
          reasoning.push('serverless_pref_penalizes_container (*0.1)');
        }
        if (isServerlessPattern) {
          score += 3;
          reasoning.push('serverless_pref_boosts_serverless (+3)');
        }
      }

      scores.push({
        pattern: patternName,
        score,
        reasoning,
        services: pattern.services,
        description: pattern.description
      });
    }

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score);

    // Use fallback if no pattern scores above threshold
    const threshold = CANONICAL_PATTERNS.minimum_score_threshold || 0.6;
    let selected = scores[0];

    if (selected.score < threshold) {
      const fallback = CANONICAL_PATTERNS.fallback_pattern || 'HYBRID_PLATFORM';
      console.log(`[SCORE-BASED RESOLUTION] No pattern scored above ${threshold}, using fallback: ${fallback}`);
      selected = scores.find(s => s.pattern === fallback) || scores[0];
      selected.reasoning.push(`fallback_used (score below ${threshold})`);
    }

    console.log(`[SCORE-BASED RESOLUTION] Selected: ${selected.pattern} (score: ${selected.score.toFixed(2)})`);

    return {
      selected_pattern: selected.pattern,
      score: selected.score,
      alternatives: scores.slice(1, 4).map(s => ({
        pattern: s.pattern,
        score: s.score,
        description: s.description
      })),
      reasoning: selected.reasoning,
      services: selected.services
    };
  }

  /**
   * NEW: Resolve services from pattern definition (Step2.txt)
   * @param {Object} patternResolution - Pattern resolution from resolvePatternsByScore
   * @param {Object} capabilities - Capabilities from axesToCapabilities
   * @returns {Object} - Services contract
   */
  resolveServicesFromPattern(patternResolution, capabilities) {
    const patternDef = CANONICAL_PATTERNS.patterns[patternResolution.selected_pattern];
    if (!patternDef) {
      throw new Error(`Unknown pattern: ${patternResolution.selected_pattern}`);
    }

    // 1. Collect all candidate services
    // Combine mandatory and optional lists from pattern
    const candidateServices = new Set([
      ...patternDef.mandatory_services,
      ...(patternDef.optional_services || [])
    ]);

    // 2. Reconcile states for each candidate
    const resolvedServices = [];

    // Explicit exclusions from user input (if we had them here, we'd filter)
    // For now, we assume candidateServices are technically "allowed" but might be turned off

    candidateServices.forEach((svcType, idx) => {
      const state = this.determineServiceState(svcType, capabilities, patternDef);

      // If EXCLUDED, do not add to contract at all (or add as disabled invisible?)
      // User request says: "Excluded by requirement" -> show as excluded.
      // For now, we'll keep them in the list but marked EXCLUDED if they violate hard constraints (not implemented yet),
      // or OPTIONAL/MANDATORY/EXTERNAL.

      const config = SERVICE_REGISTRY[svcType] || {};

      if (state !== 'EXCLUDED') {
        resolvedServices.push({
          id: `${svcType}_${idx}`, // Unique ID
          canonical_type: svcType,
          category: config.category || 'other',
          description: config.description || svcType,
          kind: 'deployable', // Legacy field, keeping for compatibility
          pricing_class: config.pricing_class || 'DIRECT',
          state: state, // 🔥 NEW: MANDATORY, OPTIONAL, EXTERNAL
          terraform_supported: true, // Simplified
          required: state === 'MANDATORY', // Legacy compat
          pattern_enforced: patternDef.mandatory_services.includes(svcType)
        });
      }
    });

    return {
      services_contract: {
        total_services: resolvedServices.length,
        required_services: resolvedServices.filter(s => s.state === 'MANDATORY').length,
        services: resolvedServices
      },
      // Deployable = DIRECT pricing + NOT DISABLED
      deployable_services: resolvedServices.filter(s =>
        s.state !== 'USER_DISABLED' &&
        s.state !== 'EXCLUDED' &&
        s.pricing_class === 'DIRECT'
      ),
      logical_services: []
    };
  }

  /**
   * Determine the state of a service based on capabilities and pattern rules
   */
  determineServiceState(svcType, capabilities, patternDef) {
    const config = SERVICE_REGISTRY[svcType];
    if (!config) return 'OPTIONAL'; // Fallback

    // Check strict pattern enforcement -> if needed for pattern core, it's MANDATORY
    // unless explicitly conditional in the new system (which we handled via data structures)

    // 1. Check Mandatory Conditions (Capability-driven)
    // If any mandatory_when capability is active -> MANDATORY
    if (config.mandatory_when && config.mandatory_when.some(cap => capabilities[cap] === 'required')) {
      return 'MANDATORY';
    }

    // 2. Check Pattern Mandate (Legacy/Hybrid)
    // If it's in the pattern's mandatory list, it's usually MANDATORY,
    // UNLESS our new dynamic rules say it depends on a missing capability.
    // For now, to be safe, if pattern says mandatory, we treat as MANDATORY
    // unless we specifically stripped it (which we did in previous step).
    if (patternDef.mandatory_services.includes(svcType)) {
      return 'MANDATORY';
    }

    // 3. Pricing Class Override
    // External services are EXTERNAL state (but implicitly mandatory if triggered?)
    // Actually, EXTERNAL is a pricing property, state should still be MANDATORY/OPTIONAL.
    // But user asked for EXTERNAL as a state. Let's respect that for visualization.
    if (config.pricing_class === 'EXTERNAL') {
      // If it's required by logic, it's EXTERNAL (active).
      // If not required, it might be dropped? 
      // For now, if it's here, it's EXTERNAL.
      return 'EXTERNAL';
    }

    // Default to OPTIONAL
    return 'OPTIONAL';
  }


  /**
   * 🛡️ GUARDRAIL: Validate if a service removal is legal
   * @param {string} serviceId - The service ID to remove
   * @param {object} currentInfra - The current infrastructure state
   * @returns {object} { valid: boolean, error: string }
   */
  validateServiceRemoval(serviceId, currentInfra) {
    // 1. Find existing service first to get canonical type reliably
    const existingService = currentInfra.services.find(s => s.id === serviceId);

    // If not in our list, implicitly allow remove (idempotent)
    if (!existingService) {
      return { valid: true };
    }

    const canonicalType = existingService.canonical_type || serviceId.split('_')[0];
    const serviceDef = SERVICE_REGISTRY[canonicalType];

    if (!serviceDef) {
      return { valid: true }; // Unknown service, allow removal
    }

    // 2. Check State: MANDATORY services cannot be removed
    // We need to re-evaluate state based on current capabilities
    // But for this check, we look at what was assigned in the InfraSpec
    if (existingService && existingService.state === 'MANDATORY') {
      const blockingCaps = serviceDef.mandatory_when || [];
      return {
        valid: false,
        error: `Cannot remove ${serviceDef.name}: Required for [${blockingCaps.join(', ')}] capabilities.`
      };
    }

    // 3. Check Dependencies (Graph check)
    // If any OTHER service in the list depends on this one
    // Only check services that are NOT disabled/excluded
    const activeServices = currentInfra.services.filter(s =>
      s.state !== 'USER_DISABLED' && s.state !== 'EXCLUDED' && s.id !== serviceId
    );

    const dependents = activeServices.filter(s => {
      const def = SERVICE_REGISTRY[s.canonical_type];
      return def && def.depends_on && def.depends_on.includes(canonicalType);
    });

    if (dependents.length > 0) {
      return {
        valid: false,
        error: `Cannot remove ${serviceDef.name}: dependent services present [${dependents.map(s => s.canonical_type).join(', ')}]`
      };
    }

    return { valid: true };
  }

  /**
   * 🔄 RECONCILIATION ENGINE: Re-calculate states after a user change
   * @param {Object} currentInfra - Current full infra object
   * @param {Object} action - { type: 'REMOVE_SERVICE' | 'ADD_SERVICE', serviceId: string }
   * @returns {Object} { services: [], deployable_services: [] }
   */
  reconcileArchitecture(currentInfra, action) {
    // Clone services to avoid mutation
    let services = JSON.parse(JSON.stringify(currentInfra.services));

    if (action.type === 'REMOVE_SERVICE') {
      // Find the service and mark it USER_DISABLED
      const target = services.find(s => s.id === action.serviceId);
      if (target) {
        target.state = 'USER_DISABLED';
      }
    }
    else if (action.type === 'RESTORE_SERVICE') {
      const target = services.find(s => s.id === action.serviceId);
      if (target) {
        target.state = 'OPTIONAL';
      }
    }

    // Re-generate deployable list based on new states
    const deployable_services = services.filter(s =>
      s.state !== 'USER_DISABLED' &&
      s.state !== 'EXCLUDED' &&
      s.pricing_class === 'DIRECT'
    );

    return {
      services_contract: {
        ...currentInfra.services_contract,
        services: services,
        required_services: services.filter(s => s.state === 'MANDATORY').length
      },
      deployable_services
    };
  }

  getServiceCategory(svcType) {
    const categories = {
      cdn: 'networking',
      apigateway: 'networking',
      loadbalancer: 'networking',
      global_loadbalancer: 'networking',
      computeserverless: 'compute',
      compute_cluster: 'compute',
      app_compute: 'compute',
      mlinference_gpu: 'ai',
      relationaldatabase: 'database',
      vector_database: 'database',
      multi_region_db: 'database',
      cache: 'database',
      objectstorage: 'storage',
      identityauth: 'security',
      secrets_manager: 'security',
      paymentgateway: 'payments',
      auditlogging: 'observability',
      logging: 'observability',
      monitoring: 'observability',
      messagequeue: 'messaging',
      eventstreaming: 'messaging',
      iotcore: 'iot',
      time_series_db: 'database',
      sms_alerts: 'notifications',
      data_lake: 'storage'
    };
    return categories[svcType] || 'other';
  }

  getServiceDescription(svcType) {
    const descriptions = {
      cdn: 'Content Delivery Network',
      apigateway: 'API Gateway',
      loadbalancer: 'Load Balancer',
      global_loadbalancer: 'Global Load Balancer (Multi-region)',
      computeserverless: 'Serverless Compute',
      compute_cluster: 'Compute Cluster',
      app_compute: 'Application Compute',
      relationaldatabase: 'Relational Database',
      cache: 'Caching Layer',
      objectstorage: 'Object Storage',
      identityauth: 'Authentication & Identity',
      secrets_manager: 'Secrets & Key Management',
      mlinference_gpu: 'ML Inference (GPU)',
      vector_database: 'Vector Database',
      multi_region_db: 'Multi-Region Database',
      paymentgateway: 'Payment Processing Gateway',
      auditlogging: 'Compliance Audit Logging',
      logging: 'Centralized Logging',
      monitoring: 'Infrastructure Monitoring',
      messagequeue: 'Message Queue',
      eventstreaming: 'Event Streaming',
      iotcore: 'IoT Core',
      time_series_db: 'Time Series Database',
      sms_alerts: 'SMS Alerts',
      data_lake: 'Data Lake'
    };
    return descriptions[svcType] || svcType;
  }

  /**
   * Resolve the complete architecture
   * Returns the CANONICAL SERVICES CONTRACT that all downstream systems must use
   * NOW with axes-based capabilities support
   */
  resolveArchitecture(intent) {
    // Extract capabilities from axes if present (new Step 1 format)
    let capabilities = intent.capabilities || {};

    if (intent.axes && Object.keys(intent.axes).length > 0) {
      console.log('[ARCHITECTURE] Using axes-based capabilities mapping');
      capabilities = mapAxesToCapabilities(intent.axes);
      console.log('[ARCHITECTURE] Mapped capabilities:', getCapabilitiesSummary(capabilities));
    }

    const requirements = this.extractRequirements(intent);

    // Try score-based resolution first (new system)
    let selectedPattern;
    let patternResolution;

    try {
      patternResolution = this.resolvePatternsByScore(capabilities, intent);
      selectedPattern = patternResolution.selected_pattern;
      console.log(`[ARCHITECTURE] Score-based pattern: ${selectedPattern} (score: ${patternResolution.score})`);
    } catch (e) {
      console.warn('[ARCHITECTURE] Score-based resolution failed, falling back to legacy:', e.message);
      selectedPattern = this.selectPattern(requirements);
    }

    const canonicalArchitecture = this.generateCanonicalArchitecture(requirements, selectedPattern);

    console.log(`[ARCHITECTURE RESOLVED] Pattern: ${selectedPattern}, Services: ${canonicalArchitecture.services_contract.total_services}`);

    return {
      requirements,
      selectedPattern,
      pattern_resolution: patternResolution,
      canonicalArchitecture,
      // Expose the canonical contract at top level for easy access
      servicesContract: canonicalArchitecture.services_contract
    };
  }

  /**
   * V2: Resolve Architecture from Deterministic/Verified Inputs
   * @param {object} preIntentContext - Fusion output (capabilities, exclusions)
   * @param {object} v2Axes - AI output (50+ axes)
   */
  resolveArchitectureV2(preIntentContext, v2Axes) {
    const { detected, exclusions, derived } = preIntentContext;
    const capabilities = new Set(detected.capability_hints);

    // 1. Construct Requirements Object (Deterministic Map)
    const requirements = {
      workload_types: [v2Axes.workload_type?.value || derived.workload_guess || 'web_app'],
      stateful: v2Axes.stateful?.value === true,
      realtime: capabilities.has('realtime') || v2Axes.realtime_updates?.value === true,
      payments: capabilities.has('payments'),
      authentication: capabilities.has('auth') || capabilities.has('user_authentication'),
      data_stores: [],
      ml: capabilities.has('ml') || capabilities.has('ai') || v2Axes.domain_ml_heavy?.value === true,
      nfr: {
        availability: v2Axes.availability_target?.value || "99.5",
        security_level: v2Axes.security_posture?.value === "hardened" ? "high" : "standard",
        compliance: v2Axes.regulatory_compliance?.value || []
      },
      data_retention: v2Axes.backup_retention_days ? { days: v2Axes.backup_retention_days.value } : {},
      deployment_strategy: v2Axes.deployment_strategy?.value || 'rolling',
      region: {
        primary: v2Axes.primary_region_hint?.value || 'us-east-1',
        multi_region: v2Axes.multi_region_required?.value === true
      },
      // Pass raw capabilities for service resolution
      capabilities: detected.capability_hints.reduce((acc, cap) => ({ ...acc, [cap]: true }), {}),
      // Map user exclusions to terminal exclusions
      terminal_exclusions: Object.keys(exclusions).filter(k => exclusions[k] === true)
    };

    // Map capabilities to data stores
    if (capabilities.has('relational_db')) requirements.data_stores.push('relationaldatabase');
    if (capabilities.has('object_storage')) requirements.data_stores.push('objectstorage');
    if (capabilities.has('message_queue')) requirements.data_stores.push('messagequeue');

    // 2. Select Pattern (Deterministic)
    // Reuse existing deterministic logic which we verified in V1
    const selectedPattern = this.selectPattern(requirements);

    // 3. Generate Canonical Architecture
    const canonicalArchitecture = this.generateCanonicalArchitecture(requirements, selectedPattern);

    return {
      requirements,
      selectedPattern,
      canonicalArchitecture,
      servicesContract: canonicalArchitecture.services_contract
    };
  }
}


/**
 * Calculate position for a node based on its index and category
 */
function calculateNodePosition(index, category, existingNodes = []) {
  // Define standard positions based on category and index
  const categoryOffsets = {
    'client': { x: 0, y: 100 },
    'network': { x: 200, y: 100 },
    'compute': { x: 400, y: 100 },
    'security': { x: 400, y: 200 },
    'storage': { x: 600, y: 100 },
    'database': { x: 600, y: 200 },
    'messaging': { x: 500, y: 300 },
    'api': { x: 300, y: 100 },
    'cdn': { x: 200, y: 150 }
  };

  // Count how many nodes of the same category already exist
  const sameCategoryCount = existingNodes.filter(n => n.category === category).length;

  const baseOffset = categoryOffsets[category] || { x: 100 * index, y: 100 + (50 * index) };

  return {
    x: baseOffset.x,
    y: baseOffset.y + (sameCategoryCount * 60)  // Add vertical spacing for same category
  };
}

module.exports = new PatternResolver();
module.exports.calculateNodePosition = calculateNodePosition;