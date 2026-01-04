/**
 * ARCHITECTURE DIAGRAM SERVICE
 * 
 * Generates architecture diagrams from CANONICAL SERVICES CONTRACT
 * 
 * CRITICAL PRINCIPLE:
 * - Input: Canonical architecture with services_contract
 * - Process: Map to provider, build graph
 * - Output: Provider-specific diagram JSON
 * - NO inference, NO guessing, ONLY reads from canonical contract
 */

const { SERVICE_MAP } = require('./costResultModel');
const patternResolver = require('./patternResolver');
const providerMappingService = require('./providerMappingService');

/**
 * Service Registry - Static infrastructure knowledge
 */
const SERVICE_REGISTRY = {
    client: {
        role: "user_interface",
        required_for: ["user_facing"],
        category: "client",
        label: "Users / Browser",
        connects_to: ["cdn", "api_gateway", "load_balancer"]
    },
    cdn: {
        role: "edge_delivery",
        required_for: ["static_content", "user_facing"],
        category: "network",
        label: "CDN",
        connects_to: ["compute", "storage"]
    },
    compute_serverless: {
        role: "execution",
        required_for: ["api_backend", "serverless"],
        category: "compute",
        label: "Serverless Compute",
        connects_to: ["storage", "auth", "database", "cache"]
    },
    compute_container: {
        role: "execution",
        required_for: ["containerized"],
        category: "compute",
        label: "Containers",
        connects_to: ["storage", "auth", "database", "cache"]
    },
    compute_vm: {
        role: "execution",
        required_for: ["traditional", "full_control"],
        category: "compute",
        label: "Virtual Machines",
        connects_to: ["storage", "auth", "database", "cache"]
    },
    api_gateway: {
        role: "routing",
        required_for: ["api_backend"],
        category: "network",
        label: "API Gateway",
        connects_to: ["compute"]
    },
    load_balancer: {
        role: "distribution",
        required_for: ["high_availability", "scale"],
        category: "network",
        label: "Load Balancer",
        connects_to: ["compute"]
    },
    identity_auth: {
        role: "security",
        required_for: ["user_authentication"],
        category: "security",
        label: "Identity Auth",
        connects_to: ["compute"]
    },
    object_storage: {
        role: "storage",
        required_for: ["static_assets", "file_storage"],
        category: "storage",
        label: "Object Storage",
        connects_to: ["compute"]
    },
    block_storage: {
        role: "storage",
        required_for: ["vm_attached"],
        category: "storage",
        label: "Block Storage",
        connects_to: ["vm"]
    },
    relational_database: {
        role: "state",
        required_for: ["stateful", "transactions"],
        category: "database",
        label: "Relational Database",
        connects_to: ["compute"],
        optional_for: ["no_database"]
    },
    nosql_database: {
        role: "state",
        required_for: ["document_storage", "scale"],
        category: "database",
        label: "NoSQL Database",
        connects_to: ["compute"],
        optional_for: ["no_database"]
    },
    cache: {
        role: "performance",
        required_for: ["read_heavy"],
        category: "database",
        label: "Cache",
        connects_to: ["compute", "database"]
    },
    message_queue: {
        role: "async_processing",
        required_for: ["background_jobs"],
        category: "messaging",
        label: "Message Queue",
        connects_to: ["compute"]
    }
};

/**
 * Generate canonical architecture model based on pattern and project signals
 * DEPRECATED: Use patternResolver.generateCanonicalArchitecture instead
 */
function generateCanonicalArchitecture(infraSpec, usageProfile = {}) {
    console.warn('[DEPRECATED] Use patternResolver.generateCanonicalArchitecture instead');
    const pattern = infraSpec.architecture_pattern || 'SERVERLESS_WEB_APP';
    const intent = infraSpec.locked_intent?.intent_classification?.project_description || '';
    
    // Use the pattern resolver to extract requirements and generate architecture
    const requirements = patternResolver.extractRequirements(intent);
    const canonicalArchitecture = patternResolver.generateCanonicalArchitecture(requirements, pattern);
    
    return canonicalArchitecture;
}

/**
 * Extract project signals from infraSpec and usageProfile
 */
function extractProjectSignals(infraSpec, usageProfile = {}) {
    const features = infraSpec.features || {};
    const exclude = infraSpec.exclude || [];
    
    return {
        user_facing: !exclude.includes('frontend'),
        static_content: !exclude.includes('static_files'),
        api_backend: features.api || features.backend,
        serverless: infraSpec.architecture_pattern === 'SERVERLESS_WEB_APP',
        containerized: infraSpec.architecture_pattern === 'CONTAINERIZED_WEB_APP',
        traditional: infraSpec.architecture_pattern === 'TRADITIONAL_VM_APP',
        full_control: infraSpec.architecture_pattern === 'TRADITIONAL_VM_APP',
        user_authentication: features.auth || features.multi_user_roles,
        static_assets: features.file_upload || features.static_content,
        stateful: features.stateful || features.database,
        transactions: features.payments || features.database,
        no_database: exclude.includes('database') || !features.database,
        high_availability: features.high_availability || usageProfile?.monthly_users?.max > 10000,
        scale: usageProfile?.monthly_users?.max > 1000,
        read_heavy: usageProfile?.data_transfer_gb?.max > 100,
        background_jobs: features.background_jobs || features.real_time,
        vm_attached: infraSpec.architecture_pattern === 'TRADITIONAL_VM_APP' && features.file_storage
    };
}

/**
 * Select services based on project signals
 */
function selectServicesFromSignals(signals) {
    let selectedServices = [];
    
    for (const [serviceType, meta] of Object.entries(SERVICE_REGISTRY)) {
        // Check if service is required for any of the signals
        if (meta.required_for?.some(f => signals[f])) {
            selectedServices.push(serviceType);
        }
    }
    
    // Handle exclusions
    if (signals.no_database) {
        selectedServices = selectedServices.filter(
            s => !s.includes("database")
        );
    }
    
    // Add default services if not excluded
    if (signals.user_facing && !selectedServices.includes('client')) {
        selectedServices.unshift('client');
    }
    
    return selectedServices;
}

/**
 * Generate connection label based on service types
 */
function generateConnectionLabel(from, to) {
    const connectionLabels = {
        'client-cdn': 'requests',
        'cdn-client': 'serves',
        'client-api_gateway': 'API calls',
        'api_gateway-client': 'responses',
        'cdn-compute': 'routes',
        'compute-cdn': 'updates',
        'compute-storage': 'reads/writes',
        'storage-compute': 'provides',
        'compute-auth': 'authenticates',
        'auth-compute': 'validates',
        'compute-database': 'reads/writes',
        'database-compute': 'stores/retrieves',
        'compute-cache': 'caches',
        'cache-compute': 'serves',
        'compute-message_queue': 'queues',
        'message_queue-compute': 'processes',
        'client-load_balancer': 'requests',
        'load_balancer-client': 'distributes',
        'load_balancer-compute': 'distributes',
        'compute-load_balancer': 'registers',
    };
    
    const key = `${from}-${to}`;
    return connectionLabels[key] || 'connects';
}



/**
 * Map canonical architecture to provider-specific services
 * NOW USES CANONICAL SERVICES CONTRACT as single source of truth
 */
function mapToProvider(canonicalArchitecture, provider) {
    console.log(`[MAP TO PROVIDER] Mapping ${canonicalArchitecture.pattern} to ${provider}`);
    
    // Validate that we have the canonical services contract
    if (!canonicalArchitecture.services_contract) {
        console.error('[MAP TO PROVIDER] Missing services_contract in canonical architecture');
        throw new Error('Canonical architecture must include services_contract');
    }
    
    // Use the provider mapping service to map canonical services to provider
    const providerArchitecture = providerMappingService.mapCanonicalToProvider(
        canonicalArchitecture.services_contract,
        provider
    );
    
    // Validate the mapping
    providerMappingService.validateProviderMapping(providerArchitecture);
    
    // Build nodes for diagram from provider services
    const nodes = providerArchitecture.services.map((service, idx) => ({
        id: service.canonical_type,
        label: service.provider_service,
        type: service.canonical_type,
        category: service.category,
        position: calculateNodePosition(idx, service.category, []),
        required: service.required,
        provider_specific: true
    }));
    
    console.log(`[MAP TO PROVIDER] Generated ${nodes.length} nodes for ${provider}`);
    
    return {
        ...canonicalArchitecture,
        provider: provider.toUpperCase(),
        provider_architecture: providerArchitecture,
        nodes: nodes,
        // Keep edges from canonical architecture
        edges: canonicalArchitecture.edges || []
    };
}

/**
 * Get a generic provider-specific service name based on service type and category
 */
function getGenericServiceName(serviceType, provider) {
    const serviceMap = {
        'relational_database': {
            'AWS': 'RDS Instance',
            'GCP': 'Cloud SQL',
            'AZURE': 'Azure SQL Database'
        },
        'nosql_database': {
            'AWS': 'DynamoDB Table',
            'GCP': 'Firestore',
            'AZURE': 'Cosmos DB'
        },
        'cache': {
            'AWS': 'ElastiCache',
            'GCP': 'Memorystore',
            'AZURE': 'Azure Cache for Redis'
        },
        'compute_serverless': {
            'AWS': 'Lambda Function',
            'GCP': 'Cloud Functions',
            'AZURE': 'Azure Functions'
        },
        'compute_container': {
            'AWS': 'ECS Container',
            'GCP': 'Cloud Run',
            'AZURE': 'Azure Container Instances'
        },
        'compute_vm': {
            'AWS': 'EC2 Instance',
            'GCP': 'Compute Engine',
            'AZURE': 'Virtual Machine'
        },
        'object_storage': {
            'AWS': 'S3 Bucket',
            'GCP': 'Cloud Storage',
            'AZURE': 'Blob Storage'
        },
        'api_gateway': {
            'AWS': 'API Gateway',
            'GCP': 'Cloud Endpoints',
            'AZURE': 'API Management'
        },
        'load_balancer': {
            'AWS': 'Application Load Balancer',
            'GCP': 'Cloud Load Balancing',
            'AZURE': 'Application Gateway'
        },
        'message_queue': {
            'AWS': 'SQS Queue',
            'GCP': 'Cloud Pub/Sub',
            'AZURE': 'Service Bus'
        },
        'identity_auth': {
            'AWS': 'Cognito',
            'GCP': 'Identity Platform',
            'AZURE': 'Azure Active Directory'
        },
        'cdn': {
            'AWS': 'CloudFront Distribution',
            'GCP': 'Cloud CDN',
            'AZURE': 'Azure CDN'
        },
        'networking': {
            'AWS': 'VPC',
            'GCP': 'Virtual Private Cloud',
            'AZURE': 'Virtual Network'
        }
    };
    
    if (serviceMap[serviceType] && serviceMap[serviceType][provider]) {
        return serviceMap[serviceType][provider];
    }
    
    // Default fallback
    return `${provider} ${serviceType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`;
}

/**
 * Generate architecture notes based on pattern and features
 */
function generateArchitectureNotes(infraSpec, usageProfile = {}, requirements = {}) {
    const notes = [];
    const features = infraSpec.features || {};
    const pattern = infraSpec.architecture_pattern || 'SERVERLESS_WEB_APP';
    
    // Add pattern-specific notes
    switch (pattern) {
        case 'SERVERLESS_WEB_APP':
            notes.push("Stateless design enables horizontal scaling");
            notes.push("Serverless compute minimizes idle cost");
            break;
        case 'STATIC_WEB_HOSTING':
            notes.push("CDN-delivered static assets for optimal performance");
            notes.push("Cost-effective for content-heavy applications");
            break;
        case 'MOBILE_BACKEND_API':
            notes.push("API Gateway handles request routing and rate limiting");
            notes.push("Serverless backend scales automatically with demand");
            break;
        case 'CONTAINERIZED_WEB_APP':
            notes.push("Container orchestration for consistent deployments");
            notes.push("Load balancing distributes traffic across instances");
            break;
        case 'TRADITIONAL_VM_APP':
            notes.push("Virtual machines provide full control over environment");
            notes.push("Persistent storage for data that survives reboots");
            break;
    }
    
    // Add requirement-specific notes
    if (requirements.stateful) {
        notes.push("Stateful design with persistent data storage");
    }
    
    if (requirements.payments) {
        notes.push("Payment processing integrated with security compliance");
    }
    
    if (requirements.realtime) {
        notes.push("Real-time capabilities for live updates and notifications");
    }
    
    if (requirements.authentication) {
        notes.push("Authentication system for user access control");
    }
    
    // Add NFR-specific notes
    if (requirements.nfr) {
        if (requirements.nfr.availability === "99.99") {
            notes.push("High availability configuration with multi-AZ deployment");
        } else if (requirements.nfr.availability === "99.9") {
            notes.push("Standard availability configuration with redundancy");
        }
        
        if (requirements.nfr.compliance && requirements.nfr.compliance.length > 0) {
            notes.push(`Compliance requirements: ${requirements.nfr.compliance.join(', ')} implemented`);
        }
        
        if (requirements.nfr.security_level === "high") {
            notes.push("Enhanced security posture with additional security services");
        }
        
        if (requirements.nfr.data_residency) {
            notes.push(`Data residency requirements: ${requirements.nfr.data_residency}`);
        }
    }
    
    // Add region-specific notes
    if (requirements.region) {
        notes.push(`Primary region: ${requirements.region.primary_region}`);
        if (requirements.region.multi_region) {
            notes.push(`Multi-region deployment enabled for availability`);
        }
    }
    
    // Add data classification notes
    if (requirements.data_classes && Object.keys(requirements.data_classes).length > 0) {
        const sensitiveDataTypes = Object.entries(requirements.data_classes)
            .filter(([_, level]) => level === 'confidential' || level === 'restricted')
            .map(([type, _]) => type);
        if (sensitiveDataTypes.length > 0) {
            notes.push(`Sensitive data handling for: ${sensitiveDataTypes.join(', ')}`);
        }
    }
    
    // Add data retention notes
    if (requirements.data_retention && Object.keys(requirements.data_retention).length > 0) {
        notes.push(`Data retention policies applied`);
    }
    
    // Add deployment strategy notes
    if (requirements.deployment_strategy) {
        notes.push(`Deployment strategy: ${requirements.deployment_strategy.charAt(0).toUpperCase() + requirements.deployment_strategy.slice(1)} update`);
    }
    
    // Add observability notes
    if (requirements.observability) {
        const obsServices = [];
        if (requirements.observability.logs) obsServices.push('logging');
        if (requirements.observability.metrics) obsServices.push('monitoring');
        if (requirements.observability.alerts) obsServices.push('alerting');
        if (obsServices.length > 0) {
            notes.push(`Observability services included: ${obsServices.join(', ')}`);
        }
    }
    
    // Add usage-based notes
    if (usageProfile?.data_transfer_gb && usageProfile.data_transfer_gb.max > 1000) {
        notes.push("High data transfer optimized with CDN and caching");
    }
    
    if (usageProfile?.monthly_users && usageProfile.monthly_users.max > 10000) {
        notes.push("Designed for high user concurrency with auto-scaling");
    }
    
    return notes;
}

/**
 * Generate services list with descriptions for the selected provider
 * NOW USES PROVIDER ARCHITECTURE from canonical contract
 */
function generateServicesList(providerArchitecture, provider) {
    console.log(`[GENERATE SERVICES LIST] Creating list for ${provider}`);
    
    // If we have provider_architecture from the mapping, use it
    if (providerArchitecture.provider_architecture) {
        return providerMappingService.generateServicesList(providerArchitecture.provider_architecture);
    }
    
    // Fallback to nodes if provider_architecture not available
    if (providerArchitecture.nodes) {
        return providerArchitecture.nodes
            .filter(node => node.type !== 'client')
            .map(node => ({
                id: node.id,
                name: node.label,
                type: node.type,
                description: getServiceDescription(node.type),
                category: node.category
            }));
    }
    
    console.warn('[GENERATE SERVICES LIST] No services found in architecture');
    return [];
}

/**
 * Get description for a service type
 */
function getServiceDescription(serviceType) {
    const descriptions = {
        'cdn': 'Global content delivery network for fast static asset delivery',
        'compute_serverless': 'Auto-scaling serverless compute for application logic',
        'identity_auth': 'User authentication and identity management service',
        'api_gateway': 'API management and request routing service',
        'compute_container': 'Container orchestration for microservices',
        'compute_vm': 'Virtual machines for full application control',
        'relational_database': 'Structured data storage with ACID compliance',
        'object_storage': 'Scalable storage for files and static assets',
        'nosql_database': 'Flexible document-based data storage',
        'cache': 'In-memory caching for improved performance',
        'load_balancer': 'Traffic distribution across multiple instances',
        'dns': 'Domain name resolution and routing',
        'block_storage': 'Persistent disk storage for VMs',
        'networking': 'Virtual network infrastructure',
        'monitoring': 'Infrastructure and application monitoring',
        'logging': 'Centralized log aggregation and analysis',
        'secrets_management': 'Secure storage and management of sensitive credentials'
    };
    
    return descriptions[serviceType] || 'Cloud infrastructure component';
}

/**
 * Calculate position for a node based on its category
 * Uses consistent layout algorithm
 */
function calculateNodePosition(index, category, existingNodes = []) {
    const categoryOffsets = {
        'client': { x: 0, y: 100 },
        'networking': { x: 200, y: 100 },
        'compute': { x: 400, y: 100 },
        'security': { x: 400, y: 250 },
        'storage': { x: 600, y: 100 },
        'database': { x: 600, y: 250 },
        'messaging': { x: 500, y: 400 },
        'observability': { x: 700, y: 400 }
    };
    
    const sameCategoryCount = existingNodes.filter(n => n.category === category).length;
    const baseOffset = categoryOffsets[category] || { x: 100 * index, y: 100 };
    
    return {
        x: baseOffset.x,
        y: baseOffset.y + (sameCategoryCount * 80)
    };
}

module.exports = {
    generateCanonicalArchitecture,
    mapToProvider,
    generateArchitectureNotes,
    generateServicesList,
    calculateNodePosition
};