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
const { resolveServiceId } = require('../../config/aliases');

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Config-based pattern catalog for scoring (uses normalized patterns)
// ═══════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════
// NEW: Config-based pattern catalog for scoring (uses normalized patterns)
// ═══════════════════════════════════════════════════════════════════════════
const { patterns: patternsConfig, findBestPattern, getPattern: getPatternFromConfig } = require('../../config');
const PATTERN_CATALOG = patternsConfig.patterns;
const TruthGate = require('./truthGate');
const { validateRuntimeContract } = require('../infrastructure/deploymentValidator');

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Domain Config for Capability Hints
// ═══════════════════════════════════════════════════════════════════════════
const DOMAIN_CONFIG = require('../../config/v2/domains.json');

/**
 * Helper to resolve domain capabilities and policy bias
 */
function resolveDomainCapabilities(domainName) {
  if (!domainName) return null;
  const normalized = domainName.toLowerCase();

  for (const [key, config] of Object.entries(DOMAIN_CONFIG)) {
    if (key === normalized || (config.aliases && config.aliases.includes(normalized))) {
      return {
        name: key,
        capabilities: config.capability_hints || [],
        policy: config.policy_bias || {}
      };
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW: Extract Explicit Services from User Description
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Parses user description text to detect explicitly mentioned services.
 * Returns an object with detected data_stores and capabilities.
 */
function extractExplicitServicesFromText(text) {
  if (!text || typeof text !== 'string') return { data_stores: [], capabilities: {} };

  const lowerText = text.toLowerCase();
  const detected = {
    data_stores: [],
    capabilities: {}
  };

  // Service keyword mappings - explicit mentions trigger service addition
  const serviceKeywords = {
    // Databases
    'database': 'relationaldatabase',
    'sql database': 'relationaldatabase',
    'relational database': 'relationaldatabase',
    'postgresql': 'relationaldatabase',
    'postgres': 'relationaldatabase',
    'mysql': 'relationaldatabase',
    'mariadb': 'relationaldatabase',
    'rds': 'relationaldatabase',
    'nosql': 'nosqldatabase',
    'mongodb': 'nosqldatabase',
    'dynamodb': 'nosqldatabase',
    'document database': 'nosqldatabase',

    // Storage
    'object storage': 'objectstorage',
    'blob storage': 'objectstorage',
    'file storage': 'objectstorage',
    's3': 'objectstorage',
    'storage bucket': 'objectstorage',
    'media storage': 'objectstorage',
    'image storage': 'objectstorage',
    'asset storage': 'objectstorage',

    // Cache
    'cache': 'cache',
    'caching': 'cache',
    'redis': 'cache',
    'memcached': 'cache',
    'elasticache': 'cache',

    // CDN
    'cdn': 'cdn',
    'content delivery': 'cdn',
    'cloudfront': 'cdn',

    // Queue/Messaging
    'queue': 'messagequeue',
    'message queue': 'messagequeue',
    'messaging': 'messagequeue',
    'rabbitmq': 'messagequeue',
    'sqs': 'messagequeue',
    'pub/sub': 'messagequeue',
    'event bus': 'messagequeue',

    // Search
    'search': 'searchengine',
    'elasticsearch': 'searchengine',
    'opensearch': 'searchengine',
    'full-text search': 'searchengine',

    // Realtime
    'websocket': 'websocketgateway',
    'real-time': 'websocketgateway',
    'realtime': 'websocketgateway',
    'live updates': 'websocketgateway',
    'push notifications': 'websocketgateway',

    // ML/AI
    'machine learning': 'mlinference',
    'ml model': 'mlinference',
    'ai inference': 'mlinference',
    'model serving': 'mlinference'
  };

  // Capability keywords - trigger capability flags
  const capabilityKeywords = {
    'payment': 'payments',
    'payments': 'payments',
    'checkout': 'payments',
    'billing': 'payments',
    'stripe': 'payments',
    'razorpay': 'payments',

    'auth': 'auth',
    'authentication': 'auth',
    'login': 'auth',
    'signup': 'auth',
    'user accounts': 'auth',
    'sso': 'auth',
    'oauth': 'auth',

    'cache': 'cache',
    'caching': 'cache',

    'search': 'search',
    'searching': 'search'
  };

  // Helper regex for negative lookbehind simulation
  const isNegated = (str, index) => {
    const prefix = str.substring(Math.max(0, index - 15), index);
    return /\b(no|without|do not need|don't need)\s+(\w+\s+)?$/.test(prefix);
  };

  // Check for service keywords (longest match first for multi-word phrases)
  const sortedKeywords = Object.keys(serviceKeywords).sort((a, b) => b.length - a.length);
  for (const keyword of sortedKeywords) {
    const idx = lowerText.indexOf(keyword);
    if (idx !== -1) {
      if (isNegated(lowerText, idx)) {
        console.log(`[EXPLICIT SERVICE] Skipping '${keyword}' due to negative context`);
        continue;
      }
      const service = serviceKeywords[keyword];
      if (!detected.data_stores.includes(service)) {
        detected.data_stores.push(service);
        console.log(`[EXPLICIT SERVICE] Detected '${keyword}' → ${service}`);
      }
    }
  }

  // Check for capability keywords
  for (const [keyword, capability] of Object.entries(capabilityKeywords)) {
    const idx = lowerText.indexOf(keyword);
    if (idx !== -1) {
      if (isNegated(lowerText, idx)) {
        console.log(`[EXPLICIT CAPABILITY] Skipping '${keyword}' due to negative context`);
        continue;
      }
      detected.capabilities[capability] = true;
      console.log(`[EXPLICIT CAPABILITY] Detected '${keyword}' → ${capability}`);
    }
  }

  return detected;
}

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

      // ═════════════════════════════════════════════════════════════════
      // 🔥 NEW: Extract explicit services from user text
      // When user says "database", "storage", etc., detect and add them
      // ═════════════════════════════════════════════════════════════════
      const explicitServices = extractExplicitServicesFromText(text);
      if (explicitServices.data_stores.length > 0) {
        console.log('[EXPLICIT EXTRACTION] Detected services from text:', explicitServices.data_stores);
        explicitServices.data_stores.forEach(svc => {
          if (!requirements.data_stores.includes(svc)) {
            requirements.data_stores.push(svc);
          }
        });
      }

      // Merge explicit capabilities from text
      if (explicitServices.capabilities) {
        Object.assign(capabilities, explicitServices.capabilities);
        if (explicitServices.capabilities.payments) requirements.payments = true;
        if (explicitServices.capabilities.auth) requirements.authentication = true;
        if (explicitServices.capabilities.cache) capabilities.cache = true;
        if (explicitServices.capabilities.search) capabilities.search = true;
      }

      // ═════════════════════════════════════════════════════════════════
      // 🔥 DOMAIN CAPABILITY RESOLUTION
      // Apply domain-specific defaults (ecommerce, fintech, etc.)
      // ═════════════════════════════════════════════════════════════════
      const primaryDomain = intentClassification.primary_domain || '';

      // ECOMMERCE: Auto-enable critical capabilities
      if (primaryDomain === 'ecommerce') {
        console.log('[DOMAIN HINT] Ecommerce detected → Enabling payments, stateful, database hints');
        requirements.payments = true;
        requirements.stateful = true;
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
        }
        if (!requirements.data_stores.includes('objectstorage')) {
          requirements.data_stores.push('objectstorage');
        }
        capabilities.payments = true;
        capabilities.cache = true;
      }

      // FINTECH: Auto-enable critical capabilities  
      if (primaryDomain === 'fintech' || primaryDomain === 'finance') {
        console.log('[DOMAIN HINT] Fintech detected → Enabling payments, stateful, relational database');
        requirements.payments = true;
        requirements.stateful = true;
        requirements.authentication = true;
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
        }
        capabilities.payments = true;
        capabilities.auth = true;
      }

      // HEALTHCARE: Auto-enable compliance and security
      if (primaryDomain === 'healthcare' || primaryDomain === 'health') {
        console.log('[DOMAIN HINT] Healthcare detected → Enabling stateful, relational database, compliance');
        requirements.stateful = true;
        requirements.authentication = true;
        requirements.nfr.compliance.push('HIPAA');
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
        }
      }

      // ════════════════════════════════════════════════════════════════
      // 🔥 PASS DOMAIN TO REQUIREMENTS (for TruthGate pattern selection)
      // ════════════════════════════════════════════════════════════════
      requirements.domain = primaryDomain || 'generic';
      console.log(`[EXTRACT REQUIREMENTS] Domain set to: ${requirements.domain}`);

      /* 
      // DISABLED: Original domain config approach
      const domainConfig = resolveDomainCapabilities(primaryDomain);

      if (domainConfig) {
        console.log(`[DOMAIN RESOLUTION] Identified domain '${domainConfig.name}' (input: ${primaryDomain})`);
        
        // Apply capability hints
        if (domainConfig.capabilities) {
          domainConfig.capabilities.forEach(cap => {
            if (cap === 'payments') requirements.payments = true;
            if (cap === 'auth') requirements.authentication = true;
            if (cap === 'audit_logging') requirements.nfr.compliance.push('AUDIT'); // Custom tag
            if (cap === 'relational_db' && !requirements.data_stores.includes('relationaldatabase')) {
                requirements.data_stores.push('relationaldatabase');
            }
            if (cap === 'object_storage' && !requirements.data_stores.includes('objectstorage')) {
                requirements.data_stores.push('objectstorage');
            }
            if (cap === 'realtime') requirements.realtime = true;
            if (cap === 'gpu_compute') requirements.ml = true; // Heuristic
            
            // Also enable the capability flag for generic service lookup
            capabilities[cap] = true;
            console.log(`[DOMAIN HINT] Applied capability: ${cap}`);
          });
        }

        // Apply policy bias (Compliance)
        if (domainConfig.policy && domainConfig.policy.compliance) {
            domainConfig.policy.compliance.forEach(comp => {
                if (!requirements.nfr.compliance.includes(comp.toUpperCase())) {
                    requirements.nfr.compliance.push(comp.toUpperCase());
                    console.log(`[DOMAIN POLICY] Enforced compliance: ${comp}`);
                }
            });
        }
      }
      */

      // 🔒 FIX 1: Detect mobile_app_backend domain from intent_classification
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
      // Strict check to avoid "supply_chain" matching "ai"
      const mlDomains = ['machine_learning', 'artificial_intelligence', 'ai_saas', 'data_science', 'llm'];
      if (mlDomains.includes(primaryDomain) || primaryDomain === 'ai' || primaryDomain === 'ml') {
        requirements.ml = true;
      }

      // Fallback: Check text for strict keywords if not already detected
      const mlKeywords = ['inference', 'training', 'gpu', 'embeddings', ' LLM ', 'neural network'];
      if (!requirements.ml && mlKeywords.some(k => text.includes(k))) {
        requirements.ml = true;
      }

      // 🔥 FIX 2: Map new ENUM domains to workloads
      if (primaryDomain === 'api_backend') {
        requirements.workload_types.push('backend_api');
      }
      if (primaryDomain === 'web_application') {
        requirements.workload_types.push('web_app');
      }
      // Note: 'ecommerce' handled by domainConfig above now (payments=true)

      // Merge explicit + inferred features (explicit takes precedence)
      const allFeatures = { ...inferredFeatures, ...explicitFeatures };

      // ... rest of logic ...
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
        requirements.stateful = true;
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
      const computeSignals = [
        allFeatures.app_compute,
        allFeatures.computecontainer,
        allFeatures.containers,
        intent.target_compute === "container",
        text.includes('container') || text.includes('kubernetes') || text.includes('fargate') || text.includes('ecs') || text.includes('gke') || text.includes('app_compute')
      ];
      if (computeSignals.some(s => s === true)) {
        requirements.compute_preference = 'container';
      }

      // Extract from decision_axes
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

      // Only use text parsing if features weren't already detected
      if (requirements.workload_types.length === 0) {
        if (text.includes('web') || text.includes('app') || text.includes('website')) {
          requirements.workload_types.push('web_app');
        }
        if (text.includes('api') || text.includes('backend') || text.includes('service') || text.includes('microservice')) {
          requirements.workload_types.push('backend_api');
        }
        if (text.includes('mobile')) {
          requirements.workload_types.push('mobile_backend');
        }
      }

      // Determine if stateful
      if (!requirements.stateful) {
        if (text.includes('database') || text.includes('store') || text.includes('save') ||
          text.includes('user') || text.includes('profile') || text.includes('session') ||
          requirements.data_stores.length > 0) { // If stores exist, it's likely stateful
          requirements.stateful = true;
        }
      }

      // Determine real-time
      if (!requirements.realtime) {
        if (text.includes('real-time') || text.includes('realtime') || text.includes('chat') ||
          text.includes('live') || text.includes('streaming') || text.includes('notifications')) {
          requirements.realtime = true;
        }
      }

      // Determine authentication
      if (!requirements.authentication) {
        if (text.includes('login') || text.includes('auth') || text.includes('user') ||
          text.includes('profile') || text.includes('account')) {
          requirements.authentication = true;
        }
      }

      // 🆕 NEW: Map decision axes to data stores
      if (decisionAxes.primary_data_model && decisionAxes.primary_data_model.includes('relational')) {
        if (!requirements.data_stores.includes('relationaldatabase')) {
          requirements.data_stores.push('relationaldatabase');
        }
      }
      if (decisionAxes.file_storage === true) {
        if (!requirements.data_stores.includes('objectstorage')) {
          requirements.data_stores.push('objectstorage');
        }
      }
      if (decisionAxes.messaging_queue === true) {
        if (!requirements.data_stores.includes('messagequeue')) {
          requirements.data_stores.push('messagequeue');
        }
      }

      // Determine data stores (Additive text search - Robust)
      if (!requirements.data_stores.includes('relationaldatabase')) {
        if (text.includes('sql') || text.includes('database') || text.includes('relational') ||
          text.includes('mysql') || text.includes('postgres')) {
          requirements.data_stores.push('relationaldatabase');
          requirements.stateful = true; // Implicitly stateful
        }
      }
      if (!requirements.data_stores.includes('cache')) {
        if (text.includes('cache') || text.includes('redis')) {
          requirements.data_stores.push('cache');
        }
      }
      if (!requirements.data_stores.includes('messagequeue')) {
        if (text.includes('queue') || text.includes('message') || text.includes('kafka')) {
          requirements.data_stores.push('messagequeue');
        }
      }
      if (!requirements.data_stores.includes('objectstorage')) {
        if (text.includes('file') || text.includes('storage') || text.includes('s3') || text.includes('images') || text.includes('photos')) {
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
        capabilities: {},
        terminal_exclusions: [],
        nfr: {
          availability: "99.5",
          latency: "medium",
          compliance: [],
          data_residency: null,
          cost_ceiling_usd: null,
          security_level: "standard"
        },
        region: {
          primary_region: "us-east-1",
          secondary_region: null,
          multi_region: false
        },
        data_classes: {},
        data_retention: {},
        deployment_strategy: "rolling",
        downtime_allowed: true,
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
   * NOW USES TRUTHGATE FOR DETERMINISTIC ROUTING
   */
  selectPattern(requirements) {
    console.log('[PATTERN RESOLUTION] Raw Requirements:', {
      stateful: requirements.stateful,
      realtime: requirements.realtime,
      payments: requirements.payments,
      authentication: requirements.authentication,
      data_stores: requirements.data_stores,
      workload_types: requirements.workload_types
    });

    // ═════════════════════════════════════════════════════════════════
    // 🔥 NEW: TRUTH GATE (Canonical Axes & Deterministic Routing)
    // ═════════════════════════════════════════════════════════════════
    const canonicalAxes = TruthGate.normalizeAxes(requirements);
    console.log('[PATTERN RESOLUTION] ⚖️ Canonical Axes:', canonicalAxes);

    // Resolve Pattern Deterministically
    const resolution = TruthGate.resolvePattern(canonicalAxes);

    if (resolution.error) {
      console.warn(`[PATTERN RESOLUTION] 🛑 ${resolution.error}`);
      // If INVALID_INTENT, we *could* fallback or throw. 
      // For current safety, we log validation error but default to HYBRID_PLATFORM 
      // to avoid crashing, but this should be handled upstream.
      // However, user rule said "No Fallback Ever".
      // We will return a 'SAFE_ERROR_PATTERN' or check if it's a clarification case.
      // Returning 'INVALID_INTENT' string might break UI if not handled.
      // For now, let's return it and rely on the UI/System to handle the string.
      // OR better: fallback to HYBRID with a warning attached?
      // User said: "Invalid Intent" is correctness.
      console.error("CRITICAL: Intent validation failed via TruthGate.");
      // We will default to HYBRID_PLATFORM for now to prevent app crash, 
      // but this signals a fundamental ambiguity.
      return 'HYBRID_PLATFORM';
    }

    console.log(`[PATTERN RESOLUTION] ✅ TruthGate resolved: ${resolution}`);
    return resolution;
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
  /**
   * ═════════════════════════════════════════════════════════════════
   * CORE SERVICE RESOLUTION FUNCTION (TruthGate Enforced)
   * ═════════════════════════════════════════════════════════════════
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
      // Rule 1: Relational Database (explicitly requested OR stateful + relational)
      if (requirements.data_stores?.includes('relationaldatabase')) {
        if (!forbidden.has('relationaldatabase')) {
          selected.set('relationaldatabase', { source: 'requirement_rule', rule: 'explicit_or_stateful_relational', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added relationaldatabase (Requirement Rule: explicit/stateful + relational)`);
        }
      }

      // Rule 1b: NoSQL Database (explicitly requested)
      if (requirements.data_stores?.includes('nosqldatabase')) {
        if (!forbidden.has('nosqldatabase')) {
          selected.set('nosqldatabase', { source: 'requirement_rule', rule: 'explicit_nosql', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added nosqldatabase (Requirement Rule: explicit nosql)`);
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

      // Rule 5b: CDN (explicitly requested)
      if (requirements.data_stores?.includes('cdn')) {
        if (!forbidden.has('cdn')) {
          selected.set('cdn', { source: 'requirement_rule', rule: 'explicit_cdn', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added cdn (Requirement Rule: explicit cdn)`);
        }
      }

      // Rule 5c: Search Engine (explicitly requested)
      if (requirements.data_stores?.includes('searchengine')) {
        if (!forbidden.has('searchengine')) {
          selected.set('searchengine', { source: 'requirement_rule', rule: 'explicit_search', removable: true });
          console.log(`[SERVICE RESOLUTION] ➕ Added searchengine (Requirement Rule: explicit search)`);
        }
      }

      // Rule 5d: WebSocket Gateway (explicitly requested)
      if (requirements.data_stores?.includes('websocketgateway')) {
        if (!forbidden.has('websocketgateway')) {
          selected.set('websocketgateway', { source: 'requirement_rule', rule: 'explicit_websocket', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added websocketgateway (Requirement Rule: explicit websocket)`);
        }
      }

      // Rule 5e: Cache (explicitly requested)
      if (requirements.data_stores?.includes('cache')) {
        if (!forbidden.has('cache')) {
          selected.set('cache', { source: 'requirement_rule', rule: 'explicit_cache', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added cache (Requirement Rule: explicit cache)`);
        }
      }

      // Rule 5f: ML Inference (explicitly requested)
      if (requirements.data_stores?.includes('mlinference')) {
        if (!forbidden.has('mlinference')) {
          selected.set('mlinference', { source: 'requirement_rule', rule: 'explicit_ml', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added mlinference (Requirement Rule: explicit ML)`);
        }
      }


      // ════════════════════════════════════════════════════════════════
      // 🔥 NEW RULE 6: Payments -> Payment Gateway (User Input Driven)
      // ════════════════════════════════════════════════════════════════
      if (requirements.payments) {
        if (!forbidden.has('paymentgateway')) {
          selected.set('paymentgateway', { source: 'requirement_rule', rule: 'payments', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added paymentgateway (Requirement Rule: payments detected)`);
        } else {
          console.warn(`[SERVICE RESOLUTION] ⚠️ Payment requirement ignored due to pattern restriction on paymentgateway`);
        }
      }

      // 🔥 NEW RULE 7: ML -> ML Inference (User Input Driven)
      if (requirements.ml) {
        if (!forbidden.has('mlinference')) {
          selected.set('mlinference', { source: 'requirement_rule', rule: 'ml', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added mlinference (Requirement Rule: ML detected)`);
        }
      }

      // 🔥 NEW RULE 8: Realtime -> WebSockets (User Input Driven)
      if (requirements.realtime) {
        if (!forbidden.has('websocketgateway')) {
          selected.set('websocketgateway', { source: 'requirement_rule', rule: 'realtime', removable: false });
          console.log(`[SERVICE RESOLUTION] 🔒 Added websocketgateway (Requirement Rule: realtime detected)`);
        }
      }

      // 🔥 NEW RULE 9: Search -> Search Engine (User Input Driven)
      if (requirements.search || (requirements.capabilities && requirements.capabilities.search)) {
        if (!forbidden.has('searchengine')) {
          selected.set('searchengine', { source: 'requirement_rule', rule: 'search', removable: true });
          console.log(`[SERVICE RESOLUTION] ➕ Added searchengine (Requirement Rule: search detected)`);
        }
      }

      // 🔥 NEW RULE 10: DNS & Custom Domains
      const needsDns = requirements.normDesc?.includes('domain') || requirements.normDesc?.includes('dns') || requirements.normDesc?.includes('hostname');
      if (needsDns) {
        if (!forbidden.has('dns')) {
          selected.set('dns', { source: 'requirement_rule', rule: 'networking', removable: true });
          console.log(`[SERVICE RESOLUTION] 🌐 Added dns (Requirement Rule: custom domain detected)`);
        }
      }

      // 🔥 NEW RULE 11: SSL/TLS & Certificates
      const needsSsl = requirements.normDesc?.includes('ssl') || requirements.normDesc?.includes('tls') || requirements.normDesc?.includes('https') || requirements.normDesc?.includes('certificate');
      if (needsSsl) {
        if (!forbidden.has('certificatemanagement')) {
          selected.set('certificatemanagement', { source: 'requirement_rule', rule: 'security', removable: true });
          console.log(`[SERVICE RESOLUTION] 🔒 Added certificatemanagement (Requirement Rule: ssl detected)`);
        }
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // 3️⃣ CAPABILITIES → SERVICES (filtered by pattern)
    // ═════════════════════════════════════════════════════════════════
    for (const [capability, value] of Object.entries(capabilities || {})) {
      if (value !== true) continue;

      const servicesList = getServicesForCapability(capability);
      servicesList.forEach(rawSvc => {
        const svc = resolveServiceId(rawSvc);

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
    (terminal_exclusions || []).forEach(rawCap => {
      // Exclusions can be broad (capabilities) or specific (service IDs)
      // We try resolving as service ID first, then capability
      const excludedServiceId = resolveServiceId(rawCap);
      const blockedServices = getServicesForCapability(rawCap); // Treats as capability

      const servicesToRemove = new Set(blockedServices);
      servicesToRemove.add(excludedServiceId);

      servicesToRemove.forEach(svc => {
        if (selected.has(svc)) {
          const entry = selected.get(svc);

          // 🔥 FIX 2: Pattern mandatory services CANNOT be removed
          // Requirement rules should be overridable by explicit user exclusions
          if (patternMandatory.has(svc)) {
            console.log(`[SERVICE RESOLUTION] ⚠️ CANNOT REMOVE ${svc} (strictly required by pattern ${pattern})`);
            return;
          }

          selected.delete(svc);
          console.log(`[SERVICE RESOLUTION] ❌ REMOVED ${svc} due to terminal exclusion: ${rawCap}`);
        }
      });
    });

    // ═════════════════════════════════════════════════════════════════
    // 5️⃣ TRUTH GATE INVARIANT ENFORCEMENT (Final Cleanup)
    // ═════════════════════════════════════════════════════════════════
    const canonicalAxes = TruthGate.normalizeAxes(requirements);
    const validServices = TruthGate.enforceServiceInvariants(Array.from(selected.keys()), canonicalAxes);

    // Update map with validated services (purge clean)
    const validSet = new Set(validServices);
    for (const svc of selected.keys()) {
      if (!validSet.has(svc)) {
        selected.delete(svc);
        console.log(`[SERVICE RESOLUTION] � TRUTH GATE KILLED: ${svc} (Violated Canonical Invariant)`);
      }
    }

    // ═════════════════════════════════════════════════════════════════
    // 6️⃣ CANONICAL REGISTRY VALIDATION
    // ═════════════════════════════════════════════════════════════════
    const finalServices = Array.from(selected.entries()).map(([id, meta]) => {
      // Logic for REQUIRED vs SUGGESTED
      // 1. If it's pattern mandatory -> REQUIRED
      // 2. If it's a hard requirement (removable: false) -> REQUIRED
      // 3. If it's a capability hint or removable rule -> SUGGESTED (contextual)
      let state = 'REQUIRED';
      if (meta.removable && (meta.source === 'capability' || meta.source === 'requirement_rule')) {
        state = 'SUGGESTED';
      }

      return {
        id,
        ...meta,
        state
      };
    });

    console.log(`[SERVICE RESOLUTION] Final resolution (${finalServices.length}):`, finalServices.map(s => `${s.id}(${s.state})`).join(', '));

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
    const ensureService = (rawServiceName, description, category) => {
      const serviceName = resolveServiceId(rawServiceName);

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
      patternDef.mandatory_services.forEach(rawId => {
        const serviceName = resolveServiceId(rawId);
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
    const resolvedServices = this.resolveServices({
      capabilities: requirements.capabilities || {},
      terminal_exclusions: requirements.terminal_exclusions || [],
      pattern: selectedPattern,
      requirements: requirements // 🔥 FIX: Passed requirements for rule enforcement
    });

    console.log(`[CANONICAL ARCHITECTURE] Pattern: ${selectedPattern}, Services: ${resolvedServices.length}`);

    // Build services array with full metadata from canonical registry
    const services = resolvedServices.map(svc => {
      const name = svc.id;
      const serviceDef = getServiceDefinition(name);
      return {
        name: name,
        state: svc.state, // REQUIRED or SUGGESTED
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
      state: service.state, // Pass through REQUIRED/SUGGESTED
      terraform_supported: service.terraform_supported,
      required: service.state === 'REQUIRED',
      pattern_enforced: service.state === 'REQUIRED'
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
      services: architecture_services,                // 🔥 COMPATIBILITY: Alias for architectureDiagramService
      deployable_services: deployable_services,       // Only terraform_supported=true (Terraform)
      logical_services: logical_services,             // Architecture-only (no Terraform)

      // Graph representation for diagrams
      nodes,
      edges,

      // 🔥 HARDENING: Explicit Runtime & Validation
      runtime: this.resolveRuntime(selectedPattern, deployable_services),
      validation: validateRuntimeContract({ requirements }, this.resolveRuntime(selectedPattern, deployable_services)),

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
    else if (action.type === 'ADD_SERVICE') {
      const existing = services.find(s => s.canonical_type === action.serviceId || s.id === action.serviceId);
      if (existing) {
        existing.state = 'OPTIONAL';
      } else {
        // New service from catalog
        const def = getServiceDefinition(action.serviceId);
        if (def) {
          services.push({
            id: `${action.serviceId}_user_${Date.now()}`,
            canonical_type: action.serviceId,
            category: def.category || 'other', // Fallback
            description: def.description,
            kind: 'deployable',
            pricing_class: def.pricing_class || 'DIRECT',
            state: 'OPTIONAL',
            terraform_supported: true,
            pattern_enforced: false
          });
        } else {
          console.warn(`[RECONCILE] Unknown service ID for ADD_SERVICE: ${action.serviceId}`);
        }
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
      stateful: (v2Axes.stateful?.value === true) || capabilities.has('relational_db') || capabilities.has('nosql_db') || capabilities.has('database'),
      realtime: capabilities.has('realtime') || (v2Axes.realtime_updates?.value === true),
      payments: capabilities.has('payments') || (v2Axes.payments?.value === true),
      authentication: capabilities.has('auth') || capabilities.has('user_authentication') || (v2Axes.user_authentication?.value === true),
      data_stores: [],
      ml: capabilities.has('ml') || capabilities.has('ai') || (v2Axes.domain_ml_heavy?.value === true),
      nfr: {
        availability: v2Axes.availability_target?.value || "99.5",
        security_level: v2Axes.security_posture?.value === "hardened" ? "high" : "standard",
        compliance: v2Axes.regulatory_compliance?.value || []
      },
      data_retention: v2Axes.backup_retention_days ? { days: v2Axes.backup_retention_days.value } : {},
      deployment_strategy: v2Axes.deployment_strategy?.value || 'rolling',
      region: {
        primary: v2Axes.primary_region_hint?.value || 'us-east-1',
        multi_region: (v2Axes.multi_region_required?.value === true)
      },
      // Pass raw capabilities for service resolution
      capabilities: detected.capability_hints.reduce((acc, cap) => ({ ...acc, [cap]: true }), {}),
      // Map user exclusions to terminal exclusions
      terminal_exclusions: Object.keys(exclusions).filter(k => exclusions[k] === true),
      // Pass normalized description for rule matching
      normDesc: (preIntentContext.raw_description || "").toLowerCase()
    };

    // Deterministic Workload Overrides
    if (derived.workload_guess === 'static_site' && !requirements.workload_types.includes('static_site')) {
      requirements.workload_types.unshift('static_site');
    }


    // Map capabilities to data stores
    if (capabilities.has('relational_db')) requirements.data_stores.push('relationaldatabase');
    if (capabilities.has('object_storage')) requirements.data_stores.push('objectstorage');
    if (capabilities.has('message_queue')) requirements.data_stores.push('messagequeue');

    // ═════════════════════════════════════════════════════════════════
    // 🔥 NEW: Extract explicit services from user description text
    // This ensures "database", "cache", "storage" mentioned in text are detected
    // ═════════════════════════════════════════════════════════════════
    const rawDescription = preIntentContext.raw_description || "";
    const explicitServices = extractExplicitServicesFromText(rawDescription);
    if (explicitServices.data_stores.length > 0) {
      console.log('[RESOLVE V2] Extracted explicit services from text:', explicitServices.data_stores);
      explicitServices.data_stores.forEach(svc => {
        if (!requirements.data_stores.includes(svc)) {
          requirements.data_stores.push(svc);
        }
      });
    }

    // Merge explicit capabilities from text
    if (explicitServices.capabilities.payments) requirements.payments = true;
    if (explicitServices.capabilities.auth) requirements.authentication = true;
    if (explicitServices.capabilities.cache) requirements.capabilities.cache = true;
    if (explicitServices.capabilities.search) requirements.capabilities.search = true;

    // ═════════════════════════════════════════════════════════════════
    // 🔥 NEW: Pass domain for TruthGate pattern routing
    // ═════════════════════════════════════════════════════════════════
    const primaryDomain = v2Axes.primary_domain?.value || v2Axes.intent_classification?.primary_domain || 'generic';
    requirements.domain = primaryDomain;
    console.log(`[RESOLVE V2] Domain set to: ${requirements.domain}`);

    // Apply domain-specific hints
    if (primaryDomain === 'ecommerce') {
      console.log('[RESOLVE V2] Ecommerce domain → Adding payments, stateful, database hints');
      requirements.payments = true;
      requirements.stateful = true;
      requirements.capabilities.payments = true;
      requirements.capabilities.cache = true;
      if (!requirements.data_stores.includes('relationaldatabase')) {
        requirements.data_stores.push('relationaldatabase');
      }
      if (!requirements.data_stores.includes('objectstorage')) {
        requirements.data_stores.push('objectstorage');
      }
    }

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
  /**
   * Resolve the explicit runtime capability object
   */
  resolveRuntime(patternName, services) {
    // 1. Check for Container Service
    if (services.some(s => s.canonical_type === 'computecontainer' || s.canonical_type === 'compute_container')) {
      return { type: 'compute_container', reason: 'Explicit container service found' };
    }

    // 2. Check for Serverless
    if (services.some(s => s.canonical_type === 'computeserverless')) {
      return { type: 'compute_serverless', reason: 'Serverless function service found' };
    }

    // 3. Check for VM
    if (services.some(s => s.canonical_type === 'computevm')) {
      return { type: 'compute_vm', reason: 'Virtual machine service found' };
    }


    // 4. Fallback for Static Sites
    if (services.some(s => s.canonical_type === 'objectstorage') && services.some(s => s.canonical_type === 'cdn')) {
      return { type: 'static_site', reason: 'Storage + CDN detected' };
    }

    return { type: 'unknown', reason: 'No compute service detected' };
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