/**
 * TERRAFORM GENERATION SERVICE - V2 MODULAR ARCHITECTURE
 * 
 * Generates modular Terraform projects with proper folder structure:
 * - versions.tf, providers.tf, variables.tf, terraform.tfvars
 * - main.tf (ONLY module references, NO direct resources)
 * - modules/ directory with individual service modules
 * 
 * Follows V1 specification with safe defaults and minimal variable exposure.
 */

const costResultModel = require('./costResultModel');
const terraformGeneratorV2 = require('./terraformGeneratorV2');
const terraformModules = require('./terraformModules');

// ═══════════════════════════════════════════════════════════════════════════
// GET TERRAFORM SERVICES LIST
// ═══════════════════════════════════════════════════════════════════════════
function getTerraformServices(infraSpec, provider) {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';
    const genericServices = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

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
 * Generate modular Terraform project following V1 specification
 * Returns folder structure with modules/ directory
 */
async function generateModularTerraform(infraSpec, provider, projectName, requirements = {}) {
    const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';
    const services = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];
    const providerLower = provider.toLowerCase();

    console.log(`[TERRAFORM V2] Generating modular structure for ${pattern} on ${provider}`);

    const projectFolder = {};

    // Generate root files
    projectFolder['versions.tf'] = terraformGeneratorV2.generateVersionsTf(providerLower);
    projectFolder['providers.tf'] = terraformGeneratorV2.generateProvidersTf(providerLower, requirements.region?.primary_region);
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
            missingModules.push(service);
            console.error(`[TERRAFORM V2] ✗ Missing Terraform module for service: ${service} (normalized: ${lookupName})`);
        }
    });
    
    // 🔥 CRITICAL: Hard fail if ANY modules are missing
    if (missingModules.length > 0) {
        throw new Error(
            `Terraform generation failed: Missing modules for services: ${missingModules.join(', ')}. ` +
            `Each canonical service must have a corresponding Terraform module.`
        );
    }

    return projectFolder;
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

module.exports = {
    generateModularTerraform,
    getTerraformServices
};
