/**
 * CANONICAL ARCHITECTURE PATTERNS
 * 
 * Every Cloudiverse project resolves to exactly one of these 8 patterns.
 * This ensures deterministic, predictable infrastructure.
 * 
 * AI never selects patterns - backend rules do.
 * 🔒 FIX 3: AI cannot change or override these patterns.
 */

// The 8 canonical patterns with required/optional/forbidden services
const ARCHITECTURE_PATTERNS = {

    // 1. STATIC_WEB_HOSTING - Portfolio, landing pages, docs
    // Cost: $1-10/month (CRITICAL GUARDRAIL)
    // 🔒 FIX 4: HARD SERVICE RULES
    STATIC_WEB_HOSTING: {
        name: 'Static Web Hosting',
        description: 'Simple static websites, portfolios, landing pages, documentation sites',
        // 🔒 FIX 4: REQUIRED SERVICES (ONLY THESE 3)
        required: ['object_storage', 'cdn', 'dns'],
        // 🔒 FIX 4: OPTIONAL (monitoring only)
        optional: ['monitoring'],
        // 🔒 FIX 4: FORBIDDEN SERVICES (HARD BLOCK - NO EXCEPTIONS)
        forbidden: [
            'compute_vm', 'compute_container', 'compute_serverless', 'compute_batch',
            'relational_database', 'nosql_database', 'cache',
            'load_balancer', 'api_gateway', 'messaging_queue', 'event_bus', 'search_engine',
            'secrets_management', 'block_storage', 'identity_auth'
        ],
        cost_range: { min: 1, max: 10, unit: 'month' },
        cost_formatted: '$1-10/month',
        // 🔒 FIX 5: Cost presentation note
        cost_note: 'Based on storage and CDN usage. Traffic not yet specified.',
        ai_mode: 'EXPLAIN_ONLY'  // 🔒 FIX 3: AI cannot change architecture
    },

    // 2. SERVERLESS_WEB_APP - SPAs, mobile backends, APIs
    SERVERLESS_WEB_APP: {
        name: 'Serverless Web App',
        description: 'Single-page apps with APIs, mobile backends, lightweight web services',
        required: [
            'object_storage', 'cdn', 'api_gateway', 'compute_serverless',
            'logging', 'monitoring', 'secrets_management', 'dns'
        ],
        optional: ['nosql_database', 'event_bus'],
        forbidden: ['compute_vm', 'compute_batch'],
        cost_range: { min: 10, max: 100, unit: 'month' },
        cost_formatted: '$10-100/month'
    },

    // 3. THREE_TIER_WEB_APP - Business apps, dashboards, admin panels
    THREE_TIER_WEB_APP: {
        name: 'Three-Tier Web App',
        description: 'Classic MVC applications, admin dashboards, business apps with databases',
        required: [
            'relational_database', 'load_balancer', 'object_storage',
            'logging', 'monitoring', 'secrets_management', 'dns'
        ],
        optional: ['cache', 'cdn', 'compute_vm', 'compute_container'],
        forbidden: ['compute_batch'],
        compute_choice: ['compute_vm', 'compute_container'], // One required
        cost_range: { min: 50, max: 300, unit: 'month' },
        cost_formatted: '$50-300/month'
    },

    // 4. CONTAINERIZED_APP - Single containerized service, APIs
    CONTAINERIZED_APP: {
        name: 'Containerized App',
        description: 'Single containerized service, REST APIs, web applications',
        required: [
            'compute_container', 'load_balancer', 'relational_database',
            'logging', 'monitoring', 'secrets_management', 'dns'
        ],
        optional: ['cache', 'object_storage', 'cdn'],
        forbidden: ['compute_vm', 'compute_batch'],
        cost_range: { min: 80, max: 400, unit: 'month' },
        cost_formatted: '$80-400/month'
    },

    // 5. MICROSERVICES_PLATFORM - Large SaaS, complex platforms
    MICROSERVICES_PLATFORM: {
        name: 'Microservices Platform',
        description: 'Complex platforms with multiple services, large teams, high scalability',
        required: [
            'compute_container', 'api_gateway', 'relational_database', 'nosql_database',
            'event_bus', 'messaging_queue', 'cache',
            'logging', 'monitoring', 'secrets_management', 'dns'
        ],
        optional: ['search_engine', 'cdn', 'object_storage'],
        forbidden: ['compute_vm'],
        cost_range: { min: 300, max: 2000, unit: 'month' },
        cost_formatted: '$300-2000/month'
    },

    // 6. EVENT_DRIVEN_SYSTEM - Notifications, background jobs, triggers
    EVENT_DRIVEN_SYSTEM: {
        name: 'Event-Driven System',
        description: 'Notification systems, background job processors, mobile push triggers',
        required: [
            'event_bus', 'messaging_queue', 'compute_serverless',
            'logging', 'monitoring'
        ],
        optional: ['nosql_database', 'object_storage', 'secrets_management', 'dns'],
        forbidden: ['compute_vm', 'compute_batch', 'load_balancer'],
        cost_range: { min: 20, max: 150, unit: 'month' },
        cost_formatted: '$20-150/month'
    },

    // 7. DATA_PROCESSING_PIPELINE - ETL, analytics, batch jobs
    DATA_PROCESSING_PIPELINE: {
        name: 'Data Processing Pipeline',
        description: 'ETL pipelines, analytics ingestion, batch data processing',
        required: [
            'object_storage', 'compute_batch', 'logging', 'monitoring'
        ],
        optional: ['relational_database', 'nosql_database', 'messaging_queue'],
        database_choice: ['relational_database', 'nosql_database'], // One required
        forbidden: ['cdn', 'api_gateway', 'load_balancer'],
        cost_range: { min: 50, max: 500, unit: 'month' },
        cost_formatted: '$50-500/month'
    },

    // 8. INTERNAL_TOOL - Admin tools, ops dashboards
    INTERNAL_TOOL: {
        name: 'Internal Tool',
        description: 'Admin tools, internal dashboards, operations management',
        required: [
            'relational_database', 'logging', 'monitoring', 'secrets_management'
        ],
        optional: ['load_balancer', 'compute_vm', 'compute_container'],
        compute_choice: ['compute_vm', 'compute_container'], // One required
        forbidden: ['cdn', 'api_gateway', 'event_bus', 'messaging_queue'],
        cost_range: { min: 30, max: 150, unit: 'month' },
        cost_formatted: '$30-150/month'
    }
};

// Canonical service classes - THE ONLY VALID CLASSES
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
    'dns'
];

/**
 * Get a pattern by name
 */
function getPattern(patternName) {
    return ARCHITECTURE_PATTERNS[patternName] || null;
}

/**
 * Get all pattern names
 */
function getPatternNames() {
    return Object.keys(ARCHITECTURE_PATTERNS);
}

/**
 * Validate that a service class is canonical
 */
function isValidServiceClass(serviceClass) {
    return CANONICAL_SERVICE_CLASSES.includes(serviceClass);
}

/**
 * Get required services for a pattern
 */
function getRequiredServices(patternName) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) return [];

    const services = [...pattern.required];

    // Add compute choice (first option as default)
    if (pattern.compute_choice && !services.some(s => pattern.compute_choice.includes(s))) {
        services.push(pattern.compute_choice[0]);
    }

    // Add database choice (first option as default)
    if (pattern.database_choice && !services.some(s => pattern.database_choice.includes(s))) {
        services.push(pattern.database_choice[0]);
    }

    return services;
}

/**
 * Check if a service is forbidden for a pattern
 */
function isForbiddenService(patternName, serviceClass) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) return false;
    return pattern.forbidden.includes(serviceClass);
}

/**
 * Validate services against pattern rules
 * Returns { valid: boolean, errors: string[] }
 */
function validateServicesForPattern(patternName, services) {
    const pattern = ARCHITECTURE_PATTERNS[patternName];
    if (!pattern) {
        return { valid: false, errors: [`Unknown pattern: ${patternName}`] };
    }

    const errors = [];

    // Check for forbidden services
    for (const service of services) {
        if (pattern.forbidden.includes(service)) {
            errors.push(`Service '${service}' is forbidden for pattern '${patternName}'`);
        }
    }

    // Check for required services
    for (const required of pattern.required) {
        if (!services.includes(required)) {
            errors.push(`Missing required service '${required}' for pattern '${patternName}'`);
        }
    }

    // Check compute choice
    if (pattern.compute_choice) {
        const hasCompute = services.some(s => pattern.compute_choice.includes(s));
        if (!hasCompute) {
            errors.push(`Pattern '${patternName}' requires one of: ${pattern.compute_choice.join(', ')}`);
        }
    }

    // Check database choice
    if (pattern.database_choice) {
        const hasDatabase = services.some(s => pattern.database_choice.includes(s));
        if (!hasDatabase) {
            errors.push(`Pattern '${patternName}' requires one of: ${pattern.database_choice.join(', ')}`);
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
    getRequiredServices,
    isForbiddenService,
    validateServicesForPattern,
    validateServiceSelection: validateServicesForPattern // Alias for workflow.js
};
