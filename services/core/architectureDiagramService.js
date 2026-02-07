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

const { SERVICE_MAP } = require('../cost/costResultModel');
const { SERVICE_DISPLAY } = require('../shared/serviceDisplay');
const patternResolver = require('./patternResolver');
const providerMappingService = require('../infrastructure/providerMappingService');
const catalog = require('../../catalog/terraform/services');

/**
 * Service Registry - Static infrastructure knowledge
 * NOW DRIVEN BY CENTRAL CATALOG
 */
const SERVICE_REGISTRY = catalog;

// ⚠️ Legacy Shim (Optional): Add fake 'client' node if frontend logic expects it
if (!SERVICE_REGISTRY.client) {
    SERVICE_REGISTRY.client = {
        name: 'Users / Browser',
        category: 'client',
        role: 'user_interface',
        connects_to: ['cdn', 'api_gateway', 'load_balancer']
    };
}


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
        'client-apigateway': 'API calls',
        'apigateway-client': 'responses',
        'cdn-computeserverless': 'routes',
        'computeserverless-cdn': 'updates',
        'computeserverless-objectstorage': 'reads/writes',
        'objectstorage-computeserverless': 'provides',
        'computeserverless-identityauth': 'authenticates',
        'identityauth-computeserverless': 'validates',
        'computeserverless-relationaldatabase': 'reads/writes',
        'relationaldatabase-computeserverless': 'stores/retrieves',
        'computeserverless-cache': 'caches',
        'cache-computeserverless': 'serves',
        'computeserverless-messagequeue': 'queues',
        'messagequeue-computeserverless': 'processes',
        'client-loadbalancer': 'requests',
        'loadbalancer-client': 'distributes',
        'loadbalancer-computecontainer': 'distributes',
        'computecontainer-loadbalancer': 'registers',
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
    let services = canonicalArchitecture.services || [];

    // 🔥 FIX: Filter out services that were removed (USER_DISABLED)
    // The canonical architecture preserves them for undo, but diagram must ignore them.
    services = services.filter(s => s.state !== 'USER_DISABLED' && s.state !== 'EXCLUDED');

    if (services.length === 0) {
        console.error('[MAP TO PROVIDER] No services in canonical architecture (after filtering disabled)');
        // Warn instead of throw? Or throw if required.
        // If user removed everything, that's an edge case.
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
    const userFacingPatterns = ['SERVERLESS_WEB_APP', 'STATEFUL_WEB_PLATFORM', 'HYBRID_PLATFORM', 'CONTAINERIZED_WEB_APP', 'HIGH_AVAILABILITY_PLATFORM', 'STATIC_WEB_HOSTING'];
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
        // 🔥 CRITICAL FIX: Skip services marked as disabled by user
        if (service.state === 'USER_DISABLED' || service.state === 'REMOVED' || service.state === 'EXCLUDED' || service.excluded === true) {
            console.log(`[MAP TO PROVIDER] Skipping disabled service: ${service.name}`);
            return;
        }

        const serviceType = service.canonical_type || service.service_class || service.name;
        const category = service.category || getCategoryForService(serviceType);

        // 🔥 CRITICAL: Mark serverless_compute role in HYBRID pattern
        let nodeLabel = getGenericServiceName(serviceType, provider.toUpperCase());
        let nodeRole = null;

        if (pattern === 'HYBRID_PLATFORM' && serviceType === 'computeserverless') {
            nodeRole = 'background_worker';
            nodeLabel += ' (Background Jobs)';  // Visual distinction
            console.log('[DIAGRAM] computeserverless marked as background_worker in HYBRID_PLATFORM');
        }

        const node = {
            id: serviceType,
            label: nodeLabel,
            type: serviceType,
            category: category,
            role: nodeRole,  // 🔥 ADDED: Role metadata for frontend
            position: calculateNodePosition(idx + nodes.length, category, existingNodes),
            required: service.required !== false,
            state: service.state || 'OPTIONAL', // 🔥 ADDED: Pass state (MANDATORY, OPTIONAL, EXTERNAL) to frontend
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
        'computecontainer': 'compute',
        'computeserverless': 'compute',
        'computevm': 'compute',
        'computebatch': 'compute',
        'mlinference': 'compute',
        // Networking
        'cdn': 'network',
        'loadbalancer': 'network',
        'apigateway': 'network',
        'websocketgateway': 'network',
        'vpcnetworking': 'network',
        // Database
        'relationaldatabase': 'database',
        'nosqldatabase': 'database',
        'analyticaldatabase': 'database',
        'cache': 'database',
        // Storage
        'objectstorage': 'storage',
        'blockstorage': 'storage',
        // Messaging
        'messagequeue': 'messaging',
        'eventbus': 'messaging',
        // Security
        'identityauth': 'security',
        'secretsmanagement': 'security',
        // Observability
        'logging': 'observability',
        'monitoring': 'observability',
        // Integration
        'paymentgateway': 'integration',
        'pushnotificationservice': 'integration'
    };
    return categoryMap[serviceType] || 'other';
}

/**
 * Generate edges (connections) based on pattern and available nodes
 * 🔥 ENHANCED: Added more patterns and fallback for orphan nodes
 */
function generateEdgesForPattern(pattern, nodes) {
    const edges = [];
    const nodeIds = nodes.map(n => n.id);
    const hasNode = (id) => nodeIds.includes(id);
    const connectedNodes = new Set();

    // Helper to add edge and track connected nodes
    const addEdge = (from, to, label = 'connects') => {
        if (hasNode(from) && hasNode(to)) {
            edges.push({
                from,
                to,
                label,
                type: 'directional'
            });
            connectedNodes.add(from);
            connectedNodes.add(to);
        }
    };

    // Pattern-specific edge generation
    // ═══════════════════════════════════════════════════════════════════════════
    // DYNAMIC EDGE GENERATION (Catalog-Driven)
    // ═══════════════════════════════════════════════════════════════════════════

    // 1. Try to load pattern definition
    const patterns = require('../../catalog/patterns/index');
    const patternDef = patterns[pattern];

    if (patternDef && patternDef.edges) {
        // Option A: Pattern defines its own edges explicitly (V2)
        patternDef.edges.forEach(edge => {
            addEdge(edge.from, edge.to, edge.label);
        });
    } else {
        // Option B: Generic Fallback (V1 Legacy Support)

        // Connect frontend -> ingress
        if (hasNode('cdn')) addEdge('client', 'cdn', 'requests');
        else if (hasNode('apigateway')) addEdge('client', 'apigateway', 'requests');
        else if (hasNode('loadbalancer')) addEdge('client', 'loadbalancer', 'requests');
        else if (hasNode('websocketgateway')) addEdge('client', 'websocketgateway', 'connects');


        // STATIC SITE / CDN PATTERN: Connect CDN -> Storage
        if (hasNode('cdn') && hasNode('objectstorage')) {
            addEdge('cdn', 'objectstorage', 'origins from');
        }

        // Connect ingress -> compute
        ['apigateway', 'loadbalancer', 'websocketgateway'].forEach(ingress => {
            if (hasNode(ingress)) {
                ['computeserverless', 'computecontainer', 'computevm', 'kubernetescluster'].forEach(comp => {
                    addEdge(ingress, comp, 'routes to');
                });
            }
        });

        // Connect compute -> downstream
        ['computeserverless', 'computecontainer', 'computevm', 'kubernetescluster'].forEach(comp => {
            if (hasNode(comp)) {
                ['relationaldatabase', 'nosqldatabase', 'cache', 'objectstorage', 'messagequeue', 'eventbus'].forEach(data => {
                    addEdge(comp, data, 'persists/reads');
                });
            }
        });

        // Logging/Monitoring (Universal)
        nodeIds.forEach(id => {
            if (id !== 'logging' && id !== 'monitoring' && id !== 'client') {
                if (hasNode('logging')) addEdge(id, 'logging', 'logs');
                if (hasNode('monitoring')) addEdge(id, 'monitoring', 'metrics');
            }
        });

        console.warn(`[EDGES] Generated generic edges for ${pattern} (Upgrade catalog to include explicit edges)`);
    }




    // 🔥 FALLBACK: Connect any orphan nodes to the nearest compute node
    const computeNodes = ['computecontainer', 'computeserverless', 'computebatch', 'mlinference'];
    const primaryCompute = computeNodes.find(c => hasNode(c)) || null;

    if (primaryCompute) {
        nodeIds.forEach(nodeId => {
            if (!connectedNodes.has(nodeId) && nodeId !== 'client' && nodeId !== primaryCompute) {
                console.log(`[EDGES] Connecting orphan node: ${nodeId} → ${primaryCompute}`);
                addEdge(primaryCompute, nodeId, 'uses');
            }
        });
    }

    return edges;
}

/**
 * Get a generic provider-specific service name based on service type and category
 */
function getGenericServiceName(serviceType, provider) {
    const serviceMap = {
        'relationaldatabase': {
            'AWS': 'RDS Instance',
            'GCP': 'Cloud SQL',
            'AZURE': 'Azure SQL Database'
        },
        'nosqldatabase': {
            'AWS': 'DynamoDB Table',
            'GCP': 'Firestore',
            'AZURE': 'Cosmos DB'
        },
        'cache': {
            'AWS': 'ElastiCache',
            'GCP': 'Memorystore',
            'AZURE': 'Azure Cache for Redis'
        },
        'computeserverless': {
            'AWS': 'Lambda Function',
            'GCP': 'Cloud Functions',
            'AZURE': 'Azure Functions'
        },
        'computecontainer': {
            'AWS': 'ECS Container',
            'GCP': 'Cloud Run',
            'AZURE': 'Azure Container Instances'
        },
        'computevm': {
            'AWS': 'EC2 Instance',
            'GCP': 'Compute Engine',
            'AZURE': 'Virtual Machine'
        },
        'objectstorage': {
            'AWS': 'S3 Bucket',
            'GCP': 'Cloud Storage',
            'AZURE': 'Blob Storage'
        },
        'apigateway': {
            'AWS': 'API Gateway',
            'GCP': 'Cloud Endpoints',
            'AZURE': 'API Management'
        },
        'loadbalancer': {
            'AWS': 'Application Load Balancer',
            'GCP': 'Cloud Load Balancing',
            'AZURE': 'Application Gateway'
        },
        'messagequeue': {
            'AWS': 'SQS Queue',
            'GCP': 'Cloud Pub/Sub',
            'AZURE': 'Service Bus'
        },
        'identityauth': {
            'AWS': 'Cognito',
            'GCP': 'Identity Platform',
            'AZURE': 'Azure Active Directory'
        },
        'cdn': {
            'AWS': 'CloudFront Distribution',
            'GCP': 'Cloud CDN',
            'AZURE': 'Azure Front Door'
        },
        'vpcnetworking': {
            'AWS': 'VPC',
            'GCP': 'Virtual Private Cloud',
            'AZURE': 'Virtual Network'
        },
        'logging': {
            'AWS': 'CloudWatch Logs',
            'GCP': 'Cloud Logging',
            'AZURE': 'Azure Monitor Logs'
        },
        'monitoring': {
            'AWS': 'CloudWatch',
            'GCP': 'Cloud Monitoring',
            'AZURE': 'Azure Monitor'
        },
        'paymentgateway': {
            'AWS': 'Lambda + Stripe',
            'GCP': 'Cloud Function + Stripe',
            'AZURE': 'Function + Stripe'
        },
        'websocketgateway': {
            'AWS': 'API Gateway WebSocket',
            'GCP': 'Cloud Endpoints',
            'AZURE': 'SignalR Service'
        },
        'mlinference': {
            'AWS': 'SageMaker Endpoint',
            'GCP': 'Vertex AI',
            'AZURE': 'Azure ML'
        },
        'computebatch': {
            'AWS': 'AWS Batch',
            'GCP': 'Cloud Dataflow',
            'AZURE': 'Azure Batch'
        },
        'analyticaldatabase': {
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
            .map(node => {
                const type = (node.type || '').toLowerCase();
                const display = SERVICE_DISPLAY[type] || {};

                return {
                    id: node.id,
                    name: node.label, // Keep provider-specific name (e.g. S3 Bucket)
                    pretty_name: display.name, // Canonical name (e.g. Object Storage)
                    type: node.type,
                    description: display.description || getServiceDescription(node.type),
                    category: display.category || node.category // Use centralized category if available
                };
            });
    }

    console.warn('[GENERATE SERVICES LIST] No services found in architecture');
    return [];
}

/**
 * Get description for a service type
 */
function getServiceDescription(serviceType) {
    const type = (serviceType || '').toLowerCase();
    if (SERVICE_DISPLAY[type]) {
        return SERVICE_DISPLAY[type].description;
    }

    const descriptions = {
        'cdn': 'Global content delivery network for fast static asset delivery',
        'computeserverless': 'Auto-scaling serverless compute for application logic',
        'identityauth': 'User authentication and identity management service',
        'apigateway': 'API management and request routing service',
        'computecontainer': 'Container orchestration for microservices',
        'computevm': 'Virtual machines for full application control',
        'relationaldatabase': 'Structured data storage with ACID compliance',
        'objectstorage': 'Scalable storage for files and static assets',
        'nosqldatabase': 'Flexible document-based data storage',
        'cache': 'In-memory caching for improved performance',
        'loadbalancer': 'Traffic distribution across multiple instances',
        'dns': 'Domain name resolution and routing',
        'blockstorage': 'Persistent disk storage for VMs',
        'vpcnetworking': 'Virtual network infrastructure',
        'monitoring': 'Infrastructure and application monitoring',
        'logging': 'Centralized log aggregation and analysis',
        'secretsmanagement': 'Secure storage and management of sensitive credentials'
    };

    return descriptions[type] || 'Cloud infrastructure component';
}

/**
 * Calculate position for a node based on its category
 * Uses consistent layout algorithm
 */
function calculateNodePosition(index, category, existingNodes = []) {
    const categoryOffsets = {
        'client': { x: 0, y: 100 },
        'network': { x: 200, y: 100 },
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