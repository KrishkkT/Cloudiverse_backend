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
 * Use deployable_services only (single source of truth)
 */
function getTerraformServices(infraSpec, provider) {
    // Read ONLY from deployable_services (Step 2 output)
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
            loadbalancer: 'azurerm_lb'
        }
    };

    return resourceMap[provider.toLowerCase()]?.[service] || `${provider}_${service}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE MODULAR TERRAFORM PROJECT (V2)
// ═══════════════════════════════════════════════════════════════════════════
/**
 * Pure consumer — reads ONLY from canonical_architecture.deployable_services
 *  
 * Generate modular Terraform project following V1 specification
 * Returns folder structure with modules/ directory
 */
async function generateModularTerraform(infraSpec, provider, projectName, requirements = {}, explicitServices = null) {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';

    // Explicit contract enforcement - Sizing MUST exist
    if (!infraSpec.sizing) {
        throw new Error(
            '❌ STEP 5 CONTRACT VIOLATION: infraSpec.sizing is missing. ' +
            'Step 3 must calculate and persist sizing before Step 5 can run. ' +
            'This indicates an upstream bug in the workflow.'
        );
    }

    console.log(`[STEP 5 CONTRACT] ✓ Sizing validation passed: tier=${infraSpec.sizing.tier}`);

    // Step 5 must ONLY read deployable_services (single source of truth)
    const services = explicitServices || infraSpec.canonical_architecture?.deployable_services || [];

    if (!Array.isArray(services) || services.length === 0) {
        throw new Error(
            'Terraform generation aborted: No deployable services provided. ' +
            'infraSpec.canonical_architecture.deployable_services is required.'
        );
    }

    // TERRAFORM FIREWALL — Assert no logical services leaked through
    // CRITICAL: Normalize services to strings first (services can be objects or strings)
    const normalizedServices = services.map(svc =>
        typeof svc === 'string' ? svc :
            (svc?.service_id || svc?.service_class || svc?.name || svc?.canonical_type || String(svc))
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // CATALOG-DRIVEN FIREWALL - SSoT
    // ═══════════════════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════════════════
    // CATALOG-DRIVEN FILTER - SSoT (Gate 3)
    // ═══════════════════════════════════════════════════════════════════════════
    const catalog = require('../../catalog/terraform/services');

    // Split services into Deployable vs Conceptual
    const deployableServices = [];
    const conceptualServices = [];

    normalizedServices.forEach(svcId => {
        // 🔥 FIX: Check for explicit user exclusion (User Disabled)
        // We need to look up the original object if possible, or trust that normalizedServices 
        // should have been filtered. IF normalizedServices implies we lost the metadata, 
        // we must rely on the upstream filter. 
        // HOWEVER, we can check if the input `services` array had state.

        // Lookup the original service object from the input array to check state
        const originalSvc = services.find(s => {
            if (typeof s === 'string') return s === svcId;
            return (s.service_id === svcId || s.service_class === svcId || s.name === svcId || s.canonical_type === svcId);
        });

        if (originalSvc && (originalSvc.state === 'USER_DISABLED' || originalSvc.state === 'EXCLUDED')) {
            console.log(`[TERRAFORM V2] 🚫 Skipping User-Disabled Service: ${svcId}`);
            return;
        }

        const serviceDef = catalog[svcId];

        // 1. Must exist in catalog
        if (!serviceDef) {
            console.warn(`[TERRAFORM V2] ⚠️  Unknown service ID: ${svcId} - Skipping`);
            return;
        }

        // 2. Check if supported
        const isSupported = serviceDef.terraform_supported === true;
        const legacyAliases = ['compute_batch', 'email_notification', 'secrets_manager', 'messaging_queue'];
        const isLegacy = legacyAliases.includes(svcId);

        if (isSupported || isLegacy) {
            deployableServices.push(svcId);
        } else {
            conceptualServices.push(svcId);
        }
    });

    if (conceptualServices.length > 0) {
        console.log(`[TERRAFORM V2] ℹ️  Excluded Conceptual/External services from Terraform: ${conceptualServices.join(', ')}`);
    }

    // UPDATE: Use filtered list for subsequent generation
    // We overwrite the local variable reference for downstream logic or ensure we use deployableServices
    // The previous code used `normalizedServices` everywhere. We need to make sure we use `deployableServices`.
    console.log(`[TERRAFORM V2] ✓ Filter passed: ${deployableServices.length} deployable services (from ${normalizedServices.length} total)`);
    console.log(`[TERRAFORM V2] Generating modular structure for ${pattern} on ${provider}`);


    // HACK: Re-assign normalizedServices if possible, or create a new variable and use it. 
    // Since normalizedServices is const, we cannot reassign.
    // We will just rename the variable in the loop below or use a new variable name.
    // But `generateModularTerraform` is huge. 
    // A better approach is to use `deployableServices` in the loop.
    // Let's comment out the original `normalizedServices` usage in the loop and use `deployableServices`.

    // Actually, I can't easily change all downstream references in this one hunk.
    // I should probably have mutated the array if it was let, but it's const.
    // I will replace `normalizedServices` with `deployableServices` in the subsequent loop.
    // But I'd need to replace the whole file content.
    // ALTERNATIVE: throw error if I can't change it?
    // No. I will add: `const servicesToProcess = deployableServices;`
    // And I will explicitly loop over `servicesToProcess`.

    // Wait, the subsequent code iterates `normalizedServices`.
    // If I don't change that, the filter is useless!
    // I MUST change the loop variable.

    // Let's use `multi_replace` to change the Loop too.
    // Check line 275: `normalizedServices.forEach(service => {`
    // I should change that to `deployableServices.forEach(service => {`

    // I will do this in two chunks using multi_replace (correctly this time).

    console.log(`[TERRAFORM V2] ✓ Firewall passed: All ${normalizedServices.length} services are terraform-deployable`);
    console.log(`[TERRAFORM V2] Generating modular structure for ${pattern} on ${provider}`);
    console.log(`[TERRAFORM V2] Deployable services: ${normalizedServices.join(', ')}`);

    const providerLower = provider.toLowerCase();

    // Use resolved_region from Step 2 (not hardcoded defaults)
    let resolvedRegion = infraSpec.region?.resolved_region ||
        requirements.region?.primary_region ||
        getDefaultRegion(providerLower);

    // FIX: Normalize Region (Handle 'ap-south1' typo)
    if (resolvedRegion && /^[a-z]+-[a-z]+\d$/.test(resolvedRegion) === false && resolvedRegion.match(/[a-z]+[a-z]+\d/)) {
        resolvedRegion = resolvedRegion.replace(/([a-z]+)-?([a-z]+)(\d)/, "$1-$2-$3");
    }

    console.log(`[TERRAFORM V2] Using resolved region: ${resolvedRegion}`);

    const projectFolder = {};

    // 3. CDN Fallback Logic (REVERTED - Always Enforce CDN)
    const options = {};
    if (providerLower === 'aws') {
        // We log capabilities but NO LONGER fallback. User must contact AWS Support if AccessDenied.
        const capabilities = infraSpec.connection?.capabilities || {};
        console.log(`[TERRAFORM DEBUG] Capabilities: ${JSON.stringify(capabilities)}`);
    }

    // Generate root files
    // NOTE: We use deployableServices (filtered) for generation to ensure consistency
    projectFolder['versions.tf'] = terraformGeneratorV2.generateVersionsTf(providerLower);
    projectFolder['providers.tf'] = terraformGeneratorV2.generateProvidersTf(providerLower, resolvedRegion);
    projectFolder['variables.tf'] = terraformGeneratorV2.generateVariablesTf(providerLower, pattern, deployableServices);
    projectFolder['terraform.tfvars'] = terraformGeneratorV2.generateTfvars(providerLower, resolvedRegion, projectName, infraSpec.sizing, infraSpec.connection);
    projectFolder['main.tf'] = terraformGeneratorV2.generateMainTf(providerLower, pattern, deployableServices, options);
    projectFolder['outputs.tf'] = terraformGeneratorV2.generateOutputsTf(providerLower, pattern, deployableServices);
    projectFolder['README.md'] = terraformGeneratorV2.generateReadme(projectName, providerLower, pattern, deployableServices);

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

    deployableServices.forEach(service => {
        // Services are already normalized and valid against catalog
        const module = terraformModules.getModule(service, providerLower);
        const folderName = terraformGeneratorV2.getModuleName(service);

        if (module) {
            projectFolder['modules'][folderName] = module;
            console.log(`[TERRAFORM V2] ✓ Module added: ${service} → ${folderName}`);
        } else {
            console.warn(`[TERRAFORM V2] ⚠️  Skipping service '${service}' - No Terraform module defined (Gate 2).`);

            // Check if this service is a blocking service (must have Terraform module)
            const blockingServices = ['objectstorage', 'apigateway']; // Normalized IDs
            const isBlocking = blockingServices.includes(service);

            // Classify module failure for better error messaging
            missingModules.push({
                service,
                provider: providerLower,
                reason: 'MODULE_NOT_IMPLEMENTED',
                is_blocking: isBlocking
            });
            console.error(`[TERRAFORM V2] ✗ Missing Terraform module for service: ${service} on ${provider} (blocking: ${isBlocking})`);
        }
    });

    // TERRAFORM-SAFE MODE: Check for blocking services before continuing
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
        // Regenerate ALL root files that depend on services to ensure consistency
        const availableServices = normalizedServices.filter(service => {
            const module = terraformModules.getModule(service, providerLower);
            return module !== null && module !== undefined;
        });

        console.log(`[TERRAFORM-SAFE] Regenerating root files with ${availableServices.length}/${normalizedServices.length} valid services.`);

        // Re-generate root files with filtered list
        projectFolder['variables.tf'] = terraformGeneratorV2.generateVariablesTf(providerLower, pattern, availableServices);
        projectFolder['main.tf'] = terraformGeneratorV2.generateMainTf(providerLower, pattern, availableServices);
        projectFolder['outputs.tf'] = terraformGeneratorV2.generateOutputsTf(providerLower, pattern, availableServices);
        projectFolder['README.md'] = terraformGeneratorV2.generateReadme(projectName, providerLower, pattern, availableServices);

    }

    // Generate hash for drift detection and caching
    const terraformHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(projectFolder))
        .digest('hex');

    console.log(`[STEP 5] ✓ Terraform hash generated: ${terraformHash.substring(0, 16)}...`);

    // Emit deployment manifest for audit and rollback
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

// Helper function to get module folder name (DEPRECATED - Use terraformGeneratorV2.getModuleName)
function getModuleFolderName(serviceType) {
    return terraformGeneratorV2.getModuleName(serviceType);
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
    getModuleName: terraformGeneratorV2.getModuleName
};