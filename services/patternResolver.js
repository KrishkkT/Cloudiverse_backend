/**
 * PATTERN RESOLVER
 * 
 * Deterministic pattern selection based on intent signals.
 * AI never selects patterns - this module does.
 * 
 * Rules are evaluated in priority order.
 */

const { ARCHITECTURE_PATTERNS, getRequiredServices } = require('./architecturePatterns');

/**
 * 🔒 FIX 1: HARD STATIC OVERRIDE (MANDATORY - RUNS FIRST)
 * This MUST run before any other inference.
 * Uses Step 1 signals VERBATIM (FIX 2).
 * 
 * @param {object} intent - The normalized intent from Step 1
 * @returns {object|null} { pattern, skipPatternInference } or null
 */
function checkStaticOverride(intent) {
    const classification = intent.intent_classification || {};
    const features = intent.feature_signals || {};  // FIX 2: Use verbatim, never recompute
    const semantic = intent.semantic_signals || {};

    // Hard STATIC override conditions (EXACT match required)
    const isStaticDomain = [
        'portfolio', 'landing_page', 'documentation', 'blog',
        'marketing_site', 'brochure', 'static_site', 'personal_website',
        'web_hosting', 'static_website'
    ].includes(classification.primary_domain) ||
        ['static_website', 'static_content', 'documentation', 'static', 'portfolio', 'landing'].includes(classification.workload_type) ||
        classification.workload_type?.includes('static');

    const isStaticContent = features.static_content === true || features.static_site === true;
    const isStateless = semantic.statefulness === 'stateless';
    const noPayments = !features.payments;
    const noRealTime = !features.real_time;

    // HARD STATIC OVERRIDE
    if ((isStaticDomain || isStaticContent) && isStateless && noPayments && noRealTime) {
        console.log('[PATTERN RESOLVER] 🔒 HARD STATIC OVERRIDE TRIGGERED');
        console.log('[PATTERN RESOLVER] Conditions: domain=' + classification.primary_domain +
            ', workload=' + classification.workload_type +
            ', static_content=' + isStaticContent +
            ', stateless=' + isStateless);
        return {
            pattern: 'STATIC_WEB_HOSTING',
            skipPatternInference: true,
            // DO NOT infer api_required
            // DO NOT allow serverless
            // DO NOT ask AI for architecture
            overrideReason: 'Hard static content guardrail'
        };
    }

    return null;
}

/**
 * Resolve the architecture pattern based on intent signals
 * @param {object} intent - The normalized intent from Step 1
 * @returns {string} Pattern name
 */
function resolvePattern(intent) {
    // 🔒 FIX 1: Check hard STATIC override FIRST
    const staticOverride = checkStaticOverride(intent);
    if (staticOverride) {
        return staticOverride.pattern;
    }

    // FIX 2: Use Step 1 signals VERBATIM (never recompute)
    const signals = extractSignals(intent);

    console.log('[PATTERN RESOLVER] Signals:', JSON.stringify(signals, null, 2));

    // RULE 2: DATA_PROCESSING_PIPELINE
    // ETL, analytics, batch processing
    if (signals.workload_type === 'batch_processing' ||
        signals.workload_type === 'data_pipeline' ||
        signals.workload_type === 'etl') {
        console.log('[PATTERN RESOLVER] → DATA_PROCESSING_PIPELINE');
        return 'DATA_PROCESSING_PIPELINE';
    }

    // RULE 3: EVENT_DRIVEN_SYSTEM
    // Notifications, background jobs, triggers
    if (signals.workload_type === 'event_driven' ||
        signals.notifications ||
        signals.background_jobs) {
        console.log('[PATTERN RESOLVER] → EVENT_DRIVEN_SYSTEM');
        return 'EVENT_DRIVEN_SYSTEM';
    }

    // RULE 4: MICROSERVICES_PLATFORM
    // Complex platforms, multiple services, large scale
    if (signals.microservices ||
        signals.scale === 'large' ||
        signals.multi_team ||
        (signals.feature_count && signals.feature_count > 10)) {
        console.log('[PATTERN RESOLVER] → MICROSERVICES_PLATFORM');
        return 'MICROSERVICES_PLATFORM';
    }

    // RULE 5: INTERNAL_TOOL
    // Admin tools, internal dashboards, not user-facing
    if (!signals.user_facing &&
        (signals.workload_type === 'internal_tool' ||
            signals.workload_type === 'admin_dashboard' ||
            signals.domain === 'ops')) {
        console.log('[PATTERN RESOLVER] → INTERNAL_TOOL');
        return 'INTERNAL_TOOL';
    }

    // RULE 6: SERVERLESS_WEB_APP
    // Mobile backends, SPAs with simple APIs, lightweight apps
    if (signals.client_type === 'mobile' ||
        signals.workload_type === 'api_service' ||
        (signals.user_facing && !signals.stateful && signals.api_required)) {
        console.log('[PATTERN RESOLVER] → SERVERLESS_WEB_APP');
        return 'SERVERLESS_WEB_APP';
    }

    // RULE 7: CONTAINERIZED_APP
    // Single service, APIs, stateful web apps
    if (signals.workload_type === 'web_application' &&
        signals.stateful &&
        !signals.microservices) {
        console.log('[PATTERN RESOLVER] → CONTAINERIZED_APP');
        return 'CONTAINERIZED_APP';
    }

    // RULE 8: THREE_TIER_WEB_APP (DEFAULT)
    // Classic web apps, business apps, dashboards
    console.log('[PATTERN RESOLVER] → THREE_TIER_WEB_APP (default)');
    return 'THREE_TIER_WEB_APP';
}

/**
 * Extract pattern-relevant signals from intent
 */
function extractSignals(intent) {
    const classification = intent.intent_classification || {};
    const features = intent.feature_signals || {};
    const semantic = intent.semantic_signals || {};

    // Check static content first (affects api_required)
    const isStatic = isStaticContent(classification, semantic, features);

    return {
        // Workload type
        workload_type: classification.workload_type || 'web_application',
        domain: classification.primary_domain || 'general',

        // Static content check (portfolio, landing pages, docs)
        static_content: isStatic,

        // Statefulness
        stateful: semantic.statefulness === 'stateful',

        // Feature flags
        payments: features.payments || false,
        realtime: features.real_time || false,
        auth_required: features.multi_user_roles || features.auth_required || false,
        // For static sites, api_required is always false
        api_required: isStatic ? false : (features.api_required !== false),
        notifications: features.notifications || false,
        background_jobs: features.background_jobs || false,

        // Scale
        scale: determineScale(intent),

        // User facing
        user_facing: classification.user_facing !== false,

        // Client type (web, mobile, both)
        client_type: classification.client_type || 'web',

        // Complexity indicators
        microservices: features.microservices || classification.workload_type === 'microservices',
        multi_team: features.multi_team || false,
        feature_count: countFeatures(features)
    };
}

/**
 * Detect if this is a static content site
 */
function isStaticContent(classification, semantic, features = {}) {
    const staticDomains = [
        'portfolio', 'landing_page', 'documentation', 'blog',
        'marketing_site', 'brochure', 'static_site', 'personal_website',
        'resume', 'cv', 'company_website'
    ];

    const staticWorkloads = [
        'static_website', 'static_content', 'documentation', 'static',
        'static_site', 'landing', 'portfolio'
    ];

    // Check primary domain
    if (staticDomains.includes(classification.primary_domain)) return true;

    // Check workload type
    if (staticWorkloads.includes(classification.workload_type)) return true;

    // Check if workload contains 'static'
    if (classification.workload_type?.includes('static')) return true;

    // Check features for static indicators
    if (features.static_site || features.jamstack) return true;

    return false;
}

/**
 * Determine scale from intent
 */
function determineScale(intent) {
    const missing = intent.missing_decision_axes || [];

    // Check if scale was asked and answered
    if (intent.answered_axes?.scale) {
        const answer = intent.answered_axes.scale.toLowerCase();
        if (answer.includes('large') || answer.includes('million')) return 'large';
        if (answer.includes('small') || answer.includes('hundred')) return 'small';
        return 'medium';
    }

    // Default based on workload type
    const workload = intent.intent_classification?.workload_type;
    if (workload === 'microservices' || workload === 'enterprise') return 'large';

    return 'medium';
}

/**
 * Count number of features to estimate complexity
 */
function countFeatures(features) {
    return Object.values(features).filter(v => v === true).length;
}

/**
 * Get the complete service list for a resolved pattern
 * @param {string} patternName - The resolved pattern
 * @param {object} options - Additional options (compute_preference, db_preference)
 * @returns {array} List of service class names
 */
function getServicesForPattern(patternName, options = {}) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) {
        console.error(`[PATTERN RESOLVER] Unknown pattern: ${patternName}`);
        return [];
    }

    const services = new Set(pattern.required);

    // Handle compute choice
    if (pattern.compute_choice) {
        const preferred = options.compute_preference || pattern.compute_choice[0];
        if (pattern.compute_choice.includes(preferred)) {
            services.add(preferred);
        } else {
            services.add(pattern.compute_choice[0]);
        }
    }

    // Handle database choice
    if (pattern.database_choice) {
        const preferred = options.db_preference || pattern.database_choice[0];
        if (pattern.database_choice.includes(preferred)) {
            services.add(preferred);
        } else {
            services.add(pattern.database_choice[0]);
        }
    }

    // Add optional services based on features
    if (options.include_optional) {
        for (const opt of pattern.optional || []) {
            services.add(opt);
        }
    }

    return Array.from(services);
}

/**
 * Map user exclusion keywords to service classes
 * e.g., "database" -> ["relational_database", "nosql_database"]
 */
const EXCLUSION_MAPPING = {
    'database': ['relational_database', 'nosql_database'],
    'db': ['relational_database', 'nosql_database'],
    'cache': ['cache'],
    'caching': ['cache'],
    'api': ['api_gateway', 'compute_serverless'],
    'backend': ['compute_container', 'compute_vm', 'compute_serverless', 'api_gateway'],
    'auth': ['identity_auth'],
    'authentication': ['identity_auth'],
    'login': ['identity_auth'],
    'compute': ['compute_container', 'compute_vm', 'compute_serverless'],
    'storage': ['object_storage', 'block_storage'],
    'cdn': ['cdn'],
    'search': ['search_engine'],
    'queue': ['messaging_queue'],
    'messaging': ['messaging_queue', 'event_bus'],
    'monitoring': ['monitoring'],
    'logging': ['logging'],
    'secrets': ['secrets_management']
};

/**
 * Extract service classes to exclude based on user's explicit_exclusions
 */
function getExcludedServiceClasses(intent) {
    const exclusions = intent.explicit_exclusions || [];
    const excludedServices = new Set();

    for (const exclusion of exclusions) {
        const normalized = exclusion.toLowerCase().trim();
        const serviceClasses = EXCLUSION_MAPPING[normalized] || [];
        for (const sc of serviceClasses) {
            excludedServices.add(sc);
        }
    }

    if (excludedServices.size > 0) {
        console.log(`[PATTERN RESOLVER] User excluded: ${Array.from(excludedServices).join(', ')}`);
    }

    return excludedServices;
}

/**
 * Full pattern resolution with services
 * @param {object} intent - The normalized intent
 * @returns {object} { pattern, services, cost_range, forbidden, user_excluded }
 */
function resolvePatternWithServices(intent) {
    const patternName = resolvePattern(intent);
    const pattern = ARCHITECTURE_PATTERNS[patternName];

    let services = getServicesForPattern(patternName, {
        compute_preference: getComputePreference(intent),
        db_preference: getDatabasePreference(intent)
    });

    // 🔒 USER EXCLUSION HANDLING
    // Remove any services the user explicitly said NOT to include
    const userExcluded = getExcludedServiceClasses(intent);
    if (userExcluded.size > 0) {
        const before = services.length;
        services = services.filter(s => !userExcluded.has(s));
        console.log(`[PATTERN RESOLVER] Filtered ${before - services.length} services based on user exclusions`);
    }

    return {
        pattern: patternName,
        pattern_name: pattern.name,
        pattern_description: pattern.description,
        services: services.map(s => ({ service_class: s })),
        required_services: pattern.required,
        optional_services: pattern.optional,
        forbidden_services: pattern.forbidden,
        user_excluded_services: Array.from(userExcluded),
        cost_range: pattern.cost_range,
        cost_formatted: pattern.cost_formatted
    };
}

/**
 * Get compute preference based on intent
 */
function getComputePreference(intent) {
    const workload = intent.intent_classification?.workload_type;

    // Serverless preference
    if (workload === 'api_service' || workload === 'serverless') {
        return 'compute_serverless';
    }

    // Container preference (default for most apps)
    return 'compute_container';
}

/**
 * Get database preference based on intent
 */
function getDatabasePreference(intent) {
    const semantic = intent.semantic_signals || {};

    // NoSQL for event-driven, high write, document-oriented
    if (semantic.write_intensity === 'high' ||
        semantic.data_model === 'document' ||
        intent.intent_classification?.workload_type === 'event_driven') {
        return 'nosql_database';
    }

    // Relational for everything else
    return 'relational_database';
}

module.exports = {
    resolvePattern,
    getServicesForPattern,
    resolvePatternWithServices,
    extractSignals
};
