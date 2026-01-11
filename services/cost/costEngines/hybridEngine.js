/**
 * HYBRID PLATFORM COST ENGINE
 * 
 * For complex platforms with:
 * - Stateful + Real-time + Payments
 * - Multiple data stores
 * - Full observability stack
 * 
 * Cost drivers: Compute, Database, Cache, Messaging, Ingress, Storage
 */

const PROVIDER_PRICING = {
    AWS: {
        app_compute: { base: 25, per_gb_hour: 0.08, per_request: 0.000001 },
        api_gateway: { base: 10, per_million_requests: 3.5 },
        load_balancer: { base: 22, per_gb: 0.008 },
        relational_db: { base: 45, per_gb_storage: 0.115, per_iops: 0.10 },
        cache: { base: 35, per_gb: 0.05 },
        websocket: { base: 15, per_million_messages: 1.0 },
        message_queue: { base: 5, per_million_requests: 0.40 },
        object_storage: { base: 3, per_gb: 0.023, per_1k_requests: 0.0004 },
        authentication: { base: 8, per_mau: 0.0055 },
        observability: { base: 12, per_gb_logs: 0.50 },
        bandwidth: { per_gb: 0.09 }
    },
    GCP: {
        app_compute: { base: 24, per_gb_hour: 0.076, per_request: 0.0000009 },
        api_gateway: { base: 9, per_million_requests: 3.0 },
        load_balancer: { base: 18, per_gb: 0.007 },
        relational_db: { base: 42, per_gb_storage: 0.10, per_iops: 0.09 },
        cache: { base: 32, per_gb: 0.047 },
        websocket: { base: 14, per_million_messages: 0.9 },
        message_queue: { base: 0, per_million_requests: 0.40 },
        object_storage: { base: 2, per_gb: 0.020, per_1k_requests: 0.0004 },
        authentication: { base: 7, per_mau: 0.0050 },
        observability: { base: 10, per_gb_logs: 0.45 },
        bandwidth: { per_gb: 0.08 }
    },
    AZURE: {
        app_compute: { base: 23, per_gb_hour: 0.075, per_request: 0.0000008 },
        api_gateway: { base: 12, per_million_requests: 3.8 },
        load_balancer: { base: 20, per_gb: 0.0075 },
        relational_db: { base: 40, per_gb_storage: 0.12, per_iops: 0.095 },
        cache: { base: 30, per_gb: 0.046 },
        websocket: { base: 13, per_million_messages: 0.85 },
        message_queue: { base: 4, per_million_requests: 0.38 },
        object_storage: { base: 2.5, per_gb: 0.021, per_1k_requests: 0.00043 },
        authentication: { base: 6, per_mau: 0.0048 },
        observability: { base: 11, per_gb_logs: 0.48 },
        bandwidth: { per_gb: 0.087 }
    }
};

/**
 * Calculate cost for HYBRID_PLATFORM pattern
 */
async function calculate(usageProfile, options = {}) {
    const { costProfile = 'cost_effective' } = options;
    
    // Extract usage metrics
    const monthlyUsers = getUsageValue(usageProfile.monthly_users, 5000);
    const requestsPerUser = getUsageValue(usageProfile.requests_per_user, 30);
    const dataTransferGB = getUsageValue(usageProfile.data_transfer_gb, 500);
    const dataStorageGB = getUsageValue(usageProfile.data_storage_gb, 100);
    
    // Calculate derived metrics
    const totalRequests = monthlyUsers * requestsPerUser;
    const totalRequestsMillions = totalRequests / 1_000_000;
    const computeGBHours = (monthlyUsers / 1000) * 720; // ~30 days * 24h
    const databaseStorageGB = Math.max(10, dataStorageGB * 0.6); // 60% of storage in DB
    const cacheGB = Math.min(16, Math.max(1, monthlyUsers / 500)); // Scale cache with users
    const logDataGB = Math.max(5, totalRequestsMillions * 0.5); // 500MB per million requests
    
    console.log(`[HYBRID ENGINE] Users: ${monthlyUsers}, Requests: ${totalRequests}, Transfer: ${dataTransferGB}GB, Storage: ${dataStorageGB}GB`);
    
    const cost_estimates = {};
    
    for (const [provider, pricing] of Object.entries(PROVIDER_PRICING)) {
        // Calculate component costs
        const costs = {
            app_compute: pricing.app_compute.base + 
                        (computeGBHours * pricing.app_compute.per_gb_hour) +
                        (totalRequestsMillions * pricing.app_compute.per_request * 1_000_000),
            
            api_gateway: pricing.api_gateway.base + 
                        (totalRequestsMillions * pricing.api_gateway.per_million_requests),
            
            load_balancer: pricing.load_balancer.base + 
                          (dataTransferGB * pricing.load_balancer.per_gb),
            
            relational_db: pricing.relational_db.base + 
                          (databaseStorageGB * pricing.relational_db.per_gb_storage),
            
            cache: pricing.cache.base + (cacheGB * pricing.cache.per_gb),
            
            websocket: pricing.websocket.base + 
                      (totalRequestsMillions * 0.2 * pricing.websocket.per_million_messages), // 20% realtime
            
            message_queue: pricing.message_queue.base + 
                          (totalRequestsMillions * 0.3 * pricing.message_queue.per_million_requests), // 30% async
            
            object_storage: pricing.object_storage.base + 
                           (dataStorageGB * 0.4 * pricing.object_storage.per_gb) + // 40% in object storage
                           (totalRequestsMillions * 10 * pricing.object_storage.per_1k_requests), // 10k per million
            
            authentication: pricing.authentication.base + 
                           (monthlyUsers * pricing.authentication.per_mau),
            
            observability: pricing.observability.base + 
                          (logDataGB * pricing.observability.per_gb_logs),
            
            bandwidth: dataTransferGB * pricing.bandwidth.per_gb
        };
        
        const totalCost = Object.values(costs).reduce((sum, cost) => sum + cost, 0);
        
        // Apply cost profile multipliers
        const multiplier = (costProfile === 'cost_effective' || costProfile === 'COST_EFFECTIVE') ? 0.85 : 
                          (costProfile === 'high_performance' || costProfile === 'HIGH_PERFORMANCE') ? 1.4 : 1.0;
        
        const adjustedCost = totalCost * multiplier;
        
        // Format matches what infracostService expects
        cost_estimates[provider.toLowerCase()] = {
            total: parseFloat(adjustedCost.toFixed(2)),
            monthly_cost: parseFloat(adjustedCost.toFixed(2)),
            formatted_cost: `$${adjustedCost.toFixed(2)}/month`,
            breakdown: costs,
            usage_assumptions: {
                monthly_users: monthlyUsers,
                total_requests: totalRequests,
                data_transfer_gb: dataTransferGB,
                data_storage_gb: dataStorageGB,
                cache_gb: cacheGB,
                log_data_gb: logDataGB
            },
            confidence: 0.78,
            cost_profile: costProfile
        };
        
        console.log(`[HYBRID ENGINE] ${provider}: $${adjustedCost.toFixed(2)}/mo`);
    }
    
    // Return in format expected by infracostService
    return {
        cost_estimates,
        pattern: 'HYBRID_PLATFORM',
        engine_type: 'formula'
    };
}

/**
 * Get usage value handling both number and object formats
 */
function getUsageValue(value, defaultVal) {
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null) {
        if (typeof value.expected === 'number') return value.expected;
        if (typeof value.max === 'number' && typeof value.min === 'number') {
            return Math.round((value.min + value.max) / 2);
        }
        if (typeof value.max === 'number') return value.max;
    }
    return defaultVal;
}

module.exports = {
    type: 'formula', // Formula-based, no Terraform/Infracost needed
    calculate
};
