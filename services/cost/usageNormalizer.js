/**
 * usageNormalizer.js
 * 
 * Explicit mapping between high-level usage profiles and resource-specific Infracost usage keys.
 * 
 * CRITICAL PRINCIPLE:
 * Usage normalization must adapt to which services are ACTUALLY DEPLOYED,
 * not blindly assume all services exist.
 */

// Refactored to use Catalog
const { getServiceDefinition } = require('../../catalog/terraform/utils');

/**
 * Normalize usage profile into Infracost-compatible resource usage.
 * 
 * @param {Object} usage_profile - High-level usage (monthly_users, requests_per_user, etc.)
 * @param {Array<string>} deployableServices - List of service_class names that are being deployed
 * @param {string} provider - Cloud provider (AWS, GCP, AZURE)
 * @returns {Object} - Infracost usage file structure
 */
function normalizeUsageForInfracost(usage_profile, deployableServices, provider) {
    if (!usage_profile) {
        console.warn('[USAGE NORMALIZER] No usage profile provided, using defaults');
        usage_profile = {
            monthly_users: 5000,
            requests_per_user: 30,
            data_transfer_gb: 50,
            data_storage_gb: 20,
            peak_concurrency: 100
        };
    }

    const usage = {};

    // Calculate derived metrics
    const monthlyRequests = (usage_profile.monthly_users || 5000) *
        (usage_profile.requests_per_user || 30);
    const storageGB = usage_profile.data_storage_gb || 20;
    const transferGB = usage_profile.data_transfer_gb || 50;

    console.log(`[USAGE NORMALIZER] ${provider} - Normalizing for ${deployableServices.length} deployable services`);
    console.log(`[USAGE NORMALIZER] Derived: ${monthlyRequests} requests/mo, ${storageGB}GB storage, ${transferGB}GB transfer`);

    // ═══════════════════════════════════════════════════════════════════
    // COMPUTE SERVICES
    // ═══════════════════════════════════════════════════════════════════

    // 🔥 FIX: Normalize service names to lowercase for comparison
    const normalizedServices = deployableServices.map(s => {
        if (typeof s === 'string') return s.toLowerCase();
        const name = s.service_id || s.service || s.canonical_type || s.name || s.service_class;
        return name ? name.toLowerCase() : null;
    }).filter(Boolean);

    // Helper to check for service presence (handles both formats)
    const hasService = (id) => normalizedServices.includes(id.toLowerCase());

    if (hasService('computeserverless') || hasService('compute_serverless') ||
        hasService('app_compute')) {

        switch (provider) {
            case 'AWS':
                usage['aws_lambda_function.app'] = {
                    monthly_requests: monthlyRequests,
                    request_duration_ms: 250
                };
                usage['aws_apigatewayv2_api.api'] = {
                    monthly_requests: monthlyRequests
                };
                break;

            case 'GCP':
                usage['google_cloudfunctions_function.app'] = {
                    monthly_requests: monthlyRequests,
                    request_duration_ms: 250
                };
                usage['google_cloud_run_service.app'] = {
                    request_count: monthlyRequests
                };
                break;

            case 'AZURE':
                usage['azurerm_function_app.app'] = {
                    monthly_executions: monthlyRequests,
                    execution_duration_ms: 250
                };
                break;
        }
    }

    if (hasService('computecontainer') || hasService('compute_container')) {
        const instances = Math.max(2, Math.ceil((usage_profile.peak_concurrency || 100) / 50));

        switch (provider) {
            case 'AWS':
                // 🔥 FIX: Map Fargate usage to the Task Definition resource, not the Service
                // Infracost v0.10+ charges Fargate at task level
                usage['aws_ecs_task_definition.pricing-task'] = {
                    monthly_cpu_credit_hours: instances * 730, // vCPU hours
                    monthly_memory_gb_hours: instances * 2 * 730 // 2GB * hours
                };

                // Keep service for orchestration overhead if any
                usage['aws_ecs_service.app'] = {
                    monthly_cpu_hours: instances * 730,
                    monthly_memory_gb_hours: instances * 2 * 730
                };
                break;

            case 'GCP':
                // 🔥 FIX: Cloud Run charging model often requires billed duration
                // For REALTIME/Web platforms, we assume at least one instance is always warm (provisioned concurrency)
                usage['google_cloud_run_service.app'] = {
                    request_count: monthlyRequests,
                    average_request_duration_ms: 500,
                    // Force 24/7 billing: instances * 3600 sec/hr * 730 hr/mo
                    monthly_billable_instance_seconds: instances * 3600 * 730
                };
                break;

            case 'AZURE':
                usage['azurerm_container_app.app'] = {
                    v_cpu_duration: monthlyRequests * 0.5 // rough estimate
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // DATABASE SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('relationaldatabase') || hasService('relational_database')) {
        switch (provider) {
            case 'AWS':
                usage['aws_db_instance.db'] = {
                    storage_gb: storageGB,
                    monthly_read_iops: monthlyRequests * 0.7, // 70% reads
                    monthly_write_iops: monthlyRequests * 0.3  // 30% writes
                };
                break;

            case 'GCP':
                usage['google_sql_database_instance.db'] = {
                    storage_gb: storageGB
                };
                break;

            case 'AZURE':
                usage['azurerm_postgresql_flexible_server.db'] = {
                    storage_gb: storageGB
                };
                break;
        }
    }

    if (hasService('nosqldatabase') || hasService('nosql_database')) {
        switch (provider) {
            case 'AWS':
                usage['aws_dynamodb_table.main'] = {
                    monthly_write_request_units: monthlyRequests * 0.3,
                    monthly_read_request_units: monthlyRequests * 0.7,
                    storage_gb: storageGB
                };
                break;

            case 'GCP':
                usage['google_firestore_database.db'] = {
                    monthly_document_writes: monthlyRequests * 0.3,
                    monthly_document_reads: monthlyRequests * 0.7,
                    storage_gb: storageGB
                };
                break;

            case 'AZURE':
                usage['azurerm_cosmosdb_account.db'] = {
                    monthly_ru_per_second: Math.ceil(monthlyRequests / (30 * 24 * 3600))
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // STORAGE SERVICES
    // ═══════════════════════════════════════════════════════════════════

    // 🔥 FIX: Check for both 'object_storage' and 'objectstorage' (catalog uses no underscore)
    if (hasService('objectstorage') || hasService('object_storage')) {
        switch (provider) {
            case 'AWS':
                // Resource name must match objectStorage.js template: aws_s3_bucket.main
                usage['aws_s3_bucket.main'] = {
                    storage_gb: storageGB,
                    monthly_tier_1_requests: monthlyRequests * 0.1, // 10% direct S3 access
                    monthly_tier_2_requests: monthlyRequests * 0.05,
                    monthly_data_transfer_gb: {
                        outbound_internet: transferGB
                    }
                };
                break;

            case 'GCP':
                usage['google_storage_bucket.storage'] = {
                    storage_gb: storageGB,
                    monthly_class_a_operations: monthlyRequests * 0.1,
                    monthly_class_b_operations: monthlyRequests * 0.05,
                    monthly_outbound_data_transfer_gb: transferGB
                };
                break;

            case 'AZURE':
                usage['azurerm_storage_account.storage'] = {
                    storage_gb: storageGB,
                    monthly_data_transfer_gb: transferGB
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CACHE SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('cache')) {
        // Cache typically runs 24/7, not usage-based
        // Usage keys are minimal (mostly sizing-based in Terraform)
        switch (provider) {
            case 'AWS':
                usage['aws_elasticache_cluster.cache'] = {
                    // ElastiCache is instance-based, not heavily usage-dependent
                };
                break;

            case 'GCP':
                usage['google_redis_instance.cache'] = {
                    // Redis instance, mostly size-based
                };
                break;

            case 'AZURE':
                usage['azurerm_redis_cache.cache'] = {
                    // Azure Cache, mostly tier-based
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // NETWORKING SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('loadbalancer') || hasService('load_balancer')) {
        switch (provider) {
            case 'AWS':
                usage['aws_lb.alb'] = {
                    new_connections: monthlyRequests,
                    active_connections: Math.round(monthlyRequests / 30 / 24 / 60),
                    processed_bytes: transferGB * 1024 * 1024 * 1024
                };
                break;

            case 'GCP':
                usage['google_compute_forwarding_rule.lb'] = {
                    monthly_data_processed_gb: transferGB
                };
                break;

            case 'AZURE':
                usage['azurerm_application_gateway.gateway'] = {
                    monthly_data_processed_gb: transferGB
                };
                break;
        }
    }

    if (hasService('cdn')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudfront_distribution.cdn'] = {
                    monthly_data_transfer_to_internet_gb: {
                        us_canada_europe: transferGB
                    },
                    monthly_http_requests: {
                        us_canada_europe: monthlyRequests * 0.8
                    },
                    monthly_https_requests: {
                        us_canada_europe: monthlyRequests * 0.2
                    }
                };
                break;

            case 'GCP':
                usage['google_compute_backend_bucket.cdn'] = {
                    monthly_egress_data_transfer_gb: {
                        worldwide: transferGB
                    }
                };
                break;

            case 'AZURE':
                usage['azurerm_cdn_endpoint.cdn'] = {
                    zone_1_data_transfer_gb: transferGB
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // MESSAGING SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('messagequeue') || hasService('message_queue')) {
        const queueMessages = monthlyRequests * 0.2; // 20% async messages

        switch (provider) {
            case 'AWS':
                usage['aws_sqs_queue.queue'] = {
                    monthly_requests: queueMessages
                };
                break;

            case 'GCP':
                usage['google_pubsub_topic.topic'] = {
                    monthly_message_data_gb: Math.ceil(queueMessages / 1000000) // 1KB avg message
                };
                break;

            case 'AZURE':
                usage['azurerm_servicebus_namespace.bus'] = {
                    monthly_messages: queueMessages
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // IDENTITY & AUTH SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('identityauth') || hasService('identity_auth')) {
        const authRequests = monthlyRequests * 0.5; // 50% require auth

        switch (provider) {
            case 'AWS':
                usage['aws_cognito_user_pool.auth'] = {
                    monthly_active_users: usage_profile.monthly_users || 5000
                };
                break;

            case 'GCP':
                // Firebase Auth is usage-based but often free tier
                usage['google_identity_platform_config.auth'] = {
                    monthly_active_users: usage_profile.monthly_users || 5000
                };
                break;

            case 'AZURE':
                usage['azurerm_active_directory_b2c_directory.auth'] = {
                    monthly_active_users: usage_profile.monthly_users || 5000
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HIGH-AVAILABILITY / MULTI-REGION SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('globalloadbalancer') || hasService('global_load_balancer')) {
        switch (provider) {
            case 'AWS':
                usage['aws_lb.global_alb'] = {
                    new_connections: monthlyRequests,
                    active_connections: Math.round(monthlyRequests / 30 / 24 / 60),
                    processed_bytes: transferGB * 1024 * 1024 * 1024
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // API GATEWAY SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('apigateway') || hasService('api_gateway')) {
        switch (provider) {
            case 'AWS':
                usage['aws_apigatewayv2_api.api'] = {
                    monthly_requests: monthlyRequests
                };
                break;

            case 'GCP':
                usage['google_api_gateway_api.api'] = {
                    monthly_requests: monthlyRequests
                };
                break;

            case 'AZURE':
                usage['azurerm_api_management.api'] = {
                    monthly_calls: monthlyRequests
                };
                break;
        }
    }

    if (hasService('websocketgateway') || hasService('websocket_gateway')) {
        switch (provider) {
            case 'AWS':
                usage['aws_apigatewayv2_api.websocket'] = {
                    monthly_connection_minutes: monthlyRequests * 5, // 5 mins avg per connection
                    monthly_messages: monthlyRequests * 10 // 10 messages per connection
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // MONITORING & LOGGING SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('monitoring')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudwatch_metric_alarm.monitoring'] = {
                    metrics: 50 // number of custom metrics
                };
                break;
        }
    }

    if (hasService('logging')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudwatch_log_group.logs'] = {
                    monthly_data_ingested_gb: Math.max(10, storageGB * 0.5),
                    monthly_data_archived_gb: storageGB * 0.3
                };
                break;
        }
    }

    if (hasService('auditlogging') || hasService('audit_logging')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudwatch_log_group.audit'] = {
                    monthly_data_ingested_gb: Math.max(5, storageGB * 0.2),
                    monthly_data_archived_gb: storageGB * 0.5
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SECRETS & SECURITY SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('secretsmanagement') || hasService('secrets_management') ||
        hasService('secrets_manager')) {
        switch (provider) {
            case 'AWS':
                usage['aws_secretsmanager_secret.vault'] = {
                    monthly_api_calls: 10000 // typical secret retrieval
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // IOT SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('iotcore') || hasService('iot_core')) {
        const deviceMessages = (usage_profile.device_count || 1000) * 30 * 24 * 60; // 1 msg/min
        switch (provider) {
            case 'AWS':
                usage['aws_iot_topic_rule.telemetry'] = {
                    monthly_messages: deviceMessages
                };
                break;
        }
    }

    if (hasService('timeseriesdatabase') || hasService('time_series_db')) {
        switch (provider) {
            case 'AWS':
                usage['aws_timestreamwrite_database.tsdb'] = {
                    monthly_writes_gb: storageGB * 0.1
                };
                break;
        }
    }

    if (hasService('eventstreaming') || hasService('event_streaming')) {
        switch (provider) {
            case 'AWS':
                usage['aws_kinesis_stream.events'] = {
                    monthly_shard_hours: 2 * 730 // 2 shards 24/7
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // ML / AI SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (hasService('mlinference') ||
        hasService('ml_inference_gpu') ||
        hasService('ml_inference_service')) {

        // Calculate ML inference usage from user inputs
        const mlInferences = monthlyRequests * 0.5; // Assume 50% of requests are ML inferences

        switch (provider) {
            case 'AWS':
                usage['aws_sagemaker_endpoint.inference'] = {
                    monthly_inference_instances: 1,
                    monthly_inference_hours: 730, // 24/7
                    monthly_inference_requests: mlInferences
                };
                break;
            case 'GCP':
                usage['google_vertex_ai_endpoint.inference'] = {
                    monthly_prediction_requests: mlInferences
                };
                break;
            case 'AZURE':
                usage['azurerm_machine_learning_inference_cluster.inference'] = {
                    monthly_inference_hours: 730
                };
                break;
        }
    }

    if (deployableServices.includes('vector_database')) {
        switch (provider) {
            case 'AWS':
                usage['aws_opensearch_domain.vectors'] = {
                    storage_gb: storageGB,
                    monthly_index_requests: monthlyRequests * 0.1
                };
                break;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // DATA / STORAGE SERVICES
    // ═══════════════════════════════════════════════════════════════════

    if (deployableServices.includes('data_lake')) {
        switch (provider) {
            case 'AWS':
                usage['aws_s3_bucket.data_lake'] = {
                    storage_gb: storageGB * 10, // data lakes are large
                    monthly_tier_1_requests: monthlyRequests * 0.05
                };
                break;
        }
    }

    if (deployableServices.includes('app_compute')) {
        switch (provider) {
            case 'AWS':
                usage['aws_ecs_service.app'] = {
                    monthly_cpu_hours: 2 * 730, // 2 instances 24/7
                    monthly_memory_gb_hours: 4 * 730 // 2GB each
                };
                break;
        }
    }

    console.log(`[USAGE NORMALIZER] Generated ${Object.keys(usage).length} resource usage entries`);

    return usage;
}

/**
 * Convert normalized usage object to Infracost YAML format.
 */
function toInfracostYAML(normalizedUsage) {
    let yaml = `version: 0.1\nusage:\n`;

    for (const [resourceName, usageData] of Object.entries(normalizedUsage)) {
        yaml += `  ${resourceName}:\n`;

        for (const [key, value] of Object.entries(usageData)) {
            if (typeof value === 'object' && value !== null) {
                // Nested object (e.g., monthly_data_transfer_gb)
                yaml += `    ${key}:\n`;
                for (const [subKey, subValue] of Object.entries(value)) {
                    yaml += `      ${subKey}: ${subValue}\n`;
                }
            } else {
                yaml += `    ${key}: ${value}\n`;
            }
        }
    }

    return yaml;
}

/**
 * Convenience wrapper: Normalize + Convert to YAML
 */
function generateInfracostUsageFile(deployableServices, usageProfile, provider = 'AWS') {
    // Note: Provider defaults to AWS for structure if not specified, 
    // but ideally should be passed. InfracostService passes it implicitly?
    // Actually infracostService loop calls this, but previously passed (billableServices, usageProfile).
    // The signature in usageNormalizer.normalizeUsageForInfracost is (usage_profile, deployableServices, provider).
    // We need to match the call site: usageNormalizer.generateInfracostUsageFile(billableServices, usageProfile)

    // We'll map the params correctly.
    // Provider is missing in the call site in infracostService.js!
    // We need to fix the call site in infracostService.js to pass provider, OR infer it.
    // However, since usage keys are provider-specific (aws_ vs google_), we MUST know the provider.

    // For now, let's look at the call site in infracostService.js:
    // usageNormalizer.generateInfracostUsageFile(billableServices, usageProfile) 
    // It's inside generateCostEstimate(provider, ...)

    // So I should also update infracostService.js to pass 'provider'.

    // But first, let's define this function to accept (deployableServices, usageProfile, provider).
    const usage = normalizeUsageForInfracost(usageProfile, deployableServices, provider || 'AWS');
    return toInfracostYAML(usage);
}

module.exports = {
    normalizeUsageForInfracost,
    toInfracostYAML,
    generateInfracostUsageFile
};
