/**
 * backend/config/aliases.js
 *
 * Centralized service/capability ID normalization.
 * Maps legacy/drifted IDs to the canonical (snake_case) IDs used across:
 * - backend/catalog/mappings/cloud.js (SERVICE_CATALOG ids)
 * - backend/config/terraform-modules.json
 *
 * Use `resolveServiceId(id)` before any lookup.
 */
'use strict';

// Canonical IDs are snake_case (right side).
const SERVICE_ALIASES = {
    // --- Compute ---
    computeserverless: 'computeserverless',
    compute_serverless: 'computeserverless',
    serverless_compute: 'compute_serverless',
    lambda: 'compute_serverless',

    computecontainer: 'computecontainer',
    compute_container: 'computecontainer',
    appcompute: 'computecontainer',
    app_compute: 'computecontainer',

    computevm: 'compute_vm',
    compute_vm: 'compute_vm',

    computebatch: 'compute_batch',
    compute_batch: 'compute_batch',

    computeedge: 'compute_edge',
    compute_edge: 'compute_edge',

    // --- Database ---
    relationaldatabase: 'relational_database',
    relational_database: 'relational_database',
    relational_db: 'relational_database',

    nosqldatabase: 'nosql_database',
    nosql_database: 'nosql_database',

    cache: 'cache',

    searchengine: 'search_engine',
    search_engine: 'search_engine',

    multiregiondb: 'multi_region_database',
    multi_region_db: 'multi_region_database',
    multi_region_database: 'multi_region_database',

    // --- Storage ---
    objectstorage: 'object_storage',
    object_storage: 'object_storage',

    blockstorage: 'block_storage',
    block_storage: 'block_storage',

    filestorage: 'file_storage',
    file_storage: 'file_storage',

    blockstorage: 'blockstorage',
    block_storage: 'blockstorage',

    backup: 'backup',

    // --- Networking ---
    apigateway: 'apigateway',
    api_gateway: 'apigateway',

    loadbalancer: 'loadbalancer',
    load_balancer: 'loadbalancer',

    cdn: 'cdn',
    dns: 'dns',

    vpcnetworking: 'vpc_networking',
    vpc_networking: 'vpc_networking',

    natgateway: 'nat_gateway',
    nat_gateway: 'nat_gateway',

    vpn: 'vpn',
    vpn_gateway: 'vpn',

    privatelink: 'private_link',
    private_link: 'private_link',

    servicediscovery: 'service_discovery',
    service_discovery: 'service_discovery',

    servicemesh: 'service_mesh',
    service_mesh: 'service_mesh',

    websocketgateway: 'websocket_gateway',
    websocket_gateway: 'websocket_gateway',

    globalloadbalancer: 'global_load_balancer',
    global_load_balancer: 'global_load_balancer',

    // --- Integration / Messaging ---
    messagequeue: 'messaging_queue',
    messaging_queue: 'messaging_queue',
    message_queue: 'messaging_queue',

    eventbus: 'eventbus',
    event_bus: 'eventbus',

    workfloworchestration: 'workfloworchestration',
    workflow_orchestration: 'workfloworchestration',

    notification: 'notification',

    emailnotification: 'email_service',
    email_service: 'email_service',

    pushnotificationservice: 'push_notification_service',
    push_notification_service: 'push_notification_service',
    push_notification: 'push_notification_service',

    // --- Security ---
    identityauth: 'identityauth',
    identity_auth: 'identityauth',
    auth: 'identityauth',
    authentication: 'identityauth',

    secretsmanagement: 'secretsmanagement',
    secrets_management: 'secretsmanagement',
    secrets_manager: 'secretsmanagement',

    keymanagement: 'keymanagement',
    key_management: 'keymanagement',

    certificatemanagement: 'certificate_management',
    certificate_management: 'certificate_management',
    certificate_manager: 'certificate_management',

    waf: 'waf',
    waf_security: 'waf',

    ddosprotection: 'ddos_protection',
    ddos_protection: 'ddos_protection',

    policygovernance: 'policy_governance',
    policy_governance: 'policy_governance',

    auditlogging: 'logging',
    eventstreaming: 'event_stream',
    vectordatabase: 'nosql_database',

    // --- Observability ---
    logging: 'logging',
    monitoring: 'monitoring',
    tracing: 'tracing',
    siem: 'siem',

    // --- DevOps ---
    containerregistry: 'container_registry',
    container_registry: 'container_registry',

    cicd: 'ci_cd',
    ci_cd: 'ci_cd',

    artifactrepository: 'artifact_repository',
    artifact_repository: 'artifact_repository',

    // --- IoT / Analytics / ML (from terraform-modules.json) ---
    iotcore: 'iot_core',
    iot_core: 'iot_core',

    timeseriesdatabase: 'time_series_database',
    time_series_database: 'time_series_database',
    time_series_db: 'time_series_database',

    eventstream: 'event_stream',
    event_stream: 'event_stream',

    datawarehouse: 'data_warehouse',
    data_warehouse: 'data_warehouse',

    streamprocessor: 'stream_processor',
    stream_processor: 'stream_processor',

    mltraining: 'ml_training',
    ml_training: 'ml_training',

    mlinference: 'ml_inference',
    ml_inference: 'ml_inference',

    featurestore: 'feature_store',
    feature_store: 'feature_store'
};

const CAPABILITY_ALIASES = {
    identity_access: 'identity_access',
    auth: 'identity_access',
    authentication: 'identity_access'
};

function resolveServiceId(id) {
    if (!id || typeof id !== 'string') return id;
    const normalized = id.trim().toLowerCase();
    return SERVICE_ALIASES[normalized] || normalized;
}

function resolveServiceIds(ids) {
    if (!Array.isArray(ids)) return ids;
    return ids.map(resolveServiceId);
}

function resolveCapabilityId(id) {
    if (!id || typeof id !== 'string') return id;
    const normalized = id.trim();
    return CAPABILITY_ALIASES[normalized] || normalized;
}

function isAlias(id) {
    if (!id || typeof id !== 'string') return false;
    return Object.prototype.hasOwnProperty.call(SERVICE_ALIASES, id.trim().toLowerCase());
}

function getReverseAliasMap() {
    const reverse = {};
    for (const [alias, canonical] of Object.entries(SERVICE_ALIASES)) {
        if (!reverse[canonical]) reverse[canonical] = [];
        reverse[canonical].push(alias);
    }
    return reverse;
}

module.exports = {
    SERVICE_ALIASES,
    CAPABILITY_ALIASES,
    resolveServiceId,
    resolveServiceIds,
    resolveCapabilityId,
    isAlias,
    getReverseAliasMap
};
