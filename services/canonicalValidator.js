/**
 * CANONICAL ARCHITECTURE VALIDATOR
 * 
 * Enforces pattern requirements and service integrity.
 * This is the SINGLE SOURCE OF TRUTH for what services are required/forbidden per pattern.
 * 
 * RULES:
 * - Canonical services must be deduplicated
 * - Required services per pattern must exist
 * - Forbidden services per pattern must NOT exist
 * - Document storage enforces object_storage
 * - Compute type must match pattern
 */

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN REQUIREMENTS CONTRACT (AUTHORITATIVE)
// ═══════════════════════════════════════════════════════════════════════════

const PATTERN_REQUIREMENTS = {
    STATIC_SITE: {
        required: ['cdn', 'object_storage'],
        optional: ['identity_auth'],
        forbidden: ['relational_database', 'app_compute', 'serverless_compute', 'load_balancer']
    },
    SERVERLESS_API: {
        required: ['api_gateway', 'serverless_compute'],
        optional: ['relational_database', 'cache', 'identity_auth'],
        forbidden: ['app_compute', 'load_balancer']
    },
    SERVERLESS_WEB_APP: {
        required: ['cdn', 'api_gateway', 'serverless_compute', 'object_storage'],
        optional: ['relational_database', 'cache', 'identity_auth'],
        forbidden: ['app_compute', 'load_balancer']
    },
    STATEFUL_WEB_PLATFORM: {
        required: ['load_balancer', 'app_compute', 'relational_database', 'identity_auth', 'logging', 'monitoring'],
        optional: ['cache', 'cdn'],
        forbidden: ['serverless_compute', 'message_queue', 'payment_gateway'],
        conditional: {
            document_storage: ['object_storage']
        }
    },
    HYBRID_PLATFORM: {
        required: ['load_balancer', 'app_compute', 'serverless_compute', 'relational_database', 'cache', 'message_queue', 'logging', 'monitoring'],
        optional: ['cdn', 'identity_auth', 'object_storage', 'payment_gateway'],
        forbidden: [],
        conditional: {
            document_storage: ['object_storage'],
            payments: ['payment_gateway'],
            background_jobs: ['message_queue']
        }
    },
    MOBILE_BACKEND_PLATFORM: {
        required: ['api_gateway', 'serverless_compute', 'relational_database', 'identity_auth'],
        optional: ['cache', 'message_queue', 'object_storage', 'push_notification_service'],
        forbidden: ['cdn', 'load_balancer']
    },
    DATA_PLATFORM: {
        required: ['object_storage', 'analytical_database', 'batch_compute', 'logging', 'monitoring'],
        optional: ['message_queue', 'serverless_compute', 'api_gateway'],
        forbidden: ['cdn', 'load_balancer', 'identity_auth']
    },
    REALTIME_PLATFORM: {
        required: ['websocket_gateway', 'app_compute', 'cache', 'message_queue', 'logging', 'monitoring'],
        optional: ['relational_database', 'identity_auth', 'load_balancer'],
        forbidden: ['cdn']
    },
    ML_INFERENCE_PLATFORM: {
        required: ['api_gateway', 'ml_inference_service', 'object_storage', 'logging', 'monitoring'],
        optional: ['cache', 'relational_database'],
        forbidden: ['cdn', 'load_balancer']
    },
    ML_TRAINING_PLATFORM: {
        required: ['object_storage', 'batch_compute', 'analytical_database', 'logging', 'monitoring'],
        optional: ['message_queue', 'api_gateway'],
        forbidden: ['cdn', 'load_balancer', 'identity_auth']
    },
    CONTAINERIZED_WEB_APP: {
        required: ['load_balancer', 'app_compute', 'relational_database', 'logging', 'monitoring'],
        optional: ['cache', 'cdn', 'identity_auth', 'object_storage'],
        forbidden: ['serverless_compute']
    },
    // ═══════════════════════════════════════════════════════════════════
    // NEW DOMAIN-SPECIFIC PATTERNS
    // ═══════════════════════════════════════════════════════════════════
    HIGH_AVAILABILITY_PLATFORM: {
        required: ['global_load_balancer', 'cdn', 'api_gateway', 'relational_database', 'identity_auth', 'logging', 'monitoring'],
        optional: ['cache', 'message_queue', 'app_compute', 'websocket_gateway'],
        forbidden: []
    },
    IOT_PLATFORM: {
        required: ['iot_core', 'time_series_db', 'api_gateway', 'logging', 'monitoring'],
        optional: ['event_streaming', 'object_storage', 'sms_alerts'],
        forbidden: ['cdn']
    },
    FINTECH_PAYMENT_PLATFORM: {
        required: ['api_gateway', 'app_compute', 'relational_database', 'identity_auth', 'secrets_manager', 'audit_logging', 'logging', 'monitoring'],
        optional: ['load_balancer', 'cache', 'payment_gateway'],
        forbidden: []
    },
    HEALTHCARE_PLATFORM: {
        required: ['api_gateway', 'app_compute', 'relational_database', 'identity_auth', 'secrets_manager', 'audit_logging', 'object_storage', 'logging', 'monitoring'],
        optional: [],
        forbidden: []
    },
    GAMING_BACKEND: {
        required: ['api_gateway', 'app_compute', 'cache', 'relational_database', 'identity_auth', 'logging', 'monitoring'],
        optional: ['websocket_gateway', 'message_queue', 'payment_gateway'],
        forbidden: []
    },
    E_COMMERCE_BACKEND: {
        required: ['cdn', 'api_gateway', 'app_compute', 'relational_database', 'identity_auth', 'object_storage', 'cache', 'logging', 'monitoring'],
        optional: ['payment_gateway'],
        forbidden: []
    },
    EVENT_DRIVEN_PLATFORM: {
        required: ['message_queue', 'serverless_compute', 'logging', 'monitoring'],
        optional: ['api_gateway', 'object_storage'],
        forbidden: []
    }
};


// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize service names to canonical form
 * Handles legacy/inconsistent naming (messaging_queue → message_queue)
 */
function normalizeServiceNames(services) {
    const nameMap = {
        'messaging_queue': 'message_queue',
        'relational_db': 'relational_database',
        'authentication': 'identity_auth',
        'compute': 'app_compute',
        'compute_serverless': 'serverless_compute'
    };

    return services.map(service => {
        const originalName = service.service_class || service.canonical_type || service.name;
        const normalizedName = nameMap[originalName] || originalName;

        if (originalName !== normalizedName) {
            console.warn(`[VALIDATOR] Normalized service name: ${originalName} → ${normalizedName}`);
        }

        return {
            ...service,
            service_class: normalizedName,
            canonical_type: normalizedName,
            name: normalizedName
        };
    });
}

/**
 * Deduplicate services by canonical type
 */
function deduplicateServices(services) {
    const seen = new Set();
    const deduplicated = [];

    for (const service of services) {
        const key = service.service_class || service.canonical_type || service.name;
        if (!seen.has(key)) {
            seen.add(key);
            deduplicated.push(service);
        } else {
            console.warn(`[VALIDATOR] Duplicate service removed: ${key}`);
        }
    }

    return deduplicated;
}

/**
 * Validate canonical architecture against pattern requirements
 */
function validateCanonicalArchitecture(canonicalArchitecture, intent = {}) {
    const errors = [];
    const warnings = [];

    const pattern = canonicalArchitecture.pattern;
    const services = canonicalArchitecture.services || [];

    // Get pattern requirements
    const requirements = PATTERN_REQUIREMENTS[pattern];
    if (!requirements) {
        errors.push(`Unknown pattern: ${pattern}`);
        return { valid: false, errors, warnings };
    }

    // Get service names
    const serviceNames = services.map(s =>
        s.service_class || s.canonical_type || s.name
    );

    // 1. Check required services
    for (const required of requirements.required) {
        if (!serviceNames.includes(required)) {
            errors.push(`Missing required service for ${pattern}: ${required}`);
        }
    }

    // 2. Check forbidden services
    for (const forbidden of requirements.forbidden) {
        if (serviceNames.includes(forbidden)) {
            errors.push(`Forbidden service for ${pattern}: ${forbidden}`);
        }
    }

    // 3. Check conditional requirements
    if (requirements.conditional) {
        // Document storage requires object_storage
        if (requirements.conditional.document_storage && intent.document_storage === true) {
            if (!serviceNames.includes('object_storage')) {
                errors.push(`document_storage=true requires object_storage service`);
            }
        }
    }

    // 4. Validate compute type matches pattern
    const hasServerlessCompute = serviceNames.includes('serverless_compute');
    const hasAppCompute = serviceNames.includes('app_compute');

    if (pattern.includes('SERVERLESS') && hasAppCompute) {
        errors.push(`${pattern} should use serverless_compute, not app_compute`);
    }

    if (pattern.includes('STATEFUL') && hasServerlessCompute) {
        errors.push(`${pattern} should use app_compute, not serverless_compute`);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

/**
 * Add missing conditional services based on intent
 */
function addConditionalServices(services, pattern, intent = {}) {
    const requirements = PATTERN_REQUIREMENTS[pattern];
    if (!requirements || !requirements.conditional) {
        return services;
    }

    const serviceNames = services.map(s => s.service_class || s.canonical_type || s.name);
    const added = [];

    // Add object_storage if document_storage is true
    if (requirements.conditional.document_storage && intent.document_storage === true) {
        if (!serviceNames.includes('object_storage')) {
            services.push({
                service_class: 'object_storage',
                canonical_type: 'object_storage',
                name: 'object_storage',
                description: 'Object storage for documents',
                category: 'storage',
                added_by: 'conditional_rule'
            });
            added.push('object_storage');
            console.log('[VALIDATOR] Auto-added object_storage (document_storage=true)');
        }
    }

    // Add payment_gateway if payments is true
    if (requirements.conditional.payments && (intent.payments === true || intent.payment_gateway === true)) {
        if (!serviceNames.includes('payment_gateway')) {
            services.push({
                service_class: 'payment_gateway',
                canonical_type: 'payment_gateway',
                name: 'payment_gateway',
                description: 'Payment processing gateway',
                category: 'integration',
                added_by: 'conditional_rule'
            });
            added.push('payment_gateway');
            console.log('[VALIDATOR] Auto-added payment_gateway (payments=true)');
        }
    }

    // Add message_queue if background_jobs is true
    if (requirements.conditional.background_jobs && intent.background_jobs === true) {
        if (!serviceNames.includes('message_queue')) {
            services.push({
                service_class: 'message_queue',
                canonical_type: 'message_queue',
                name: 'message_queue',
                description: 'Message queue for background jobs',
                category: 'messaging',
                added_by: 'conditional_rule'
            });
            added.push('message_queue');
            console.log('[VALIDATOR] Auto-added message_queue (background_jobs=true)');
        }
    }

    return services;
}

/**
 * Filter services to only include Terraform-supported ones
 * This ensures that Terraform generation will never fail due to unsupported services
 */
function filterTerraformSafeServices(services) {
    const { getServiceDefinition } = require('./canonicalServiceRegistry');

    const terraformSupportedServices = [];
    const excludedServices = [];

    services.forEach(service => {
        const serviceName = service.service_class || service.canonical_type || service.name;
        const serviceDef = getServiceDefinition(serviceName);

        // Include service if it's terraform_supported and belongs to terraform_core or terraform_optional class
        if (serviceDef && serviceDef.terraform_supported === true &&
            (serviceDef.class === 'terraform_core' || serviceDef.class === 'terraform_optional')) {
            terraformSupportedServices.push(service);
        } else {
            excludedServices.push({
                service: serviceName,
                reason: serviceDef ? `Not terraform-supported or wrong class (${serviceDef.class})` : 'Unknown service'
            });
        }
    });

    if (excludedServices.length > 0) {
        console.warn('[TERRAFORM-SAFE] Excluded services that are not terraform-supported:',
            excludedServices.map(e => e.service).join(', '));
        excludedServices.forEach(ex => {
            console.warn(`[TERRAFORM-SAFE] Service excluded: ${ex.service} - ${ex.reason}`);
        });
    }

    return terraformSupportedServices;
}

/**
 * Main validation function - validates and fixes canonical architecture
 */
function validateAndFixCanonicalArchitecture(canonicalArchitecture, intent = {}) {
    console.log('[VALIDATOR] Starting validation...');

    // Step 0: Normalize service names (handles messaging_queue → message_queue, etc.)
    canonicalArchitecture.services = normalizeServiceNames(canonicalArchitecture.services);
    console.log('[VALIDATOR] Service names normalized');

    // Step 1: Deduplicate services
    const originalCount = canonicalArchitecture.services.length;
    canonicalArchitecture.services = deduplicateServices(canonicalArchitecture.services);
    if (canonicalArchitecture.services.length < originalCount) {
        console.warn(`[VALIDATOR] Deduped ${originalCount - canonicalArchitecture.services.length} duplicate services`);
    }

    // Step 2: Add conditional services
    canonicalArchitecture.services = addConditionalServices(
        canonicalArchitecture.services,
        canonicalArchitecture.pattern,
        intent
    );

    // Step 3: Apply Terraform-Safe Mode - filter to only terraform-supported services
    const originalServiceCount = canonicalArchitecture.services.length;
    canonicalArchitecture.services = filterTerraformSafeServices(canonicalArchitecture.services);
    const filteredServiceCount = canonicalArchitecture.services.length;

    if (filteredServiceCount < originalServiceCount) {
        console.warn(`[TERRAFORM-SAFE] Filtered services from ${originalServiceCount} to ${filteredServiceCount} (terraform-safe mode)`);
    }

    // Step 4: Validate
    const validation = validateCanonicalArchitecture(canonicalArchitecture, intent);

    if (!validation.valid) {
        console.error('[VALIDATOR] Validation failed:', validation.errors);
        throw new Error(`Canonical architecture validation failed:\n${validation.errors.join('\n')}`);
    }

    if (validation.warnings.length > 0) {
        console.warn('[VALIDATOR] Warnings:', validation.warnings);
    }

    console.log('[VALIDATOR] ✓ Validation passed');
    return {
        canonicalArchitecture,
        validation
    };
}

module.exports = {
    PATTERN_REQUIREMENTS,
    normalizeServiceNames,
    deduplicateServices,
    validateCanonicalArchitecture,
    validateAndFixCanonicalArchitecture,
    addConditionalServices,
    filterTerraformSafeServices
};
