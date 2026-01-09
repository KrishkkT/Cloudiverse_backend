/**
 * serviceDisplay.js
 * Maps canonical service types to user-friendly display format
 * Used by architecture display endpoint
 */

const SERVICE_DISPLAY = {
    // Traffic / Networking
    "cdn": { name: "CDN", category: "traffic", icon: "cloud", description: "Content Delivery Network" },
    "api_gateway": { name: "API Gateway", category: "traffic", icon: "cloud", description: "API routing & throttling" },
    "load_balancer": { name: "Load Balancer", category: "traffic", icon: "cloud", description: "Traffic distribution" },
    "global_load_balancer": { name: "Global Load Balancer", category: "traffic", icon: "globe", description: "Multi-region routing" },
    "websockets": { name: "WebSockets", category: "traffic", icon: "link", description: "Real-time connections" },

    // Compute
    "app_compute": { name: "App Compute", category: "compute", icon: "server", description: "Application servers" },
    "compute_serverless": { name: "Serverless Compute", category: "compute", icon: "zap", description: "Event-driven functions" },
    "compute_cluster": { name: "Compute Cluster", category: "compute", icon: "server", description: "Container orchestration" },
    "ml_inference": { name: "ML Inference", category: "ai", icon: "brain", description: "Model serving" },
    "ml_inference_gpu": { name: "ML Inference (GPU)", category: "ai", icon: "brain", description: "GPU-accelerated inference" },
    "serverless_compute": { name: "Serverless Compute", category: "compute", icon: "zap", description: "Event-driven functions" },

    // Data / Storage
    "relational_database": { name: "Relational Database", category: "data", icon: "database", description: "SQL database (encrypted)" },
    "object_storage": { name: "Object Storage", category: "data", icon: "folder", description: "File & asset storage" },
    "document_storage": { name: "Document Storage", category: "data", icon: "file", description: "Document database" },
    "time_series_db": { name: "Time Series DB", category: "data", icon: "activity", description: "Metrics & telemetry" },
    "vector_db": { name: "Vector Database", category: "data", icon: "grid", description: "Embeddings storage" },
    "vector_database": { name: "Vector Database", category: "data", icon: "grid", description: "ML embeddings storage" },
    "image_storage": { name: "Image Storage", category: "data", icon: "image", description: "Optimized image storage" },
    "cache": { name: "Cache", category: "data", icon: "flash", description: "In-memory caching" },
    "caching_layer": { name: "Caching Layer", category: "data", icon: "flash", description: "Low-latency caching" },

    // Security
    "identity_auth": { name: "Identity & Auth", category: "security", icon: "shield", description: "Authentication (MFA)" },
    "secrets_manager": { name: "Secrets Manager", category: "security", icon: "key", description: "Key & secret management" },
    "payment_tokenization": { name: "Payment Tokenization", category: "security", icon: "lock", description: "PCI tokenization" },
    "card_vault": { name: "Card Vault", category: "security", icon: "lock", description: "Secure card storage" },

    // Observability  
    "logging": { name: "Logging", category: "observability", icon: "list", description: "Centralized logs" },
    "monitoring": { name: "Monitoring", category: "observability", icon: "activity", description: "Metrics & alerts" },
    "audit_logging": { name: "Audit Logging", category: "observability", icon: "clipboard", description: "Compliance audit trail" },

    // Payments
    "payment_gateway": { name: "Payment Gateway", category: "payments", icon: "dollar-sign", description: "Payment processing" },

    // Messaging
    "messaging_queue": { name: "Message Queue", category: "messaging", icon: "mail", description: "Async messaging" },
    "event_bus": { name: "Event Bus", category: "messaging", icon: "radio", description: "Event streaming" },
    "event_streaming": { name: "Event Streaming", category: "messaging", icon: "radio", description: "Real-time event pipeline" },

    // Networking
    "network_segmentation": { name: "Network Segmentation", category: "networking", icon: "shield", description: "PCI network isolation" },

    // IoT
    "iot_core": { name: "IoT Core", category: "iot", icon: "cpu", description: "Device management" },
    "time_series_db": { name: "Time Series DB", category: "data", icon: "activity", description: "Telemetry storage" },
    "sms_alerts": { name: "SMS Alerts", category: "notifications", icon: "phone", description: "SMS notifications" },
    "data_lake": { name: "Data Lake", category: "data", icon: "database", description: "Raw data storage" },

    // AI / ML
    "multi_region_db": { name: "Multi-Region DB", category: "data", icon: "globe", description: "Globally replicated database" }
};



/**
 * Generate display-ready service list from canonical services
 * @param {Array} services - Array of service objects with canonical_type
 * @returns {Array} - Display-ready service objects
 */
function generateServiceDisplay(services) {
    if (!services || !Array.isArray(services)) {
        return [];
    }

    return services.map(svc => {
        const canonical_type = svc.canonical_type || svc;
        const display = SERVICE_DISPLAY[canonical_type] || {
            name: canonical_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            category: "other",
            icon: "cloud",
            description: canonical_type
        };

        return {
            id: svc.id || canonical_type,
            icon: display.icon,
            name: display.name,
            category: display.category,
            description: display.description,
            canonical_type: canonical_type
        };
    });
}

/**
 * Group services by category for tiered display
 * @param {Array} services - Display-ready services
 * @returns {Object} - Services grouped by category
 */
function groupServicesByCategory(services) {
    const groups = {
        traffic: [],
        compute: [],
        ai: [],
        data: [],
        security: [],
        observability: [],
        payments: [],
        messaging: [],
        networking: [],
        notifications: [],
        iot: [],
        other: []
    };


    services.forEach(svc => {
        const category = svc.category || 'other';
        if (groups[category]) {
            groups[category].push(svc);
        } else {
            groups.other.push(svc);
        }
    });

    // Remove empty categories
    Object.keys(groups).forEach(key => {
        if (groups[key].length === 0) {
            delete groups[key];
        }
    });

    return groups;
}

/**
 * Get category display name
 * @param {string} category - Category key
 * @returns {string} - Display name
 */
function getCategoryDisplayName(category) {
    const names = {
        traffic: "Traffic & Networking",
        compute: "Compute",
        ai: "AI & Machine Learning",
        data: "Data & Storage",
        security: "Security",
        observability: "Observability",
        payments: "Payments",
        messaging: "Messaging",
        networking: "Network Security",
        notifications: "Notifications",
        iot: "IoT",
        other: "Other Services"
    };
    return names[category] || category;
}


module.exports = {
    SERVICE_DISPLAY,
    generateServiceDisplay,
    groupServicesByCategory,
    getCategoryDisplayName
};
