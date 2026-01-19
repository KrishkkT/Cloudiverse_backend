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
 * - Document storage enforces objectstorage
 * - Compute type must match pattern
 */

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN REQUIREMENTS CONTRACT (AUTHORITATIVE)
// ═══════════════════════════════════════════════════════════════════════════

const { patterns: patternsConfig } = require('../../config/canonicalPatterns.config');

// Helper to convert config pattern to validator requirements format
const getPatternRequirements = (patternId) => {
    // patternsConfig IS the object containing pattern IDs as keys
    const p = patternsConfig[patternId];
    if (!p) return null;
    return {
        required: p.services || p.required_services || [],
        optional: p.optional_services || [],
        forbidden: p.forbidden_services || []
    };
};


// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize service names to canonical catalog IDs
 * Handles legacy/inconsistent naming (messaging_queue → messagequeue)
 */
function normalizeServiceNames(services) {
    // Use centralized aliases from config layer
    const { resolveServiceId } = require('../../config/aliases');

    return services.map(service => {
        const originalName = service.service_class || service.canonical_type || service.name;
        const normalizedName = resolveServiceId(originalName);

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
function validateCanonicalArchitecture(canonicalArchitecture, intent = {}, excludedServicesInput = []) {
    const errors = [];
    const warnings = [];

    const pattern = canonicalArchitecture.pattern;
    const services = canonicalArchitecture.services || [];

    // Get pattern requirements from config
    const requirements = getPatternRequirements(pattern);
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
            // 🔥 FIX: Skip validation if service was strictly excluded by user/logic
            const isExcluded = (excludedServicesInput || []).includes(required);
            if (isExcluded) {
                console.log(`[VALIDATION] Skipping missing required service ${required} (it was explicitly excluded)`);
                continue;
            }
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
        // Document storage requires objectstorage
        if (requirements.conditional.document_storage && intent.document_storage === true) {
            if (!serviceNames.includes('objectstorage')) {
                errors.push(`document_storage=true requires objectstorage service`);
            }
        }
    }

    // 4. Validate compute type matches pattern
    const hasServerlessCompute = serviceNames.includes('computeserverless');
    const hasAppCompute = serviceNames.includes('computecontainer');

    if (pattern.includes('SERVERLESS') && hasAppCompute) {
        errors.push(`${pattern} should use computeserverless, not computecontainer`);
    }

    if (pattern.includes('STATEFUL') && hasServerlessCompute) {
        errors.push(`${pattern} should use computecontainer, not computeserverless`);
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
    const requirements = getPatternRequirements(pattern);
    if (!requirements || !requirements.conditional) {
        return services;
    }

    const serviceNames = services.map(s => s.service_class || s.canonical_type || s.name);
    const added = [];

    // Add objectstorage if document_storage is true
    if (requirements.conditional.document_storage && intent.document_storage === true) {
        if (!serviceNames.includes('objectstorage')) {
            services.push({
                service_class: 'objectstorage',
                canonical_type: 'objectstorage',
                name: 'objectstorage',
                description: 'Object storage for documents',
                category: 'storage',
                added_by: 'conditional_rule'
            });
            added.push('objectstorage');
            console.log('[VALIDATOR] Auto-added objectstorage (document_storage=true)');
        }
    }

    // Add paymentgateway if payments is true
    if (requirements.conditional.payments && (intent.payments === true || intent.paymentgateway === true)) {
        if (!serviceNames.includes('paymentgateway')) {
            services.push({
                service_class: 'paymentgateway',
                canonical_type: 'paymentgateway',
                name: 'paymentgateway',
                description: 'Payment processing gateway',
                category: 'integration',
                added_by: 'conditional_rule'
            });
            added.push('paymentgateway');
            console.log('[VALIDATOR] Auto-added paymentgateway (payments=true)');
        }
    }

    // Add messagequeue if background_jobs is true
    if (requirements.conditional.background_jobs && intent.background_jobs === true) {
        if (!serviceNames.includes('messagequeue')) {
            services.push({
                service_class: 'messagequeue',
                canonical_type: 'messagequeue',
                name: 'messagequeue',
                description: 'Message queue for background jobs',
                category: 'messaging',
                added_by: 'conditional_rule'
            });
            added.push('messagequeue');
            console.log('[VALIDATOR] Auto-added messagequeue (background_jobs=true)');
        }
    }

    return services;
}

/**
 * Filter services to only include Terraform-supported ones
 * This ensures that Terraform generation will never fail due to unsupported services
 */
function filterTerraformSafeServices(services) {
    const { getServiceDefinition } = require('../../catalog/terraform/utils');

    const terraformSupportedServices = [];
    const excludedServices = [];

    services.forEach(service => {
        const serviceName = service.service_class || service.canonical_type || service.name;
        const serviceDef = getServiceDefinition(serviceName);

        // Include service if it's terraform_supported
        if (serviceDef && serviceDef.terraform_supported === true) {
            terraformSupportedServices.push(service);
        } else {
            excludedServices.push({
                name: serviceName,
                reason: serviceDef ? 'Not terraform-supported' : 'Unknown service'
            });
        }
    });

    if (excludedServices.length > 0) {
        console.warn('[TERRAFORM-SAFE] Excluded services that are not terraform-supported:',
            excludedServices.map(e => e.name).join(', '));
        excludedServices.forEach(ex => {
            console.warn(`[TERRAFORM-SAFE] Service excluded: ${ex.name} - ${ex.reason}`);
        });
    }

    return terraformSupportedServices;
}

/**
 * Main validation function - validates and fixes canonical architecture
 */
function validateAndFixCanonicalArchitecture(canonicalArchitecture, intent = {}) {
    console.log('[VALIDATOR] Starting validation...');

    // Extract exclusions from the architecture contract if available
    const excludedServices = canonicalArchitecture.services_contract?.excluded || canonicalArchitecture.excluded || [];
    if (excludedServices.length > 0) {
        console.log(`[VALIDATOR] Respecting excluded services: ${excludedServices.join(', ')}`);
    }

    // Step 0: Normalize service names (handles messaging_queue → messagequeue, etc.)
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
    const validation = validateCanonicalArchitecture(canonicalArchitecture, intent, excludedServices);

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
    getPatternRequirements,
    normalizeServiceNames,
    deduplicateServices,
    validateCanonicalArchitecture,
    validateAndFixCanonicalArchitecture,
    addConditionalServices,
    filterTerraformSafeServices
};
