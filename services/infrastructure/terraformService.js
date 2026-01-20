const costResultModel = require('../cost/costResultModel');
const terraformGeneratorV2 = require('./terraformGeneratorV2');
const terraformModules = require('../terraform/terraformModules');
const crypto = require('crypto');

// 1. Define Module Mappings directly here to avoid initialization errors
const MODULE_MAPPINGS = {
    aws: {
        globalloadbalancer: "terraform-aws-modules/alb/aws",
        cdn: "terraform-aws-modules/cloudfront/aws",
        apigateway: "terraform-aws-modules/apigateway-v2/aws",
        relationaldatabase: "terraform-aws-modules/rds/aws",
        identityauth: "terraform-aws-modules/cognito-user-pool/aws",
        logging: "terraform-aws-modules/cloudwatch/aws//modules/log-group",
        monitoring: "terraform-aws-modules/cloudwatch/aws//modules/metric-alarm",
        websocketgateway: "terraform-aws-modules/apigateway-v2/aws",
        messagequeue: "terraform-aws-modules/sqs/aws",
        appcompute: "terraform-aws-modules/ecs/aws",
        objectstorage: "terraform-aws-modules/s3-bucket/aws",
        secretsmanager: "terraform-aws-modules/secrets-manager/aws",
        auditlogging: "terraform-aws-modules/cloudwatch/aws//modules/log-group", // Fallback to logs
        eventbus: "terraform-aws-modules/eventbridge/aws",
        // Existing mappings
        computeserverless: "terraform-aws-modules/lambda/aws",
        cache: "terraform-aws-modules/elasticache/aws",
        loadbalancer: "terraform-aws-modules/alb/aws",
        computecontainer: "terraform-aws-modules/ecs/aws",
        computevm: "terraform-aws-modules/ec2-instance/aws",
        nosqldatabase: "terraform-aws-modules/dynamodb/aws",
        blockstorage: "terraform-aws-modules/ebs/aws",
        searchengine: "terraform-aws-modules/elasticsearch/aws",
        networking: "terraform-aws-modules/vpc/aws",
        dns: "terraform-aws-modules/route53/aws",
        secretsmanagement: "terraform-aws-modules/secrets-manager/aws",
    },
    gcp: {
        globalloadbalancer: "terraform-google-modules/lb-http/google",
        cdn: "terraform-google-modules/cdn/google",
        apigateway: "terraform-google-modules/api-gateway/google",
        relationaldatabase: "terraform-google-modules/cloud-sql/google",
        identityauth: "terraform-google-modules/iam/google",
        logging: "terraform-google-modules/logging/google",
        monitoring: "terraform-google-modules/monitoring/google",
        messagequeue: "terraform-google-modules/pubsub/google",
        appcompute: "terraform-google-modules/cloud-run/google",
        objectstorage: "terraform-google-modules/cloud-storage/google",
        secretsmanager: "terraform-google-modules/secrets/google",
        auditlogging: "terraform-google-modules/logging/google",
        eventbus: "terraform-google-modules/eventarc/google",
        // Existing mappings
        computeserverless: "terraform-google-modules/cloud-functions/google",
        cache: "terraform-google-modules/redis/google",
        loadbalancer: "terraform-google-modules/lb-http/google",
        computecontainer: "terraform-google-modules/cloud-run/google",
        computevm: "terraform-google-modules/compute-engine/google",
        nosqldatabase: "terraform-google-modules/spanner/google",
        blockstorage: "terraform-google-modules/compute-engine/google//modules/disks",
        searchengine: "terraform-google-modules/elasticsearch/google",
        networking: "terraform-google-modules/network/google",
        dns: "terraform-google-modules/dns/google",
        secretsmanagement: "terraform-google-modules/secrets/google",
    },
    azure: {
        globalloadbalancer: "Azure/load-balancer/azurerm",
        cdn: "Azure/cdn/azurerm",
        apigateway: "Azure/api-management/azurerm",
        relationaldatabase: "Azure/postgresql-flexible-server/azurerm",
        identityauth: "Azure/active-directory-b2c/azurerm",
        logging: "Azure/log-analytics/azurerm",
        monitoring: "Azure/monitor/azurerm",
        messagequeue: "Azure/service-bus/azurerm",
        appcompute: "Azure/container-apps/azurerm",
        objectstorage: "Azure/storage-account/azurerm",
        secretsmanager: "Azure/key-vault/azurerm",
        auditlogging: "Azure/log-analytics/azurerm",
        eventbus: "Azure/eventgrid/azurerm",
        // Existing mappings
        computeserverless: "Azure/functions/azurerm",
        cache: "Azure/redis/azurerm",
        loadbalancer: "Azure/load-balancer/azurerm",
        computecontainer: "Azure/container-apps/azurerm",
        computevm: "Azure/virtual-machine/azurerm",
        nosqldatabase: "Azure/cosmosdb/azurerm",
        blockstorage: "Azure/managed-disk/azurerm",
        searchengine: "Azure/search/azurerm",
        networking: "Azure/virtual-network/azurerm",
        dns: "Azure/private-dns/azurerm",
        secretsmanagement: "Azure/key-vault/azurerm",
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
            objectstorage: 'aws_s3_bucket',
            cdn: 'aws_cloudfront_distribution',
            computeserverless: 'aws_lambda_function',
            identityauth: 'aws_cognito_user_pool',
            apigateway: 'aws_apigatewayv2_api',
            relationaldatabase: 'aws_db_instance',
            cache: 'aws_elasticache_cluster',
            messagequeue: 'aws_sqs_queue',
            messagingqueue: 'aws_sqs_queue',
            messaging_queue: 'aws_sqs_queue',
            loadbalancer: 'aws_lb'
        },
        gcp: {
            objectstorage: 'google_storage_bucket',
            cdn: 'google_compute_backend_bucket',
            computeserverless: 'google_cloudfunctions2_function',
            identityauth: 'google_identity_platform_config',
            apigateway: 'google_api_gateway_api',
            relationaldatabase: 'google_sql_database_instance',
            cache: 'google_redis_instance',
            messagequeue: 'google_pubsub_topic',
            messagingqueue: 'google_pubsub_topic',
            messaging_queue: 'google_pubsub_topic',
            loadbalancer: 'google_compute_url_map'
        },
        azure: {
            objectstorage: 'azurerm_storage_account',
            cdn: 'azurerm_cdn_endpoint',
            computeserverless: 'azurerm_linux_function_app',
            identityauth: 'azurerm_active_directory_b2c',
            apigateway: 'azurerm_api_management',
            relationaldatabase: 'azurerm_postgresql_server',
            cache: 'azurerm_redis_cache',
            messagequeue: 'azurerm_servicebus_queue',
            messagingqueue: 'azurerm_servicebus_queue',
            messaging_queue: 'azurerm_servicebus_queue',
            loadbalancer: 'azurerm_lb'
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

    // ═══════════════════════════════════════════════════════════════════════════
    // CATALOG-DRIVEN FIREWALL - SSoT
    // ═══════════════════════════════════════════════════════════════════════════
    const catalog = require('../../catalog/terraform/services');

    const illegalServices = normalizedServices.filter(svcId => {
        // 1. Must exist in catalog
        const serviceDef = catalog[svcId];
        if (!serviceDef) return true; // Illegal: Unknown service

        // 2. Must be supported by Terraform
        if (serviceDef.terraform && serviceDef.terraform.moduleId) return false; // Legal

        // 3. Shim for legacy aliases (Optional, can be removed if catalog has aliases)
        const legacyAliases = ['compute_batch', 'email_notification', 'secrets_manager', 'messaging_queue'];
        if (legacyAliases.includes(svcId)) return false;

        return true; // Illegal: Known service but no TF module
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

    // ═══════════════════════════════════════════════════════════════════════════
    // DELEGATE TO V2 GENERATOR - SOURCE OF TRUTH
    // ═══════════════════════════════════════════════════════════════════════════
    // We construct a proxy architecture object to force the generator to use 
    // our strict 'normalizedServices' list (which came from deployable_services).
    // This ensures that the Export uses exactly what we validated above.
    const proxyArchitecture = {
        ...infraSpec.canonical_architecture,
        services: normalizedServices, // Override 'services' with verified deployable list
        pattern: pattern
    };

    console.log(`[TERRAFORM SERVICE] Delegating generation to V2 Generator for ${projectName}...`);

    const result = await terraformGeneratorV2.generateTerraform(
        proxyArchitecture,
        provider,
        resolvedRegion,
        projectName
    );

    // V2 generator returns { files, modules } - we map 'files' to 'projectFolder'
    // to match the expected return signature of this service.
    const projectFolder = result.files;


    // Hash and Manifest logic follows...

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
        relationaldatabase: 'relational_db',
        identityauth: 'auth',
        mlinferenceservice: 'ml_inference',
        websocketgateway: 'websocket',
        computeserverless: 'serverless_compute',
        analyticaldatabase: 'analytical_db',
        pushnotificationservice: 'push_notification',
        globalloadbalancer: 'global_lb',
        messagequeue: 'mq',
        messaging_queue: 'mq',
        secretsmanagement: 'secrets',
        auditlogging: 'audit_log',
        appcompute: 'app_compute',
        searchengine: 'search',
        blockstorage: 'block_store',
        dns: 'dns'
    };

    return nameMap[serviceType] || serviceType;
}

// Helper function to determine if networking module is needed
function needsNetworking(pattern, services) {
    // Networking module is needed for certain patterns
    const needsNetwork = ['STATEFUL_WEB_PLATFORM', 'CONTAINERIZED_WEB_APP', 'TRADITIONAL_VM_APP', 'HIGH_AVAILABILITY_PLATFORM'].includes(pattern);

    // Or if any of these services are present
    const networkDependentServices = ['appcompute', 'computecontainer', 'computevm', 'loadbalancer'];
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