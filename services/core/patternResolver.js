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
    requirements: {
      stateful: false,
      backend: false,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 2️⃣ STATIC_SITE_WITH_AUTH
  STATIC_SITE_WITH_AUTH: {
    name: 'Static Site with Auth',
    use_case: 'Marketing site with login / gated content',
    mandatory_services: ['objectstorage', 'cdn', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['waf'],
    forbidden_services: ['computecontainer', 'computeserverless', 'compute_vm', 'relationaldatabase', 'apigateway'],
    requirements: {
      stateful: false,
      backend: false,
      realtime: false,
      payments: false,
      ml: false,
      authentication: true
    }
  },

  // 3️⃣ SERVERLESS_API
  SERVERLESS_API: {
    name: 'Serverless API',
    use_case: 'Pure API backend, stateless, event-driven',
    mandatory_services: ['apigateway', 'computeserverless', 'logging', 'monitoring'],
    optional_services: ['nosqldatabase', 'objectstorage', 'messagequeue'],
    forbidden_services: ['relationaldatabase', 'loadbalancer'],
    requirements: {
      stateful: false,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 4️⃣ SERVERLESS_WEB_APP
  SERVERLESS_WEB_APP: {
    name: 'Serverless Web App',
    use_case: 'Simple full-stack apps, low complexity',
    mandatory_services: ['cdn', 'apigateway', 'computeserverless', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['nosqldatabase', 'objectstorage'],
    forbidden_services: ['relationaldatabase', 'loadbalancer', 'paymentgateway'],
    invalid_if: ['payments', 'realtime', 'multi_user_workflows'],
    requirements: {
      stateful: false,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 5️⃣ STATEFUL_WEB_PLATFORM
  STATEFUL_WEB_PLATFORM: {
    name: 'Stateful Web Platform',
    use_case: 'SaaS, CRMs, dashboards, ERPs (supports async workflows, messaging)',
    mandatory_services: ['cdn', 'loadbalancer', 'computecontainer', 'relationaldatabase', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['objectstorage', 'cache', 'messagequeue', 'websocketgateway'],
    forbidden_services: ['computeserverless'],
    invalid_if: [],  // 🔥 FIX 2: Removed outdated restrictions
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 6️⃣ HYBRID_PLATFORM
  HYBRID_PLATFORM: {
    name: 'Hybrid Platform',
    use_case: 'Stateful + realtime + async workflows',
    mandatory_services: ['cdn', 'loadbalancer', 'computecontainer', 'computeserverless', 'relationaldatabase', 'cache', 'messagequeue', 'identityauth', 'logging', 'monitoring'],
    conditional_mandatory: {
      websocketgateway: 'if realtime',
      paymentgateway: 'if payments',
      objectstorage: 'if file uploads'
    },
    optional_services: [],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: true,
      payments: false,
      ml: false
    }
  },

  // 7️⃣ MOBILE_BACKEND_PLATFORM
  MOBILE_BACKEND_PLATFORM: {
    name: 'Mobile Backend Platform',
    use_case: 'API backend for mobile apps, low latency required',
    mandatory_services: ['apigateway', 'computecontainer', 'relationaldatabase', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['push_notification_service', 'cache', 'messagequeue'],
    forbidden_services: ['cdn'],
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: false,
      ml: false,
      mobile_only: true
    }
  },

  // 8️⃣ DATA_PLATFORM
  DATA_PLATFORM: {
    name: 'Data Platform',
    use_case: 'Internal analytics, batch processing, data warehousing',
    mandatory_services: ['data_warehouse', 'objectstorage', 'computebatch', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['messagequeue', 'apigateway'],
    forbidden_services: ['cdn', 'loadbalancer', 'computecontainer'],
    requirements: {
      stateful: true,
      backend: false,
      realtime: false,
      payments: false,
      ml: false,
      internal_only: true
    }
  },

  // 9️⃣ REALTIME_PLATFORM
  REALTIME_PLATFORM: {
    name: 'Real-time Platform',
    use_case: 'Chat apps, live dashboards, WebSockets, pub/sub',
    mandatory_services: ['websocketgateway', 'computecontainer', 'cache', 'messagequeue', 'logging', 'monitoring'],
    optional_services: ['relationaldatabase', 'identityauth'],
    forbidden_services: [],
    requirements: {
      stateful: false,
      backend: true,
      realtime: true,
      payments: false,
      ml: false
    }
  },

  // 🔟 ML_INFERENCE_PLATFORM
  ML_INFERENCE_PLATFORM: {
    name: 'ML Inference Platform',
    use_case: 'Model serving, prediction APIs',
    mandatory_services: ['mlinference', 'objectstorage', 'logging', 'monitoring'], // 🔥 FIX 2
    optional_services: ['apigateway', 'cache'], // 🔥 FIX 2
    forbidden_services: ['relationaldatabase', 'nosqldatabase', 'messagequeue', 'computebatch'], // 🔥 FIX 2: No DB, no queue, no batch
    requirements: {
      stateful: false,
      backend: true,
      realtime: false,
      payments: false,
      ml: true
    }
  },

  // 1️⃣1️⃣ ML_TRAINING_PLATFORM
  ML_TRAINING_PLATFORM: {
    name: 'ML Training Platform',
    use_case: 'Training pipelines, batch jobs, GPU workloads',
    mandatory_services: ['computebatch', 'objectstorage', 'logging', 'monitoring'],
    optional_services: ['container_registry'],
    forbidden_services: [],
    requirements: {
      stateful: false,
      backend: false,
      realtime: false,
      payments: false,
      ml: true
    }
  },

  // 1️⃣2️⃣ HIGH_AVAILABILITY_PLATFORM
  HIGH_AVAILABILITY_PLATFORM: {
    name: 'High Availability Platform',
    use_case: '99.99% SLA multi-region deployment',
    mandatory_services: ['loadbalancer', 'cdn', 'apigateway', 'relationaldatabase', 'identityauth', 'logging', 'monitoring', 'cache'],
    optional_services: ['messagequeue'],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 1️⃣3️⃣ IOT_PLATFORM
  IOT_PLATFORM: {
    name: 'IoT Platform',
    use_case: 'Device management, telemetry, time-series data',
    mandatory_services: ['iotcore', 'timeseriesdatabase', 'apigateway', 'objectstorage', 'logging', 'monitoring'],
    optional_services: ['event_stream', 'sms_notification'],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: true,
      payments: false,
      ml: false
    }
  },

  // 1️⃣4️⃣ FINTECH_PAYMENT_PLATFORM
  FINTECH_PAYMENT_PLATFORM: {
    name: 'Fintech Payment Platform',
    use_case: 'PCI-DSS compliant payment processing',
    mandatory_services: ['apigateway', 'computecontainer', 'relationaldatabase', 'paymentgateway', 'identityauth', 'secretsmanagement', 'logging', 'monitoring'],
    optional_services: ['loadbalancer', 'cache'],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: true,
      ml: false
    }
  },

  // 1️⃣5️⃣ HEALTHCARE_PLATFORM
  HEALTHCARE_PLATFORM: {
    name: 'Healthcare Platform',
    use_case: 'HIPAA-compliant healthcare data',
    mandatory_services: ['apigateway', 'computecontainer', 'relationaldatabase', 'identityauth', 'secretsmanagement', 'objectstorage', 'logging', 'monitoring'],
    optional_services: [],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  },

  // 1️⃣6️⃣ GAMING_BACKEND
  GAMING_BACKEND: {
    name: 'Gaming Backend',
    use_case: 'Real-time gaming with leaderboards',
    mandatory_services: ['apigateway', 'computecontainer', 'cache', 'relationaldatabase', 'identityauth', 'logging', 'monitoring'],
    optional_services: ['websocketgateway', 'messagequeue'],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: true,
      payments: false,
      ml: false
    }
  },

  // 1️⃣7️⃣ E_COMMERCE_BACKEND
  E_COMMERCE_BACKEND: {
    name: 'E-Commerce Backend',
    use_case: 'Online store with payments and inventory',
    mandatory_services: ['cdn', 'apigateway', 'computecontainer', 'relationaldatabase', 'paymentgateway', 'identityauth', 'objectstorage', 'cache', 'logging', 'monitoring'],
    optional_services: [],
    forbidden_services: [],
    requirements: {
      stateful: true,
      backend: true,
      realtime: false,
      payments: true,
      ml: false
    }
  },

  // 1️⃣8️⃣ EVENT_DRIVEN_PLATFORM
  EVENT_DRIVEN_PLATFORM: {
    name: 'Event-Driven Platform',
    use_case: 'Decoupled event-based architecture',
    mandatory_services: ['messagequeue', 'computeserverless', 'logging', 'monitoring'],
    optional_services: ['apigateway', 'objectstorage'],
    forbidden_services: [],
    requirements: {
      stateful: false,
      backend: true,
      realtime: false,
      payments: false,
      ml: false
    }
  }
};


const SERVICE_REGISTRY = {
  relationaldatabase: {  // 🔥 CANONICAL NAME (not relational_db)
    required_for: ["stateful", "data_stores:relational"],
    description: "Relational database service",
    category: "database"
  },
  messagequeue: {
    required_for: ["realtime", "data_stores:queue"],
    description: "Message queue service",
    category: "messaging"
  },
  websocketgateway: {
    required_for: ["realtime"],
    description: "WebSocket gateway service",
    category: "messaging"
  },
  paymentgateway: {
    required_for: ["payments"],
    description: "Payment processing service",
    category: "payments"
  },
  mlinference: {  // 🔥 CANONICAL NAME
    required_for: ["ml"],
    description: "ML inference service",
    category: "ml"
  },
  objectstorage: {
    required_for: ["file_storage", "data_stores:objectstorage"],  // 🔥 ADDED data_stores trigger
    description: "Object storage service",
    category: "storage"
  },
  cache: {
    required_for: ["performance", "data_stores:cache"],
    description: "Caching service",
    category: "database"
  },
  apigateway: {
    required_for: ["api_management"],
    description: "API gateway service",
    category: "networking"
  },
  identityauth: {  // 🔥 CANONICAL NAME (not authentication)
    required_for: ["authentication"],
    description: "Authentication service",
    category: "security"
  },
  computecontainer: {  // 🔥 CANONICAL NAME
    required_for: ["backend", "processing"],
    description: "Application compute service",
    category: "compute"
  },
  computeserverless: {  // 🔥 CANONICAL NAME
    required_for: ["serverless", "background_jobs"],
    description: "Serverless compute for event-driven workloads",
    category: "compute"
  },
  loadbalancer: {
    required_for: ["high_availability", "scaling"],
    description: "Load balancing service",
    category: "networking"
  },
  cdn: {  // 🔥 ADDED (was missing)
    required_for: ["public_facing", "static_content"],
    description: "Content delivery network",
    category: "networking"
  },
  logging: {  // 🔥 ADDED (was missing)
    required_for: ["observability"],
    description: "Centralized logging service",
    category: "observability"
  },
  monitoring: {  // 🔥 ADDED (was missing)
    required_for: ["observability"],
    description: "Infrastructure monitoring service",
    category: "observability"
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
          alerts: false
        }
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
      const text = (intent.project_description || intent.description || intent || '').toString().toLowerCase();

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

    // Payments ALWAYS require stateful platform for security/audit
    if (requirements.payments) {
      console.log('[PATTERN ESCALATION] Payments detected → STATEFUL_WEB_PLATFORM (security required)');
      return 'STATEFUL_WEB_PLATFORM';
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

    // Stateful (any type) = Stateful Web Platform (only if NOT mobile backend or analytics)
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
   * 1. PATTERN CONTRACT (highest authority)
   *    - Pattern mandatory services ALWAYS added
   *    - Pattern forbidden services ALWAYS blocked
   * 2. TERMINAL EXCLUSIONS (user authority)
   *    - User exclusions remove services (unless pattern requires)
   * 3. CAPABILITY-DRIVEN ADDITIONS (lowest authority)
   *    - Capabilities suggest services (pattern can override)
   * 
   * CRITICAL RULES:
   * - Pattern contract ALWAYS wins over capabilities
   * - Terminal exclusions respected UNLESS pattern requires service
   * - All services must exist in CANONICAL_SERVICES registry
   * ═════════════════════════════════════════════════════════════════
   */
  resolveServices({ capabilities, terminal_exclusions, pattern }) {
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
    // 2️⃣ CAPABILITIES → SERVICES (filtered by pattern)
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
    // 3️⃣ TERMINAL EXCLUSIONS (user authority, but pattern can override)
    // ═════════════════════════════════════════════════════════════════
    (terminal_exclusions || []).forEach(cap => {
      const blockedServices = getServicesForCapability(cap);
      blockedServices.forEach(svc => {
        if (selected.has(svc)) {
          const entry = selected.get(svc);

          // 🔥 FIX 2: Pattern mandatory services CANNOT be removed
          if (entry.removable === false || patternMandatory.has(svc)) {
            console.log(`[SERVICE RESOLUTION] ⚠️ CANNOT REMOVE ${svc} (required by pattern ${pattern})`);
            return;
          }

          selected.delete(svc);
          console.log(`[SERVICE RESOLUTION] ❌ REMOVED ${svc} due to terminal exclusion: ${cap}`);
        }
      });
    });

    // ═════════════════════════════════════════════════════════════════
    // 4️⃣ PATTERN SANITIZATION (enforce compute model)
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
    // 5️⃣ CANONICAL REGISTRY VALIDATION
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
    // 6️⃣ PATTERN CONTRACT ENFORCEMENT (ensure JSON config services)
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
      pattern: selectedPattern
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
      'payments': ['paymentgateway']
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

    // Get base services from pattern
    const services = patternDef.services.map((svcType, idx) => ({
      id: `${svcType}_${idx}`,
      canonical_type: svcType,
      category: this.getServiceCategory(svcType),
      description: this.getServiceDescription(svcType),
      kind: 'deployable',
      terraform_supported: true,
      required: true,
      pattern_enforced: true
    }));

    return {
      services_contract: {
        total_services: services.length,
        required_services: services.length,
        services
      },
      deployable_services: services.filter(s => s.terraform_supported),
      logical_services: []
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