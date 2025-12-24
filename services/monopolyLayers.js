/**
 * monopolyLayers.js
 * The 15-Layer Authoritative Pipeline for Deterministic Architecture.
 */

/* =========================================
   LAYER 1 & 2: Workload Classification
   Adapts strict AI signals to internal Deterministic Classifications.
   ========================================= */
const classifyWorkload = (intent, signals) => {
    // Default values
    let classification = {
        type: "balanced",
        statefulness: signals.statefulness || "stateful",
        caching: false,
        asyncProcessing: false
    };

    // 1. Latency Sensitivity Check
    if (signals.latency_sensitivity === "high" || intent.workload_type === "realtime") {
        classification.type = "latency_sensitive";
        classification.caching = true;
    }
    // 2. Throughput / Batch Check
    else if (signals.usage_pattern === "bursty" || intent.workload_type === "batch" || signals.read_write_ratio === "write_heavy") {
        classification.type = "throughput_heavy";
        classification.asyncProcessing = true;
        if (intent.workload_type === "batch") {
            classification.statefulness = "stateless";
        }
    }
    // 3. Cost Optimization Check (e.g. tools, dev envs)
    else if (intent.app_type.includes("internal") || intent.app_type.includes("tool")) {
        classification.type = "cost_optimized";
    }

    return classification;
};

/* =========================================
   LAYER 3: Architecture Skeleton Builder
   ========================================= */
const buildSkeleton = (classification, intent, signals) => {
    const modules = [];

    // 1. Force Networking
    modules.push({ category: "Networking", type: "Virtual Private Cloud (VPC)", required: true });

    // 2. Force Compute (Abstract)
    if (classification.type === "latency_sensitive") {
        modules.push({ category: "Compute", type: "Container Orchestration", required: true });
    } else if (classification.type === "throughput_heavy") {
        modules.push({ category: "Compute", type: "Batch Processing Cluster", required: true });
    } else {
        modules.push({ category: "Compute", type: "Application Server", required: true });
    }

    // 3. Database
    if (classification.statefulness !== "stateless") {
        // Look at intent to guess DB type abstractly
        const dbType = signals.read_write_ratio === "write_heavy" ? "NoSQL Database" : "Relational Database";
        modules.push({ category: "Database", type: dbType, required: true });
    }

    // 4. Observability (Forced)
    modules.push({ category: "Observability", type: "Centralized Monitoring", required: true });

    // 5. Security (Forced)
    modules.push({ category: "Security", type: "Identity Access Management", required: true });

    return modules;
};

/* =========================================
   LAYER 5: Structural Validation
   ========================================= */
const validateStructure = (spec, skeleton) => {
    // 1. Ensure all Skeleton modules exist in the AI proposal
    // If AI deleted a mandatory module, put it back.
    skeleton.forEach(reqMod => {
        const exists = spec.modules.find(m => m.category === reqMod.category && m.type === reqMod.type);
        if (!exists) {
            console.warn(`[Monopoly] AI missed required module: ${reqMod.type}. Injecting default.`);
            spec.modules.push({
                ...reqMod,
                service_name: `Default ${reqMod.type}`,
                specs: { capacity: "Standard Configuration" },
                reason: "Enforced by Monopoly Skeleton"
            });
        }
    });

    return spec;
};

/* =========================================
   LAYER 6: Security Policy Enforcement
   ========================================= */
const enforceSecurity = (spec) => {
    // Force Encryption everywhere
    spec.modules.forEach(mod => {
        if (!mod.specs) mod.specs = {};

        if (mod.category === "Database" || mod.category === "Storage") {
            mod.specs.encryption_at_rest = "Enabled (AES-256)";
            mod.specs.encryption_in_transit = "Enabled (TLS 1.2+)";
        }

        // Force Private Subnets for Data
        if (mod.category === "Database") {
            mod.specs.network_placement = "Private Subnet Only";
            mod.specs.public_access = "BLOCKED";
            mod.specs.multi_az = "Required";
        }
    });

    // Add generic Security Policy Metadata
    spec.security_policy = {
        encryption: "STRICT_ALL",
        iam_policy: "LEAST_PRIVILEGE",
        public_ingress: "RESTRICTED",
        data_residency: "Region-Locked"
    };

    return spec;
};

/* =========================================
   LAYER 7: Compliance Resolution
   ========================================= */
const resolveCompliance = (spec, intent) => {
    let compliance = "Standard";
    let extraControls = [];

    const appType = (intent.app_type || "").toLowerCase();

    if (appType.includes("healthcare") || appType.includes("medical") || appType.includes("hospital")) {
        compliance = "HIPAA";
        extraControls = ["Audit Logs", "Access Tracking", "Business Associate Agreement"];
    } else if (appType.includes("finance") || appType.includes("payment") || appType.includes("bank")) {
        compliance = "PCI-DSS";
        extraControls = ["Tokenization", "Network Isolation", "WAF"];
    } else if (appType.includes("ecommerce") || appType.includes("shop")) {
        compliance = "GDPR/PII";
        extraControls = ["User Consent Management", "Data Anonymization"];
    }

    spec.compliance = {
        level: compliance,
        enforced_controls: extraControls
    };

    // Inject Missing Audit Modules if High Compliance
    if (compliance !== "Standard") {
        const hasAudit = spec.modules.some(m => m.type.toLowerCase().includes("audit"));
        if (!hasAudit) {
            spec.modules.push({
                category: "Security",
                service_name: "Audit Trail Service",
                specs: { retention: "7 Years (Legal Hold)" },
                reason: `Mandatory for ${compliance} compliance`
            });
        }
    }

    return spec;
};

/* =========================================
   LAYER 8: Conflict Detection & Repair
   ========================================= */
const detectConflicts = (spec) => {
    const modules = spec.modules;

    // 1. Deduplication: Only one "VPC" allowed
    const vpcs = modules.filter(m => m.category === "Networking" && m.type.includes("VPC"));
    if (vpcs.length > 1) {
        console.warn("[Monopoly] Conflict: Multiple VPCs detected. Merging...");
        const toKeep = vpcs[0];
        spec.modules = modules.filter(m => !(m.category === "Networking" && m.type.includes("VPC")) || m === toKeep);
    }

    return spec;
};

/* =========================================
   LAYER 9: Default Materialization
   ========================================= */
const materializeDefaults = (spec, classification) => {
    const scale = spec.assumptions?.traffic_tier || "Medium";

    spec.modules.forEach(mod => {
        // Resolve undefined specs
        if (!mod.specs) mod.specs = {};

        // Sizing Defaults
        if (!mod.specs.capacity || mod.specs.capacity === "TBD") {
            if (scale === "High" || scale === "Very High") {
                mod.specs.capacity = "Production Grade (Autoscaling Cluster)";
                if (mod.category === "Database") mod.specs.capacity = "High Availability Cluster (Multi-AZ)";
            }
            else if (scale === "Medium") {
                mod.specs.capacity = "Standard (Balanced)";
                if (mod.category === "Database") mod.specs.capacity = "Primary-Replica Set";
            }
            else {
                mod.specs.capacity = "Dev/Test (Burstable)";
                if (mod.category === "Database") mod.specs.capacity = "Single Instance (Dev)";
            }
        }

        // Retention Defaults
        if (mod.category === "Observability" && !mod.specs.log_retention) {
            mod.specs.log_retention = "30 Days";
        }
        if (mod.category === "Database" && !mod.specs.backup_retention) {
            mod.specs.backup_retention = "7 Days";
        }
    });

    return spec;
};

/* =========================================
   LAYER 13: Scoring & Quality Gates
   ========================================= */
const scoreSpec = (spec) => {
    let securityScore = 80; // Base score

    // Penalties / Bonuses
    if (spec.compliance.level !== "Standard") securityScore += 10;
    if (spec.security_policy.public_ingress === "RESTRICTED") securityScore += 5;

    // Reliability Score
    let reliabilityScore = 90;
    const hasMultiAZ = spec.modules.some(m =>
        (m.specs.features || "").toLowerCase().includes("multi-az") ||
        (m.specs.availability || "").toLowerCase().includes("high")
    );
    if (!hasMultiAZ) reliabilityScore -= 20;

    spec.scores = {
        security: Math.min(100, securityScore),
        reliability: Math.min(100, reliabilityScore),
        cost_efficiency: 85 // Placeholder logic
    };

    return spec;
};

/* =========================================
   LAYER 14: Canonical Output
   ========================================= */
const canonicalizeOutput = (spec) => {
    return {
        step: "infra_spec_generated",
        data: {
            project_name: spec.project_name || "Generated Project",
            project_summary: spec.project_summary || "No summary provided",
            assumptions: spec.assumptions || {},
            modules: spec.modules, // The verified list
            compliance: spec.compliance,
            security_policy: spec.security_policy,
            scores: spec.scores,
            monopoly_metadata: {
                generated_by: "Cloudiverse Deterministic Engine",
                version: "1.0",
                timestamp: new Date().toISOString()
            }
        }
    };
};

module.exports = {
    classifyWorkload,
    buildSkeleton,
    validateStructure,
    enforceSecurity,
    resolveCompliance,
    detectConflicts,
    materializeDefaults,
    scoreSpec,
    canonicalizeOutput
};
