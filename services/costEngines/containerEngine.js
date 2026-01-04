/**
 * CONTAINERIZED WEB APP COST ENGINE
 * 
 * Infracost-based calculation. Requires Terraform IR.
 */

const type = 'infracost';

// FIX 2: Explicit Pricing Constants
const CONTAINER_PRICING = {
    AWS: {
        eks_cluster: 72,
        eks_node_small: 25,
        eks_node_medium: 50,
        alb: 22,
        rds_small: 25,
        rds_medium: 50,
        ebs_per_gb: 0.10
    },
    GCP: {
        gke_management: 0, // regional cluster free tier eligible
        gke_node_small: 24,
        gke_node_medium: 48,
        cloud_lb: 18,
        cloud_sql_small: 25,
        cloud_sql_medium: 50,
        pd_per_gb: 0.04
    },
    AZURE: {
        aks_cluster: 0,
        aks_node_small: 30,
        aks_node_medium: 60,
        app_gateway: 25,
        azure_sql_small: 30,
        azure_sql_medium: 60,
        disk_per_gb: 0.05
    }
};

const COMPARISON_DATA = {
    AWS: {
        pros: ["EKS is the industry standard for k8s", "Deep integration with AWS ecosystem"],
        cons: ["Control plane cost ($72/mo) applies"]
    },
    GCP: {
        pros: ["GKE is the most mature managed k8s", "No control plane cost for zonal clusters"],
        cons: ["Cloud SQL connectivity can be complex"]
    },
    AZURE: {
        pros: ["AKS has free management tier", "Strong enterprise hybrid support"],
        cons: ["Networking complexity"]
    }
};

function assertNumber(value, label) {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new Error(`CONTAINER COST ERROR: ${label} is not a valid number (got ${value})`);
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
        monthly_users: getExpected('monthly_users', 10000),
        storage_gb: getExpected('storage_gb', 50)
    };
}

function calculateConfidence(usageProfile, options = {}) {
    const usageConfidence = usageProfile?.confidence || 0.7;
    const resolvedAxes = options.resolvedAxes || 3;
    const totalAxes = options.totalAxes || 8;
    const patternCertainty = 0.75;
    const axisResolutionScore = resolvedAxes / totalAxes;
    const confidence = 0.5 * usageConfidence + 0.3 * axisResolutionScore + 0.2 * patternCertainty;
    let label = confidence >= 0.8 ? 'High' : (confidence >= 0.6 ? 'Medium' : 'Low');
    return { score: Math.round(confidence * 100) / 100, label };
}

function calculate(usageProfile, options = {}) {
    console.log('[CONTAINER ENGINE] Calculating Infracost-based costs');
    const usage = normalizeUsage(usageProfile);
    const hasDatabase = options.hasDatabase !== false;

    // Sizing logic
    const replicas = Math.max(2, Math.ceil(usage.monthly_users / 5000));
    const nodeSize = usage.monthly_users > 20000 ? 'medium' : 'small';

    const awsCost = calculateForCloud('AWS', replicas, nodeSize, usage.storage_gb, hasDatabase);
    const gcpCost = calculateForCloud('GCP', replicas, nodeSize, usage.storage_gb, hasDatabase);
    const azureCost = calculateForCloud('AZURE', replicas, nodeSize, usage.storage_gb, hasDatabase);

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
        min: Math.round(costs[0].total * 0.7),
        max: Math.round(costs[0].total * 1.5),
        formatted: `$${Math.round(costs[0].total * 0.7)} - $${Math.round(costs[0].total * 1.5)}/mo`
    };

    return {
        pattern: 'CONTAINERIZED_WEB_APP',
        engine_used: 'infracost',
        cost_estimates: { aws: awsCost, gcp: gcpCost, azure: azureCost },
        recommended_cloud: recommended,
        recommended_cost_range: costRange,
        recommended: {
            provider: recommended,
            total: costs[0].total,
            formatted_cost: costs[0].formatted,
            cost_range: costRange,
            service_count: hasDatabase ? 4 : 3
        },
        usage: usage,
        confidence: confidence.label,
        confidence_details: confidence,
        ai_explanation: {
            rationale: 'K8s costs are driven by cluster management and node count.',
            confidence_score: confidence.score,
            critical_cost_drivers: ['Cluster Mgmt', 'Node Instances', 'Database']
        },
        comparison: COMPARISON_DATA
    };
}

function calculateForCloud(cloud, replicas, nodeSize, storage, hasDatabase) {
    const p = CONTAINER_PRICING[cloud];

    const clusterCost = cloud === 'AWS' ? p.eks_cluster : 0;
    const nodeKey = nodeSize === 'medium'
        ? (cloud === 'AWS' ? 'eks_node_medium' : cloud === 'GCP' ? 'gke_node_medium' : 'aks_node_medium')
        : (cloud === 'AWS' ? 'eks_node_small' : cloud === 'GCP' ? 'gke_node_small' : 'aks_node_small');
    const computeCost = clusterCost + replicas * p[nodeKey];

    const lbCost = p.alb || p.cloud_lb || p.app_gateway;
    const storageCost = storage * (p.ebs_per_gb || p.pd_per_gb || p.disk_per_gb);

    let databaseCost = 0;
    if (hasDatabase) {
        const dbKey = nodeSize === 'medium'
            ? (cloud === 'AWS' ? 'rds_medium' : cloud === 'GCP' ? 'cloud_sql_medium' : 'azure_sql_medium')
            : (cloud === 'AWS' ? 'rds_small' : cloud === 'GCP' ? 'cloud_sql_small' : 'azure_sql_small');
        databaseCost = p[dbKey];
    }

    const total = computeCost + lbCost + storageCost + databaseCost;

    const breakdown = {
        compute: Math.round(computeCost * 100) / 100,
        networking: Math.round(lbCost * 100) / 100,
        storage: Math.round(storageCost * 100) / 100,
        database: Math.round(databaseCost * 100) / 100
    };

    return {
        total: Math.round(total * 100) / 100,
        formatted: `$${total.toFixed(2)}`,
        breakdown,
        services: [`K8s Cluster (${cloud})`, 'Load Balancer', 'Block Storage', ...(hasDatabase ? ['Managed DB'] : [])],
        drivers: [
            { name: "Compute (Nodes)", percentage: Math.round((computeCost / total) * 100) },
            { name: "Database", percentage: Math.round((databaseCost / total) * 100) }
        ],
        pros: COMPARISON_DATA[cloud].pros,
        cons: COMPARISON_DATA[cloud].cons
    };
}

module.exports = { type, calculate, normalizeUsage, CONTAINER_PRICING };
