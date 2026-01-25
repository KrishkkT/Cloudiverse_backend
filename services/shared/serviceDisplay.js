/**
 * serviceDisplay.js
 * Maps canonical service types to user-friendly display format
 * Used by architecture display endpoint
 */

const SERVICE_DISPLAY = {
    // Traffic / Networking
    "cdn": { name: "CDN", category: "traffic", icon: "cloud", description: "Content Delivery Network" },
    "apigateway": { name: "API Gateway", category: "traffic", icon: "cloud", description: "API routing & throttling" },
    "loadbalancer": { name: "Load Balancer", category: "traffic", icon: "cloud", description: "Traffic distribution" },
    "globalloadbalancer": { name: "Global Load Balancer", category: "traffic", icon: "globe", description: "Multi-region routing" },
    "websockets": { name: "WebSockets", category: "traffic", icon: "link", description: "Real-time connections" },
    "dns": { name: "DNS", category: "traffic", icon: "globe", description: "Domain Name System" },
    "websocketgateway": { name: "WebSocket Gateway", category: "traffic", icon: "radio-tower", description: "Real-time socket management" },

    // Compute
    "appcompute": { name: "App Compute", category: "compute", icon: "server", description: "Application servers" },
    "computeserverless": { name: "Serverless Compute", category: "compute", icon: "zap", description: "Event-driven functions" },
    "computecluster": { name: "Compute Cluster", category: "compute", icon: "server", description: "Container orchestration" },
    "mlinference": { name: "ML Inference", category: "ai", icon: "brain", description: "Model serving" },
    "mlinferencegpu": { name: "ML Inference (GPU)", category: "ai", icon: "brain", description: "GPU-accelerated inference" },
    "computecontainer": { name: "App Container", category: "compute", icon: "server", description: "Containerized application runtime" },

    // Data / Storage
    "relationaldatabase": { name: "Relational Database", category: "data", icon: "database", description: "SQL database (encrypted)" },
    "objectstorage": { name: "Object Storage", category: "data", icon: "folder", description: "File & asset storage" },
    "block_storage": { name: "Block Storage", category: "data", icon: "hard-drive", description: "Persistent disk volume" },
    "documentstorage": { name: "Document Storage", category: "data", icon: "file", description: "Document database" },
    "timeseriesdb": { name: "Time Series DB", category: "data", icon: "activity", description: "Metrics & telemetry" },
    "vectordb": { name: "Vector Database", category: "data", icon: "grid", description: "Embeddings storage" },
    "vectordatabase": { name: "Vector Database", category: "data", icon: "grid", description: "ML embeddings storage" },
    "imagestorage": { name: "Image Storage", category: "data", icon: "image", description: "Optimized image storage" },
    "cache": { name: "Cache", category: "data", icon: "flash", description: "In-memory caching" },
    "cachinglayer": { name: "Caching Layer", category: "data", icon: "flash", description: "Low-latency caching" },

    // Security
    "identityauth": { name: "Identity & Auth", category: "security", icon: "shield", description: "Authentication (MFA)" },
    "secretsmanager": { name: "Secrets Manager", category: "security", icon: "key", description: "Key & secret management" },
    "paymenttokenization": { name: "Payment Tokenization", category: "security", icon: "lock", description: "PCI tokenization" },
    "cardvault": { name: "Card Vault", category: "security", icon: "lock", description: "Secure card storage" },
    "waf": { name: "WAF", category: "security", icon: "shield", description: "Web Application Firewall" },
    "secretsmanagement": { name: "Secrets Manager", category: "security", icon: "key", description: "Secure secrets storage" },

    // Observability  
    "logging": { name: "Logging", category: "observability", icon: "list", description: "Centralized logs" },
    "monitoring": { name: "Monitoring", category: "observability", icon: "activity", description: "Metrics & alerts" },
    "auditlogging": { name: "Audit Logging", category: "observability", icon: "clipboard", description: "Compliance audit trail" },

    // Payments
    "paymentgateway": { name: "Payment Gateway", category: "payments", icon: "dollar-sign", description: "Payment processing" },

    // Messaging
    "messagequeue": { name: "Message Queue", category: "messaging", icon: "mail", description: "Async messaging" },
    "eventbus": { name: "Event Bus", category: "messaging", icon: "radio", description: "Event streaming" },
    "eventstreaming": { name: "Event Streaming", category: "messaging", icon: "radio", description: "Real-time event pipeline" },

    // Networking
    "networksegmentation": { name: "Network Segmentation", category: "networking", icon: "shield", description: "PCI network isolation" },

    // IoT
    "iotcore": { name: "IoT Core", category: "iot", icon: "cpu", description: "Device management" },
    "timeseriesdb": { name: "Time Series DB", category: "data", icon: "activity", description: "Telemetry storage" },
    "smsalerts": { name: "SMS Alerts", category: "notifications", icon: "phone", description: "SMS notifications" },
    "datalake": { name: "Data Lake", category: "data", icon: "database", description: "Raw data storage" },

    // AI / ML
    "multiregiondb": { name: "Multi-Region DB", category: "data", icon: "globe", description: "Globally replicated database" }
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
        const canonical_type = (svc.canonical_type || svc).toLowerCase().trim(); // Ensure lowercase and trim
        console.log(`[DISPLAY DEBUG] Looking up service: '${canonical_type}'`);
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
