/**
 * DATA PROCESSING PIPELINE COST ENGINE
 */

const type = 'infracost';

const PIPELINE_PRICING = {
    AWS: { glue_dpu_hour: 0.44, s3_per_gb: 0.023, step_functions_per_1k: 0.025, athena_per_tb: 5.00 },
    GCP: { dataflow_per_vcpu_hour: 0.056, storage_per_gb: 0.020, composer_small: 300, bigquery_per_tb: 5.00 },
    AZURE: { databricks_dbu: 0.22, storage_per_gb: 0.018, data_factory_per_1k: 1.00, synapse_per_dwu: 1.20 }
};

const COMPARISON_DATA = {
    AWS: { pros: ["Glue is serverless & powerful", "Athena integration"], cons: ["Glue can get expensive"] },
    GCP: { pros: ["Dataflow is best-in-class for streaming", "BigQuery speed"], cons: ["Composer (Airflow) base cost is high"] },
    AZURE: { pros: ["Databricks integration", "Synapse unification"], cons: ["Integration complexity"] }
};

function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`PIPELINE COST ERROR: ${label}`);
}

function normalizeUsage(usageProfile) {
    const getExpected = (field, defaultVal) => {
        const val = usageProfile?.[field];
        if (typeof val === 'number') return val;
        if (typeof val?.expected === 'number') return val.expected;
        if (typeof val?.min === 'number' && typeof val?.max === 'number') return Math.round((val.min + val.max) / 2);
        return defaultVal;
    };
    return { storage_gb: getExpected('storage_gb', 500), jobs_per_day: getExpected('jobs_per_day', 10), job_duration_hours: getExpected('job_duration_hours', 2) };
}

function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7;
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 0.70;
    const confidence = 0.5 * usageConfidence + 0.3 * (resolvedAxes / totalAxes) + 0.2 * patternCertainty;
    return { score: Math.round(confidence * 100) / 100, label: confidence >= 0.8 ? 'High' : confidence >= 0.6 ? 'Medium' : 'Low' };
}

function calculate(usageProfile, options = {}) {
    const usage = normalizeUsage(usageProfile);
    const monthlyJobHours = usage.jobs_per_day * 30 * usage.job_duration_hours;

    const awsCost = calcCloud('AWS', usage, monthlyJobHours);
    const gcpCost = calcCloud('GCP', usage, monthlyJobHours);
    const azureCost = calcCloud('AZURE', usage, monthlyJobHours);

    assertNumber(awsCost.total, "AWS total");
    assertNumber(gcpCost.total, "GCP total");
    assertNumber(azureCost.total, "Azure total");

    const costs = [{ provider: 'AWS', ...awsCost }, { provider: 'GCP', ...gcpCost }, { provider: 'AZURE', ...azureCost }].sort((a, b) => a.total - b.total);
    const recommended = costs[0].provider;
    const confidence = calculateConfidence(usageProfile, options);
    const costRange = { min: Math.round(costs[0].total * 0.5), max: Math.round(costs[0].total * 2), formatted: `$${Math.round(costs[0].total * 0.5)} - $${Math.round(costs[0].total * 2)}/mo` };

    return {
        pattern: 'DATA_PROCESSING_PIPELINE', engine_used: 'infracost',
        cost_estimates: { aws: awsCost, gcp: gcpCost, azure: azureCost },
        recommended_cloud: recommended, recommended_cost_range: costRange,
        recommended: { provider: recommended, total: costs[0].total, formatted_cost: costs[0].formatted, cost_range: costRange, service_count: 4 },
        usage: usage, confidence: confidence.label, confidence_details: confidence,
        ai_explanation: { rationale: 'Pipeline costs driven by compute hours and data volume.', confidence_score: confidence.score, critical_cost_drivers: ['ETL Compute', 'Storage', 'Query'] },
        comparison: COMPARISON_DATA
    };
}

function calcCloud(cloud, usage, monthlyJobHours) {
    const p = PIPELINE_PRICING[cloud];
    let compute = 0;
    if (cloud === 'AWS') compute = monthlyJobHours * p.glue_dpu_hour * 2;
    else if (cloud === 'GCP') compute = monthlyJobHours * p.dataflow_per_vcpu_hour * 4;
    else compute = monthlyJobHours * p.databricks_dbu * 2;

    const storage = usage.storage_gb * (p.s3_per_gb || p.storage_per_gb);
    const queryTB = usage.storage_gb / 1000;
    const query = queryTB * (p.athena_per_tb || p.bigquery_per_tb || p.synapse_per_dwu);
    const total = compute + storage + query + 50;
    return {
        total: Math.round(total * 100) / 100, formatted: `$${total.toFixed(2)}`, breakdown: { compute, storage, query },
        services: ['ETL Service', 'Object Storage', 'Query Engine', 'Orchestration'],
        drivers: [{ name: 'Compute', percentage: Math.round((compute / total) * 100) }, { name: 'Query/Storage', percentage: Math.round(((query + storage) / total) * 100) }],
        pros: COMPARISON_DATA[cloud].pros, cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = { type, calculate, normalizeUsage, PIPELINE_PRICING };
