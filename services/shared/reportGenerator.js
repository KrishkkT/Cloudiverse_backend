/**
 * Professional Report Generator
 * Formats the final analysis response to meet high-level professional standards.
 */

function generateProfessionalReport(infraSpec, costAnalysis, safeProvider, aiExplanation) {
    const patternId = infraSpec.pattern || infraSpec.architecture_pattern || "CUSTOM_ARCHITECTURE";
    const workloadType = infraSpec.intent?.intent_classification?.workload_type || "General Workload";

    // 1. Architecture Summary
    const architectureSummary = {
        selected_pattern: patternId.replace(/_/g, ' '),
        workload_type: workloadType.charAt(0).toUpperCase() + workloadType.slice(1),
        key_characteristics: [
            infraSpec.requirements?.realtime ? "Real-time communication" : null,
            infraSpec.requirements?.stateful ? "Stateful persistence" : "Stateless compute",
            infraSpec.features?.payments ? "External payment processing" : null,
            infraSpec.requirements?.data_residency ? "Data residency compliance" : null,
            infraSpec.features?.database === false ? "Database explicitly excluded" : null
        ].filter(Boolean)
    };

    // 2. Service Inventory
    const requiredServices = infraSpec.service_classes?.required_services || [];
    const serviceInventory = requiredServices.map(svc => {
        const name = typeof svc === 'string' ? svc : (svc.service_class || svc.id);
        const isExternal = name === 'paymentgateway' || name === 'identityauth'; // Simple heuristic

        return {
            name: formatServiceName(name),
            category: determineCategory(name),
            annotation: isExternal ? "External (SaaS)" : "Required",
            cost_status: isExternal ? "Excluded (3rd party fees)" : "Included"
        };
    });

    // 3. Honest Cost Section
    const providerCosts = {};
    if (costAnalysis.rankings) {
        costAnalysis.rankings.forEach(r => {
            if (r.monthly_cost === 0 && hasUsageBasedServices(requiredServices)) {
                providerCosts[r.provider] = "Not available (usage-based pricing model)";
            } else {
                providerCosts[r.provider] = r.formatted_cost;
            }
        });
    }

    // 4. Assumptions
    const assumptions = {
        traffic_level: infraSpec.assumptions?.traffic_tier || "Medium",
        scaling: "Automatic (Serverless/Container-based)",
        availability: "High (Multi-AZ)",
        database_status: infraSpec.features?.database === false ? "Excluded by user request" : "Provisioned",
        region_selection: "Cost-optimized default"
    };

    return {
        project_context: {
            name: infraSpec.project_name || "New Project",
            environment: "Production",
            optimization_profile: costAnalysis.cost_profile || "Standard"
        },
        architecture_summary: architectureSummary,
        service_inventory: serviceInventory,
        cost_estimation: {
            status: "Complete",
            infrastructure_costs: providerCosts,
            external_costs: [
                "Payment gateway transaction fees",
                "Identity provider MAU charges",
                "Data transfer egress (if high volume)"
            ]
        },
        key_assumptions: assumptions,
        diagram_data: infraSpec.canonical_architecture // Raw data for frontend to render diagram
    };
}

// Helpers
function formatServiceName(key) {
    const map = {
        'computecontainer': 'App Container (Compute)',
        'computeserverless': 'Serverless Function',
        'apigateway': 'API Gateway',
        'websocketgateway': 'WebSocket Gateway',
        'relationaldatabase': 'Relational Database',
        'objectstorage': 'Object Storage',
        'loadbalancer': 'Load Balancer',
        'identityauth': 'Identity & Authentication',
        'paymentgateway': 'Payment Gateway',
        'monitoring': 'Monitoring & Observability',
        'logging': 'Centralized Logging',
        'eventbus': 'Event Bus'
    };
    return map[key] || key.charAt(0).toUpperCase() + key.slice(1);
}

function determineCategory(key) {
    if (key.includes('compute') || key.includes('container')) return 'Compute';
    if (key.includes('database') || key.includes('storage')) return 'Storage';
    if (key.includes('gateway') || key.includes('balancer')) return 'Network';
    return 'Utility';
}

function hasUsageBasedServices(services) {
    return services.some(s => {
        const name = typeof s === 'string' ? s : (s.service_class || s.id);
        return ['computeserverless', 'objectstorage', 'eventbus'].includes(name);
    });
}

module.exports = { generateProfessionalReport };
