/**
 * MOBILE BACKEND API COST ENGINE
 * Hybrid calculation.
 */

const type = 'hybrid';

const MOBILE_PRICING = {
    AWS: {
        api_gateway_per_million: 3.50,
        lambda_per_million: 0.20,
        cognito_per_mau: 0.0055,
        dynamodb_baseline: 25,
        sns_per_million: 0.50,
        bandwidth_per_gb: 0.09
    },
    GCP: {
        api_gateway_per_million: 3.00,
        functions_per_million: 0.40,
        firebase_auth_free_tier: 50000,
        firestore_baseline: 20,
        fcm_free: true,
        bandwidth_per_gb: 0.12
    },
    AZURE: {
        api_management_base: 25,
        functions_per_million: 0.20,
        aad_b2c_per_mau: 0.003,
        cosmos_baseline: 30,
        notification_hub: 10,
        bandwidth_per_gb: 0.087
    }
};

const COMPARISON_DATA = {
    AWS: {
        pros: ["Mature mobile SDK (Amplify)", "AppSync for GraphQL"],
        cons: ["Complexity of stitching services"]
    },
    GCP: {
        pros: ["Firebase is the gold standard for mobile", "Real-time DB + Auth integration"],
        cons: ["Vendor lock-in with Firebase"]
    },
    AZURE: {
        pros: ["Strong enterprise auth (B2C)", "Notification Hubs cross-platform"],
        cons: ["API Management is pricey"]
    }
};

function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`MOBILE COST ERROR: ${label} is not a valid number (got ${value})`);
    }
}

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
        requests_per_user: getExpected('requests_per_user', 50),
        data_transfer_gb: getExpected('data_transfer_gb', 100)
    };
}

function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7;
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 0.80;
    const axisResolutionScore = resolvedAxes / totalAxes;
    const confidence = 0.5 * usageConfidence + 0.3 * axisResolutionScore + 0.2 * patternCertainty;
    let label = confidence >= 0.8 ? 'High' : (confidence >= 0.6 ? 'Medium' : 'Low');
    return { score: Math.round(confidence * 100) / 100, label };
}

function calculate(usageProfile, options = {}) {
    console.log('[MOBILE ENGINE] Calculating hybrid costs');
    const usage = normalizeUsage(usageProfile);
    const totalRequests = usage.monthly_users * usage.requests_per_user;

    const awsCost = calculateForCloud('AWS', usage, totalRequests);
    const gcpCost = calculateForCloud('GCP', usage, totalRequests);
    const azureCost = calculateForCloud('AZURE', usage, totalRequests);

    assertNumber(awsCost.total, "AWS Total");
    assertNumber(gcpCost.total, "GCP Total");
    assertNumber(azureCost.total, "Azure Total");

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
        pattern: 'MOBILE_BACKEND_API',
        engine_used: 'hybrid',
        cost_estimates: { aws: awsCost, gcp: gcpCost, azure: azureCost },
        recommended_cloud: recommended,
        recommended_cost_range: costRange,
        recommended: {
            provider: recommended,
            total: costs[0].total,
            formatted_cost: costs[0].formatted,
            cost_range: costRange,
            service_count: 5
        },
        usage: usage,
        confidence: confidence.label,
        confidence_details: confidence,
        ai_explanation: {
            rationale: 'Mobile costs driven by APIM, Auth MAUs, and Database.',
            confidence_score: confidence.score,
            critical_cost_drivers: ['Auth (MAU)', 'API Calls', 'Database']
        },
        comparison: COMPARISON_DATA
    };
}

function calculateForCloud(cloud, usage, totalRequests) {
    const p = MOBILE_PRICING[cloud];

    const apiCost = (totalRequests / 1000000) * (p.api_gateway_per_million || p.api_management_base);
    const computeCost = (totalRequests / 1000000) * (p.lambda_per_million || p.functions_per_million);

    let authCost = 0;
    if (cloud === 'AWS') {
        authCost = Math.max(0, usage.monthly_users - 50000) * p.cognito_per_mau;
    } else if (cloud === 'AZURE') {
        authCost = Math.max(0, usage.monthly_users - 50000) * p.aad_b2c_per_mau;
    }

    const databaseCost = p.dynamodb_baseline || p.firestore_baseline || p.cosmos_baseline;
    const bandwidthCost = usage.data_transfer_gb * p.bandwidth_per_gb;

    const total = apiCost + computeCost + authCost + databaseCost + bandwidthCost;

    const breakdown = {
        compute: Math.round((apiCost + computeCost) * 100) / 100,
        auth: Math.round(authCost * 100) / 100,
        database: Math.round(databaseCost * 100) / 100,
        bandwidth: Math.round(bandwidthCost * 100) / 100
    };

    return {
        total: Math.round(total * 100) / 100,
        formatted: `$${total.toFixed(2)}`,
        breakdown,
        services: ['API Gateway', 'Compute', 'Auth', 'Database', 'Notifications'],
        drivers: [
            { name: "API & Compute", percentage: Math.round(((apiCost + computeCost) / total) * 100) },
            { name: "Database", percentage: Math.round((databaseCost / total) * 100) },
            { name: "Auth", percentage: Math.round((authCost / total) * 100) }
        ],
        pros: COMPARISON_DATA[cloud].pros,
        cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = { type, calculate, normalizeUsage, MOBILE_PRICING };
