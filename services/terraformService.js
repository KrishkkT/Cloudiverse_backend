/**
 * TERRAFORM GENERATION SERVICE - V2 MODULAR ARCHITECTURE
 * 
 * 🎯 CORE PRINCIPLE: Cloudiverse produces PLANS, not infrastructure.
 * 
 * ✅ STEP 5 CONTRACT (ABSOLUTE - NO EXCEPTIONS):
 * - NO inference (all inputs are authoritative)
 * - NO sizing calculation (Step 3 owns this)
 * - NO cost logic (Step 3 owns this)
 * - NO AI involvement (deterministic only)
 * - NO pattern resolution (Step 2 owns this)
 * - NO deployment execution (user owns this)
 * - NO cloud credentials (security boundary)
 * 
 * Violations of this contract indicate UPSTREAM BUGS, not Step 5 issues.
 * 
 * STRICT CONTRACT:
 * - Input: infraSpec.canonical_architecture.deployable_services (ONLY)
 * - Input: infraSpec.sizing (locked from Step 3)
 * - Input: infraSpec.region.resolved_region (locked from Step 2)
 * - Input: infraSpec.nfr (locked from Step 2)
 * - Forbidden: Pattern resolution, service inference, cost decisions, AI, deployment
 * 
 * INVARIANTS:
 * 1. If Step 3 priced it, Step 5 can deploy it
 * 2. If Step 5 can deploy it, Step 3 already priced it
 * 3. Terraform sizing MUST match Step 3 cost estimates
 * 4. Logical services (event_bus, waf, payment_gateway, artifact_registry) NEVER reach Terraform
 * 5. Hash and manifest are ALWAYS generated for audit and drift detection
 * 
 * OUTPUT:
 * - Modular Terraform project (versions.tf, providers.tf, variables.tf, terraform.tfvars, main.tf, outputs.tf, modules/)
 * - SHA-256 hash (for drift detection and caching)
 * - Deployment manifest (for audit, rollback, and compliance)
 * 
 * HARD BOUNDARY:
 * Cloudiverse ends at Terraform generation. Deployment, credentials, state management,
 * and runtime operations are intentionally out of scope for security and liability reasons.
 */

const costResultModel = require('./costResultModel');
const terraformGeneratorV2 = require('./terraformGeneratorV2');
const terraformModules = require('./terraformModules');
const { CANONICAL_SERVICES } = require('./canonicalServiceRegistry');
const crypto = require('crypto');

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
    const illegalServices = services.filter(svc => {
        const serviceDef = CANONICAL_SERVICES[svc];
        return !serviceDef || serviceDef.terraform_supported !== true;
    });
    
    if (illegalServices.length > 0) {
        throw new Error(
            `🚨 TERRAFORM FIREWALL VIOLATION: Illegal services reached Terraform layer: ${illegalServices.join(', ')}. ` +
            `These services are not terraform-deployable. This indicates an upstream bug in Step 2.`
        );
    }
    
    console.log(`[TERRAFORM V2] ✓ Firewall passed: All ${services.length} services are terraform-deployable`);
    console.log(`[TERRAFORM V2] Generating modular structure for ${pattern} on ${provider}`);
    console.log(`[TERRAFORM V2] Deployable services: ${services.join(', ')}`);
    
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
    projectFolder['variables.tf'] = terraformGeneratorV2.generateVariablesTf(providerLower, pattern, services);
    projectFolder['terraform.tfvars'] = terraformGeneratorV2.generateTfvars(providerLower, projectName, requirements);
    projectFolder['main.tf'] = terraformGeneratorV2.generateMainTf(providerLower, pattern, services);
    projectFolder['outputs.tf'] = terraformGeneratorV2.generateOutputsTf(providerLower, pattern, services);
    projectFolder['README.md'] = terraformGeneratorV2.generateReadme(projectName, providerLower, pattern, services);

    // Generate modules
    projectFolder['modules'] = {};

    // Add networking module if needed
    if (needsNetworking(pattern, services)) {
        const networkingModule = terraformModules.getModule('networking', providerLower);
        if (networkingModule) {
            projectFolder['modules']['networking'] = networkingModule;
        }
    }

    // Add service modules
    const missingModules = [];
    const { CANONICAL_SERVICES } = require('./canonicalServiceRegistry');
    
    services.forEach(service => {
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
            const serviceDef = CANONICAL_SERVICES[service];
            const isBlocking = serviceDef && serviceDef.class === 'terraform_core' && serviceDef.blocks_terraform === true;
            
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
        const availableServices = services.filter(service => {
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
        
        console.log(`[TERRAFORM-SAFE] Proceeding with ${availableServices.length}/${services.length} services (missing non-blocking services excluded)`);
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
        services: services,
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

/**
 * Check if pattern needs networking (VPC)
 */
function needsNetworking(pattern, services) {
    const patternsNeedingVPC = [
        'STATEFUL_WEB_PLATFORM',
        'HYBRID_PLATFORM',
        'MOBILE_BACKEND_PLATFORM',
        'CONTAINERIZED_WEB_APP',
        'DATA_PLATFORM',
        'REALTIME_PLATFORM',
        'ML_TRAINING_PLATFORM'
    ];
    return patternsNeedingVPC.includes(pattern);
}

/**
 * Get module folder name from service name
 */
function getModuleFolderName(service) {
    const moduleMap = {
        'cdn': 'cdn',
        'api_gateway': 'api_gateway',
        'serverless_compute': 'serverless_compute',
        'compute_serverless': 'serverless_compute',  // 🔥 ALIAS: normalize to serverless_compute
        'app_compute': 'app_compute',
        'relational_database': 'relational_db',
        'analytical_database': 'analytical_db',
        'cache': 'cache',
        'message_queue': 'message_queue',
        'messaging_queue': 'message_queue',  // 🔥 ALIAS: normalize to message_queue
        'object_storage': 'object_storage',
        'identity_auth': 'auth',
        'load_balancer': 'load_balancer',
        'monitoring': 'monitoring',
        'logging': 'logging',
        'ml_inference_service': 'ml_inference',
        'batch_compute': 'batch_compute',
        'websocket_gateway': 'websocket',
        'payment_gateway': 'payment_gateway',
        'push_notification_service': 'push_notification'  // 🔥 ADDED
    };
    return moduleMap[service] || service;
}

/**
 * ✅ FIX 5: Get default region per provider (fallback only)
 */
function getDefaultRegion(provider) {
    const defaults = {
        aws: 'us-east-1',
        gcp: 'us-central1',
        azure: 'eastus'
    };
    return defaults[provider] || 'us-east-1';
}

module.exports = {
    generateModularTerraform,
    getTerraformServices,
    getModuleFolderName
};
