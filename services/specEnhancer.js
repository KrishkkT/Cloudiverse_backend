/**
 * specEnhancer.js
 * Post-processes the AI-generated Infrastructure Specification to ensure validity,
 * fill missing defaults, and enforce architectural best practices.
 */

const enhanceSpec = (aiSpec, userInput) => {
    // 1. Ensure basics exist
    if (!aiSpec.project_name) {
        aiSpec.project_name = "Cloudiverse Project " + new Date().toISOString().split('T')[0];
    }
    if (!aiSpec.modules || !Array.isArray(aiSpec.modules)) {
        aiSpec.modules = [];
    }

    // 2. Identify Critical Gaps & Fill them
    // Helper to check if a category exists
    const hasCategory = (cat) => aiSpec.modules.some(m => m.category.toLowerCase() === cat.toLowerCase());

    // RULE: Every project needs Networking (VPC)
    if (!hasCategory("Networking")) {
        aiSpec.modules.push({
            category: "Networking",
            service_name: "Virtual Private Cloud (VPC)",
            specs: {
                "cidr": "10.0.0.0/16",
                "subnets": "Public & Private Tiered",
                "nat_gateway": true
            },
            reason: "Fundamental network isolation and security."
        });
    }

    // RULE: Every project needs Observability (CloudWatch/Monitor)
    if (!hasCategory("Observability") && !hasCategory("Monitoring")) {
        aiSpec.modules.push({
            category: "Observability",
            service_name: "Centralized Monitoring",
            specs: {
                "logs": "7 days retention",
                "metrics": "Detailed Monitoring",
                "alarms": ["CPU > 80%", "5xx Errors > 1%"]
            },
            reason: "Required for production visibility."
        });
    }

    // RULE: If 'Database' exists, check for Backup settings
    aiSpec.modules.forEach(mod => {
        if (mod.category === "Database") {
            if (!mod.specs.backup_retention) {
                mod.specs.backup_retention = "7 days (Auto-filled)";
            }
            if (!mod.specs.encryption) {
                mod.specs.encryption = "AES-256 (Enforced)";
            }
        }
    });

    // 3. Enforce Compliance Overrides
    const isHealthcare = userInput.toLowerCase().includes("health") ||
        userInput.toLowerCase().includes("doctor") ||
        userInput.toLowerCase().includes("patient");

    if (isHealthcare) {
        aiSpec.compliance_level = "HIPAA";
        // Ensure Database is ENCRYPTED
        aiSpec.modules.forEach(mod => {
            if (mod.category === "Database" || mod.category === "Storage") {
                mod.specs.encryption_at_rest = "REQUIRED (HIPAA)";
            }
        });
        // Ensure Audit Logging
        if (!aiSpec.modules.some(m => m.service_name.includes("Audit") || m.service_name.includes("Trail"))) {
            aiSpec.modules.push({
                category: "Security",
                service_name: "Audit Trail",
                specs: { "retention": "1 year" },
                reason: "HIPAA Compliance requirement."
            });
        }
    }

    return aiSpec;
};

module.exports = { enhanceSpec };
