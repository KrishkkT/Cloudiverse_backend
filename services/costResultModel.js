/**
 * CANONICAL COST MODEL - DYNAMIC & REALISTIC
 * 
 * This is the SINGLE SOURCE OF TRUTH for cost data structures.
 * All cost calculations MUST use these structures.
 * 
 * KEY FEATURES:
 * - Cost Intent Layer (hobby/startup/production)
 * - Dynamic weight calculation from usage (not hardcoded)
 * - Quantified drivers with values + impact
 * - Deterministic confidence with explanation
 * - Provider-specific service mapping
 */

// ═══════════════════════════════════════════════════════════════════════════
// COST INTENT LAYER (makes low-scale projects realistic)
// ═══════════════════════════════════════════════════════════════════════════
const COST_INTENT_MULTIPLIER = {
    hobby: 0.25,       // Free tiers, minimal provision, aggressive serverless
    startup: 1.0,      // Balanced defaults
    production: 1.4    // Conservative, HA-biased, safety buffers
};

const COST_INTENT_DESCRIPTIONS = {
    hobby: 'Optimized for free tiers and minimal usage',
    startup: 'Balanced for growth-stage applications',
    production: 'Conservative estimates with HA and safety buffers'
};

/**
 * Infer cost intent from usage data (deterministic, no AI)
 */
function inferCostIntent(usage) {
    const getMax = (field, defaultVal) => {
        const val = usage?.[field];
        if (typeof val === 'number') return val;
        if (typeof val?.max === 'number') return val.max;
        return defaultVal;
    };

    const maxUsers = getMax('monthly_users', 5000);
    const maxTransfer = getMax('data_transfer_gb', 50);
    const maxStorage = getMax('data_storage_gb', 10);

    // Hobby: ≤2k users, ≤50GB transfer, ≤20GB storage
    if (maxUsers <= 2000 && maxTransfer <= 50 && maxStorage <= 20) {
        return 'hobby';
    }

    // Startup: ≤20k users
    if (maxUsers <= 20000) {
        return 'startup';
    }

    // Production: >20k users
    return 'production';
}

// ═══════════════════════════════════════════════════════════════════════════
// PROVIDER-SPECIFIC SERVICE MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const SERVICE_MAP = {
    aws: {
        compute_serverless: 'AWS Lambda',
        cdn: 'CloudFront',
        object_storage: 'Amazon S3',
        identity_auth: 'Amazon Cognito',
        api_gateway: 'API Gateway',
        compute_container: 'Amazon ECS/Fargate',
        compute_vm: 'Amazon EC2',
        relational_database: 'Amazon RDS',
        nosql_database: 'DynamoDB',
        cache: 'ElastiCache',
        load_balancer: 'Application Load Balancer',
        dns: 'Route 53',
        block_storage: 'Amazon EBS',
        networking: 'Amazon VPC',
        monitoring: 'CloudWatch',
        logging: 'CloudWatch Logs',
        secrets_management: 'Secrets Manager'
    },
    gcp: {
        compute_serverless: 'Cloud Functions',
        cdn: 'Cloud CDN',
        object_storage: 'Cloud Storage',
        identity_auth: 'Identity Platform',
        api_gateway: 'API Gateway',
        compute_container: 'Cloud Run / GKE',
        compute_vm: 'Compute Engine',
        relational_database: 'Cloud SQL',
        nosql_database: 'Firestore',
        cache: 'Memorystore',
        load_balancer: 'Cloud Load Balancing',
        dns: 'Cloud DNS',
        block_storage: 'Persistent Disk',
        networking: 'VPC',
        monitoring: 'Cloud Monitoring',
        logging: 'Cloud Logging',
        secrets_management: 'Secret Manager'
    },
    azure: {
        compute_serverless: 'Azure Functions',
        cdn: 'Azure Front Door',
        object_storage: 'Blob Storage',
        identity_auth: 'Entra ID B2C',
        api_gateway: 'API Management',
        compute_container: 'Container Apps',
        compute_vm: 'Virtual Machines',
        relational_database: 'Azure SQL',
        nosql_database: 'Cosmos DB',
        cache: 'Azure Cache for Redis',
        load_balancer: 'Azure Load Balancer',
        dns: 'Azure DNS',
        block_storage: 'Managed Disks',
        networking: 'Virtual Network',
        monitoring: 'Azure Monitor',
        logging: 'Log Analytics',
        secrets_management: 'Key Vault'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// DRIVER DEFINITIONS BY PATTERN (with impact descriptions)
// ═══════════════════════════════════════════════════════════════════════════
const DRIVER_DEFINITIONS = {
    SERVERLESS_WEB_APP: [
        { name: 'Monthly active users', service: 'identity_auth', impact: 'Auth + session scaling' },
        { name: 'Requests per user', service: 'compute_serverless', impact: 'Lambda invocation costs' },
        { name: 'Data transfer', service: 'cdn', impact: 'CDN egress dominates at scale' },
        { name: 'Storage volume', service: 'object_storage', impact: 'Asset storage costs' }
    ],
    STATIC_WEB_HOSTING: [
        { name: 'Data transfer', service: 'cdn', impact: 'CDN egress is primary driver' },
        { name: 'Storage size', service: 'object_storage', impact: 'Static file storage' },
        { name: 'Request count', service: 'cdn', impact: 'Per-request CDN costs' }
    ],
    CONTAINERIZED_WEB_APP: [
        { name: 'Container CPU hours', service: 'compute_container', impact: 'Compute dominates' },
        { name: 'Memory allocation', service: 'compute_container', impact: 'Memory pricing' },
        { name: 'Load balancer hours', service: 'load_balancer', impact: 'Always-on LB costs' },
        { name: 'Network egress', service: 'networking', impact: 'Data transfer out' }
    ],
    MOBILE_BACKEND_API: [
        { name: 'API calls/month', service: 'api_gateway', impact: 'API Gateway pricing' },
        { name: 'Auth events (MAU)', service: 'identity_auth', impact: 'Per-user auth costs' },
        { name: 'Database operations', service: 'nosql_database', impact: 'Read/write units' }
    ],
    TRADITIONAL_VM_APP: [
        { name: 'Instance hours', service: 'compute_vm', impact: 'VM runtime costs' },
        { name: 'Disk size (GB)', service: 'block_storage', impact: 'Persistent storage' },
        { name: 'Network transfer', service: 'networking', impact: 'Data out costs' }
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC WEIGHT CALCULATION (usage-derived, NOT hardcoded)
// ═══════════════════════════════════════════════════════════════════════════
function deriveWeights(usage, pattern) {
    // Normalize usage values (handle objects with min/max or direct numbers)
    const getVal = (field, defaultVal) => {
        const val = usage?.[field];
        if (typeof val === 'number') return val;
        if (typeof val?.expected === 'number') return val.expected;
        if (typeof val?.max === 'number' && typeof val?.min === 'number') {
            return Math.round((val.min + val.max) / 2);
        }
        return defaultVal;
    };

    const monthlyUsers = getVal('monthly_users', 5000);
    const requestsPerUser = getVal('requests_per_user', 20);
    const dataTransferGB = getVal('data_transfer_gb', 50);
    const storageGB = getVal('data_storage_gb', 10);

    // Pattern-specific weight derivation
    if (pattern === 'SERVERLESS_WEB_APP' || pattern === 'MOBILE_BACKEND_API') {
        // Serverless: compute scales with requests, auth with users
        return {
            compute_serverless: Math.min(0.5, 0.1 + (requestsPerUser / 100) * 0.4),
            cdn: Math.min(0.4, 0.1 + (dataTransferGB / 500) * 0.3),
            object_storage: Math.min(0.25, 0.05 + (storageGB / 100) * 0.2),
            identity_auth: Math.min(0.3, 0.05 + (monthlyUsers / 50000) * 0.25),
            api_gateway: Math.min(0.2, 0.05 + (requestsPerUser * monthlyUsers / 1000000) * 0.15)
        };
    }

    if (pattern === 'STATIC_WEB_HOSTING') {
        // Static: CDN dominates
        return {
            cdn: Math.min(0.6, 0.3 + (dataTransferGB / 500) * 0.3),
            object_storage: Math.min(0.35, 0.15 + (storageGB / 100) * 0.2),
            dns: 0.05,
            identity_auth: 0.05
        };
    }

    if (pattern === 'CONTAINERIZED_WEB_APP') {
        // Containers: compute and LB dominate
        return {
            compute_container: Math.min(0.55, 0.3 + (requestsPerUser / 50) * 0.25),
            load_balancer: 0.20,
            block_storage: Math.min(0.2, 0.1 + (storageGB / 200) * 0.1),
            networking: 0.10,
            monitoring: 0.05
        };
    }

    // Default weights
    return {
        compute_serverless: 0.35,
        cdn: 0.25,
        object_storage: 0.15,
        identity_auth: 0.15,
        api_gateway: 0.10
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD CANONICAL CostResult (ENGINE ALREADY APPLIED MULTIPLIER)
// ═══════════════════════════════════════════════════════════════════════════
function buildCostResult(provider, pattern, totalCost, genericServices, usage = {}) {
    const providerLower = provider.toLowerCase();

    // 🔥 CRITICAL: Engine has ALREADY applied cost profile multiplier
    // DO NOT apply cost intent here - that would double-apply it
    // The totalCost passed in is the final, adjusted cost from the engine
    
    if (totalCost <= 0) {
        console.error(`[COST RESULT] Invalid cost: $${totalCost} for ${providerLower}`);
        throw new Error(`Invalid base cost $${totalCost} - cost engine must return positive value`);
    }
    
    console.log(`[COST RESULT] Building result for ${providerLower}: $${totalCost.toFixed(2)}`);

    // Get dynamic weights based on usage
    const weights = deriveWeights(usage, pattern);

    // Calculate allocated weight total for normalization
    let allocatedWeight = 0;
    genericServices.forEach(svc => {
        if (weights[svc]) allocatedWeight += weights[svc];
    });

    // Build service-level costs with provider-specific names
    const services = [];
    genericServices.forEach(svc => {
        const weight = weights[svc] || (1 / genericServices.length);
        const normalizedWeight = allocatedWeight > 0 ? (weight / allocatedWeight) : weight;
        const serviceCost = totalCost * normalizedWeight;  // Use engine cost directly

        services.push({
            generic_name: svc,
            cloud_service: SERVICE_MAP[providerLower]?.[svc] || svc,
            cost: parseFloat(serviceCost.toFixed(2)),
            percentage: parseFloat((normalizedWeight * 100).toFixed(1)),
            reason: getServiceReason(svc, usage)
        });
    });

    // Build quantified drivers
    const drivers = buildQuantifiedDrivers(pattern, usage, services);

    return {
        provider: providerLower,
        monthly_cost: parseFloat(totalCost.toFixed(2)),
        formatted_cost: `$${totalCost.toFixed(2)}`,
        services,
        drivers
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// QUANTIFIED DRIVERS (values + impact)
// ═══════════════════════════════════════════════════════════════════════════
function buildQuantifiedDrivers(pattern, usage, services = []) {
    const definitions = DRIVER_DEFINITIONS[pattern] || [];

    // Normalize usage values
    const getRange = (field) => {
        const val = usage?.[field];
        if (typeof val === 'number') return `~${formatNumber(val)}`;
        if (typeof val?.min === 'number' && typeof val?.max === 'number') {
            return `${formatNumber(val.min)} – ${formatNumber(val.max)}`;
        }
        return 'Unknown';
    };

    return definitions.map(def => {
        // Calculate cost contribution from related services
        let cost_contribution = 0;
        if (def.service && services.length > 0) {
            const relatedService = services.find(s => s.generic_name === def.service);
            if (relatedService) {
                cost_contribution = relatedService.cost || 0;
            }
        }
        
        return {
            name: def.name,
            value: getDriverValue(def.name, usage),
            impact: def.impact,
            cost_contribution: parseFloat(cost_contribution.toFixed(2))
        };
    });
}

function getDriverValue(driverName, usage) {
    const mapping = {
        'Monthly active users': () => formatRange(usage?.monthly_users),
        'Requests per user': () => formatRange(usage?.requests_per_user) + '/day',
        'Data transfer': () => formatRange(usage?.data_transfer_gb) + ' GB/mo',
        'Storage volume': () => formatRange(usage?.data_storage_gb) + ' GB',
        'Storage size': () => formatRange(usage?.data_storage_gb) + ' GB',
        'Request count': () => formatRange(usage?.monthly_users) + ' × ' + formatRange(usage?.requests_per_user),
        'Container CPU hours': () => '730 hrs/mo (always-on)',
        'Memory allocation': () => '512 MB – 2 GB',
        'Load balancer hours': () => '730 hrs/mo',
        'Network egress': () => formatRange(usage?.data_transfer_gb) + ' GB',
        'API calls/month': () => {
            const users = getNumeric(usage?.monthly_users, 5000);
            const requests = getNumeric(usage?.requests_per_user, 20);
            return formatNumber(users * requests * 30);
        },
        'Auth events (MAU)': () => formatRange(usage?.monthly_users),
        'Database operations': () => formatNumber(getNumeric(usage?.monthly_users, 5000) * 100) + ' ops/mo',
        'Instance hours': () => '730 hrs/mo',
        'Disk size (GB)': () => formatRange(usage?.data_storage_gb) + ' GB'
    };

    const getter = mapping[driverName];
    return getter ? getter() : 'Variable';
}

function formatRange(val) {
    if (typeof val === 'number') return formatNumber(val);
    if (typeof val?.min === 'number' && typeof val?.max === 'number') {
        return `${formatNumber(val.min)} – ${formatNumber(val.max)}`;
    }
    return 'N/A';
}

function getNumeric(val, defaultVal) {
    if (typeof val === 'number') return val;
    if (typeof val?.expected === 'number') return val.expected;
    if (typeof val?.max === 'number' && typeof val?.min === 'number') {
        return Math.round((val.min + val.max) / 2);
    }
    return defaultVal;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function getServiceReason(service, usage) {
    const reasons = {
        compute_serverless: `Handles ${formatRange(usage?.requests_per_user) || '~20'} requests/user/day`,
        cdn: `Delivers ${formatRange(usage?.data_transfer_gb) || '~50'} GB/month`,
        object_storage: `Stores ${formatRange(usage?.data_storage_gb) || '~10'} GB of assets`,
        identity_auth: `Authenticates ${formatRange(usage?.monthly_users) || '~5k'} users`,
        api_gateway: 'Routes and rate-limits API requests',
        compute_container: 'Runs containerized application workloads',
        compute_vm: 'Hosts virtual machine instances',
        relational_database: 'Stores structured relational data',
        nosql_database: 'Stores flexible document data',
        cache: 'Caches frequently accessed data',
        load_balancer: 'Distributes traffic across instances',
        dns: 'Resolves domain names',
        block_storage: 'Provides persistent disk storage',
        networking: 'Manages network infrastructure',
        monitoring: 'Collects metrics and alerts',
        logging: 'Aggregates application logs',
        secrets_management: 'Stores sensitive credentials'
    };
    return reasons[service] || 'Infrastructure component';
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILD CANONICAL CostScenarios
// ═══════════════════════════════════════════════════════════════════════════
function buildCostScenarios(costEffective, standard, highPerf) {
    return {
        cost_effective: {
            aws: costEffective.aws || null,
            gcp: costEffective.gcp || null,
            azure: costEffective.azure || null
        },
        standard: {
            aws: standard.aws || null,
            gcp: standard.gcp || null,
            azure: standard.azure || null
        },
        high_performance: {
            aws: highPerf.aws || null,
            gcp: highPerf.gcp || null,
            azure: highPerf.azure || null
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE FROM CANONICAL STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════
function aggregateScenarios(scenarios) {
    const allCosts = [];

    for (const profileName of Object.keys(scenarios)) {
        const profile = scenarios[profileName];
        for (const provider of Object.keys(profile)) {
            const result = profile[provider];
            if (typeof result?.monthly_cost === "number") {
                allCosts.push(result.monthly_cost);
            }
        }
    }

    if (allCosts.length === 0) {
        throw new Error("aggregateScenarios: no costs found");
    }

    const min = Math.min(...allCosts);
    const max = Math.max(...allCosts);
    
    // Calculate recommended based on the lowest cost across all profiles
    let recommended = null;
    for (const profileName of Object.keys(scenarios)) {
        const profile = scenarios[profileName];
        for (const provider of Object.keys(profile)) {
            const result = profile[provider];
            if (result && typeof result.monthly_cost === "number") {
                // Create a copy to avoid mutating original object
                const resultCopy = { ...result };
                
                // Attach competitiveness score to every result
                resultCopy.score = computeScore(resultCopy.monthly_cost, min, max);
                
                if (!recommended || resultCopy.monthly_cost < recommended.monthly_cost) {
                    recommended = resultCopy;
                }
                
                // Update the profile with the copy that has the score
                profile[provider] = resultCopy;
            }
        }
    }
    
    return {
        cost_range: {
            min: min,
            max: max,
            formatted: `$${min.toFixed(2)} - $${max.toFixed(2)}/month`
        },
        recommended: recommended
    };
}

function findCheapest(scenarios) {
    let cheapest = null;

    for (const profile of Object.values(scenarios)) {
        for (const result of Object.values(profile)) {
            if (!cheapest || result.monthly_cost < cheapest.monthly_cost) {
                cheapest = result;
            }
        }
    }

    if (!cheapest) {
        throw new Error("findCheapest: no valid cost result");
    }

    return cheapest;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE COMPETITIVENESS SCORE
// ═══════════════════════════════════════════════════════════════════════════
function computeScore(cost, min, max) {
    const range = max - min;
    if (range === 0) return 100;

    return Math.round(
        100 - ((cost - min) / range) * 100
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE SINGLE PROFILE RESULTS (for use within performCostAnalysis)
// ═══════════════════════════════════════════════════════════════════════════
function aggregateCostResults(results) {
    const comparison = {};
    let minCost = Infinity;
    let maxCost = 0;
    let recommended = null;

    results.forEach(res => {
        comparison[res.provider] = res;
        if (res.monthly_cost < minCost) {
            minCost = res.monthly_cost;
            recommended = res;
        }
        if (res.monthly_cost > maxCost) {
            maxCost = res.monthly_cost;
        }
    });

    if (minCost === Infinity) minCost = 0;
    if (!recommended && results.length > 0) recommended = results[0];

    return {
        comparison,
        cost_range: {
            min: parseFloat(minCost.toFixed(2)),
            max: parseFloat(maxCost.toFixed(2)),
            formatted: `$${minCost.toFixed(2)} - $${maxCost.toFixed(2)}`
        },
        recommended: recommended || {
            provider: 'unknown',
            monthly_cost: 0,
            formatted_cost: '$0.00',
            services: [],
            drivers: []
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPUTE CONFIDENCE WITH EXPLANATION (deterministic)
// ═══════════════════════════════════════════════════════════════════════════
function computeConfidence(infraSpec, scenarios, usage = {}) {
    let score = 0;
    const explanation = [];

    // Service completeness (max 0.25)
    const serviceCount = infraSpec?.service_classes?.required_services?.length || 0;
    if (serviceCount >= 4) {
        score += 0.25;
        explanation.push('All required services identified');
    } else if (serviceCount >= 2) {
        score += 0.15;
        explanation.push('Core services identified');
    } else if (serviceCount >= 1) {
        score += 0.05;
        explanation.push('Minimal services identified');
    }

    // Scenario completeness (max 0.45)
    let scenarioCount = 0;
    if (scenarios?.cost_effective?.aws?.monthly_cost > 0) scenarioCount++;
    if (scenarios?.standard?.aws?.monthly_cost > 0) scenarioCount++;
    if (scenarios?.high_performance?.aws?.monthly_cost > 0) scenarioCount++;

    if (scenarioCount === 3) {
        score += 0.45;
        explanation.push('Multi-cloud comparison completed');
    } else if (scenarioCount >= 1) {
        score += 0.15 * scenarioCount;
        explanation.push('Partial cloud comparison');
    }

    // Usage data quality (max 0.20)
    const usageFields = ['monthly_users', 'requests_per_user', 'data_transfer_gb'];
    const filledFields = usageFields.filter(f => usage[f] !== undefined).length;
    if (filledFields === usageFields.length) {
        score += 0.20;
        explanation.push('Usage data provided');
    } else if (filledFields > 0) {
        score += 0.10;
        explanation.push('Partial usage inferred');
    } else {
        explanation.push('Usage inferred (not user-provided)');
    }

    // Always add this (honest limitation)
    explanation.push('Heuristic pricing (not SKU-level)');

    return {
        score: parseFloat(Math.min(score, 0.95).toFixed(2)),
        percentage: Math.round(Math.min(score, 0.95) * 100),
        explanation
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATE INFRASPEC
// ═══════════════════════════════════════════════════════════════════════════
function validateInfraSpec(infraSpec) {
    const services = infraSpec?.service_classes?.required_services || [];
    if (services.length === 0) {
        throw new Error('Invalid InfraSpec: no services selected');
    }
    return true;
}

function generateRecommendationFacts(recommendedResult, allScenarios, usage, pattern) {
    if (!recommendedResult) return null;
    
    // Get all costs to calculate differences
    const allCosts = [];
    for (const profileName of Object.keys(allScenarios)) {
        const profile = allScenarios[profileName];
        for (const provider of Object.keys(profile)) {
            const result = profile[provider];
            if (result && typeof result.monthly_cost === 'number' && result.monthly_cost > 0) {
                allCosts.push({
                    provider: provider,
                    cost: result.monthly_cost,
                    result: result
                });
            }
        }
    }
    
    // Sort by cost to identify next best alternative
    allCosts.sort((a, b) => a.cost - b.cost);
    
    // Find the next best option (not the same as recommended)
    const nextBest = allCosts.find(item => 
        item.provider !== recommendedResult.provider || 
        JSON.stringify(item.result) !== JSON.stringify(recommendedResult)
    );
    
    // Calculate cost difference
    let costDifference = null;
    if (nextBest) {
        const diffPercent = ((nextBest.cost - recommendedResult.monthly_cost) / recommendedResult.monthly_cost) * 100;
        costDifference = {
            provider: nextBest.provider,
            cost: nextBest.cost,
            difference: nextBest.cost - recommendedResult.monthly_cost,
            percentage: Math.round(diffPercent)
        };
    }
    
    // Identify dominant cost drivers from the recommended result
    const dominantDrivers = recommendedResult.drivers
        .sort((a, b) => b.cost_contribution - a.cost_contribution)
        .slice(0, 2)
        .map(driver => ({
            name: driver.name,
            value: driver.value,
            cost_contribution: driver.cost_contribution
        }));
    
    // Generate pros/cons based on provider and usage pattern
    const pros = [];
    const cons = [];
    const bestFor = [];
    const notIdealFor = [];
    
    const provider = recommendedResult.provider.toUpperCase();
    const monthlyCost = recommendedResult.monthly_cost;
    
    // Always add the primary cost-based reason
    pros.push(`Lowest estimated monthly cost at your current usage of $${monthlyCost.toFixed(2)}`);
    
    // Additional pros based on provider strengths
    if (provider === 'AZURE') {
        if (monthlyCost < 50) {
            pros.push("Excellent free tier and startup pricing");
        }
        if (dominantDrivers.some(d => d.name.includes('CDN') || d.name.includes('data transfer'))) {
            pros.push("Competitive CDN pricing for moderate data transfer");
        }
        pros.push("Strong integration with Microsoft ecosystem");
    } else if (provider === 'AWS') {
        if (dominantDrivers.some(d => d.name.includes('CDN'))) {
            pros.push("Best global CDN coverage and performance");
        }
        pros.push("Largest service ecosystem and feature set");
    } else if (provider === 'GCP') {
        if (dominantDrivers.some(d => d.name.includes('compute'))) {
            pros.push("Competitive compute pricing for containerized workloads");
        }
        pros.push("Superior machine learning and data analytics services");
    }
    
    // Cons based on provider trade-offs
    if (provider === 'AZURE') {
        cons.push("Smaller ecosystem than AWS");
        cons.push("Fewer advanced managed services");
    } else if (provider === 'AWS') {
        cons.push("More complex pricing structure");
        cons.push("Steeper learning curve for optimal configuration");
    } else if (provider === 'GCP') {
        cons.push("Smaller partner ecosystem");
        cons.push("Less mature enterprise support compared to AWS/Azure");
    }
    
    // Best for based on usage pattern
    const maxUsers = getNumeric(usage?.monthly_users, 5000);
    const maxTransfer = getNumeric(usage?.data_transfer_gb, 50);
    
    if (maxUsers <= 5000) {
        bestFor.push("Early-stage projects");
        bestFor.push("Portfolio websites");
    } else {
        bestFor.push("Growth-stage applications");
    }
    
    if (monthlyCost < 50) {
        bestFor.push("Cost-sensitive workloads");
    }
    
    if (pattern.includes('SERVERLESS')) {
        bestFor.push("Serverless-first architectures");
    }
    
    // Not ideal for based on usage
    if (maxUsers > 100000) {
        notIdealFor.push("Very large user bases (consider enterprise support)");
    }
    
    if (maxTransfer > 1000) {
        notIdealFor.push("Very high data transfer (negotiated rates may be better)");
    }
    
    return {
        provider: recommendedResult.provider,
        verdict: "recommended",
        facts: {
            cost_rank: 1, // It's the recommended one
            monthly_cost: recommendedResult.monthly_cost,
            cost_difference_vs_next: costDifference ? `${costDifference.percentage > 0 ? '+' : ''}${costDifference.percentage}%` : null,
            dominant_drivers: dominantDrivers,
            scenario: recommendedResult.cost_intent || 'standard',
            usage: {
                monthly_users: usage?.monthly_users,
                data_transfer_gb: usage?.data_transfer_gb,
                data_storage_gb: usage?.data_storage_gb
            }
        },
        pros,
        cons,
        best_for: bestFor,
        not_ideal_for: notIdealFor,
        generated_at: new Date().toISOString()
    };
}

module.exports = {
    buildCostResult,
    buildCostScenarios,
    aggregateScenarios,
    aggregateCostResults,
    computeConfidence,
    validateInfraSpec,
    deriveWeights,
    buildQuantifiedDrivers,
    inferCostIntent,
    generateRecommendationFacts,
    SERVICE_MAP,
    DRIVER_DEFINITIONS,
    COST_INTENT_MULTIPLIER,
    COST_INTENT_DESCRIPTIONS
};
