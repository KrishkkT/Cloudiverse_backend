/**
 * TRADITIONAL VM APP COST ENGINE
 * Infracost-based calculation.
 */

const type = 'infracost';

const VM_PRICING = {
    AWS: { ec2_t3_small: 15, ec2_t3_medium: 30, ebs_gp3_per_gb: 0.08, elb: 18, rds_small: 25, bandwidth_per_gb: 0.09 },
    GCP: { e2_small: 12, e2_medium: 25, pd_ssd_per_gb: 0.17, cloud_lb: 18, cloud_sql_small: 25, bandwidth_per_gb: 0.12 },
    AZURE: { b2s: 30, b2ms: 60, managed_disk_per_gb: 0.05, app_gateway: 25, azure_sql_small: 30, bandwidth_per_gb: 0.087 }
};

const COMPARISON_DATA = {
    AWS: { pros: ["Broadest instance types", "Mature ecosystem"], cons: ["Bandwidth cost"] },
    GCP: { pros: ["Sustained use discounts", "Fast VM startup"], cons: ["Smaller ecosystem"] },
    AZURE: { pros: ["Hybrid benefit", "Windows integration"], cons: ["Complex licensing"] }
};

function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`VM COST ERROR: ${label}`);
}

function normalizeUsage(usageProfile) {
    const getExpected = (field, defaultVal) => {
        const val = usageProfile?.[field];
        if (typeof val === 'number') return val;
        if (typeof val?.expected === 'number') return val.expected;
        if (typeof val?.min === 'number' && typeof val?.max === 'number') return Math.round((val.min + val.max) / 2);
        return defaultVal;
    };
    return { monthly_users: getExpected('monthly_users', 5000), storage_gb: getExpected('storage_gb', 100), data_transfer_gb: getExpected('data_transfer_gb', 100) };
}

function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7;
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 0.85;
    const confidence = 0.5 * usageConfidence + 0.3 * (resolvedAxes / totalAxes) + 0.2 * patternCertainty;
    return { score: Math.round(confidence * 100) / 100, label: confidence >= 0.8 ? 'High' : confidence >= 0.6 ? 'Medium' : 'Low' };
}

function calculate(usageProfile, options = {}) {
    const usage = normalizeUsage(usageProfile);
    const hasDatabase = options.hasDatabase !== false;
    const vmSize = usage.monthly_users > 5000 ? 'medium' : 'small';
    const vmCount = Math.max(1, Math.ceil(usage.monthly_users / 10000));

    const awsCost = calcCloud('AWS', vmCount, vmSize, usage, hasDatabase);
    const gcpCost = calcCloud('GCP', vmCount, vmSize, usage, hasDatabase);
    const azureCost = calcCloud('AZURE', vmCount, vmSize, usage, hasDatabase);

    assertNumber(awsCost.total, "AWS total");
    assertNumber(gcpCost.total, "GCP total");
    assertNumber(azureCost.total, "Azure total");

    const costs = [{ provider: 'AWS', ...awsCost }, { provider: 'GCP', ...gcpCost }, { provider: 'AZURE', ...azureCost }].sort((a, b) => a.total - b.total);
    const recommended = costs[0].provider;
    const confidence = calculateConfidence(usageProfile, options);
    const costRange = { min: Math.round(costs[0].total * 0.7), max: Math.round(costs[0].total * 1.5), formatted: `$${Math.round(costs[0].total * 0.7)} - $${Math.round(costs[0].total * 1.5)}/mo` };

    return {
        pattern: 'TRADITIONAL_VM_APP', engine_used: 'infracost',
        cost_estimates: { aws: awsCost, gcp: gcpCost, azure: azureCost },
        recommended_cloud: recommended, recommended_cost_range: costRange,
        recommended: { provider: recommended, total: costs[0].total, formatted_cost: costs[0].formatted, cost_range: costRange, service_count: hasDatabase ? 4 : 3 },
        usage: usage, confidence: confidence.label, confidence_details: confidence,
        ai_explanation: { rationale: 'VM costs based on instance size x count.', confidence_score: confidence.score, critical_cost_drivers: ['VM Compute', 'Storage', 'Database'] },
        comparison: COMPARISON_DATA
    };
}

function calcCloud(cloud, vmCount, vmSize, usage, hasDatabase) {
    const p = VM_PRICING[cloud];
    const vmKey = vmSize === 'medium' ? (cloud === 'AWS' ? 'ec2_t3_medium' : cloud === 'GCP' ? 'e2_medium' : 'b2ms') : (cloud === 'AWS' ? 'ec2_t3_small' : cloud === 'GCP' ? 'e2_small' : 'b2s');
    const compute = vmCount * p[vmKey];
    const storage = usage.storage_gb * (p.ebs_gp3_per_gb || p.pd_ssd_per_gb || p.managed_disk_per_gb);
    const lb = p.elb || p.cloud_lb || p.app_gateway;
    const db = hasDatabase ? (p.rds_small || p.cloud_sql_small || p.azure_sql_small) : 0;
    const total = compute + storage + lb + db;
    return {
        total: Math.round(total * 100) / 100, formatted: `$${total.toFixed(2)}`, breakdown: { compute, storage, networking: lb, database: db },
        services: ['VM Instances', 'Block Storage', 'Load Balancer', ...(hasDatabase ? ['Database'] : [])],
        drivers: [{ name: 'Compute', percentage: Math.round((compute / total) * 100) }, { name: 'Storage', percentage: Math.round((storage / total) * 100) }],
        pros: COMPARISON_DATA[cloud].pros, cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = { type, calculate, normalizeUsage, VM_PRICING };
