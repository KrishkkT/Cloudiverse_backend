const costResultModel = require('./costResultModel');
const terraformGeneratorV2 = require('./terraformGeneratorV2');
const terraformModules = require('./terraformModules');
const crypto = require('crypto');

// 1. Define Module Mappings directly here to avoid initialization errors
const MODULE_MAPPINGS = {
    aws: {
        global_load_balancer: "terraform-aws-modules/alb/aws",
        cdn: "terraform-aws-modules/cloudfront/aws",
        api_gateway: "terraform-aws-modules/apigateway-v2/aws",
        relational_database: "terraform-aws-modules/rds/aws",
        identity_auth: "terraform-aws-modules/cognito-user-pool/aws",
        logging: "terraform-aws-modules/cloudwatch/aws//modules/log-group",
        monitoring: "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm",
        websocket_gateway: "terraform-aws-modules/apigateway-v2/aws",
        message_queue: "terraform-aws-modules/sqs/aws",
        app_compute: "terraform-aws-modules/ecs/aws",
        object_storage: "terraform-aws-modules/s3-bucket/aws",
        secrets_manager: "terraform-aws-modules/secrets-manager/aws",
        audit_logging: "terraform-aws-modules/cloudwatch/aws//modules/log-group", // Fallback to logs
        event_bus: "terraform-aws-modules/eventbridge/aws",
        // Existing mappings
        compute_serverless: "terraform-aws-modules/lambda/aws",
        cache: "terraform-aws-modules/elasticache/aws",
        load_balancer: "terraform-aws-modules/alb/aws",
        compute_container: "terraform-aws-modules/ecs/aws",
        compute_vm: "terraform-aws-modules/ec2-instance/aws",
        nosql_database: "terraform-aws-modules/dynamodb/aws",
        block_storage: "terraform-aws-modules/ebs/aws",
        search_engine: "terraform-aws-modules/elasticsearch/aws",
        networking: "terraform-aws-modules/vpc/aws",
        dns: "terraform-aws-modules/route53/aws",
        secrets_management: "terraform-aws-modules/secrets-manager/aws",
        messaging_queue: "terraform-aws-modules/sqs/aws"
    },
    gcp: {
        global_load_balancer: "terraform-google-modules/lb-http/google",
        cdn: "terraform-google-modules/cdn/google",
        api_gateway: "terraform-google-modules/api-gateway/google",
        relational_database: "terraform-google-modules/cloud-sql/google",
        identity_auth: "terraform-google-modules/iam/google",
        logging: "terraform-google-modules/logging/google",
        monitoring: "terraform-google-modules/monitoring/google",
        message_queue: "terraform-google-modules/pubsub/google",
        app_compute: "terraform-google-modules/cloud-run/google",
        object_storage: "terraform-google-modules/cloud-storage/google",
        secrets_manager: "terraform-google-modules/secrets/google",
        audit_logging: "terraform-google-modules/logging/google",
        event_bus: "terraform-google-modules/eventarc/google",
        // Existing mappings
        compute_serverless: "terraform-google-modules/cloud-functions/google",
        cache: "terraform-google-modules/redis/google",
        load_balancer: "terraform-google-modules/lb-http/google",
        compute_container: "terraform-google-modules/cloud-run/google",
        compute_vm: "terraform-google-modules/compute-engine/google",
        nosql_database: "terraform-google-modules/spanner/google",
        block_storage: "terraform-google-modules/compute-engine/google//modules/disks",
        search_engine: "terraform-google-modules/elasticsearch/google",
        networking: "terraform-google-modules/network/google",
        dns: "terraform-google-modules/dns/google",
        secrets_management: "terraform-google-modules/secrets/google",
        messaging_queue: "terraform-google-modules/pubsub/google"
    },
    azure: {
        global_load_balancer: "Azure/load-balancer/azurerm",
        cdn: "Azure/cdn/azurerm",
        api_gateway: "Azure/api-management/azurerm",
        relational_database: "Azure/postgresql-flexible-server/azurerm",
        identity_auth: "Azure/active-directory-b2c/azurerm",
        logging: "Azure/log-analytics/azurerm",
        monitoring: "Azure/monitor/azurerm",
        message_queue: "Azure/service-bus/azurerm",
        app_compute: "Azure/container-apps/azurerm",
        object_storage: "Azure/storage-account/azurerm",
        secrets_manager: "Azure/key-vault/azurerm",
        audit_logging: "Azure/log-analytics/azurerm",
        event_bus: "Azure/eventgrid/azurerm",
        // Existing mappings
        compute_serverless: "Azure/functions/azurerm",
        cache: "Azure/redis/azurerm",
        load_balancer: "Azure/load-balancer/azurerm",
        compute_container: "Azure/container-apps/azurerm",
        compute_vm: "Azure/virtual-machine/azurerm",
        nosql_database: "Azure/cosmosdb/azurerm",
        block_storage: "Azure/managed-disk/azurerm",
        search_engine: "Azure/search/azurerm",
        networking: "Azure/virtual-network/azurerm",
        dns: "Azure/private-dns/azurerm",
        secrets_management: "Azure/key-vault/azurerm",
        messaging_queue: "Azure/service-bus/azurerm"
    }
};

// 2. Helper to get clean variables
function getModuleVars(service, sizing) {
    const vars = {
        name: `${service.canonical_type}-service`,
        tags: { Environment: "production", ManagedBy: "Cloudiverse" }
    };

    // Apply specific sizing vars if available
    if (sizing) {
        if (sizing.instance_class) vars.instance_class = sizing.instance_class;
        if (sizing.storage_gb) vars.allocated_storage = sizing.storage_gb;
        if (sizing.requests_per_month) vars.estimated_requests = sizing.requests_per_month;
    }
    return vars;
}

// ═══════════════════════════════════════════════════════════════════════════
// GET TERRAFORM SERVICES LIST
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ✅ FIX 1: Use deployable_services only (single source of truth)
 */
function getTerraformServices(infraSpec, provider) {
    // ✅ FIX 1: Read ONLY from deployable_services (Step 2 output)
    const genericServices = infraSpec.canonical_architecture?.deployable_services || [];

    if (!Array.isArray(genericServices) || genericServices.length === 0) {
        console.warn('[TERRAFORM] No deployable services found in infraSpec.canonical_architecture.deployable_services');
        return [];
    }

    return genericServices.map(svc => ({
        generic_name: svc,
        cloud_service: costResultModel.SERVICE_MAP[provider.toLowerCase()]?.[svc] || svc,
        terraform_resource: getTerraformResourceType(svc, provider)
    }));
}

function getTerraformResourceType(service, provider) {
    const resourceMap = {
        aws: {
            object_storage: 'aws_s3_bucket',
            cdn: 'aws_cloudfront_distribution',
            compute_serverless: 'aws_lambda_function',
            identity_auth: 'aws_cognito_user_pool',
            api_gateway: 'aws_apigatewayv2_api',
            relational_database: 'aws_db_instance',
            cache: 'aws_elasticache_cluster',
            message_queue: 'aws_sqs_queue',
            load_balancer: 'aws_lb'
        },
        gcp: {
            object_storage: 'google_storage_bucket',
            cdn: 'google_compute_backend_bucket',
            compute_serverless: 'google_cloudfunctions2_function',
            identity_auth: 'google_identity_platform_config',
            api_gateway: 'google_api_gateway_api',
            relational_database: 'google_sql_database_instance',
            cache: 'google_redis_instance',
            message_queue: 'google_pubsub_topic',
            load_balancer: 'google_compute_url_map'
        },
        azure: {
            object_storage: 'azurerm_storage_account',
            cdn: 'azurerm_cdn_endpoint',
            compute_serverless: 'azurerm_linux_function_app',
            identity_auth: 'azurerm_active_directory_b2c',
            api_gateway: 'azurerm_api_management',
            relational_database: 'azurerm_postgresql_server',
            cache: 'azurerm_redis_cache',
            message_queue: 'azurerm_servicebus_queue',
            load_balancer: 'azurerm_lb'
        }
    };

    return resourceMap[provider.toLowerCase()]?.[service] || `${provider}_${service}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE MODULAR TERRAFORM PROJECT (V2)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * ✅ FIX 1-5: Pure consumer — reads ONLY from canonical_architecture.deployable_services
 * 
 * Generate modular Terraform project following V1 specification
 * Returns folder structure with modules/ directory
 */
async function generateModularTerraform(infraSpec, provider, projectName, requirements = {}) {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';

    // ✅ TIGHTENING 1: Explicit contract enforcement - Sizing MUST exist
    if (!infraSpec.sizing) {
        throw new Error(
            '❌ STEP 5 CONTRACT VIOLATION: infraSpec.sizing is missing. ' +
            'Step 3 must calculate and persist sizing before Step 5 can run. ' +
            'This indicates an upstream bug in the workflow.'
        );
    }

    console.log(`[STEP 5 CONTRACT] ✓ Sizing validation passed: tier=${infraSpec.sizing.tier}`);

    // ✅ FIX 1: Step 5 must ONLY read deployable_services (single source of truth)
    const services = infraSpec.canonical_architecture?.deployable_services || [];

    if (!Array.isArray(services) || services.length === 0) {
        throw new Error(
            'Terraform generation aborted: No deployable services provided. ' +
            'infraSpec.canonical_architecture.deployable_services is required.'
        );
    }

    // ✅ FIX 2: TERRAFORM FIREWALL — Assert no logical services leaked through
    // 🔥 CRITICAL FIX: Normalize services to strings first (services can be objects or strings)
    const normalizedServices = services.map(svc =>
        typeof svc === 'string' ? svc :
            (svc?.service_class || svc?.name || svc?.canonical_type || String(svc))
    );

    // Define supported services directly to avoid initialization issues
    const SUPPORTED_SERVICES = [
        'global_load_balancer', 'cdn', 'api_gateway', 'relational_database', 'identity_auth',
        'logging', 'monitoring', 'websocket_gateway', 'message_queue', 'app_compute',
        'object_storage', 'secrets_manager', 'audit_logging', 'event_bus',
        'compute_serverless', 'serverless_compute', 'cache', 'load_balancer', 'compute_container', 'compute_vm',
        'nosql_database', 'block_storage', 'search_engine', 'networking', 'dns',
        'secrets_management', 'messaging_queue'
    ];

    const illegalServices = normalizedServices.filter(svc => {
        return !SUPPORTED_SERVICES.includes(svc);
    });

    if (illegalServices.length > 0) {
        throw new Error(
            `🚨 TERRAFORM FIREWALL VIOLATION: Illegal services reached Terraform layer: ${illegalServices.join(', ')}. `
            + `These services are not terraform-deployable. This indicates an upstream bug in Step 2.`
        );
    }

    console.log(`[TERRAFORM V2] ✓ Firewall passed: All ${normalizedServices.length} services are terraform-deployable`);
    console.log(`[TERRAFORM V2] Generating modular structure for ${pattern} on ${provider}`);
    console.log(`[TERRAFORM V2] Deployable services: ${normalizedServices.join(', ')}`);

    const providerLower = provider.toLowerCase();

    // ✅ FIX 5: Use resolved_region from Step 2 (not hardcoded defaults)
    const resolvedRegion = infraSpec.region?.resolved_region ||
        requirements.region?.primary_region ||
        getDefaultRegion(providerLower);

    console.log(`[TERRAFORM V2] Using resolved region: ${resolvedRegion}`);

    const projectFolder = {};

    // Generate root files
    projectFolder['versions.tf'] = terraformGeneratorV2.generateVersionsTf(providerLower);
    projectFolder['providers.tf'] = terraformGeneratorV2.generateProvidersTf(providerLower, resolvedRegion);
    projectFolder['variables.tf'] = terraformGeneratorV2.generateVariablesTf(providerLower, pattern, normalizedServices);
    projectFolder['terraform.tfvars'] = terraformGeneratorV2.generateTfvars(providerLower, projectName, requirements);
    projectFolder['main.tf'] = terraformGeneratorV2.generateMainTf(providerLower, pattern, normalizedServices);
    projectFolder['outputs.tf'] = terraformGeneratorV2.generateOutputsTf(providerLower, pattern, normalizedServices);
    projectFolder['README.md'] = terraformGeneratorV2.generateReadme(projectName, providerLower, pattern, normalizedServices);

    // Generate modules
    projectFolder['modules'] = {};

    // Add networking module if needed
    if (needsNetworking(pattern, normalizedServices)) {
        const networkingModule = terraformModules.getModule('networking', providerLower);
        if (networkingModule) {
            projectFolder['modules']['networking'] = networkingModule;
        }
    }

    // Add service modules
    const missingModules = [];

    normalizedServices.forEach(service => {
        // 🔥 CRITICAL: Normalize service name BEFORE module lookup
        const normalizedService = getModuleFolderName(service);
        const lookupName = normalizedService === 'relational_db' ? 'relational_database' :
            normalizedService === 'auth' ? 'identity_auth' :
                normalizedService === 'ml_inference' ? 'ml_inference_service' :
                    normalizedService === 'websocket' ? 'websocket_gateway' :
                        normalizedService === 'serverless_compute' ? 'serverless_compute' :
                            normalizedService === 'analytical_db' ? 'analytical_database' :
                                normalizedService === 'push_notification' ? 'push_notification_service' :
                                    normalizedService;

        const module = terraformModules.getModule(lookupName, providerLower);
        if (module) {
            projectFolder['modules'][normalizedService] = module;
            console.log(`[TERRAFORM V2] ✓ Module added: ${service} → ${normalizedService}`);
        } else {
            // Check if this service is a blocking service (must have Terraform module)
            const blockingServices = ['object_storage', 'api_gateway']; // Define which services are blocking (compute_serverless has fallback)
            const isBlocking = blockingServices.includes(service);

            // ✅ FIX 4: Classify module failure for better error messaging
            missingModules.push({
                service,
                normalized: normalizedService,
                provider: providerLower,
                reason: 'MODULE_NOT_IMPLEMENTED',
                is_blocking: isBlocking
            });
            console.error(`[TERRAFORM V2] ✗ Missing Terraform module for service: ${service} (normalized: ${lookupName}) on ${provider} (blocking: ${isBlocking})`);
        }
    });

    // 🔥 TERRAFORM-SAFE MODE: Check for blocking services before continuing
    const blockingMissingModules = missingModules.filter(m => m.is_blocking);

    if (blockingMissingModules.length > 0) {
        // FAIL if blocking services are missing modules
        const blockingServiceNames = blockingMissingModules.map(m => m.service).join(', ');
        throw new Error(
            `Terraform generation failed: Missing modules for blocking services: ${blockingServiceNames}.\n` +
            `Blocking services must have Terraform modules implemented for the selected provider.`
        );
    } else if (missingModules.length > 0) {
        // Only warn for non-blocking services
        const serviceNames = missingModules.map(m => m.service).join(', ');
        console.warn(`[TERRAFORM-SAFE] Missing modules for non-blocking services: ${serviceNames}. These will be excluded for Terraform generation.`);

        // Log the missing modules but continue
        missingModules.forEach(m => {
            console.warn(`[TERRAFORM-SAFE] Service excluded: ${m.service} (normalized: ${m.normalized}) on ${m.provider} - ${m.reason} (blocking: ${m.is_blocking})`);
        });

        // Remove missing services from the main.tf to avoid broken references
        // We'll need to rebuild main.tf without the missing services
        const availableServices = normalizedServices.filter(service => {
            const normalizedService = getModuleFolderName(service);
            const lookupName = normalizedService === 'relational_db' ? 'relational_database' :
                normalizedService === 'auth' ? 'identity_auth' :
                    normalizedService === 'ml_inference' ? 'ml_inference_service' :
                        normalizedService === 'websocket' ? 'websocket_gateway' :
                            normalizedService === 'serverless_compute' ? 'serverless_compute' :
                                normalizedService === 'analytical_db' ? 'analytical_database' :
                                    normalizedService === 'push_notification' ? 'push_notification_service' :
                                        normalizedService;
            return terraformModules.getModule(lookupName, providerLower) !== undefined;
        });

        // Regenerate main.tf with only available services
        projectFolder['main.tf'] = terraformGeneratorV2.generateMainTf(providerLower, pattern, availableServices);

        console.log(`[TERRAFORM-SAFE] Proceeding with ${availableServices.length}/${normalizedServices.length} services (missing non-blocking services excluded)`);
    }

    // ✅ TIGHTENING 2: Generate hash for drift detection and caching
    const terraformHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(projectFolder))
        .digest('hex');

    console.log(`[STEP 5] ✓ Terraform hash generated: ${terraformHash.substring(0, 16)}...`);

    // ✅ TIGHTENING 3: Emit deployment manifest for audit and rollback
    const deploymentManifest = {
        provider: provider,
        region: resolvedRegion,
        pattern: pattern,
        services: normalizedServices,
        sizing: infraSpec.sizing,
        nfr: infraSpec.nfr || {},
        timestamp: new Date().toISOString(),
        terraform_hash: terraformHash,
        version: '2.0'
    };

    console.log(`[STEP 5] ✓ Deployment manifest created: ${services.length} services`);

    return {
        projectFolder,
        terraform_hash: terraformHash,
        deployment_manifest: deploymentManifest
    };
}

// Helper function to get module folder name
function getModuleFolderName(serviceType) {
    // Normalize service type names for folder structure
    const nameMap = {
        'relational_database': 'relational_db',
        'identity_auth': 'auth',
        'ml_inference_service': 'ml_inference',
        'websocket_gateway': 'websocket',
        'serverless_compute': 'serverless_compute',
        'analytical_database': 'analytical_db',
        'push_notification_service': 'push_notification',
        'global_load_balancer': 'global_lb',
        'message_queue': 'mq',
        'secrets_management': 'secrets',
        'messaging_queue': 'messaging',
        'audit_logging': 'audit_log',
        'app_compute': 'app_compute',
        'search_engine': 'search',
        'block_storage': 'block_store',
        'dns': 'dns'
    };

    return nameMap[serviceType] || serviceType.replace(/_/g, '_');
}

// Helper function to determine if networking module is needed
function needsNetworking(pattern, services) {
    // Networking module is needed for certain patterns
    const needsNetwork = ['STATEFUL_WEB_PLATFORM', 'CONTAINERIZED_WEB_APP', 'TRADITIONAL_VM_APP'].includes(pattern);

    // Or if any of these services are present
    const networkDependentServices = ['app_compute', 'compute_container', 'compute_vm', 'load_balancer'];
    const hasNetworkDependent = services.some(service => networkDependentServices.includes(service));

    return needsNetwork || hasNetworkDependent;
}

// Helper function to get default region
function getDefaultRegion(provider) {
    const defaults = {
        aws: 'us-east-1',
        gcp: 'us-central1',
        azure: 'East US'
    };

    return defaults[provider] || 'us-east-1';
}

module.exports = {
    generateModularTerraform,
    getTerraformServices,
    getTerraformResourceType,
    getModuleFolderName  // 🔥 CRITICAL: Required by workflow.js
};