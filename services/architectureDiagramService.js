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
    
    // Validate that we have canonical services
    const services = canonicalArchitecture.services || [];
    if (services.length === 0) {
        console.error('[MAP TO PROVIDER] No services in canonical architecture');
        throw new Error('Canonical architecture must include services');
    }
    
    // CRITICAL VALIDATION: Minimum service count check per V1 Pattern Catalog
    const minServicesByPattern = {
        'STATIC_SITE': 2, // object_storage, cdn
        'STATIC_SITE_WITH_AUTH': 3, // + identity_auth
        'SERVERLESS_API': 2, // api_gateway, serverless_compute
        'SERVERLESS_WEB_APP': 4, // cdn, api_gateway, serverless_compute, object_storage
        'STATEFUL_WEB_PLATFORM': 6, // load_balancer, app_compute, relational_database, identity_auth, logging, monitoring
        'HYBRID_PLATFORM': 6, // load_balancer, app_compute + serverless_compute, relational_database, logging, monitoring
        'MOBILE_BACKEND_PLATFORM': 4, // api_gateway, serverless_compute, relational_database, identity_auth
        'REALTIME_PLATFORM': 5, // websocket_gateway, app_compute, cache, message_queue, logging
        'DATA_PLATFORM': 4, // analytical_database, object_storage, batch_compute, logging
        'ML_INFERENCE_PLATFORM': 3, // ml_inference_service, object_storage, logging
        'ML_TRAINING_PLATFORM': 3 // batch_compute, object_storage, logging
    };
    
    const pattern = canonicalArchitecture.pattern;
    const minRequired = minServicesByPattern[pattern] || 1;
    const actualCount = services.length;
    
    if (actualCount < minRequired) {
        const error = `[DIAGRAM GENERATION FAILED] Pattern ${pattern} requires minimum ${minRequired} services, but only ${actualCount} provided. Cannot generate meaningful diagram.`;
        console.error(error);
        console.error('[DIAGRAM GENERATION FAILED] Services:', services.map(s => s.canonical_type || s.name).join(', '));
        throw new Error(error);
    }
    
    console.log(`[DIAGRAM VALIDATION] Pattern ${pattern} has ${actualCount} services (minimum: ${minRequired}) ✓`);
    
    // Build nodes for diagram from canonical services
    const nodes = [];
    const existingNodes = [];
    
    // Add client node for user-facing patterns
    const userFacingPatterns = ['SERVERLESS_WEB_APP', 'STATEFUL_WEB_PLATFORM', 'HYBRID_PLATFORM', 'CONTAINERIZED_WEB_APP'];
    if (userFacingPatterns.includes(pattern)) {
        const clientNode = {
            id: 'client',
            label: 'Users / Browser',
            type: 'client',
            category: 'client',
            position: calculateNodePosition(0, 'client', existingNodes),
            required: true,
            provider_specific: false
        };
        nodes.push(clientNode);
        existingNodes.push(clientNode);
    }
    
    // Map each canonical service to provider-specific node
    services.forEach((service, idx) => {
        const serviceType = service.canonical_type || service.service_class || service.name;
        const category = service.category || getCategoryForService(serviceType);
        
        // 🔥 CRITICAL: Mark serverless_compute role in HYBRID pattern
        let nodeLabel = getGenericServiceName(serviceType, provider.toUpperCase());
        let nodeRole = null;
        
        if (pattern === 'HYBRID_PLATFORM' && serviceType === 'serverless_compute') {
            nodeRole = 'background_worker';
            nodeLabel += ' (Background Jobs)';  // Visual distinction
            console.log('[DIAGRAM] serverless_compute marked as background_worker in HYBRID_PLATFORM');
        }
        
        const node = {
            id: serviceType,
            label: nodeLabel,
            type: serviceType,
            category: category,
            role: nodeRole,  // 🔥 ADDED: Role metadata for frontend
            position: calculateNodePosition(idx + nodes.length, category, existingNodes),
            required: service.required !== false,
            provider_specific: true
        };
        nodes.push(node);
        existingNodes.push(node);
    });
    
    console.log(`[MAP TO PROVIDER] Generated ${nodes.length} nodes for ${provider}`);
    
    // Generate edges based on pattern and services
    const edges = generateEdgesForPattern(pattern, nodes);
    console.log(`[MAP TO PROVIDER] Generated ${edges.length} edges`);
    
    return {
        ...canonicalArchitecture,
        provider: provider.toUpperCase(),
        nodes: nodes,
        edges: edges
    };
}

/**
 * Get category for a service type
 */
function getCategoryForService(serviceType) {
    const categoryMap = {
        // Compute
        'app_compute': 'compute',
        'serverless_compute': 'compute',
        'compute_container': 'compute',
        'compute_vm': 'compute',
        'batch_compute': 'compute',
        'ml_inference_service': 'compute',
        // Networking
        'cdn': 'network',
        'load_balancer': 'network',
        'api_gateway': 'network',
        'websocket_gateway': 'network',
        'networking': 'network',
        // Database
        'relational_database': 'database',
        'nosql_database': 'database',
        'analytical_database': 'database',
        'cache': 'database',
        // Storage
        'object_storage': 'storage',
        'block_storage': 'storage',
        // Messaging
        'message_queue': 'messaging',
        'messaging_queue': 'messaging',
        'event_bus': 'messaging',
        // Security
        'identity_auth': 'security',
        'authentication': 'security',
        'secrets_management': 'security',
        // Observability
        'logging': 'observability',
        'monitoring': 'observability',
        // Integration
        'payment_gateway': 'integration',
        'push_notification_service': 'integration'
    };
    return categoryMap[serviceType] || 'other';
}

/**
 * Generate edges (connections) based on pattern and available nodes
 */
function generateEdgesForPattern(pattern, nodes) {
    const edges = [];
    const nodeIds = nodes.map(n => n.id);
    const hasNode = (id) => nodeIds.includes(id);
    
    // Helper to add edge
    const addEdge = (from, to, label = 'connects') => {
        if (hasNode(from) && hasNode(to)) {
            edges.push({
                from,
                to,
                label,
                type: 'directional'
            });
        }
    };
    
    // Pattern-specific edge generation
    switch (pattern) {
        case 'STATEFUL_WEB_PLATFORM':
        case 'HYBRID_PLATFORM':
        case 'CONTAINERIZED_WEB_APP':
            // User → CDN → Load Balancer → App Compute
            if (hasNode('client')) {
                if (hasNode('cdn')) {
                    addEdge('client', 'cdn', 'requests');
                    addEdge('cdn', 'load_balancer', 'routes');
                } else {
                    addEdge('client', 'load_balancer', 'requests');
                }
            }
            addEdge('load_balancer', 'app_compute', 'distributes');
            
            // App Compute connections
            addEdge('app_compute', 'relational_database', 'reads/writes');
            addEdge('app_compute', 'cache', 'caches');
            addEdge('app_compute', 'object_storage', 'stores');
            addEdge('app_compute', 'identity_auth', 'authenticates');
            addEdge('app_compute', 'message_queue', 'queues');
            addEdge('app_compute', 'messaging_queue', 'queues');
            addEdge('app_compute', 'payment_gateway', 'processes');
            addEdge('app_compute', 'logging', 'logs');
            addEdge('app_compute', 'monitoring', 'metrics');
            
            // Background workers (if hybrid)
            if (pattern === 'HYBRID_PLATFORM' && hasNode('serverless_compute')) {
                addEdge('message_queue', 'serverless_compute', 'triggers');
                addEdge('messaging_queue', 'serverless_compute', 'triggers');
                addEdge('serverless_compute', 'relational_database', 'reads/writes');
                addEdge('serverless_compute', 'object_storage', 'processes');
            }
            break;
            
        case 'SERVERLESS_WEB_APP':
        case 'SERVERLESS_API':
            // User → CDN (for web) or API Gateway (for API)
            if (hasNode('client')) {
                if (hasNode('cdn')) {
                    addEdge('client', 'cdn', 'requests');
                    addEdge('cdn', 'api_gateway', 'routes');
                } else {
                    addEdge('client', 'api_gateway', 'requests');
                }
            }
            addEdge('api_gateway', 'serverless_compute', 'invokes');
            
            // Serverless connections
            addEdge('serverless_compute', 'relational_database', 'reads/writes');
            addEdge('serverless_compute', 'nosql_database', 'reads/writes');
            addEdge('serverless_compute', 'cache', 'caches');
            addEdge('serverless_compute', 'object_storage', 'stores');
            addEdge('serverless_compute', 'identity_auth', 'authenticates');
            addEdge('serverless_compute', 'logging', 'logs');
            addEdge('serverless_compute', 'monitoring', 'metrics');
            break;
            
        case 'MOBILE_BACKEND_PLATFORM':
            // Mobile App → API Gateway → Serverless
            if (hasNode('client')) {
                addEdge('client', 'api_gateway', 'API calls');
            }
            addEdge('api_gateway', 'serverless_compute', 'invokes');
            addEdge('serverless_compute', 'relational_database', 'reads/writes');
            addEdge('serverless_compute', 'identity_auth', 'authenticates');
            addEdge('serverless_compute', 'cache', 'caches');
            addEdge('serverless_compute', 'push_notification_service', 'sends');
            addEdge('serverless_compute', 'logging', 'logs');
            break;
            
        case 'DATA_PLATFORM':
            // Batch Compute → Data Storage/Database
            addEdge('batch_compute', 'object_storage', 'reads/writes');
            addEdge('batch_compute', 'analytical_database', 'loads');
            addEdge('object_storage', 'analytical_database', 'imports');
            addEdge('batch_compute', 'logging', 'logs');
            addEdge('batch_compute', 'monitoring', 'metrics');
            if (hasNode('message_queue')) {
                addEdge('message_queue', 'batch_compute', 'triggers');
            }
            break;
            
        case 'STATIC_SITE':
            // User → CDN → Object Storage
            if (hasNode('client')) {
                addEdge('client', 'cdn', 'requests');
            }
            addEdge('cdn', 'object_storage', 'serves');
            if (hasNode('identity_auth')) {
                addEdge('object_storage', 'identity_auth', 'authenticates');
            }
            break;
            
        default:
            // Generic fallback edges
            console.warn(`[EDGES] No specific edge pattern for ${pattern}, generating generic edges`);
            break;
    }
    
    return edges;
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
        'serverless_compute': {
            'AWS': 'Lambda Function',
            'GCP': 'Cloud Functions',
            'AZURE': 'Azure Functions'
        },
        'app_compute': {  // 🔥 ADDED (was missing)
            'AWS': 'ECS/Fargate',
            'GCP': 'Cloud Run',
            'AZURE': 'Container Instances'
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
        },
        'logging': {  // 🔥 ADDED
            'AWS': 'CloudWatch Logs',
            'GCP': 'Cloud Logging',
            'AZURE': 'Azure Monitor Logs'
        },
        'monitoring': {  // 🔥 ADDED
            'AWS': 'CloudWatch',
            'GCP': 'Cloud Monitoring',
            'AZURE': 'Azure Monitor'
        },
        'payment_gateway': {  // 🔥 ADDED
            'AWS': 'Lambda + Stripe',
            'GCP': 'Cloud Function + Stripe',
            'AZURE': 'Function + Stripe'
        },
        'websocket_gateway': {  // 🔥 ADDED
            'AWS': 'API Gateway WebSocket',
            'GCP': 'Cloud Endpoints',
            'AZURE': 'SignalR Service'
        },
        'ml_inference_service': {  // 🔥 ADDED
            'AWS': 'SageMaker Endpoint',
            'GCP': 'Vertex AI',
            'AZURE': 'Azure ML'
        },
        'batch_compute': {  // 🔥 ADDED
            'AWS': 'AWS Batch',
            'GCP': 'Cloud Dataflow',
            'AZURE': 'Azure Batch'
        },
        'analytical_database': {  // 🔥 ADDED
            'AWS': 'Redshift',
            'GCP': 'BigQuery',
            'AZURE': 'Synapse Analytics'
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