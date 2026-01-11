/**
 * backend/config/terraformRegistry.config.js
 *
 * JS wrapper around terraform-modules.json with:
 * - Module lookup by (serviceId, provider, variant)
 * - Service ID normalization via aliases
 * - Fallback to null (caller handles minimal module)
 */

'use strict';

const { resolveServiceId } = require('./aliases');

// Load raw registry JSON
const registry = require('./terraform-modules.json');

const SUPPORTED_PROVIDERS = ['aws', 'gcp', 'azure'];
const VARIANTS = ['COST_EFFECTIVE', 'HIGH_PERFORMANCE'];

/**
 * Assert provider is valid.
 */
function assertProvider(provider) {
    const p = String(provider || '').toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(p)) {
        throw new Error(`Unsupported provider '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    return p;
}

/**
 * Get Terraform Registry module source for a service.
 *
 * @param {string} serviceId - Service ID (will be normalized via aliases)
 * @param {string} provider - Provider: aws, gcp, azure
 * @param {string} [variant] - Optional: COST_EFFECTIVE or HIGH_PERFORMANCE
 * @returns {string|null} - Registry module path or null if not found
 */
function getModuleSource(serviceId, provider, variant) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);

    const providerModules = registry[p];
    if (!providerModules) return null;

    const entry = providerModules[canonicalId];
    if (!entry) {
        // Try legacy ID as fallback
        const legacyEntry = providerModules[serviceId];
        if (legacyEntry) {
            return extractModuleSource(legacyEntry, variant);
        }
        return null;
    }

    return extractModuleSource(entry, variant);
}

/**
 * Extract module source from entry (handles string or variant object).
 */
function extractModuleSource(entry, variant) {
    if (typeof entry === 'string') {
        return entry;
    }

    if (entry && typeof entry === 'object') {
        // Has variants
        if (variant && entry[variant]) {
            return entry[variant];
        }
        // Default to COST_EFFECTIVE if available
        return entry.COST_EFFECTIVE || entry.HIGH_PERFORMANCE || null;
    }

    return null;
}

/**
 * Check if a service has a registered module.
 */
function hasModule(serviceId, provider) {
    return getModuleSource(serviceId, provider) !== null;
}

/**
 * Get all services with modules for a provider.
 */
function getServicesWithModules(provider) {
    const p = assertProvider(provider);
    const providerModules = registry[p];
    if (!providerModules) return [];

    return Object.keys(providerModules).filter(id => {
        const entry = providerModules[id];
        return entry !== null;
    });
}

/**
 * Check if service has variant-based modules.
 */
function hasVariants(serviceId, provider) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);
    const providerModules = registry[p];
    if (!providerModules) return false;

    const entry = providerModules[canonicalId] || providerModules[serviceId];
    return entry && typeof entry === 'object' && !Array.isArray(entry);
}

/**
 * Get available variants for a service.
 */
function getVariants(serviceId, provider) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);
    const providerModules = registry[p];
    if (!providerModules) return [];

    const entry = providerModules[canonicalId] || providerModules[serviceId];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return Object.keys(entry);
    }

    return [];
}

/**
 * Get registry version.
 */
function getVersion() {
    return registry.version || 'unknown';
}

module.exports = {
    SUPPORTED_PROVIDERS,
    VARIANTS,
    getModuleSource,
    hasModule,
    getServicesWithModules,
    hasVariants,
    getVariants,
    getVersion,
    // Raw access if needed
    registry
};
