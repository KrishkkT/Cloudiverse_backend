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

function assertProvider(provider) {
    const p = String(provider || '').toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(p)) {
        throw new Error(`Unsupported provider '${provider}'. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`);
    }
    return p;
}

function extractModuleSource(entry, variant) {
    if (typeof entry === 'string') return entry;

    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        if (variant && entry[variant]) return entry[variant];
        return entry.COST_EFFECTIVE || entry.HIGH_PERFORMANCE || null;
    }

    return null;
}

/**
 * Get Terraform Registry module source for a service.
 *
 * @param {string} serviceId - Service ID (will be normalized via aliases)
 * @param {string} provider - Provider: aws, gcp, azure
 * @param {string} [variant] - Optional: COST_EFFECTIVE or HIGH_PERFORMANCE
 * @returns {string|null}
 */
function getModuleSource(serviceId, provider, variant) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);

    const providerModules = registry[p];
    if (!providerModules) return null;

    const entry = providerModules[canonicalId];
    if (entry) return extractModuleSource(entry, variant);

    // fallback to raw serviceId as-is
    const legacyEntry = providerModules[serviceId];
    if (legacyEntry) return extractModuleSource(legacyEntry, variant);

    return null;
}

function hasModule(serviceId, provider) {
    return getModuleSource(serviceId, provider) !== null;
}

function getServicesWithModules(provider) {
    const p = assertProvider(provider);
    const providerModules = registry[p];
    if (!providerModules) return [];
    return Object.keys(providerModules).filter((id) => providerModules[id] !== null);
}

function hasVariants(serviceId, provider) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);

    const providerModules = registry[p];
    if (!providerModules) return false;

    const entry = providerModules[canonicalId] || providerModules[serviceId];
    return entry && typeof entry === 'object' && !Array.isArray(entry);
}

function getVariants(serviceId, provider) {
    const p = assertProvider(provider);
    const canonicalId = resolveServiceId(serviceId);

    const providerModules = registry[p];
    if (!providerModules) return [];

    const entry = providerModules[canonicalId] || providerModules[serviceId];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) return Object.keys(entry);

    return [];
}

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
    registry
};
