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

    if (deployableServices.includes('compute_serverless') ||
        deployableServices.includes('app_compute')) {

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

    if (deployableServices.includes('compute_container')) {
        const instances = Math.max(2, Math.ceil((usage_profile.peak_concurrency || 100) / 50));

        switch (provider) {
            case 'AWS':
                usage['aws_ecs_service.app'] = {
                    monthly_cpu_hours: instances * 730, // 730 hours/month
                    monthly_memory_gb_hours: instances * 2 * 730 // 2GB per instance
                };
                break;

            case 'GCP':
                usage['google_cloud_run_service.app'] = {
                    request_count: monthlyRequests,
                    average_request_duration: 250
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

    if (deployableServices.includes('relational_database')) {
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

    if (deployableServices.includes('nosql_database')) {
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

    if (deployableServices.includes('object_storage')) {
        switch (provider) {
            case 'AWS':
                usage['aws_s3_bucket.storage'] = {
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

    if (deployableServices.includes('cache')) {
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

    if (deployableServices.includes('load_balancer')) {
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

    if (deployableServices.includes('cdn')) {
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

    if (deployableServices.includes('message_queue')) {
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

    if (deployableServices.includes('identity_auth')) {
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

    if (deployableServices.includes('global_load_balancer')) {
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

    if (deployableServices.includes('api_gateway')) {
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

    if (deployableServices.includes('websocket_gateway')) {
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

    if (deployableServices.includes('monitoring')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudwatch_metric_alarm.monitoring'] = {
                    metrics: 50 // number of custom metrics
                };
                break;
        }
    }

    if (deployableServices.includes('logging')) {
        switch (provider) {
            case 'AWS':
                usage['aws_cloudwatch_log_group.logs'] = {
                    monthly_data_ingested_gb: Math.max(10, storageGB * 0.5),
                    monthly_data_archived_gb: storageGB * 0.3
                };
                break;
        }
    }

    if (deployableServices.includes('audit_logging')) {
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

    if (deployableServices.includes('secrets_management') ||
        deployableServices.includes('secrets_manager')) {
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

    if (deployableServices.includes('iot_core')) {
        const deviceMessages = (usage_profile.device_count || 1000) * 30 * 24 * 60; // 1 msg/min
        switch (provider) {
            case 'AWS':
                usage['aws_iot_topic_rule.telemetry'] = {
                    monthly_messages: deviceMessages
                };
                break;
        }
    }

    if (deployableServices.includes('time_series_db')) {
        switch (provider) {
            case 'AWS':
                usage['aws_timestreamwrite_database.tsdb'] = {
                    monthly_writes_gb: storageGB * 0.1
                };
                break;
        }
    }

    if (deployableServices.includes('event_streaming')) {
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

    if (deployableServices.includes('mlinference') ||
        deployableServices.includes('ml_inference_gpu') ||
        deployableServices.includes('ml_inference_service')) {

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

module.exports = {
    normalizeUsageForInfracost,
    toInfracostYAML
};
