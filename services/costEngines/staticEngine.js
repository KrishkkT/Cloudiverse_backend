/**
 * STATIC WEB HOSTING COST ENGINE
 * 
 * Formula-based calculation. NEVER uses Infracost or Terraform.
 * 
 * Cost Drivers: bandwidth, storage, dns
 * Forbidden: compute, load_balancer, containers, VMs
 * 
 * Expected range: $1 - $10/month
 */

const type = 'formula';

// FIX 2: Explicit Pricing Constants (No Magic Numbers)
const STATIC_PRICING = {
    AWS: {
        storage_per_gb: 0.023,      // S3 Standard
        bandwidth_per_gb: 0.085,    // First 10TB data out
        dns_flat: 0.50,             // Route 53 Hosted Zone
        requests_per_10k: 0.004     // GET requests
    },
    GCP: {
        storage_per_gb: 0.020,      // Cloud Storage Standard
        bandwidth_per_gb: 0.080,    // Network egress
        dns_flat: 0.30,             // Cloud DNS
        requests_per_10k: 0.004
    },
    AZURE: {
        storage_per_gb: 0.024,      // Blob Storage Hot
        bandwidth_per_gb: 0.087,    // Data transfer out
        dns_flat: 0.40,             // Azure DNS
        requests_per_10k: 0.004
    }
};

// FIX 6: Comparative Reasons (Pros/Cons)
const COMPARISON_DATA = {
    AWS: {
        pros: ["Mature CDN integration (CloudFront)", "Best-in-class DNS latency"],
        cons: ["Slightly higher storage cost than GCP"]
    },
    GCP: {
        pros: ["Lowest object storage cost", "Global fiber network performance"],
        cons: ["DNS management slightly less integrated"]
    },
    AZURE: {
        pros: ["Seamless integration with Azure DevOps/GitHub", "Enterprise-grade compliance"],
        cons: ["Higher bandwidth egress pricing"]
    }
};

// FIX 1: Hard Fail on Non-Numeric Costs
function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`STATIC COST ERROR: ${label} is not a valid number (got ${value})`);
    }
}

/**
 * MANDATORY: Normalize usage profile to expected values.
 * If only min/max provided, use midpoint.
 */
function normalizeUsage(usageProfile) {
    const getExpected = (field, defaultVal) => {
        const val = usageProfile?.[field];
        if (typeof val === 'number') return val;

        // Handle "expected" if it exists and is a number
        if (typeof val?.expected === 'number') return val.expected;

        // Handle min/max -> midpoint
        if (typeof val?.min === 'number' && typeof val?.max === 'number') {
            return Math.round((val.min + val.max) / 2);
        }

        return defaultVal;
    };

    return {
        monthly_users: getExpected('monthly_users', 1000),
        data_transfer_gb: getExpected('data_transfer_gb', 50),
        storage_gb: getExpected('storage_gb', 5),
        requests_per_month: getExpected('requests_per_month', 100000)
    };
}

/**
 * FIX 5: Correct Confidence Formula
 */
function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7; // Default to 0.7 if missing
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 1.0; // Static is 100% certain

    const axisResolutionScore = resolvedAxes / totalAxes;

    const confidence =
        0.5 * usageConfidence +
        0.3 * axisResolutionScore +
        0.2 * patternCertainty;

    let label;
    if (confidence >= 0.8) label = 'High';
    else if (confidence >= 0.6) label = 'Medium';
    else label = 'Low';

    return {
        score: Math.round(confidence * 100) / 100,
        label,
        components: {
            usage_confidence: usageConfidence,
            axis_resolution: axisResolutionScore,
            pattern_certainty: patternCertainty
        }
    };
}

/**
 * Calculate static website costs for all 3 clouds.
 * Returns MANDATORY contract.
 */
function calculate(usageProfile, options = {}) {
    console.log('[STATIC ENGINE] Calculating formula-based costs');

    // STEP 1: Normalize usage
    const usage = normalizeUsage(usageProfile);
    console.log('[STATIC ENGINE] Normalized usage:', usage);

    // STEP 2: Calculate per-cloud costs
    const awsCost = calculateForCloud('AWS', usage);
    const gcpCost = calculateForCloud('GCP', usage);
    const azureCost = calculateForCloud('AZURE', usage);

    // STEP 3: Verify numeric integrity
    assertNumber(awsCost.total, "AWS Total Cost");
    assertNumber(gcpCost.total, "GCP Total Cost");
    assertNumber(azureCost.total, "Azure Total Cost");

    // STEP 4: Rank and Recommend
    const costs = [
        { provider: 'AWS', ...awsCost },
        { provider: 'GCP', ...gcpCost },
        { provider: 'AZURE', ...azureCost }
    ].sort((a, b) => a.total - b.total);

    const recommended = costs[0].provider;

    // STEP 5: Calculate Confidence
    const confidence = calculateConfidence(usageProfile, options);

    // STEP 6: Calculate Cost Range (Min/Max)
    // For static, simple multiplier is safe
    const costRange = {
        min: Math.round(costs[0].total * 0.8),
        max: Math.round(costs[0].total * 1.25),
        formatted: `$${Math.round(costs[0].total * 0.8)} - $${Math.round(costs[0].total * 1.25)}/mo`
    };

    // Full Contract Return
    return {
        pattern: 'STATIC_WEB_HOSTING',
        engine_used: 'formula',

        // Maps nicely to frontend requirements
        cost_estimates: {
            aws: awsCost,
            gcp: gcpCost,
            azure: azureCost
        },

        recommended_cloud: recommended,
        recommended_cost_range: costRange,

        // Strict contract properties
        recommended: {
            provider: recommended,
            total: costs[0].total,
            formatted_cost: costs[0].formatted,
            cost_range: costRange,
            service_count: 3
        },

        // Pass-through usage for UI verification
        usage: usage,

        // Correct confidence object
        confidence: confidence.label,
        confidence_details: confidence,

        // AI Metadata
        ai_explanation: {
            rationale: 'Static websites are storage and bandwidth bound. No compute costs.',
            confidence_score: confidence.score,
            critical_cost_drivers: ['Bandwidth', 'Storage']
        },

        // Comparison Data (Pros/Cons)
        comparison: COMPARISON_DATA
    };
}

/**
 * Calculate single cloud cost with strict assertions
 */
function calculateForCloud(cloud, usage) {
    const p = STATIC_PRICING[cloud];
    if (!p) throw new Error(`Missing pricing for cloud: ${cloud}`);

    const storageCost = usage.storage_gb * p.storage_per_gb;
    const bandwidthCost = usage.data_transfer_gb * p.bandwidth_per_gb;
    const dnsCost = p.dns_flat;
    const requestsCost = (usage.requests_per_month / 10000) * p.requests_per_10k;

    const total = storageCost + bandwidthCost + dnsCost + requestsCost;

    const breakdown = {
        storage: Math.round(storageCost * 100) / 100,
        bandwidth: Math.round(bandwidthCost * 100) / 100,
        dns: Math.round(dnsCost * 100) / 100,
        requests: Math.round(requestsCost * 100) / 100
    };

    return {
        total: Math.round(total * 100) / 100,
        formatted: `$${total.toFixed(2)}`,
        breakdown: breakdown,
        services: [
            `${cloud === 'AWS' ? 'S3' : cloud === 'GCP' ? 'Cloud Storage' : 'Blob Storage'}`,
            `${cloud === 'AWS' ? 'CloudFront' : cloud === 'GCP' ? 'Cloud CDN' : 'Azure CDN'}`,
            `${cloud === 'AWS' ? 'Route53' : cloud === 'GCP' ? 'Cloud DNS' : 'Azure DNS'}`,
        ],
        drivers: [
            { name: "Bandwidth", percentage: Math.round((bandwidthCost / total) * 100) },
            { name: "Storage", percentage: Math.round((storageCost / total) * 100) }
        ],
        pros: COMPARISON_DATA[cloud].pros,
        cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = {
    type,
    calculate,
    normalizeUsage,
    calculateConfidence,
    STATIC_PRICING
};
