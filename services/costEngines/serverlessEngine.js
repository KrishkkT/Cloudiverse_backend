/**
 * SERVERLESS WEB APP COST ENGINE
 * 
 * Hybrid calculation: Formula for functions/API, optional Infracost for DB.
 * 
 * Cost Drivers: invocations, api_requests, bandwidth, managed_db
 * 
 * Expected range: $10 - $150/month
 */

const type = 'hybrid';

// FIX 2: Explicit Pricing Constants
const SERVERLESS_PRICING = {
    AWS: {
        lambda_per_million_invocations: 0.20,
        lambda_per_gb_second: 0.0000166667,
        api_gateway_per_million: 3.50,
        dynamodb_per_wcu: 0.00065,
        dynamodb_per_rcu: 0.00013,
        bandwidth_per_gb: 0.09,
        s3_per_gb: 0.023,
        db_base: 25 // Approximate small RDS/Dynamo
    },
    GCP: {
        functions_per_million: 0.40,
        functions_per_gb_second: 0.0000025,
        api_gateway_per_million: 3.00,
        firestore_operations: 0.108,
        bandwidth_per_gb: 0.12,
        storage_per_gb: 0.020,
        db_base: 20
    },
    AZURE: {
        functions_per_million: 0.20,
        functions_per_gb_second: 0.000016,
        api_management_base: 0.035, // hourly
        cosmos_per_100_ru: 0.008,
        bandwidth_per_gb: 0.087,
        storage_per_gb: 0.018,
        db_base: 30
    }
};

const COMPARISON_DATA = {
    AWS: {
        pros: ["Market leader in serverless (Lambda)", "Rich integration with DynamoDB/S3"],
        cons: ["API Gateway can be expensive at high scale"]
    },
    GCP: {
        pros: ["Excellent developer experience (Cloud Run/Functions)", "Strong global networking"],
        cons: ["Fewer triggers compared to AWS"]
    },
    AZURE: {
        pros: ["Great IDE integration (VS Code)", "Logic Apps for orchestration"],
        cons: ["Cold start times can vary"]
    }
};

// FIX 1: Hard Fail on Non-Numeric Costs
function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`SERVERLESS COST ERROR: ${label} is not a valid number (got ${value})`);
    }
}

/**
 * MANDATORY: Normalize usage profile to expected values.
 */
function normalizeUsage(usageProfile) {
    const getExpected = (field, defaultVal) => {
        const val = usageProfile?.[field];
        if (typeof val === 'number') return val;
        if (typeof val?.expected === 'number') return val.expected;
        if (typeof val?.min === 'number' && typeof val?.max === 'number') {
            return Math.round((val.min + val.max) / 2);
        }
        return defaultVal;
    };

    return {
        monthly_users: getExpected('monthly_users', 5000),
        requests_per_user: getExpected('requests_per_user', 20),
        data_transfer_gb: getExpected('data_transfer_gb', 50),
        storage_gb: getExpected('storage_gb', 10)
    };
}

/**
 * FIX 5: Correct Confidence Formula
 */
function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7;
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 0.85;

    const axisResolutionScore = resolvedAxes / totalAxes;
    const confidence =
        0.5 * usageConfidence +
        0.3 * axisResolutionScore +
        0.2 * patternCertainty;

    let label;
    if (confidence >= 0.8) label = 'High';
    else if (confidence >= 0.6) label = 'Medium';
    else label = 'Low';

    return { score: Math.round(confidence * 100) / 100, label };
}

/**
 * Calculate serverless app costs.
 */
function calculate(usageProfile, options = {}) {
    console.log('[SERVERLESS ENGINE] Calculating hybrid costs');

    const usage = normalizeUsage(usageProfile);
    const hasDatabase = options.hasDatabase !== false;
    const totalRequests = usage.monthly_users * usage.requests_per_user;

    const awsCost = calculateForCloud('AWS', usage, totalRequests, hasDatabase);
    const gcpCost = calculateForCloud('GCP', usage, totalRequests, hasDatabase);
    const azureCost = calculateForCloud('AZURE', usage, totalRequests, hasDatabase);

    // STRICT ASSERTIONS
    assertNumber(awsCost.total, "AWS Total");
    assertNumber(gcpCost.total, "GCP Total");
    assertNumber(azureCost.total, "AZURE Total");

    const costs = [
        { provider: 'AWS', ...awsCost },
        { provider: 'GCP', ...gcpCost },
        { provider: 'AZURE', ...azureCost }
    ].sort((a, b) => a.total - b.total);

    const recommended = costs[0].provider;
    const confidence = calculateConfidence(usageProfile, options);

    const costRange = {
        min: Math.round(costs[0].total * 0.6),
        max: Math.round(costs[0].total * 2),
        formatted: `$${Math.round(costs[0].total * 0.6)} - $${Math.round(costs[0].total * 2)}/mo`
    };

    return {
        pattern: 'SERVERLESS_WEB_APP',
        engine_used: 'hybrid',
        cost_estimates: { aws: awsCost, gcp: gcpCost, azure: azureCost },
        recommended_cloud: recommended,
        recommended_cost_range: costRange,

        recommended: {
            provider: recommended,
            total: costs[0].total,
            formatted_cost: costs[0].formatted,
            cost_range: costRange,
            service_count: hasDatabase ? 5 : 4
        },

        usage: usage,
        confidence: confidence.label,
        confidence_details: confidence,

        ai_explanation: {
            rationale: 'Serverless scales with requests. Cost structure is pay-per-use.',
            confidence_score: confidence.score,
            critical_cost_drivers: ['Invocations', 'API Requests']
        },

        comparison: COMPARISON_DATA
    };
}

function calculateForCloud(cloud, usage, totalRequests, hasDatabase) {
    const p = SERVERLESS_PRICING[cloud];
    const invocations = totalRequests;

    let computeCost = 0;
    if (cloud === 'AWS') {
        computeCost = (invocations / 1000000) * p.lambda_per_million_invocations;
        computeCost += invocations * 0.128 * 0.2 * p.lambda_per_gb_second;
    } else if (cloud === 'GCP') {
        computeCost = (invocations / 1000000) * p.functions_per_million;
        computeCost += invocations * 0.128 * 0.2 * p.functions_per_gb_second;
    } else {
        computeCost = (invocations / 1000000) * p.functions_per_million;
        computeCost += invocations * 0.128 * 0.2 * p.functions_per_gb_second;
    }

    const apiCost = (totalRequests / 1000000) * (p.api_gateway_per_million || p.api_management_base * 730);
    const bandwidthCost = usage.data_transfer_gb * p.bandwidth_per_gb;
    const storageCost = usage.storage_gb * (p.s3_per_gb || p.storage_per_gb);
    const databaseCost = hasDatabase ? p.db_base : 0;

    const total = computeCost + apiCost + bandwidthCost + storageCost + databaseCost;

    const breakdown = {
        compute: Math.round(computeCost * 100) / 100,
        api_gateway: Math.round(apiCost * 100) / 100,
        bandwidth: Math.round(bandwidthCost * 100) / 100,
        storage: Math.round(storageCost * 100) / 100,
        database: Math.round(databaseCost * 100) / 100
    };

    return {
        total: Math.round(total * 100) / 100,
        formatted: `$${total.toFixed(2)}`,
        breakdown,
        services: [`Compute (${cloud})`, 'API Gateway', 'Object Storage', ...(hasDatabase ? ['Managed DB'] : [])],
        drivers: [
            { name: "Compute & API", percentage: Math.round(((computeCost + apiCost) / total) * 100) },
            { name: "Database", percentage: Math.round((databaseCost / total) * 100) }
        ],
        pros: COMPARISON_DATA[cloud].pros,
        cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = { type, calculate, normalizeUsage, SERVERLESS_PRICING };
