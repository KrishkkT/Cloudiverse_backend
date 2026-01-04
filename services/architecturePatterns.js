/**
 * CANONICAL ARCHITECTURE PATTERNS
 * 
 * Every Cloudiverse project resolves to exactly ONE of these 6 patterns.
 * This is the most important structural decision in the system.
 * 
 * CORE PRINCIPLE:
 *   Pattern → Cost Engine → Pricing Model
 *   AI NEVER bypasses either.
 * 
 * COST ENGINE TYPES:
 *   - 'formula': Pure math, no Terraform/Infracost
 *   - 'hybrid':  Formula for compute, optional Infracost for DB
 *   - 'infracost': Full Terraform IR + Infracost required
 */

const ARCHITECTURE_PATTERNS = {

    // ═══════════════════════════════════════════════════════════════════
    // 1. STATIC_WEB_HOSTING — Formula Based (NEVER INFRACOST)
    // ═══════════════════════════════════════════════════════════════════
    STATIC_WEB_HOSTING: {
        name: 'Static Web Hosting',
        description: 'Static websites, portfolios, landing pages, documentation sites',
        cost_engine: 'formula',
        cost_drivers: ['bandwidth', 'storage', 'dns'],
        allowed_services: ['object_storage', 'cdn', 'dns', 'monitoring', 'identity_auth'],
        forbidden_services: [
            'compute_vm', 'compute_container', 'compute_serverless', 'compute_batch',
            'relational_database', 'nosql_database', 'cache',
            'load_balancer', 'api_gateway', 'messaging_queue', 'event_bus'
        ],
        cost_range: { min: 1, max: 10, unit: 'month' },
        infracost_allowed: false
    },

    // ═══════════════════════════════════════════════════════════════════
    // 2. SERVERLESS_WEB_APP — Hybrid (Formula + Optional Infracost for DB)
    // ═══════════════════════════════════════════════════════════════════
    SERVERLESS_WEB_APP: {
        name: 'Serverless Web App',
        description: 'SPAs with APIs, mobile backends, lightweight web services',
        cost_engine: 'hybrid',
        cost_drivers: ['invocations', 'api_requests', 'bandwidth', 'managed_db'],
        allowed_services: [
            'object_storage', 'cdn', 'api_gateway', 'compute_serverless',
            'nosql_database', 'event_bus', 'logging', 'monitoring',
            'secrets_management', 'dns', 'identity_auth'
        ],
        forbidden_services: ['compute_vm', 'compute_batch', 'load_balancer'],
        cost_range: { min: 10, max: 150, unit: 'month' },
        infracost_allowed: true,
        infracost_scope: ['nosql_database', 'relational_database'] // Only these go to Infracost
    },

    // ═══════════════════════════════════════════════════════════════════
    // 3. CONTAINERIZED_WEB_APP — Infracost Required
    // ═══════════════════════════════════════════════════════════════════
    CONTAINERIZED_WEB_APP: {
        name: 'Containerized Web App',
        description: 'Containerized services, REST APIs, microservices',
        cost_engine: 'infracost',
        cost_drivers: ['compute_hours', 'memory', 'load_balancers', 'databases'],
        allowed_services: [
            'compute_container', 'load_balancer', 'relational_database', 'nosql_database',
            'cache', 'object_storage', 'cdn', 'api_gateway',
            'logging', 'monitoring', 'secrets_management', 'dns', 'identity_auth'
        ],
        forbidden_services: ['compute_vm', 'compute_batch'],
        cost_range: { min: 80, max: 500, unit: 'month' },
        infracost_allowed: true
    },

    // ═══════════════════════════════════════════════════════════════════
    // 4. MOBILE_BACKEND_API — Hybrid (Formula for API + Infracost for DB)
    // ═══════════════════════════════════════════════════════════════════
    MOBILE_BACKEND_API: {
        name: 'Mobile Backend API',
        description: 'APIs for mobile apps, push notifications, user auth',
        cost_engine: 'hybrid',
        cost_drivers: ['api_calls', 'auth', 'db_read_write', 'bandwidth'],
        allowed_services: [
            'api_gateway', 'compute_serverless', 'nosql_database', 'relational_database',
            'event_bus', 'messaging_queue', 'object_storage',
            'logging', 'monitoring', 'secrets_management', 'dns', 'identity_auth'
        ],
        forbidden_services: ['compute_vm', 'compute_batch', 'cdn'],
        cost_range: { min: 20, max: 200, unit: 'month' },
        infracost_allowed: true,
        infracost_scope: ['nosql_database', 'relational_database']
    },

    // ═══════════════════════════════════════════════════════════════════
    // 5. TRADITIONAL_VM_APP — Infracost Required
    // ═══════════════════════════════════════════════════════════════════
    TRADITIONAL_VM_APP: {
        name: 'Traditional VM App',
        description: 'Legacy applications, VMs, classic server deployments',
        cost_engine: 'infracost',
        cost_drivers: ['vm_hours', 'disk', 'bandwidth'],
        allowed_services: [
            'compute_vm', 'load_balancer', 'relational_database',
            'block_storage', 'object_storage',
            'logging', 'monitoring', 'secrets_management', 'dns', 'identity_auth'
        ],
        forbidden_services: ['compute_container', 'compute_serverless', 'compute_batch', 'cdn', 'api_gateway'],
        cost_range: { min: 50, max: 400, unit: 'month' },
        infracost_allowed: true
    },

    // ═══════════════════════════════════════════════════════════════════
    // 6. DATA_PROCESSING_PIPELINE — Infracost Required
    // ═══════════════════════════════════════════════════════════════════
    DATA_PROCESSING_PIPELINE: {
        name: 'Data Processing Pipeline',
        description: 'ETL pipelines, analytics, batch data processing',
        cost_engine: 'infracost',
        cost_drivers: ['batch_compute', 'storage', 'orchestration'],
        allowed_services: [
            'compute_batch', 'object_storage', 'relational_database', 'nosql_database',
            'messaging_queue', 'event_bus',
            'logging', 'monitoring', 'secrets_management', 'dns'
        ],
        forbidden_services: ['compute_vm', 'compute_container', 'cdn', 'api_gateway', 'load_balancer'],
        cost_range: { min: 50, max: 500, unit: 'month' },
        infracost_allowed: true
    }
};

// ═══════════════════════════════════════════════════════════════════
// CANONICAL SERVICE CLASSES
// ═══════════════════════════════════════════════════════════════════
const CANONICAL_SERVICE_CLASSES = [
    'compute_vm',
    'compute_container',
    'compute_serverless',
    'compute_batch',
    'relational_database',
    'nosql_database',
    'cache',
    'load_balancer',
    'object_storage',
    'block_storage',
    'messaging_queue',
    'event_bus',
    'search_engine',
    'cdn',
    'api_gateway',
    'logging',
    'monitoring',
    'secrets_management',
    'dns',
    'identity_auth'
];

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════

function getPattern(patternName) {
    return ARCHITECTURE_PATTERNS[patternName] || null;
}

function getPatternNames() {
    return Object.keys(ARCHITECTURE_PATTERNS);
}

function isValidServiceClass(serviceClass) {
    return CANONICAL_SERVICE_CLASSES.includes(serviceClass);
}

function getCostEngine(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    return pattern ? pattern.cost_engine : null;
}

function isInfracostAllowed(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    return pattern ? pattern.infracost_allowed : false;
}

function getInfracostScope(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    return pattern?.infracost_scope || null; // null means "all services"
}

function getAllowedServices(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    return pattern ? pattern.allowed_services : [];
}

function getForbiddenServices(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    return pattern ? pattern.forbidden_services : [];
}

function isForbiddenService(patternName, serviceClass) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) return false;
    return pattern.forbidden_services.includes(serviceClass);
}

function validateServicesForPattern(patternName, services) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) {
        return { valid: false, errors: [`Unknown pattern: ${patternName}`] };
    }

    const errors = [];

    // Check for forbidden services
    for (const service of services) {
        if (pattern.forbidden_services.includes(service)) {
            errors.push(`Service '${service}' is forbidden for pattern '${patternName}'`);
        }
    }

    // Check that all services are in the allowed list
    for (const service of services) {
        if (!pattern.allowed_services.includes(service) && !pattern.forbidden_services.includes(service)) {
            // Warn but don't fail for unknown services
            console.warn(`[PATTERN] Service '${service}' not in allowed list for '${patternName}'`);
        }
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

module.exports = {
    ARCHITECTURE_PATTERNS,
    CANONICAL_SERVICE_CLASSES,
    getPattern,
    getPatternNames,
    isValidServiceClass,
    getCostEngine,
    isInfracostAllowed,
    getInfracostScope,
    getAllowedServices,
    getForbiddenServices,
    isForbiddenService,
    validateServicesForPattern,
    validateServiceSelection: validateServicesForPattern
};
