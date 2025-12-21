/**
 * monopolyCore.js
 * The Deterministic Logic Layer.
 * Defines strict architectural patterns and rules that AI cannot override.
 */

const ARCH_PATTERNS = {
    "WEB_STANDARD": {
        id: "WEB_STANDARD",
        description: "Standard 3-Tier Web Architecture",
        modules: [
            { category: "Networking", type: "Virtual Private Cloud (VPC)", required: true },
            { category: "Networking", type: "Public/Private Subnets", required: true },
            { category: "Security", type: "Web Application Firewall (WAF)", required: true },
            { category: "Compute", type: "Load Balancer", required: true },
            { category: "Compute", type: "Application Server Cluster", required: true },
            { category: "Database", type: "Relational Database Service", required: true },
            { category: "Caching", type: "In-Memory Data Store", required: false },
            { category: "Observability", type: "Centralized Logging & Monitoring", required: true }
        ]
    },
    "SERVERLESS_API": {
        id: "SERVERLESS_API",
        description: "Event-Driven Serverless Architecture",
        modules: [
            { category: "Networking", type: "API Gateway", required: true },
            { category: "Compute", type: "Function-as-a-Service (FaaS)", required: true },
            { category: "Database", type: "NoSQL Document Store", required: true },
            { category: "Storage", type: "Object Storage Blob", required: true },
            { category: "Observability", type: "Distributed Tracing", required: true },
            { category: "Security", type: "Identity & Access Management (IAM)", required: true }
        ]
    },
    "DATA_ANALYTICS": {
        id: "DATA_ANALYTICS",
        description: "High-Throughput Data Pipeline",
        modules: [
            { category: "Ingestion", type: "Streaming Event Queue", required: true },
            { category: "Compute", type: "Batch Processing Cluster", required: true },
            { category: "Storage", type: "Data Warehouse", required: true },
            { category: "Storage", type: "Data Lake (Raw Storage)", required: true },
            { category: "Observability", type: "Metrics Dashboard", required: true }
        ]
    },
    "MICROSERVICES_K8S": {
        id: "MICROSERVICES_K8S",
        description: "Containerized Microservices on Kubernetes",
        modules: [
            { category: "Networking", type: "Ingress Controller", required: true },
            { category: "Compute", type: "Container Orchestration Cluster", required: true },
            { category: "Registry", type: "Container Image Registry", required: true },
            { category: "Database", type: "Distributed Database", required: true },
            { category: "Observability", type: "Service Mesh / Tracing", required: true },
            { category: "Security", type: "Network Policies", required: true }
        ]
    }
};

const DATA_CLASSES = {
    "healthcare": { level: "PHI", controls: ["encryption_at_rest", "audit_logs", "dedicated_tenancy"] },
    "fintech": { level: "PCI", controls: ["network_isolation", "tokenization", "encryption_in_transit"] },
    "ecommerce": { level: "PII", controls: ["encryption_at_rest", "waf"] },
    "general": { level: "Standard", controls: ["basic_firewall"] }
};

/**
 * Layer 1: Deterministic Workload Classifier
 */
const classifyWorkload = (intentTags) => {
    // intentTags is an array of strings like ["real-time", "analytics", "dashboard"]

    if (intentTags.includes("streaming") || intentTags.includes("video") || intentTags.includes("gaming")) {
        return "latency_critical";
    }
    if (intentTags.includes("analytics") || intentTags.includes("pipeline") || intentTags.includes("big_data")) {
        return "throughput_optimized";
    }
    if (intentTags.includes("microservices") || intentTags.includes("complex_custom_app")) {
        return "containerized_scaling";
    }
    if (intentTags.includes("api") || intentTags.includes("event_driven") || intentTags.includes("mvp")) {
        return "serverless_efficiency";
    }

    return "balanced_web"; // Default
};

/**
 * Layer 2: Architecture Pattern Resolver
 */
const resolvePattern = (workloadType) => {
    switch (workloadType) {
        case "latency_critical":
        case "containerized_scaling":
            return ARCH_PATTERNS.MICROSERVICES_K8S;
        case "throughput_optimized":
            return ARCH_PATTERNS.DATA_ANALYTICS;
        case "serverless_efficiency":
            return ARCH_PATTERNS.SERVERLESS_API;
        case "balanced_web":
        default:
            return ARCH_PATTERNS.WEB_STANDARD;
    }
};

/**
 * Layer 4: Compliance Engine
 */
const getComplianceRequirements = (intentTags) => {
    if (intentTags.includes("healthcare") || intentTags.includes("medical")) return DATA_CLASSES.healthcare;
    if (intentTags.includes("finance") || intentTags.includes("banking") || intentTags.includes("payments")) return DATA_CLASSES.fintech;
    if (intentTags.includes("ecommerce") || intentTags.includes("shop")) return DATA_CLASSES.ecommerce;

    return DATA_CLASSES.general;
};

module.exports = {
    ARCH_PATTERNS,
    classifyWorkload,
    resolvePattern,
    getComplianceRequirements
};
