/**
 * STEP 3 — SIZING MODEL
 * Tier-based sizing for all 21 service classes
 * Tiers: SMALL | MEDIUM | LARGE (from Step 1 scale)
 * Cost Profiles: cost_effective | high_performance
 */

// Compute Sizing with cost profiles
const COMPUTE_SIZING = {
    compute_container: {
        cost_effective: {
            SMALL: { instances: 1, cpu: 0.5, memory_gb: 1, description: "1 container, 0.5 vCPU, 1GB RAM" },
            MEDIUM: { instances: 2, cpu: 1, memory_gb: 2, description: "2 containers, 1 vCPU each, 2GB RAM" },
            LARGE: { instances: 3, cpu: 2, memory_gb: 4, description: "3 containers, 2 vCPU each, 4GB RAM" }
        },
        high_performance: {
            SMALL: { instances: 2, cpu: 1, memory_gb: 2, description: "2 containers, 1 vCPU each, 2GB RAM" },
            MEDIUM: { instances: 4, cpu: 2, memory_gb: 4, description: "4 containers, 2 vCPU each, 4GB RAM" },
            LARGE: { instances: 6, cpu: 4, memory_gb: 8, description: "6 containers, 4 vCPU each, 8GB RAM" }
        }
    },
    compute_serverless: {
        cost_effective: {
            SMALL: { requests_per_month: 100000, avg_duration_ms: 200, memory_mb: 256, description: "100K requests/mo, 200ms avg" },
            MEDIUM: { requests_per_month: 1000000, avg_duration_ms: 300, memory_mb: 512, description: "1M requests/mo, 300ms avg" },
            LARGE: { requests_per_month: 10000000, avg_duration_ms: 500, memory_mb: 1024, description: "10M requests/mo, 500ms avg" }
        },
        high_performance: {
            SMALL: { requests_per_month: 100000, avg_duration_ms: 100, memory_mb: 512, description: "100K requests/mo, 100ms avg" },
            MEDIUM: { requests_per_month: 1000000, avg_duration_ms: 150, memory_mb: 1024, description: "1M requests/mo, 150ms avg" },
            LARGE: { requests_per_month: 10000000, avg_duration_ms: 250, memory_mb: 2048, description: "10M requests/mo, 250ms avg" }
        }
    },
    compute_vm: {
        cost_effective: {
            SMALL: { instance_type: "t3.small", instances: 1, description: "1x t3.small (2 vCPU, 2GB)" },
            MEDIUM: { instance_type: "t3.medium", instances: 2, description: "2x t3.medium (2 vCPU, 4GB each)" },
            LARGE: { instance_type: "t3.large", instances: 3, description: "3x t3.large (2 vCPU, 8GB each)" }
        },
        high_performance: {
            SMALL: { instance_type: "c7i.large", instances: 1, description: "1x c7i.large (2 vCPU, 4GB)" },
            MEDIUM: { instance_type: "c7i.xlarge", instances: 2, description: "2x c7i.xlarge (4 vCPU, 8GB each)" },
            LARGE: { instance_type: "c7i.2xlarge", instances: 3, description: "3x c7i.2xlarge (8 vCPU, 16GB each)" }
        }
    },
    compute_static: {
        cost_effective: {
            SMALL: { storage_gb: 1, bandwidth_gb: 10, description: "1GB storage, 10GB bandwidth" },
            MEDIUM: { storage_gb: 5, bandwidth_gb: 100, description: "5GB storage, 100GB bandwidth" },
            LARGE: { storage_gb: 20, bandwidth_gb: 500, description: "20GB storage, 500GB bandwidth" }
        },
        high_performance: {
            SMALL: { storage_gb: 1, bandwidth_gb: 50, description: "1GB storage, 50GB bandwidth" },
            MEDIUM: { storage_gb: 5, bandwidth_gb: 500, description: "5GB storage, 500GB bandwidth" },
            LARGE: { storage_gb: 20, bandwidth_gb: 2000, description: "20GB storage, 2TB bandwidth" }
        }
    }
};

// Data & State Sizing with cost profiles
const DATA_SIZING = {
    relational_database: {
        cost_effective: {
            SMALL: { instance_class: "db.t3.micro", storage_gb: 20, multi_az: false, description: "t3.micro, 20GB, single-AZ" },
            MEDIUM: { instance_class: "db.t3.small", storage_gb: 100, multi_az: true, description: "t3.small, 100GB, multi-AZ" },
            LARGE: { instance_class: "db.t3.medium", storage_gb: 500, multi_az: true, description: "t3.medium, 500GB, multi-AZ" }
        },
        high_performance: {
            SMALL: { instance_class: "db.r6i.large", storage_gb: 100, multi_az: true, description: "r6i.large, 100GB, multi-AZ" },
            MEDIUM: { instance_class: "db.r6i.xlarge", storage_gb: 200, multi_az: true, description: "r6i.xlarge, 200GB, multi-AZ" },
            LARGE: { instance_class: "db.r6i.2xlarge", storage_gb: 500, multi_az: true, description: "r6i.2xlarge, 500GB, multi-AZ" }
        }
    },
    nosql_database: {
        cost_effective: {
            SMALL: { read_units: 5, write_units: 5, storage_gb: 1, description: "5 RCU, 5 WCU, 1GB" },
            MEDIUM: { read_units: 25, write_units: 25, storage_gb: 10, description: "25 RCU, 25 WCU, 10GB" },
            LARGE: { read_units: 100, write_units: 100, storage_gb: 100, description: "100 RCU, 100 WCU, 100GB" }
        },
        high_performance: {
            SMALL: { read_units: 50, write_units: 50, storage_gb: 10, description: "50 RCU, 50 WCU, 10GB" },
            MEDIUM: { read_units: 250, write_units: 250, storage_gb: 100, description: "250 RCU, 250 WCU, 100GB" },
            LARGE: { read_units: 1000, write_units: 1000, storage_gb: 500, description: "1000 RCU, 1000 WCU, 500GB" }
        }
    },
    cache: {
        cost_effective: {
            SMALL: { node_type: "cache.t3.micro", nodes: 1, description: "1x t3.micro node" },
            MEDIUM: { node_type: "cache.t3.small", nodes: 2, description: "2x t3.small nodes" },
            LARGE: { node_type: "cache.t3.medium", nodes: 3, description: "3x t3.medium cluster" }
        },
        high_performance: {
            SMALL: { node_type: "cache.r6g.large", nodes: 1, description: "1x r6g.large node" },
            MEDIUM: { node_type: "cache.r6g.xlarge", nodes: 2, description: "2x r6g.xlarge nodes" },
            LARGE: { node_type: "cache.r6g.2xlarge", nodes: 3, description: "3x r6g.2xlarge cluster" }
        }
    },
    object_storage: {
        cost_effective: {
            SMALL: { storage_gb: 10, requests_per_month: 10000, description: "10GB, 10K requests/mo" },
            MEDIUM: { storage_gb: 100, requests_per_month: 100000, description: "100GB, 100K requests/mo" },
            LARGE: { storage_gb: 1000, requests_per_month: 1000000, description: "1TB, 1M requests/mo" }
        },
        high_performance: {
            SMALL: { storage_gb: 10, requests_per_month: 100000, description: "10GB, 100K requests/mo" },
            MEDIUM: { storage_gb: 100, requests_per_month: 1000000, description: "100GB, 1M requests/mo" },
            LARGE: { storage_gb: 1000, requests_per_month: 10000000, description: "1TB, 10M requests/mo" }
        }
    },
    block_storage: {
        cost_effective: {
            SMALL: { size_gb: 20, type: "gp3", iops: 3000, description: "20GB gp3" },
            MEDIUM: { size_gb: 100, type: "gp3", iops: 3000, description: "100GB gp3" },
            LARGE: { size_gb: 500, type: "gp3", iops: 6000, description: "500GB gp3, 6K IOPS" }
        },
        high_performance: {
            SMALL: { size_gb: 50, type: "io2", iops: 10000, description: "50GB io2, 10K IOPS" },
            MEDIUM: { size_gb: 200, type: "io2", iops: 20000, description: "200GB io2, 20K IOPS" },
            LARGE: { size_gb: 1000, type: "io2", iops: 64000, description: "1TB io2, 64K IOPS" }
        }
    }
};

// Traffic & Integration Sizing with cost profiles
const TRAFFIC_SIZING = {
    load_balancer: {
        cost_effective: {
            SMALL: { lcu_hours: 10, processed_bytes_gb: 50, description: "10 LCU-hours, 50GB processed" },
            MEDIUM: { lcu_hours: 50, processed_bytes_gb: 200, description: "50 LCU-hours, 200GB processed" },
            LARGE: { lcu_hours: 200, processed_bytes_gb: 1000, description: "200 LCU-hours, 1TB processed" }
        },
        high_performance: {
            SMALL: { lcu_hours: 20, processed_bytes_gb: 200, description: "20 LCU-hours, 200GB processed" },
            MEDIUM: { lcu_hours: 100, processed_bytes_gb: 1000, description: "100 LCU-hours, 1TB processed" },
            LARGE: { lcu_hours: 400, processed_bytes_gb: 5000, description: "400 LCU-hours, 5TB processed" }
        }
    },
    api_gateway: {
        cost_effective: {
            SMALL: { requests_per_month: 100000, description: "100K requests/mo" },
            MEDIUM: { requests_per_month: 1000000, description: "1M requests/mo" },
            LARGE: { requests_per_month: 10000000, description: "10M requests/mo" }
        },
        high_performance: {
            SMALL: { requests_per_month: 1000000, description: "1M requests/mo" },
            MEDIUM: { requests_per_month: 10000000, description: "10M requests/mo" },
            LARGE: { requests_per_month: 100000000, description: "100M requests/mo" }
        }
    },
    messaging_queue: {
        cost_effective: {
            SMALL: { messages_per_month: 100000, description: "100K messages/mo" },
            MEDIUM: { messages_per_month: 1000000, description: "1M messages/mo" },
            LARGE: { messages_per_month: 10000000, description: "10M messages/mo" }
        },
        high_performance: {
            SMALL: { messages_per_month: 1000000, description: "1M messages/mo" },
            MEDIUM: { messages_per_month: 10000000, description: "10M messages/mo" },
            LARGE: { messages_per_month: 100000000, description: "100M messages/mo" }
        }
    },
    event_bus: {
        cost_effective: {
            SMALL: { events_per_month: 100000, description: "100K events/mo" },
            MEDIUM: { events_per_month: 1000000, description: "1M events/mo" },
            LARGE: { events_per_month: 10000000, description: "10M events/mo" }
        },
        high_performance: {
            SMALL: { events_per_month: 1000000, description: "1M events/mo" },
            MEDIUM: { events_per_month: 10000000, description: "10M events/mo" },
            LARGE: { events_per_month: 100000000, description: "100M events/mo" }
        }
    },
    search_engine: {
        cost_effective: {
            SMALL: { instance_type: "t3.small.search", storage_gb: 10, description: "t3.small, 10GB" },
            MEDIUM: { instance_type: "t3.medium.search", storage_gb: 50, description: "t3.medium, 50GB" },
            LARGE: { instance_type: "m5.large.search", storage_gb: 200, description: "m5.large, 200GB" }
        },
        high_performance: {
            SMALL: { instance_type: "m5.large.search", storage_gb: 50, description: "m5.large, 50GB" },
            MEDIUM: { instance_type: "m5.xlarge.search", storage_gb: 200, description: "m5.xlarge, 200GB" },
            LARGE: { instance_type: "m5.2xlarge.search", storage_gb: 500, description: "m5.2xlarge, 500GB" }
        }
    },
    cdn: {
        cost_effective: {
            SMALL: { data_transfer_gb: 50, requests_per_month: 100000, description: "50GB transfer, 100K requests" },
            MEDIUM: { data_transfer_gb: 500, requests_per_month: 1000000, description: "500GB transfer, 1M requests" },
            LARGE: { data_transfer_gb: 5000, requests_per_month: 10000000, description: "5TB transfer, 10M requests" }
        },
        high_performance: {
            SMALL: { data_transfer_gb: 200, requests_per_month: 500000, description: "200GB transfer, 500K requests" },
            MEDIUM: { data_transfer_gb: 2000, requests_per_month: 5000000, description: "2TB transfer, 5M requests" },
            LARGE: { data_transfer_gb: 20000, requests_per_month: 50000000, description: "20TB transfer, 50M requests" }
        }
    }
};

// Platform Essentials Sizing with cost profiles
const PLATFORM_SIZING = {
    networking: {
        cost_effective: {
            SMALL: { nat_gateway_hours: 730, data_processed_gb: 10, description: "1 NAT gateway, 10GB" },
            MEDIUM: { nat_gateway_hours: 730, data_processed_gb: 100, description: "1 NAT gateway, 100GB" },
            LARGE: { nat_gateway_hours: 1460, data_processed_gb: 500, description: "2 NAT gateways, 500GB" }
        },
        high_performance: {
            SMALL: { nat_gateway_hours: 730, data_processed_gb: 100, description: "1 NAT gateway, 100GB" },
            MEDIUM: { nat_gateway_hours: 1460, data_processed_gb: 500, description: "2 NAT gateways, 500GB" },
            LARGE: { nat_gateway_hours: 2190, data_processed_gb: 2000, description: "3 NAT gateways, 2TB" }
        }
    },
    identity_auth: {
        cost_effective: {
            SMALL: { mau: 100, description: "100 monthly active users" },
            MEDIUM: { mau: 1000, description: "1K monthly active users" },
            LARGE: { mau: 10000, description: "10K monthly active users" }
        },
        high_performance: {
            SMALL: { mau: 1000, description: "1K monthly active users" },
            MEDIUM: { mau: 10000, description: "10K monthly active users" },
            LARGE: { mau: 100000, description: "100K monthly active users" }
        }
    },
    dns: {
        cost_effective: {
            SMALL: { hosted_zones: 1, queries_per_month: 100000, description: "1 zone, 100K queries" },
            MEDIUM: { hosted_zones: 2, queries_per_month: 1000000, description: "2 zones, 1M queries" },
            LARGE: { hosted_zones: 5, queries_per_month: 10000000, description: "5 zones, 10M queries" }
        },
        high_performance: {
            SMALL: { hosted_zones: 1, queries_per_month: 1000000, description: "1 zone, 1M queries" },
            MEDIUM: { hosted_zones: 2, queries_per_month: 10000000, description: "2 zones, 10M queries" },
            LARGE: { hosted_zones: 5, queries_per_month: 100000000, description: "5 zones, 100M queries" }
        }
    }
};

// Operations Sizing with cost profiles
const OPERATIONS_SIZING = {
    monitoring: {
        cost_effective: {
            SMALL: { metrics: 10, alarms: 5, description: "10 metrics, 5 alarms" },
            MEDIUM: { metrics: 50, alarms: 20, description: "50 metrics, 20 alarms" },
            LARGE: { metrics: 200, alarms: 50, description: "200 metrics, 50 alarms" }
        },
        high_performance: {
            SMALL: { metrics: 50, alarms: 10, description: "50 metrics, 10 alarms" },
            MEDIUM: { metrics: 200, alarms: 50, description: "200 metrics, 50 alarms" },
            LARGE: { metrics: 1000, alarms: 200, description: "1000 metrics, 200 alarms" }
        }
    },
    logging: {
        cost_effective: {
            SMALL: { ingestion_gb: 5, retention_days: 7, description: "5GB/mo ingested, 7 day retention" },
            MEDIUM: { ingestion_gb: 50, retention_days: 30, description: "50GB/mo ingested, 30 day retention" },
            LARGE: { ingestion_gb: 500, retention_days: 90, description: "500GB/mo ingested, 90 day retention" }
        },
        high_performance: {
            SMALL: { ingestion_gb: 20, retention_days: 30, description: "20GB/mo ingested, 30 day retention" },
            MEDIUM: { ingestion_gb: 200, retention_days: 90, description: "200GB/mo ingested, 90 day retention" },
            LARGE: { ingestion_gb: 2000, retention_days: 365, description: "2TB/mo ingested, 365 day retention" }
        }
    },
    secrets_management: {
        cost_effective: {
            SMALL: { secrets: 5, api_calls_per_month: 1000, description: "5 secrets, 1K API calls" },
            MEDIUM: { secrets: 20, api_calls_per_month: 10000, description: "20 secrets, 10K API calls" },
            LARGE: { secrets: 100, api_calls_per_month: 100000, description: "100 secrets, 100K API calls" }
        },
        high_performance: {
            SMALL: { secrets: 10, api_calls_per_month: 10000, description: "10 secrets, 10K API calls" },
            MEDIUM: { secrets: 50, api_calls_per_month: 100000, description: "50 secrets, 100K API calls" },
            LARGE: { secrets: 200, api_calls_per_month: 1000000, description: "200 secrets, 1M API calls" }
        }
    }
};

// Combined sizing model
const SIZING_MODEL = {
    compute_container: { ...COMPUTE_SIZING.compute_container },
    compute_serverless: { ...COMPUTE_SIZING.compute_serverless },
    compute_vm: { ...COMPUTE_SIZING.compute_vm },
    compute_static: { ...COMPUTE_SIZING.compute_static },
    relational_database: { ...DATA_SIZING.relational_database },
    nosql_database: { ...DATA_SIZING.nosql_database },
    cache: { ...DATA_SIZING.cache },
    object_storage: { ...DATA_SIZING.object_storage },
    block_storage: { ...DATA_SIZING.block_storage },
    load_balancer: { ...TRAFFIC_SIZING.load_balancer },
    api_gateway: { ...TRAFFIC_SIZING.api_gateway },
    messaging_queue: { ...TRAFFIC_SIZING.messaging_queue },
    event_bus: { ...TRAFFIC_SIZING.event_bus },
    search_engine: { ...TRAFFIC_SIZING.search_engine },
    cdn: { ...TRAFFIC_SIZING.cdn },
    networking: { ...PLATFORM_SIZING.networking },
    identity_auth: { ...PLATFORM_SIZING.identity_auth },
    dns: { ...PLATFORM_SIZING.dns },
    monitoring: { ...OPERATIONS_SIZING.monitoring },
    logging: { ...OPERATIONS_SIZING.logging },
    secrets_management: { ...OPERATIONS_SIZING.secrets_management }
};

/**
 * Get sizing for a service class at a specific tier and cost profile
 * @param {string} serviceClass - One of the 21 service classes
 * @param {string} tier - SMALL, MEDIUM, or LARGE
 * @param {string} costProfile - cost_effective or high_performance
 * @returns {object} Sizing configuration
 */
function getSizing(serviceClass, tier = 'MEDIUM', costProfile = 'cost_effective') {
    const sizing = SIZING_MODEL[serviceClass];
    if (!sizing) {
        console.warn(`No sizing defined for service class: ${serviceClass}`);
        return { description: "Default sizing" };
    }
    
    // Check if this service class has cost profile-specific sizing
    if (sizing.cost_effective && sizing.high_performance) {
        const profileSizing = sizing[costProfile] || sizing.cost_effective;
        return profileSizing[tier] || profileSizing.MEDIUM;
    }
    
    // Fallback to original behavior if no cost profiles defined
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
 * @param {string} costProfile - cost_effective or high_performance
 * @returns {object} Sizing for all services
 */
function getSizingForInfraSpec(infraSpec, intent, costProfile = 'cost_effective') {
    const tier = determineScaleTier(intent);
    const requiredServices = infraSpec.service_classes?.required_services || [];
    const sizing = {};

    for (const service of requiredServices) {
        sizing[service.service_class] = {
            tier,
            ...getSizing(service.service_class, tier, costProfile)
        };
    }

    return {
        tier,
        profile: costProfile, // Include the profile in the result
        services: sizing
    };
}

module.exports = {
    SIZING_MODEL,
    getSizing,
    determineScaleTier,
    getSizingForInfraSpec
};
