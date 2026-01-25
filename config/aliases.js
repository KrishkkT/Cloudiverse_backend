/**
 * backend/config/aliases.js
 *
 * Centralized service ID alias normalization.
 * Maps legacy/drifted IDs to canonical catalog IDs.
 *
 * Use `resolveServiceId(id)` before any catalog lookup.
 */

'use strict';

/**
 * Mapping of any possible drift/legacy name to the new "catalog style" (non-snake_case) ID.
 * The right side MUST match an ID in backend/catalog/domains/*.
 */
const SERVICE_ALIASES = {
    // -- Compute --
    compute_serverless: 'computeserverless',
    serverless_compute: 'computeserverless',
    compute_container: 'computecontainer',
    app_compute: 'computecontainer',
    compute_vm: 'computevm',
    compute_batch: 'computebatch',
    compute_edge: 'computeedge',
    compute: 'computecontainer', // default alias

    // -- Database --
    relational_database: 'relationaldatabase',
    relational_db: 'relationaldatabase',
    nosql_database: 'nosqldatabase',
    time_series_database: 'timeseriesdatabase',
    time_series_db: 'timeseriesdatabase',
    vector_database: 'vectordatabase',
    search_engine: 'searchengine',
    cache: 'cache', // core.js

    // -- Storage --
    object_storage: 'objectstorage',
    block_storage: 'blockstorage',
    file_storage: 'filestorage',

    // -- Network --
    api_gateway: 'apigateway',
    load_balancer: 'loadbalancer',
    global_load_balancer: 'loadbalancer',
    vpc_networking: 'vpcnetworking',
    nat_gateway: 'natgateway',
    private_link: 'privatelink',
    service_discovery: 'servicediscovery',
    service_mesh: 'servicemesh',
    vpn_gateway: 'vpngateway',
    internet_gateway: 'internetgateway',
    transit_gateway: 'transitgateway',

    // -- Integration / Messaging --
    messaging_queue: 'messagequeue',
    message_queue: 'messagequeue',
    event_bus: 'eventbus',
    workflow_orchestration: 'workfloworchestration',
    event_streaming: 'eventstreaming',
    event_stream: 'eventstreaming',
    kinesis_stream: 'kinesisstream',
    batch_job: 'batchjob',
    sms_notification: 'smsnotification',
    payment_gateway: 'paymentgateway',
    websocket_gateway: 'websocketgateway',
    websocket: 'websocketgateway',

    // -- Security --
    identity_auth: 'identityauth',
    auth: 'identityauth',
    authentication: 'identityauth',
    secrets_management: 'secretsmanagement',
    secrets_manager: 'secretsmanagement',
    key_management: 'keymanagement',
    certificate_management: 'certificatemanagement',
    certificate_manager: 'certificatemanagement',
    ddos_protection: 'ddosprotection',
    policy_governance: 'policygovernance',
    waf_security: 'waf',
    iam_policy: 'iampolicy',
    vulnerability_scanner: 'vulnerabilityscanner',
    security_posture: 'securityposture',

    // -- Observability --
    audit_logging: 'auditlogging',
    log_aggregation: 'logaggregation',
    incident_management: 'incidentmanagement',

    // -- DevOps --
    container_registry: 'containerregistry',
    ci_cd: 'cicd',
    artifact_repository: 'artifactrepository',
    build_service: 'buildservice',
    config_management: 'configmanagement',
    parameter_store: 'parameterstore',
    iac_state: 'iacstate',
    state_locking: 'statelocking'
};

const CAPABILITY_ALIASES = {
    identity_access: 'identity_access',
    auth: 'identity_access',
    authentication: 'identity_access'
};

function resolveServiceId(id) {
    if (!id || typeof id !== 'string') return id;
    // Normalize to lowercase first to be extra safe
    const normalized = id.toLowerCase();
    return SERVICE_ALIASES[normalized] || normalized;
}

function resolveServiceIds(ids) {
    if (!Array.isArray(ids)) return ids;
    return ids.map(resolveServiceId);
}

function resolveCapabilityId(id) {
    if (!id || typeof id !== 'string') return id;
    return CAPABILITY_ALIASES[id] || id;
}

function isAlias(id) {
    return SERVICE_ALIASES.hasOwnProperty(id);
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
