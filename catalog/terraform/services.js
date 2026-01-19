/**
 * backend/catalog/services.js
 *
 * MASTER SERVICE REGISTRY (SSOT)
 * - Loads service definitions from backend/catalog/mappings/cloud.js (SERVICE_CATALOG)
 * - Builds "services[serviceId] => definition" lookup
 * - Adds legacy aliases (objectstorage -> object_storage, etc.) to avoid rewriting patterns
 * - Validates every service against schemas/serviceSchema.js
 *
 * Usage:
 * const services = require('./services');
 * services['objectstorage'] -> { ... } (alias)
 * services['object_storage'] -> { ... } (canonical)
 */
'use strict';

const { validateService } = require('../schemas/serviceSchema');
const { SERVICE_CATALOG } = require('../mappings/cloud');

// Env-driven strictness:
// - CATALOG_STRICT=true => throw on any catalog error (recommended for CI)
// - default => soft-fail (log errors but export services)
const STRICT = String(process.env.CATALOG_STRICT || '').toLowerCase() === 'true';

const services = Object.create(null);
const validationErrors = [];

// Legacy aliases so existing patterns keep working without edits
const LEGACY_ID_ALIASES = {
    // compute
    computeserverless: 'compute_serverless',
    computecontainer: 'compute_container',
    computevm: 'compute_vm',
    computebatch: 'compute_batch',
    computeedge: 'compute_edge',

    // data
    relationaldatabase: 'relational_database',
    nosqldatabase: 'nosql_database',

    // storage
    objectstorage: 'object_storage',
    blockstorage: 'block_storage',
    filestorage: 'file_storage',

    // networking
    apigateway: 'api_gateway',
    loadbalancer: 'load_balancer',
    vpcnetworking: 'vpc_networking',
    natgateway: 'nat_gateway',
    privatelink: 'private_link',
    servicediscovery: 'service_discovery',
    servicemesh: 'service_mesh',
    websocketgateway: 'websocket_gateway',
    globalloadbalancer: 'global_load_balancer',

    // integration
    messagequeue: 'messaging_queue',
    messagingqueue: 'messaging_queue',
    eventbus: 'event_bus',
    workfloworchestration: 'workflow_orchestration',
    emailnotification: 'email_service',
    pushnotificationservice: 'push_notification_service',

    // security
    identityauth: 'identity_auth',
    secretsmanagement: 'secrets_management',
    keymanagement: 'key_management',
    certificatemanagement: 'certificate_management',
    ddosprotection: 'ddos_protection',
    policygovernance: 'policy_governance',

    // analytics/ml/iot
    iotcore: 'iot_core',
    timeseriesdatabase: 'time_series_database',
    eventstream: 'event_stream',
    datawarehouse: 'data_warehouse',
    streamprocessor: 'stream_processor',
    mltraining: 'ml_training',
    mlinference: 'ml_inference',
    featurestore: 'feature_store',
    multiregiondb: 'multi_region_database',

    // MLOps
    modelregistry: 'model_registry',
    experimenttracking: 'experiment_tracking',
    mlpipelineorchestration: 'ml_pipeline_orchestration',

    // DevOps (additional aliases)
    containerregistry: 'container_registry',
    cicd: 'ci_cd',
    artifactrepository: 'artifact_repository',

    // IoT (additional aliases)
    deviceregistry: 'iot_core', // maps to iot_core as device registry is part of IoT Core
    digitaltwin: 'iot_core',    // digital twin functionality is part of IoT Core
    otaupdates: 'iot_core'      // OTA updates is part of IoT Core
};

// If your terraform/modules.js already expects older moduleIds (like "objectstorage"),
// this mapping keeps compatibility even if cloud.js uses snake_case moduleIds.
// 100: Compatibility layer removed to ensure 1:1 mapping with terraform-modules.json
// The module registry uses snake_case keys (e.g. compute_serverless), matching our canonical IDs.
const MODULE_ID_COMPAT = {};

function freezeDeep(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    Object.freeze(obj);
    for (const k of Object.keys(obj)) freezeDeep(obj[k]);
    return obj;
}

function titleFromId(id) {
    return String(id || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferCategory(serviceId) {
    if (serviceId.startsWith('compute_')) return 'compute';
    if (serviceId.endsWith('_storage') || serviceId.includes('storage')) return 'storage';
    if (serviceId.includes('database') || serviceId.includes('warehouse') || serviceId.includes('cache') || serviceId.includes('search')) return 'database';
    if (serviceId.includes('gateway') || serviceId.includes('load_balancer') || serviceId.includes('cdn') || serviceId.includes('dns') || serviceId.includes('vpc') || serviceId.includes('vpn') || serviceId.includes('nat') || serviceId.includes('private_link') || serviceId.includes('mesh') || serviceId.includes('discovery')) return 'network';
    if (serviceId.includes('identity') || serviceId.includes('secrets') || serviceId.includes('key_') || serviceId.includes('waf') || serviceId.includes('ddos') || serviceId.includes('policy')) return 'security';
    if (serviceId === 'logging' || serviceId === 'monitoring' || serviceId === 'tracing' || serviceId === 'siem') return 'observability';
    if (serviceId.startsWith('ml_') || serviceId.includes('feature_store')) return 'ml';
    if (serviceId.includes('data_warehouse') || serviceId.includes('stream_processor')) return 'analytics';
    if (serviceId.includes('messaging') || serviceId.includes('event_bus') || serviceId.includes('workflow_orchestration') || serviceId.includes('notification') || serviceId.includes('email_service')) return 'integration';
    if (serviceId.includes('container_registry') || serviceId.includes('ci_cd') || serviceId.includes('artifact')) return 'devops';
    if (serviceId.startsWith('iot_') || serviceId.includes('time_series') || serviceId.includes('event_stream')) return 'iot';
    return 'core';
}

function inferDomain(serviceId) {
    if (serviceId.startsWith('ml_') || serviceId.includes('feature_store')) return 'ml';
    if (serviceId.includes('data_warehouse') || serviceId.includes('stream_processor')) return 'analytics';
    if (serviceId.startsWith('iot_') || serviceId.includes('time_series') || serviceId.includes('event_stream')) return 'iot';
    if (serviceId.includes('identity') || serviceId.includes('secrets') || serviceId.includes('key_') || serviceId.includes('waf') || serviceId.includes('ddos') || serviceId.includes('policy')) return 'security';
    if (serviceId.includes('gateway') || serviceId.includes('load_balancer') || serviceId.includes('cdn') || serviceId.includes('dns') || serviceId.includes('vpc') || serviceId.includes('vpn') || serviceId.includes('nat') || serviceId.includes('private_link') || serviceId.includes('mesh') || serviceId.includes('discovery')) return 'networking';
    if (serviceId === 'logging' || serviceId === 'monitoring' || serviceId === 'tracing' || serviceId === 'siem') return 'observability';
    if (serviceId.includes('container_registry') || serviceId.includes('ci_cd') || serviceId.includes('artifact')) return 'devops';
    if (serviceId.includes('messaging') || serviceId.includes('event_bus') || serviceId.includes('workflow_orchestration') || serviceId.includes('notification') || serviceId.includes('email_service')) return 'messaging';
    return 'core';
}

function buildServiceDef(serviceId, def) {
    const tfResource = def?.terraform?.resourceType || {};
    const pricing = def?.pricing || { engine: 'formula' };

    // Normalize pricing.infracost.resourceType into an object {aws,gcp,azure}
    let infracostResourceType = null;
    if (pricing.engine === 'infracost') {
        const rc = pricing.infracost || {};
        const v = rc.resourceType || rc; // support either {resourceType:{...}} or {aws,gcp,azure}
        if (typeof v === 'string') {
            infracostResourceType = { aws: v, gcp: v, azure: v };
        } else if (v && typeof v === 'object') {
            infracostResourceType = {
                aws: v.aws || null,
                gcp: v.gcp || null,
                azure: v.azure || null
            };
        } else {
            infracostResourceType = { aws: null, gcp: null, azure: null };
        }
    }

    const moduleId = MODULE_ID_COMPAT[serviceId] || def?.terraform?.moduleId || null;

    return {
        id: serviceId,
        name: def?.name || titleFromId(serviceId),
        category: def?.category || inferCategory(serviceId),
        domain: def?.domain || inferDomain(serviceId),

        // Pass through terraform_supported flag (Critical for Validator)
        terraform_supported: def?.terraform?.terraform_supported || false,

        terraform: {
            moduleId
        },

        // Keep "mappings" contract that utils + schemas expect:
        // mappings.<provider>.resource => Terraform resource type
        mappings: {
            aws: { resource: tfResource.aws || null, name: def?.mappings?.aws?.name || null },
            gcp: { resource: tfResource.gcp || null, name: def?.mappings?.gcp?.name || null },
            azure: { resource: tfResource.azure || null, name: def?.mappings?.azure?.name || null }
        },

        pricing: pricing.engine === 'infracost'
            ? { engine: 'infracost', infracost: { resourceType: infracostResourceType } }
            : { engine: (pricing.engine || 'formula') },

        // Keep the cloud product variant mapping as extra metadata
        cloud: def?.cloud || {}
    };
}

// 1) Load canonical services
for (const [id, def] of Object.entries(SERVICE_CATALOG || {})) {
    const built = buildServiceDef(id, def);

    const errors = validateService(id, built);
    if (errors.length) {
        validationErrors.push(`Schema error in '${id}': ${errors.join('; ')}`);
    }

    services[id] = freezeDeep(built);
}

// 2) Add legacy aliases (point to same object with metadata)
for (const [legacyId, canonicalId] of Object.entries(LEGACY_ID_ALIASES)) {
    if (!services[canonicalId]) {
        validationErrors.push(`Alias '${legacyId}' points to missing canonical service '${canonicalId}'`);
        continue;
    }
    services[legacyId] = freezeDeep({
        ...services[canonicalId],
        id: legacyId,
        alias_of: canonicalId
    });
}

// 3) Attach metadata
const meta = {
    source: 'mappings/cloud.js',
    service_count: Object.keys(services).length,
    canonical_service_count: Object.keys(SERVICE_CATALOG || {}).length,
    strict: STRICT,
    has_errors: validationErrors.length > 0
};

Object.defineProperty(services, '__meta', { value: meta, enumerable: false });
Object.defineProperty(services, '__errors', { value: validationErrors, enumerable: false });

// 4) Fail fast (optional)
if (validationErrors.length > 0) {
    console.error('🚨 CATALOG VALIDATION FAILED 🚨');
    for (const err of validationErrors) console.error(`- ${err}`);
    if (STRICT) {
        throw new Error(`Catalog validation failed with ${validationErrors.length} error(s).`);
    }
} else {
    console.log(`✅ Service Catalog Loaded: ${meta.service_count} services (${meta.canonical_service_count} canonical)`);
}

module.exports = services;
