/**
 * STEP 3 — SIZING MODEL
 * Tier-based sizing for all 21 service classes
 * Tiers: SMALL | MEDIUM | LARGE (from Step 1 scale)
 */

// Compute Sizing (different paradigms use different sizing logic)
const COMPUTE_SIZING = {
    compute_container: {
        SMALL: { instances: 1, cpu: 0.5, memory_gb: 1, description: "1 container, 0.5 vCPU, 1GB RAM" },
        MEDIUM: { instances: 2, cpu: 1, memory_gb: 2, description: "2 containers, 1 vCPU each, 2GB RAM" },
        LARGE: { instances: 3, cpu: 2, memory_gb: 4, description: "3 containers, 2 vCPU each, 4GB RAM" }
    },
    compute_serverless: {
        SMALL: { requests_per_month: 100000, avg_duration_ms: 200, memory_mb: 256, description: "100K requests/mo, 200ms avg" },
        MEDIUM: { requests_per_month: 1000000, avg_duration_ms: 300, memory_mb: 512, description: "1M requests/mo, 300ms avg" },
        LARGE: { requests_per_month: 10000000, avg_duration_ms: 500, memory_mb: 1024, description: "10M requests/mo, 500ms avg" }
    },
    compute_vm: {
        SMALL: { instance_type: "t3.small", instances: 1, description: "1x t3.small (2 vCPU, 2GB)" },
        MEDIUM: { instance_type: "t3.medium", instances: 2, description: "2x t3.medium (2 vCPU, 4GB each)" },
        LARGE: { instance_type: "t3.large", instances: 3, description: "3x t3.large (2 vCPU, 8GB each)" }
    },
    compute_static: {
        SMALL: { storage_gb: 1, bandwidth_gb: 10, description: "1GB storage, 10GB bandwidth" },
        MEDIUM: { storage_gb: 5, bandwidth_gb: 100, description: "5GB storage, 100GB bandwidth" },
        LARGE: { storage_gb: 20, bandwidth_gb: 500, description: "20GB storage, 500GB bandwidth" }
    }
};

// Data & State Sizing
const DATA_SIZING = {
    relational_database: {
        SMALL: { instance_class: "db.t3.micro", storage_gb: 20, multi_az: false, description: "t3.micro, 20GB, single-AZ" },
        MEDIUM: { instance_class: "db.t3.small", storage_gb: 100, multi_az: true, description: "t3.small, 100GB, multi-AZ" },
        LARGE: { instance_class: "db.t3.medium", storage_gb: 500, multi_az: true, description: "t3.medium, 500GB, multi-AZ" }
    },
    nosql_database: {
        SMALL: { read_units: 5, write_units: 5, storage_gb: 1, description: "5 RCU, 5 WCU, 1GB" },
        MEDIUM: { read_units: 25, write_units: 25, storage_gb: 10, description: "25 RCU, 25 WCU, 10GB" },
        LARGE: { read_units: 100, write_units: 100, storage_gb: 100, description: "100 RCU, 100 WCU, 100GB" }
    },
    cache: {
        SMALL: { node_type: "cache.t3.micro", nodes: 1, description: "1x t3.micro node" },
        MEDIUM: { node_type: "cache.t3.small", nodes: 2, description: "2x t3.small nodes" },
        LARGE: { node_type: "cache.t3.medium", nodes: 3, description: "3x t3.medium cluster" }
    },
    object_storage: {
        SMALL: { storage_gb: 10, requests_per_month: 10000, description: "10GB, 10K requests/mo" },
        MEDIUM: { storage_gb: 100, requests_per_month: 100000, description: "100GB, 100K requests/mo" },
        LARGE: { storage_gb: 1000, requests_per_month: 1000000, description: "1TB, 1M requests/mo" }
    },
    block_storage: {
        SMALL: { size_gb: 20, type: "gp3", iops: 3000, description: "20GB gp3" },
        MEDIUM: { size_gb: 100, type: "gp3", iops: 3000, description: "100GB gp3" },
        LARGE: { size_gb: 500, type: "gp3", iops: 6000, description: "500GB gp3, 6K IOPS" }
    }
};

// Traffic & Integration Sizing
const TRAFFIC_SIZING = {
    load_balancer: {
        SMALL: { lcu_hours: 10, processed_bytes_gb: 50, description: "10 LCU-hours, 50GB processed" },
        MEDIUM: { lcu_hours: 50, processed_bytes_gb: 200, description: "50 LCU-hours, 200GB processed" },
        LARGE: { lcu_hours: 200, processed_bytes_gb: 1000, description: "200 LCU-hours, 1TB processed" }
    },
    api_gateway: {
        SMALL: { requests_per_month: 100000, description: "100K requests/mo" },
        MEDIUM: { requests_per_month: 1000000, description: "1M requests/mo" },
        LARGE: { requests_per_month: 10000000, description: "10M requests/mo" }
    },
    messaging_queue: {
        SMALL: { messages_per_month: 100000, description: "100K messages/mo" },
        MEDIUM: { messages_per_month: 1000000, description: "1M messages/mo" },
        LARGE: { messages_per_month: 10000000, description: "10M messages/mo" }
    },
    event_bus: {
        SMALL: { events_per_month: 100000, description: "100K events/mo" },
        MEDIUM: { events_per_month: 1000000, description: "1M events/mo" },
        LARGE: { events_per_month: 10000000, description: "10M events/mo" }
    },
    search_engine: {
        SMALL: { instance_type: "t3.small.search", storage_gb: 10, description: "t3.small, 10GB" },
        MEDIUM: { instance_type: "t3.medium.search", storage_gb: 50, description: "t3.medium, 50GB" },
        LARGE: { instance_type: "m5.large.search", storage_gb: 200, description: "m5.large, 200GB" }
    },
    cdn: {
        SMALL: { data_transfer_gb: 50, requests_per_month: 100000, description: "50GB transfer, 100K requests" },
        MEDIUM: { data_transfer_gb: 500, requests_per_month: 1000000, description: "500GB transfer, 1M requests" },
        LARGE: { data_transfer_gb: 5000, requests_per_month: 10000000, description: "5TB transfer, 10M requests" }
    }
};

// Platform Essentials Sizing
const PLATFORM_SIZING = {
    networking: {
        SMALL: { nat_gateway_hours: 730, data_processed_gb: 10, description: "1 NAT gateway, 10GB" },
        MEDIUM: { nat_gateway_hours: 730, data_processed_gb: 100, description: "1 NAT gateway, 100GB" },
        LARGE: { nat_gateway_hours: 1460, data_processed_gb: 500, description: "2 NAT gateways, 500GB" }
    },
    identity_auth: {
        SMALL: { mau: 100, description: "100 monthly active users" },
        MEDIUM: { mau: 1000, description: "1K monthly active users" },
        LARGE: { mau: 10000, description: "10K monthly active users" }
    },
    dns: {
        SMALL: { hosted_zones: 1, queries_per_month: 100000, description: "1 zone, 100K queries" },
        MEDIUM: { hosted_zones: 2, queries_per_month: 1000000, description: "2 zones, 1M queries" },
        LARGE: { hosted_zones: 5, queries_per_month: 10000000, description: "5 zones, 10M queries" }
    }
};

// Operations Sizing
const OPERATIONS_SIZING = {
    monitoring: {
        SMALL: { metrics: 10, alarms: 5, description: "10 metrics, 5 alarms" },
        MEDIUM: { metrics: 50, alarms: 20, description: "50 metrics, 20 alarms" },
        LARGE: { metrics: 200, alarms: 50, description: "200 metrics, 50 alarms" }
    },
    logging: {
        SMALL: { ingestion_gb: 5, retention_days: 7, description: "5GB/mo ingested, 7 day retention" },
        MEDIUM: { ingestion_gb: 50, retention_days: 30, description: "50GB/mo ingested, 30 day retention" },
        LARGE: { ingestion_gb: 500, retention_days: 90, description: "500GB/mo ingested, 90 day retention" }
    },
    secrets_management: {
        SMALL: { secrets: 5, api_calls_per_month: 1000, description: "5 secrets, 1K API calls" },
        MEDIUM: { secrets: 20, api_calls_per_month: 10000, description: "20 secrets, 10K API calls" },
        LARGE: { secrets: 100, api_calls_per_month: 100000, description: "100 secrets, 100K API calls" }
    }
};

// Combined sizing model
const SIZING_MODEL = {
    ...COMPUTE_SIZING,
    ...DATA_SIZING,
    ...TRAFFIC_SIZING,
    ...PLATFORM_SIZING,
    ...OPERATIONS_SIZING
};

/**
 * Get sizing for a service class at a specific tier
 * @param {string} serviceClass - One of the 21 service classes
 * @param {string} tier - SMALL, MEDIUM, or LARGE
 * @returns {object} Sizing configuration
 */
function getSizing(serviceClass, tier = 'MEDIUM') {
    const sizing = SIZING_MODEL[serviceClass];
    if (!sizing) {
        console.warn(`No sizing defined for service class: ${serviceClass}`);
        return { description: "Default sizing" };
    }
    return sizing[tier] || sizing.MEDIUM;
}

/**
 * Determine scale tier from Step 1 intent
 * @param {object} intent - Intent object from Step 1
 * @returns {string} SMALL, MEDIUM, or LARGE
 */
function determineScaleTier(intent) {
    const scale = intent?.intent_classification?.scale ||
        intent?.decision_axes?.scale ||
        'medium';

    const scaleMap = {
        'poc': 'SMALL',
        'proof_of_concept': 'SMALL',
        'small': 'SMALL',
        'smb': 'MEDIUM',
        'medium': 'MEDIUM',
        'enterprise': 'LARGE',
        'large': 'LARGE'
    };

    return scaleMap[scale.toLowerCase()] || 'MEDIUM';
}

/**
 * Get sizing for all required services
 * @param {object} infraSpec - InfraSpec from Step 2
 * @param {object} intent - Intent from Step 1
 * @returns {object} Sizing for all services
 */
function getSizingForInfraSpec(infraSpec, intent) {
    const tier = determineScaleTier(intent);
    const requiredServices = infraSpec.service_classes?.required_services || [];
    const sizing = {};

    for (const service of requiredServices) {
        sizing[service.service_class] = {
            tier,
            ...getSizing(service.service_class, tier)
        };
    }

    return {
        tier,
        services: sizing
    };
}

module.exports = {
    SIZING_MODEL,
    getSizing,
    determineScaleTier,
    getSizingForInfraSpec
};
