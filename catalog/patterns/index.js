/**
 * PATTERN REGISTRY (CONFIG ONLY)
 * Patterns define:
 * - which canonical services are allowed/forbidden
 * - defaults (which compute/db to prefer)
 * - diagram edges (as data, not code)
 *
 * IMPORTANT:
 * - Service IDs MUST match backend/catalog/services (master registry). [file:54]
 */

'use strict';

const services = require('../terraform/services'); // Master registry (merged domain packs)

// verify() helps catch typos early. In production, keep warnings (do not crash).
function verify(serviceId) {
    if (!services[serviceId]) {
        console.warn(`⚠️ PATTERN WARNING: Referenced unknown service '${serviceId}'`);
    }
    return serviceId;
}

function v(list) {
    return (list || []).map(verify);
}

module.exports = {
    // ───────────────────────────────────────────────────────────────────
    // CORE PATTERNS
    // ───────────────────────────────────────────────────────────────────

    STATIC_WEB_HOSTING: {
        id: 'STATIC_WEB_HOSTING',
        name: 'Static Web Hosting',
        description: 'Static sites, SPAs, landing pages',
        cost_engine: 'formula',

        required_services: v(['objectstorage', 'dns']),
        recommended_services: v(['cdn', 'certificatemanagement', 'waf', 'logging', 'monitoring']),
        allowed_services: v([
            'cdn', 'objectstorage', 'dns',
            'identityauth', 'waf', 'logging', 'monitoring',
            'certificatemanagement', 'ddosprotection'
        ]),
        forbidden_services: v([
            'computevm', 'computecontainer', 'computeserverless', 'computebatch',
            'relationaldatabase', 'nosqldatabase', 'cache',
            'apigateway', 'loadbalancer'
        ]),

        defaults: {},
        edges: [
            { from: 'client', to: 'cdn', label: 'requests' },
            { from: 'cdn', to: 'objectstorage', label: 'serves assets' },
            { from: 'client', to: 'dns', label: 'resolves' },
            { from: 'waf', to: 'cdn', label: 'protects' }
        ]
    },

    SERVERLESS_WEB_APP: {
        id: 'SERVERLESS_WEB_APP',
        name: 'Serverless Web App',
        description: 'API-driven web apps with managed backend',
        cost_engine: 'hybrid',

        required_services: v(['apigateway', 'computeserverless']),
        recommended_services: v(['logging', 'monitoring', 'tracing', 'secretsmanagement', 'waf']),
        allowed_services: v([
            'apigateway', 'computeserverless',
            'relationaldatabase', 'nosqldatabase', 'cache',
            'objectstorage', 'cdn', 'dns',
            'identityauth', 'secretsmanagement',
            'messagequeue', 'eventbus', 'workfloworchestration',
            'logging', 'monitoring', 'tracing',
            'waf', 'certificatemanagement', 'ddosprotection'
        ]),
        forbidden_services: v(['computevm', 'computecontainer']),

        defaults: { compute: 'computeserverless' },
        edges: [
            { from: 'client', to: 'cdn', label: 'requests' },
            { from: 'cdn', to: 'apigateway', label: 'routes' },
            { from: 'apigateway', to: 'computeserverless', label: 'invokes' },
            { from: 'computeserverless', to: 'relationaldatabase', label: 'reads/writes' },
            { from: 'computeserverless', to: 'nosqldatabase', label: 'reads/writes' },
            { from: 'computeserverless', to: 'cache', label: 'caches' },
            { from: 'computeserverless', to: 'objectstorage', label: 'stores' },
            { from: 'computeserverless', to: 'secretsmanagement', label: 'fetches' },
            { from: 'computeserverless', to: 'logging', label: 'logs' }
        ]
    },

    CONTAINERIZED_WEB_APP: {
        id: 'CONTAINERIZED_WEB_APP',
        name: 'Containerized Web App',
        description: 'Microservices or APIs on containers',
        cost_engine: 'infracost',

        required_services: v(['computecontainer', 'loadbalancer']),
        recommended_services: v(['servicediscovery', 'logging', 'monitoring', 'tracing', 'waf']),
        allowed_services: v([
            'loadbalancer', 'computecontainer',
            'relationaldatabase', 'nosqldatabase', 'cache',
            'objectstorage', 'filestorage', 'blockstorage', 'backup',
            'cdn', 'apigateway', 'dns',
            'identityauth', 'secretsmanagement',
            'messagequeue', 'eventbus', 'workfloworchestration',
            'servicediscovery', 'servicemesh',
            'logging', 'monitoring', 'tracing',
            'waf', 'certificatemanagement', 'ddosprotection',
            'containerregistry', 'cicd', 'artifactrepository'
        ]),
        forbidden_services: v(['computeserverless']),

        defaults: { compute: 'computecontainer' },
        edges: [
            { from: 'client', to: 'cdn', label: 'requests' },
            { from: 'cdn', to: 'loadbalancer', label: 'routes' },
            { from: 'loadbalancer', to: 'computecontainer', label: 'distributes' },
            { from: 'computecontainer', to: 'relationaldatabase', label: 'persists' },
            { from: 'computecontainer', to: 'cache', label: 'caches' },
            { from: 'computecontainer', to: 'logging', label: 'logs' }
        ]
    },

    TRADITIONAL_VM_APP: {
        id: 'TRADITIONAL_VM_APP',
        name: 'Traditional VM App',
        description: 'Classic server-based deployments',
        cost_engine: 'infracost',

        required_services: v(['computevm']),
        recommended_services: v(['loadbalancer', 'backup', 'logging', 'monitoring', 'waf']),
        allowed_services: v([
            'computevm', 'loadbalancer',
            'relationaldatabase',
            'blockstorage', 'filestorage', 'backup',
            'objectstorage', 'dns',
            'identityauth', 'secretsmanagement',
            'logging', 'monitoring',
            'waf', 'ddosprotection',
            'vpcnetworking', 'natgateway', 'vpn', 'privatelink'
        ]),
        forbidden_services: v(['computecontainer', 'computeserverless']),

        defaults: { compute: 'computevm' },
        edges: [
            { from: 'client', to: 'loadbalancer', label: 'requests' },
            { from: 'loadbalancer', to: 'computevm', label: 'routes' },
            { from: 'computevm', to: 'relationaldatabase', label: 'reads/writes' },
            { from: 'computevm', to: 'blockstorage', label: 'persists' }
        ]
    },

    DATA_PROCESSING_PIPELINE: {
        id: 'DATA_PROCESSING_PIPELINE',
        name: 'Data Processing Pipeline',
        description: 'ETL + batch analytics',
        cost_engine: 'infracost',

        required_services: v(['computebatch', 'objectstorage']),
        recommended_services: v(['workfloworchestration', 'messagequeue', 'logging', 'monitoring']),
        allowed_services: v([
            'computebatch', 'computecontainer', 'computeserverless',
            'objectstorage', 'filestorage', 'blockstorage', 'backup',
            'relationaldatabase', 'nosqldatabase',
            'messagequeue', 'eventbus', 'workfloworchestration',
            'logging', 'monitoring', 'tracing'
        ]),
        forbidden_services: v(['computevm', 'cdn', 'apigateway', 'loadbalancer']),

        defaults: { compute: 'computebatch' },
        edges: [
            { from: 'objectstorage', to: 'computebatch', label: 'triggers/feeds' },
            { from: 'computebatch', to: 'objectstorage', label: 'writes outputs' },
            { from: 'workfloworchestration', to: 'computebatch', label: 'orchestrates' }
        ]
    },

    // ───────────────────────────────────────────────────────────────────
    // DOMAIN PATTERNS (compose with packs through service IDs)
    // ───────────────────────────────────────────────────────────────────

    IOT_PLATFORM: {
        id: 'IOT_PLATFORM',
        name: 'IoT Platform',
        description: 'Device telemetry ingestion + stream processing + time-series storage',
        cost_engine: 'infracost',

        required_services: v(['iotcore', 'eventstream', 'timeseriesdatabase']),
        recommended_services: v(['streamprocessor', 'apigateway', 'computeserverless', 'logging', 'monitoring']),
        allowed_services: v([
            'iotcore', 'deviceregistry', 'digitaltwin', 'otaupdates',
            'eventstream', 'streamprocessor', 'timeseriesdatabase',
            'apigateway', 'computeserverless',
            'objectstorage', 'nosqldatabase',
            'logging', 'monitoring'
        ]),
        forbidden_services: v(['computevm']),

        defaults: { compute: 'computeserverless', database: 'timeseriesdatabase' },
        edges: [
            { from: 'devices', to: 'iotcore', label: 'telemetry' },
            { from: 'iotcore', to: 'eventstream', label: 'routes' },
            { from: 'eventstream', to: 'streamprocessor', label: 'processes' },
            { from: 'streamprocessor', to: 'timeseriesdatabase', label: 'stores' },
            { from: 'client', to: 'apigateway', label: 'queries' },
            { from: 'apigateway', to: 'computeserverless', label: 'invokes' },
            { from: 'computeserverless', to: 'timeseriesdatabase', label: 'reads' }
        ]
    },

    ML_PLATFORM: {
        id: 'ML_PLATFORM',
        name: 'ML / Data Science Platform',
        description: 'Training + inference with data/feature storage',
        cost_engine: 'infracost',

        required_services: v(['mltraining', 'mlinference', 'objectstorage']),
        recommended_services: v(['featurestore', 'datawarehouse', 'logging', 'monitoring']),
        allowed_services: v([
            'mltraining', 'mlinference', 'featurestore',
            'modelregistry', 'experimenttracking', 'mlpipelineorchestration',
            'objectstorage', 'datawarehouse',
            'apigateway',
            'logging', 'monitoring', 'tracing'
        ]),
        forbidden_services: v(['computevm']),

        defaults: { compute: 'mlinference' },
        edges: [
            { from: 'mltraining', to: 'objectstorage', label: 'stores models' },
            { from: 'mltraining', to: 'datawarehouse', label: 'reads training data' },
            { from: 'client', to: 'apigateway', label: 'inference req' },
            { from: 'apigateway', to: 'mlinference', label: 'invokes' },
            { from: 'mlinference', to: 'objectstorage', label: 'loads models' },
            { from: 'featurestore', to: 'mlinference', label: 'features' }
        ]
    },

    HIGH_AVAILABILITY_PLATFORM: {
        id: 'HIGH_AVAILABILITY_PLATFORM',
        name: 'High Availability Platform',
        description: 'Multi-region / Zero-downtime architecture',
        cost_engine: 'hybrid',

        required_services: v(['loadbalancer', 'cdn', 'apigateway', 'relationaldatabase', 'identityauth', 'cache']),
        recommended_services: v(['logging', 'monitoring', 'waf', 'ddosprotection', 'backup']),
        allowed_services: v([
            'loadbalancer', 'cdn', 'apigateway', 'relationaldatabase', 'identityauth', 'cache',
            'objectstorage', 'dns', 'computeserverless', 'computecontainer',
            'logging', 'monitoring', 'waf', 'ddosprotection', 'backup',
            'messagequeue', 'eventbus', 'secretsmanagement'
        ]),
        forbidden_services: v([]),

        defaults: { compute: 'computecontainer' },
        edges: [
            { from: 'client', to: 'cdn', label: 'global entry' },
            { from: 'cdn', to: 'loadbalancer', label: 'routes' },
            { from: 'loadbalancer', to: 'computecontainer', label: 'distributes' },
            { from: 'loadbalancer', to: 'computeserverless', label: 'distributes' },
            { from: 'apigateway', to: 'computeserverless', label: 'invokes' },
            { from: 'computecontainer', to: 'relationaldatabase', label: 'persists' },
            { from: 'computecontainer', to: 'cache', label: 'speeds up' },
            { from: 'computeserverless', to: 'relationaldatabase', label: 'persists' },
            { from: 'computeserverless', to: 'cache', label: 'speeds up' }
        ]
    }
};
