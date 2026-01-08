/**
 * Pattern Resolver Service
 * Implements V1 Pattern Catalog (Authoritative)
 * 
 * 11 CANONICAL PATTERNS - Each project resolves to exactly ONE
 * Extensions add services, patterns never combine
 */

const { CANONICAL_SERVICES, getServiceDefinition, isDeployable } = require('./canonicalServiceRegistry');
const { CAPABILITY_TO_SERVICE, resolveServicesFromCapabilities, getBlockedServices } = require('./capabilityMap');

// ═══════════════════════════════════════════════════════════════════════════
// V1 PATTERN CATALOG (AUTHORITATIVE)
// ═══════════════════════════════════════════════════════════════════════════
const PATTERN_CATALOG = {
  // 1️⃣ STATIC_SITE
  STATIC_SITE: {
    name: 'Static Site',
    use_case: 'Informational websites, landing pages, documentation',
    mandatory_services: ['object_storage', 'cdn', 'logging', 'monitoring'],
    optional_services: ['identity_auth', 'waf'],
    forbidden_services: ['compute', 'relational_database', 'api_gateway'],
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
    mandatory_services: ['object_storage', 'cdn', 'identity_auth', 'logging', 'monitoring'],
    optional_services: ['waf'],
    forbidden_services: ['compute', 'relational_database', 'api_gateway'],
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
    mandatory_services: ['api_gateway', 'serverless_compute', 'logging', 'monitoring'],
    optional_services: ['nosql_database', 'object_storage', 'message_queue'],
    forbidden_services: ['relational_database', 'load_balancer'],
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
    mandatory_services: ['cdn', 'api_gateway', 'serverless_compute', 'identity_auth', 'logging', 'monitoring'],
    optional_services: ['nosql_database', 'object_storage'],
    forbidden_services: ['relational_database', 'load_balancer', 'payment_gateway'],
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
    mandatory_services: ['cdn', 'load_balancer', 'app_compute', 'relational_database', 'identity_auth', 'logging', 'monitoring'],
    optional_services: ['object_storage', 'cache', 'message_queue', 'websocket_gateway'],
    forbidden_services: ['serverless_compute'],
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
    mandatory_services: ['cdn', 'load_balancer', 'app_compute', 'serverless_compute', 'relational_database', 'cache', 'message_queue', 'identity_auth', 'logging', 'monitoring'],
    conditional_mandatory: {
      websocket_gateway: 'if realtime',
      payment_gateway: 'if payments',
      object_storage: 'if file uploads'
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
    mandatory_services: ['api_gateway', 'app_compute', 'relational_database', 'identity_auth', 'logging', 'monitoring'],
    optional_services: ['push_notification_service', 'cache', 'message_queue'],
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
    mandatory_services: ['analytical_database', 'object_storage', 'batch_compute', 'identity_auth', 'logging', 'monitoring'],
    optional_services: ['message_queue', 'api_gateway'],
    forbidden_services: ['cdn', 'load_balancer', 'app_compute'],
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
    mandatory_services: ['websocket_gateway', 'app_compute', 'cache', 'message_queue', 'logging', 'monitoring'],
    optional_services: ['relational_database', 'identity_auth'],
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
    mandatory_services: ['ml_inference_service', 'object_storage', 'logging', 'monitoring'], // 🔥 FIX 2
    optional_services: ['api_gateway', 'cache'], // 🔥 FIX 2
    forbidden_services: ['relational_database', 'nosql_database', 'message_queue', 'batch_compute'], // 🔥 FIX 2: No DB, no queue, no batch
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
    mandatory_services: ['batch_compute', 'object_storage', 'logging', 'monitoring'],
    optional_services: ['artifact_registry'],
    forbidden_services: [],
    requirements: {
      stateful: false,
      backend: false,
      realtime: false,
      payments: false,
      ml: true
    }
  }
};

const SERVICE_REGISTRY = {
  relational_database: {  // 🔥 CANONICAL NAME (not relational_db)
    required_for: ["stateful", "data_stores:relational"], 
    description: "Relational database service",
    category: "database"
  },
  message_queue: { 
    required_for: ["realtime", "data_stores:queue"], 
    description: "Message queue service",
    category: "messaging"
  },
  websocket_gateway: { 
    required_for: ["realtime"], 
    description: "WebSocket gateway service",
    category: "messaging"
  },
  payment_gateway: { 
    required_for: ["payments"], 
    description: "Payment processing service",
    category: "payments"
  },
  ml_inference_service: {  // 🔥 CANONICAL NAME (not ml_inference)
    required_for: ["ml"], 
    description: "ML inference service",
    category: "ml"
  },
  object_storage: { 
    required_for: ["file_storage", "data_stores:object_storage"],  // 🔥 ADDED data_stores trigger
    description: "Object storage service",
    category: "storage"
  },
  cache: { 
    required_for: ["performance", "data_stores:cache"], 
    description: "Caching service",
    category: "database"
  },
  api_gateway: { 
    required_for: ["api_management"], 
    description: "API gateway service",
    category: "networking"
  },
  identity_auth: {  // 🔥 CANONICAL NAME (not authentication)
    required_for: ["authentication"], 
    description: "Authentication service",
    category: "security"
  },
  app_compute: {  // 🔥 CANONICAL NAME (not compute)
    required_for: ["backend", "processing"], 
    description: "Application compute service",
    category: "compute"
  },
  serverless_compute: {  // 🔥 ADDED (was missing)
    required_for: ["serverless", "background_jobs"],
    description: "Serverless compute for event-driven workloads",
    category: "compute"
  },
  load_balancer: { 
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
  'stateful + relational_db': (requirements) => {
    if (requirements.stateful && requirements.data_stores?.includes('relational_db')) {
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
        requirements.data_stores.push('object_storage');
      }
      if (allFeatures.multi_user_roles === true) {
        requirements.authentication = true;
        requirements.stateful = true; // Multi-user typically requires stateful architecture
      }
      if (allFeatures.identity_auth === true) {
        requirements.authentication = true;
      }
      if (allFeatures.messaging_queue === true) {
        requirements.data_stores.push('queue');
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
        if (!requirements.data_stores.includes('relational_db')) {
          requirements.data_stores.push('relational_db');
        }
      }
      if (text.includes('cache') || text.includes('redis') || text.includes('memcached')) {
        if (!requirements.data_stores.includes('cache')) {
          requirements.data_stores.push('cache');
        }
      }
      if (text.includes('queue') || text.includes('message') || text.includes('kafka')) {
        if (!requirements.data_stores.includes('queue')) {
          requirements.data_stores.push('queue');
        }
      }
      if (text.includes('file') || text.includes('storage') || text.includes('document') || 
          text.includes('image') || text.includes('video')) {
        if (!requirements.data_stores.includes('object_storage')) {
          requirements.data_stores.push('object_storage');
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
    if (requirements.stateful && requirements.data_stores.includes('relational_db')) {
      console.log('[PATTERN REJECTION] SERVERLESS_WEB_APP is ILLEGAL for stateful + relational DB');
    }
    
    // Rule 2: Payments → CANNOT be SERVERLESS_WEB_APP (requires stateful for security)
    if (requirements.payments) {
      console.log('[PATTERN REJECTION] SERVERLESS_WEB_APP is ILLEGAL for payment processing');
    }
    
    // Rule 3: Real-time + Messaging → MUST have proper WebSocket/event architecture
    if (requirements.realtime && (requirements.data_stores.includes('queue') || requirements.data_stores.includes('cache'))) {
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
    
    // ML alone = ML Inference Service
    if (requirements.ml) {
      console.log('[PATTERN SELECTION] ML detected → ML_INFERENCE_SERVICE');
      return 'ML_INFERENCE_SERVICE';
    }
    
    // Real-time + Stateful + Payments = Hybrid Platform (complex requirements)
    if (requirements.realtime && requirements.stateful && requirements.payments) {
      console.log('[PATTERN ESCALATION] Real-time + Stateful + Payments → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }
    
    // 🔥 CRITICAL: Payments + Message Queue = Hybrid Platform (background processing required)
    // E-commerce, payment processing, order fulfillment need async workflows
    if (requirements.payments && requirements.data_stores.includes('queue')) {
      console.log('[PATTERN ESCALATION] Payments + Message Queue → HYBRID_PLATFORM');
      return 'HYBRID_PLATFORM';
    }
    
    // 🔥 CRITICAL: Stateful + Message Queue = Hybrid Platform (async workflows required)
    // Background jobs, async processing, worker queues
    if (requirements.stateful && requirements.data_stores.includes('queue')) {
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
    const patternMandatory = new Set(patternDef.mandatory_services);
    patternDef.mandatory_services.forEach(svc => {
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

      const services = CAPABILITY_TO_SERVICE[capability] || [];
      services.forEach(svc => {
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
      const blockedServices = CAPABILITY_TO_SERVICE[cap] || [];
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
      if (selected.has('app_compute')) {
        selected.delete('app_compute');
        console.log(`[SERVICE RESOLUTION] 🔧 SANITIZED: Removed app_compute (serverless pattern)`);
      }
      if (!selected.has('serverless_compute')) {
        selected.set('serverless_compute', { source: 'pattern_sanitization', pattern, removable: false });
        console.log(`[SERVICE RESOLUTION] 🔧 SANITIZED: Added serverless_compute (serverless pattern)`);
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

    // 🔥 TERRAFORM-SAFE MODE: Filter to only services that are terraform-supported
    const terraformSafeServices = [];
    const excludedServices = [];
    
    for (const [svc, metadata] of selected.entries()) {
      const serviceDef = getServiceDefinition(svc);
      if (serviceDef && serviceDef.terraform_supported === true) {
        terraformSafeServices.push(svc);
      } else {
        excludedServices.push({
          service: svc,
          reason: serviceDef ? 'terraform_supported=false' : 'unknown_service'
        });
      }
    }
    
    if (excludedServices.length > 0) {
      console.warn('[TERRAFORM-SAFE] Excluded services that are not terraform-supported:', 
                   excludedServices.map(e => e.service).join(', '));
      excludedServices.forEach(ex => {
        console.warn(`[TERRAFORM-SAFE] Service excluded: ${ex.service} - ${ex.reason}`);
      });
    }
    
    const finalServices = terraformSafeServices;
    console.log(`[SERVICE RESOLUTION] Final services (${finalServices.length}):`, finalServices);

    return finalServices;
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
          object_storage: 'Object storage for static files and assets',
          cdn: 'Content delivery network for global distribution',
          logging: 'Centralized logging service',
          monitoring: 'Infrastructure and application monitoring',
          identity_auth: 'User authentication and identity management',
          waf: 'Web application firewall',
          api_gateway: 'API gateway for request routing and management',
          serverless_compute: 'Serverless compute for application logic',
          app_compute: 'Application compute service (containers/VMs)',
          relational_database: 'Relational database for structured data',
          nosql_database: 'NoSQL database for flexible data storage',
          load_balancer: 'Load balancer for traffic distribution',
          cache: 'In-memory cache for performance',
          message_queue: 'Message queue for async processing',
          websocket_gateway: 'WebSocket gateway for real-time connections',
          payment_gateway: 'Payment processing integration',
          push_notification_service: 'Push notification service for mobile alerts',
          batch_compute: 'Batch compute for long-running jobs',
          analytical_database: 'Analytical database for OLAP workloads',
          ml_inference_service: 'ML model inference service',
          artifact_registry: 'Artifact and model registry'
        };
        
        const categories = {
          object_storage: 'storage',
          cdn: 'networking',
          logging: 'observability',
          monitoring: 'observability',
          identity_auth: 'security',
          waf: 'security',
          api_gateway: 'networking',
          serverless_compute: 'compute',
          app_compute: 'compute',
          relational_database: 'database',
          nosql_database: 'database',
          load_balancer: 'networking',
          cache: 'database',
          message_queue: 'messaging',
          websocket_gateway: 'messaging',
          payment_gateway: 'payments',
          push_notification_service: 'messaging',
          batch_compute: 'compute',
          analytical_database: 'database',
          ml_inference_service: 'ml',
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
    
    if (requirements.realtime && nodes.some(n => n.id === 'websocket_gateway') && nodes.some(n => n.id === 'message_queue')) {
      edges.push({
        from: 'websocket_gateway',
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
    if (requirements.nfr.compliance.includes('PCI') && nodes.some(n => n.id === 'payment_gateway') && nodes.some(n => n.id === 'monitoring')) {
      edges.push({
        from: 'payment_gateway',
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
    if (requirements.deployment_strategy === 'blue-green' && nodes.some(n => n.id === 'load_balancer') && nodes.some(n => n.id === 'compute')) {
      edges.push({
        from: 'load_balancer',
        to: 'compute',
        label: 'blue-green deployment routing'
      });
    }
    
    // Add region-based connections
    if (requirements.region.multi_region && nodes.some(n => n.id === 'load_balancer') && nodes.some(n => n.id === 'database')) {
      edges.push({
        from: 'load_balancer',
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
      'data_persistence': ['relational_database', 'nosql_database', 'block_storage'],  // 🔥 FIX: REMOVED object_storage
      'document_storage': ['object_storage'],  // 🔥 FIX: Added separate capability
      'messaging': ['message_queue'],
      'realtime': ['websocket_gateway'],
      'payments': ['payment_gateway']
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
   * Resolve the complete architecture
   * Returns the CANONICAL SERVICES CONTRACT that all downstream systems must use
   */
  resolveArchitecture(intent) {
    const requirements = this.extractRequirements(intent);
    const selectedPattern = this.selectPattern(requirements);
    const canonicalArchitecture = this.generateCanonicalArchitecture(requirements, selectedPattern);
    
    console.log(`[ARCHITECTURE RESOLVED] Pattern: ${selectedPattern}, Services: ${canonicalArchitecture.services_contract.total_services}`);

    return {
      requirements,
      selectedPattern,
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