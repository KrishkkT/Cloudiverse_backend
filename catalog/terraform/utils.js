/**
 * backend/catalog/utils.js
 *
 * CATALOG UTILITIES
 * - Services + Patterns helpers
 * - Terraform module lookup helpers
 * - Provider mapping helpers
 * - Pattern/service selection validation
 */

'use strict';

// 🔥 FIX: Use new_services.json (SSOT) instead of legacy services.js
const servicesRaw = require('../new_services.json');
// Index for O(1) lookup
const services = {};
if (servicesRaw.services) {
    servicesRaw.services.forEach(s => { services[s.service_id] = s; });
    console.log(`[UTILS] Indexed ${Object.keys(services).length} services from New SSOT`);
}
const patterns = require('../patterns/index');

const SUPPORTED_PROVIDERS = ['aws', 'gcp', 'azure'];

function assertProvider(provider) {
    const p = String(provider || '').toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(p)) {
        throw new Error(`Unsupported provider '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    return p;
}

/**
 * SERVICES HELPERS
 */

const getServiceDefinition = (serviceId) => {
    const def = services[serviceId] || null;
    if (!def && serviceId && !serviceId.startsWith('__')) {
        // console.warn(`[CATALOG UTILS] getServiceDefinition: Service '${serviceId}' not found.`);
    }
    return def;
};

const getServiceOrThrow = (serviceId) => {
    const svc = getServiceDefinition(serviceId);
    if (!svc) throw new Error(`Unknown serviceId: ${serviceId}`);
    return svc;
};

const getAllServiceIds = () => Object.keys(services);

const getAllServices = () => getAllServiceIds().map((id) => ({ id, ...services[id] }));

const getServicesByCategory = (category) =>
    getAllServiceIds().filter((id) => services[id].category === category);

const getServicesByDomain = (domain) =>
    getAllServiceIds().filter((id) => services[id].domain === domain);

const isDeployable = (serviceId) => {
    const service = getServiceDefinition(serviceId);
    // 🔥 FIX: Use new schema (terraform_supported flag)
    if (service && typeof service.terraform_supported === 'boolean') {
        return service.terraform_supported;
    }
    // Fallback for legacy objects
    return !!(service?.terraform?.moduleId);
};

const getDeployableServiceIds = () => getAllServiceIds().filter(isDeployable);

const getTerraformModuleId = (serviceId) => {
    const svc = getServiceDefinition(serviceId);
    return svc?.terraform?.moduleId || null;
};

const getProviderMapping = (serviceId, provider) => {
    const p = assertProvider(provider);
    const svc = getServiceDefinition(serviceId);
    if (!svc) return null;
    return svc.mappings?.[p] || null;
};

const getProviderResourceId = (serviceId, provider) => {
    const mapping = getProviderMapping(serviceId, provider);
    // Expect mapping like: { resource: 'aws_s3_bucket', name: 'S3', ... } (as seen in packs)
    return mapping?.resource || null;
};

const getInfracostResourceType = (serviceId) => {
    const svc = getServiceDefinition(serviceId);
    return svc?.pricing?.engine === 'infracost' ? (svc?.pricing?.infracost?.resourceType || null) : null;
};

/**
 * PATTERNS HELPERS
 */

const getPattern = (patternId) => patterns[patternId] || null;

const getPatternNames = () => Object.keys(patterns);

const getAllowedServices = (patternId) => {
    const pattern = getPattern(patternId);
    return pattern ? (pattern.allowed_services || []) : [];
};

const getForbiddenServices = (patternId) => {
    const pattern = getPattern(patternId);
    return pattern ? (pattern.forbidden_services || []) : [];
};

const getRequiredServices = (patternId) => {
    const pattern = getPattern(patternId);
    return pattern ? (pattern.required_services || []) : [];
};

const getRecommendedServices = (patternId) => {
    const pattern = getPattern(patternId);
    return pattern ? (pattern.recommended_services || []) : [];
};

/**
 * Validate chosen services against a pattern.
 *
 * Options:
 * - strictAllowed: if true, enforce allowed_services as well (recommended once patterns stabilize)
 * - requireRequired: if true, ensures all required_services are present
 */
const validateServiceSelection = (patternId, serviceIds, opts = {}) => {
    const pattern = getPattern(patternId);
    if (!pattern) return { valid: false, errors: [`Unknown pattern: ${patternId}`] };

    const strictAllowed = !!opts.strictAllowed;
    const requireRequired = opts.requireRequired !== false; // default true

    const errors = [];
    const chosen = Array.isArray(serviceIds) ? serviceIds : [];

    // 1) Existence
    for (const id of chosen) {
        if (!services[id]) errors.push(`Unknown service ID: ${id}`);
    }

    // 2) Forbidden enforcement
    if (Array.isArray(pattern.forbidden_services)) {
        for (const id of chosen) {
            if (pattern.forbidden_services.includes(id)) {
                const name = services[id]?.name || id;
                errors.push(`Service '${name}' is forbidden in pattern '${pattern.name}'`);
            }
        }
    }

    // 3) Allowed enforcement (optional strict mode)
    if (strictAllowed && Array.isArray(pattern.allowed_services) && pattern.allowed_services.length > 0) {
        for (const id of chosen) {
            if (services[id] && !pattern.allowed_services.includes(id)) {
                const name = services[id]?.name || id;
                errors.push(`Service '${name}' is not allowed in pattern '${pattern.name}'`);
            }
        }
    }

    // 4) Required services present
    if (requireRequired && Array.isArray(pattern.required_services) && pattern.required_services.length > 0) {
        for (const req of pattern.required_services) {
            if (!chosen.includes(req)) errors.push(`Missing required service '${req}' for pattern '${pattern.name}'`);
        }
    }

    return { valid: errors.length === 0, errors };
};

module.exports = {
    // Services
    getServiceDefinition,
    getServiceOrThrow,
    getAllServiceIds,
    getAllServices,
    getServicesByCategory,
    getServicesByDomain,
    isDeployable,
    getDeployableServiceIds,
    getTerraformModuleId,
    getProviderMapping,
    getProviderResourceId,
    getInfracostResourceType,

    // Patterns
    getPattern,
    getPatternNames,
    getAllowedServices,
    getForbiddenServices,
    getRequiredServices,
    getRecommendedServices,
    validateServiceSelection,
    validateServicesForPattern: validateServiceSelection
};
