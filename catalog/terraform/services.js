/**
 * backend/catalog/services.js
 *
 * MASTER SERVICE REGISTRY (SSOT)
 * - Aggregates domain packs into ONE lookup: services[serviceId] => definition
 * - Validates every service against schemas/serviceSchema.js
 * - Detects duplicates across packs
 * - Exposes metadata + validation errors without breaking old import style
 *
 * Usage:
 *   const services = require('./services');
 *   services['objectstorage'] -> { ... }
 *   services.__meta -> catalog stats
 *   services.__errors -> validation errors
 */

'use strict';

const { validateService } = require('../schemas/serviceSchema');

// Domain packs (each should export: { name, description, services: {id: def} })
const corePack = require('../domains/core');
const iotPack = require('../domains/iot');
const mlPack = require('../domains/ml');
const analyticsPack = require('../domains/analytics');
const securityPack = require('../domains/security');
const networkingPack = require('../domains/networking');
const devopsPack = require('../domains/devops');
const observabilityPack = require('../domains/observability');
const messagingPack = require('../domains/messaging');

const allPacks = [
    corePack,
    iotPack,
    mlPack,
    analyticsPack,
    securityPack,
    networkingPack,
    devopsPack,
    observabilityPack,
    messagingPack
].filter(Boolean);

const services = Object.create(null);
const validationErrors = [];

/**
 * Env-driven strictness:
 * - CATALOG_STRICT=true => throw on any catalog error (recommended for CI)
 * - default => soft-fail (log errors but export services)
 */
const STRICT = String(process.env.CATALOG_STRICT || '').toLowerCase() === 'true';

function packLabel(pack) {
    return pack?.name || pack?.id || 'unknown-pack';
}

function freezeDeep(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    for (const k of Object.keys(obj)) {
        freezeDeep(obj[k]);
    }
    return obj;
}

// 1) Flatten + validate
for (const pack of allPacks) {
    const label = packLabel(pack);

    if (!pack.services || typeof pack.services !== 'object') {
        validationErrors.push(`Pack '${label}' is missing 'services' object export`);
        continue;
    }

    for (const [id, def] of Object.entries(pack.services)) {
        // Duplicate ID check
        if (services[id]) {
            validationErrors.push(`Duplicate serviceId '${id}' defined in multiple packs (latest pack: '${label}').`);
            continue;
        }

        // Schema validation
        const errors = validateService(id, def);
        if (errors.length) {
            validationErrors.push(`Schema error in '${id}' (pack '${label}'): ${errors.join('; ')}`);
            // Keep it in registry anyway for debugging unless strict mode is enabled
        }

        // Derived flags for backward compatibility
        const enrichedDef = {
            ...def,
            terraform_supported: !!def?.terraform?.moduleId
        };

        // Freeze to prevent runtime mutation bugs
        services[id] = freezeDeep(enrichedDef);
    }
}

// 2) Attach metadata (non-enumerable so Object.keys(services) remains clean)
const meta = {
    packs_loaded: allPacks.map(packLabel),
    pack_count: allPacks.length,
    service_count: Object.keys(services).length,
    strict: STRICT,
    has_errors: validationErrors.length > 0
};

Object.defineProperty(services, '__meta', { value: meta, enumerable: false });
Object.defineProperty(services, '__errors', { value: validationErrors, enumerable: false });

// 3) Fail fast (optional)
if (validationErrors.length > 0) {
    console.error('🚨 CATALOG VALIDATION FAILED 🚨');
    for (const err of validationErrors) console.error(`- ${err}`);

    if (STRICT) {
        throw new Error(`Catalog validation failed with ${validationErrors.length} error(s).`);
    }
} else {
    console.log(`✅ Service Catalog Loaded: ${meta.service_count} services from ${meta.pack_count} packs.`);
}

module.exports = services;
