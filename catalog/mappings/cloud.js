/**
 * backend/catalog/mappings/cloud.js
 *
 * Single source of truth for:
 * 1) Canonical service id -> cloud product (AWS/GCP/Azure) with profiles:
 *    - COST_EFFECTIVE | HIGH_PERFORMANCE
 * 2) Terraform resource types per provider (aws/gcp/azure)
 * 3) Pricing metadata per service (infracost resource types where applicable)
 *
 * NOTE:
 * - Domains (your 20 strategies + 9 facets) should NOT change this file directly.
 *   Domains/facets only decide which canonical services are needed.
 * - This file only needs to cover the canonical services that can appear in your architecture.
 */
'use strict';

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const PROFILES = {
    COST_EFFECTIVE: 'COST_EFFECTIVE',
    HIGH_PERFORMANCE: 'HIGH_PERFORMANCE'
};

const PROVIDERS = {
    AWS: 'AWS',
    GCP: 'GCP',
    AZURE: 'AZURE'
};

function normProvider(provider) {
    const p = String(provider || '').trim().toUpperCase();
    if (p === 'AWS' || p === 'AMAZON' || p === 'AMAZONWEB_SERVICES') return PROVIDERS.AWS;
    if (p === 'GCP' || p === 'GOOGLE' || p === 'GOOGLECLOUD') return PROVIDERS.GCP;
    if (p === 'AZURE' || p === 'MICROSOFT' || p === 'MSAZURE') return PROVIDERS.AZURE;
    return p;
}

function normProfile(profile) {
    const p = String(profile || '').trim().toUpperCase();
    if (p === 'HIGH' || p === 'PERFORMANCE' || p === 'HIGH_PERF' || p === 'HIGH_PERFORMANCE') return PROFILES.HIGH_PERFORMANCE;
    return PROFILES.COST_EFFECTIVE;
}

// ----------------------------------------------------------------------------
// Service Catalog (canonical services)
// ----------------------------------------------------------------------------
// Each service includes:
// - terraform: moduleId + resourceType per provider
// - pricing: engine + infracost resourceType per provider (when you use infracost)
// - cloud: product id selection per provider with profiles
//
// IMPORTANT: Canonical service ids here must match what your pipeline emits
// (capabilities.js => deployable services list).
// ----------------------------------------------------------------------------

const SERVICE_CATALOG = {
    // ------------------------
    // Compute
    // ------------------------
    compute_serverless: {
        id: 'compute_serverless',
        terraform: {
            terraform_supported: true,
            moduleId: 'serverless_compute',
            resourceType: {
                aws: 'aws_lambda_function',
                gcp: 'google_cloudfunctions_function',
                azure: 'azurerm_function_app'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_lambda_function',
                gcp: 'google_cloudfunctions_function',
                azure: 'azurerm_function_app'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_lambda' },
            GCP: { DEFAULT: 'gcp_cloud_functions' },
            AZURE: { DEFAULT: 'az_functions' }
        }
    },

    compute_container: {
        id: 'compute_container',
        terraform: {
            terraform_supported: true,
            moduleId: 'app_compute',
            resourceType: {
                aws: 'aws_ecs_service',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_container_app'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_ecs_service',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_container_app'
            }
        },
        cloud: {
            AWS: { COST_EFFECTIVE: 'aws_ecs_fargate', HIGH_PERFORMANCE: 'aws_eks', DEFAULT: 'aws_ecs_fargate' },
            GCP: { COST_EFFECTIVE: 'gcp_cloud_run', HIGH_PERFORMANCE: 'gcp_gke', DEFAULT: 'gcp_cloud_run' },
            AZURE: { COST_EFFECTIVE: 'az_container_apps', HIGH_PERFORMANCE: 'az_aks', DEFAULT: 'az_container_apps' }
        }
    },

    compute_vm: {
        id: 'compute_vm',
        terraform: {
            terraform_supported: true,
            moduleId: 'app_compute',
            resourceType: {
                aws: 'aws_instance',
                gcp: 'google_compute_instance',
                azure: 'azurerm_virtual_machine'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_instance',
                gcp: 'google_compute_instance',
                azure: 'azurerm_virtual_machine'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_instance' },
            GCP: { DEFAULT: 'gcp_compute_engine' },
            AZURE: { DEFAULT: 'az_virtual_machines' }
        }
    },

    compute_batch: {
        id: 'compute_batch',
        terraform: {
            terraform_supported: true,
            moduleId: 'batch_compute',
            resourceType: {
                aws: 'aws_batch_compute_environment',
                gcp: 'google_batch_job',
                azure: 'azurerm_batch_account'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_batch_compute_environment',
                gcp: 'google_batch_job',
                azure: 'azurerm_batch_account'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_batch' },
            GCP: { DEFAULT: 'gcp_batch' },
            AZURE: { DEFAULT: 'az_batch' }
        }
    },

    compute_edge: {
        id: 'compute_edge',
        terraform: {
            terraform_supported: true,
            moduleId: 'edge_compute',
            resourceType: {
                aws: 'aws_cloudfront_function',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_frontdoor_rule_set'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudfront_function',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_frontdoor_rule_set'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudfront_functions' },
            GCP: { DEFAULT: 'gcp_cloud_cdn_edge' },
            AZURE: { DEFAULT: 'az_front_door_edge' }
        }
    },

    // ------------------------
    // Databases / Storage
    // ------------------------
    relational_database: {
        id: 'relational_database',
        terraform: {
            terraform_supported: true,
            moduleId: 'relational_database',
            // NOTE: generic resource type; engine selection is handled in mapServiceToCloud().
            resourceType: {
                aws: 'aws_db_instance',
                gcp: 'google_sql_database_instance',
                azure: 'azurerm_postgresql_flexible_server'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_db_instance',
                gcp: 'google_sql_database_instance',
                azure: 'azurerm_postgresql_flexible_server'
            }
        },
        cloud: {
            AWS: {
                POSTGRES_COST: 'aws_rds_postgresql',
                POSTGRES_PERF: 'aws_aurora_postgresql',
                MYSQL_COST: 'aws_rds_mysql',
                MYSQL_PERF: 'aws_aurora_mysql',
                DEFAULT: 'aws_rds_postgresql'
            },
            GCP: {
                POSTGRES_COST: 'gcp_cloud_sql_postgres',
                POSTGRES_PERF: 'gcp_cloud_sql_postgres_ha',
                MYSQL_COST: 'gcp_cloud_sql_mysql',
                DEFAULT: 'gcp_cloud_sql_postgres'
            },
            AZURE: {
                POSTGRES_COST: 'az_postgresql_flexible',
                POSTGRES_PERF: 'az_postgresql_flexible_ha',
                MYSQL_COST: 'az_mysql_flexible',
                DEFAULT: 'az_postgresql_flexible'
            }
        }
    },

    nosql_database: {
        id: 'nosql_database',
        terraform: {
            terraform_supported: true,
            moduleId: 'nosql_database',
            resourceType: {
                aws: 'aws_dynamodb_table',
                gcp: 'google_firestore_database',
                azure: 'azurerm_cosmosdb_account'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_dynamodb_table',
                gcp: 'google_firestore_database',
                azure: 'azurerm_cosmosdb_account'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_dynamodb' },
            GCP: { DEFAULT: 'gcp_firestore' },
            AZURE: { DEFAULT: 'az_cosmosdb' }
        }
    },

    cache: {
        id: 'cache',
        terraform: {
            terraform_supported: true,
            moduleId: 'cache',
            resourceType: {
                aws: 'aws_elasticache_cluster',
                gcp: 'google_redis_instance',
                azure: 'azurerm_redis_cache'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_elasticache_cluster',
                gcp: 'google_redis_instance',
                azure: 'azurerm_redis_cache'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_elasticache_redis' },
            GCP: { DEFAULT: 'gcp_memorystore_redis' },
            AZURE: { DEFAULT: 'az_redis' }
        }
    },

    search_engine: {
        id: 'search_engine',
        terraform: {
            terraform_supported: true,
            moduleId: 'search_engine',
            resourceType: {
                aws: 'aws_opensearch_domain',
                gcp: 'google_discovery_engine_data_store',
                azure: 'azurerm_search_service'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_opensearch_domain',
                gcp: 'google_discovery_engine_data_store',
                azure: 'azurerm_search_service'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_opensearch' },
            GCP: { DEFAULT: 'gcp_elastic_cloud' },
            AZURE: { DEFAULT: 'az_ai_search' }
        }
    },

    object_storage: {
        id: 'object_storage',
        terraform: {
            terraform_supported: true,
            moduleId: 'object_storage',
            resourceType: {
                aws: 'aws_s3_bucket',
                gcp: 'google_storage_bucket',
                azure: 'azurerm_storage_account'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_s3_bucket',
                gcp: 'google_storage_bucket',
                azure: 'azurerm_storage_account'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_s3' },
            GCP: { DEFAULT: 'gcp_cloud_storage' },
            AZURE: { DEFAULT: 'az_blob_storage' }
        }
    },

    block_storage: {
        id: 'block_storage',
        terraform: {
            terraform_supported: true,
            moduleId: 'block_storage',
            resourceType: {
                aws: 'aws_ebs_volume',
                gcp: 'google_compute_disk',
                azure: 'azurerm_managed_disk'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_ebs_volume',
                gcp: 'google_compute_disk',
                azure: 'azurerm_managed_disk'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_ebs' },
            GCP: { DEFAULT: 'gcp_persistent_disk' },
            AZURE: { DEFAULT: 'az_managed_disks' }
        }
    },

    file_storage: {
        id: 'file_storage',
        terraform: {
            terraform_supported: true,
            moduleId: 'file_storage',
            resourceType: {
                aws: 'aws_efs_file_system',
                gcp: 'google_filestore_instance',
                azure: 'azurerm_storage_share'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_efs_file_system',
                gcp: 'google_filestore_instance',
                azure: 'azurerm_storage_share'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_efs' },
            GCP: { DEFAULT: 'gcp_filestore' },
            AZURE: { DEFAULT: 'az_files' }
        }
    },

    backup: {
        id: 'backup',
        terraform: {
            terraform_supported: true,
            moduleId: 'backup',
            resourceType: {
                aws: 'aws_backup_plan',
                gcp: 'google_backup_dr_backup_plan',
                azure: 'azurerm_recovery_services_vault'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_backup_plan',
                gcp: 'google_backup_dr_backup_plan',
                azure: 'azurerm_recovery_services_vault'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_backup' },
            GCP: { DEFAULT: 'gcp_backup_and_dr' },
            AZURE: { DEFAULT: 'az_recovery_services' }
        }
    },

    // ------------------------
    // Networking / Delivery
    // ------------------------
    api_gateway: {
        id: 'api_gateway',
        terraform: {
            terraform_supported: true,
            moduleId: 'api_gateway',
            resourceType: {
                aws: 'aws_apigatewayv2_api',
                gcp: 'google_api_gateway_api',
                azure: 'azurerm_api_management'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_apigatewayv2_api',
                gcp: 'google_api_gateway_api',
                azure: 'azurerm_api_management'
            }
        },
        cloud: {
            AWS: { COST_EFFECTIVE: 'aws_apigateway_v2', HIGH_PERFORMANCE: 'aws_api_gateway_rest', DEFAULT: 'aws_apigateway_v2' },
            GCP: { DEFAULT: 'gcp_api_gateway' },
            AZURE: { DEFAULT: 'az_api_management' }
        }
    },

    load_balancer: {
        id: 'load_balancer',
        terraform: {
            terraform_supported: true,
            moduleId: 'load_balancer',
            resourceType: {
                aws: 'aws_lb',
                gcp: 'google_compute_url_map',
                azure: 'azurerm_application_gateway'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_lb',
                gcp: 'google_compute_url_map',
                azure: 'azurerm_application_gateway'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_alb' },
            GCP: { DEFAULT: 'gcp_cloud_load_balancing' },
            AZURE: { DEFAULT: 'az_application_gateway' }
        }
    },

    cdn: {
        id: 'cdn',
        terraform: {
            terraform_supported: true,
            moduleId: 'cdn',
            resourceType: {
                aws: 'aws_cloudfront_distribution',
                gcp: 'google_compute_backend_bucket',
                azure: 'azurerm_cdn_profile'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudfront_distribution',
                gcp: 'google_compute_backend_bucket',
                azure: 'azurerm_cdn_profile'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudfront' },
            GCP: { DEFAULT: 'gcp_cloud_cdn' },
            AZURE: { COST_EFFECTIVE: 'az_cdn', HIGH_PERFORMANCE: 'az_front_door', DEFAULT: 'az_cdn' }
        }
    },

    dns: {
        id: 'dns',
        terraform: {
            terraform_supported: true,
            moduleId: 'dns',
            resourceType: {
                aws: 'aws_route53_zone',
                gcp: 'google_dns_managed_zone',
                azure: 'azurerm_dns_zone'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_route53' },
            GCP: { DEFAULT: 'gcp_cloud_dns' },
            AZURE: { DEFAULT: 'az_dns' }
        }
    },

    vpc_networking: {
        id: 'vpc_networking',
        terraform: {
            terraform_supported: true,
            moduleId: 'vpc_networking',
            resourceType: {
                aws: 'aws_vpc',
                gcp: 'google_compute_network',
                azure: 'azurerm_virtual_network'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_vpc' },
            GCP: { DEFAULT: 'gcp_vpc' },
            AZURE: { DEFAULT: 'az_virtual_network' }
        }
    },

    nat_gateway: {
        id: 'nat_gateway',
        terraform: {
            terraform_supported: true,
            moduleId: 'nat_gateway',
            resourceType: {
                aws: 'aws_nat_gateway',
                gcp: 'google_compute_router_nat',
                azure: 'azurerm_nat_gateway'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_nat_gateway',
                gcp: 'google_compute_router_nat',
                azure: 'azurerm_nat_gateway'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_nat_gateway' },
            GCP: { DEFAULT: 'gcp_cloud_nat' },
            AZURE: { DEFAULT: 'az_nat_gateway' }
        }
    },

    vpn: {
        id: 'vpn',
        terraform: {
            terraform_supported: true,
            moduleId: 'vpn',
            resourceType: {
                aws: 'aws_vpn_connection',
                gcp: 'google_compute_vpn_gateway',
                azure: 'azurerm_virtual_network_gateway'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_vpn_connection',
                gcp: 'google_compute_vpn_gateway',
                azure: 'azurerm_virtual_network_gateway'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_vpn' },
            GCP: { DEFAULT: 'gcp_cloud_vpn' },
            AZURE: { DEFAULT: 'az_vpn_gateway' }
        }
    },

    private_link: {
        id: 'private_link',
        terraform: {
            terraform_supported: true,
            moduleId: 'private_link',
            resourceType: {
                aws: 'aws_vpc_endpoint',
                gcp: 'google_compute_service_attachment',
                azure: 'azurerm_private_endpoint'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_privatelink' },
            GCP: { DEFAULT: 'gcp_private_service_connect' },
            AZURE: { DEFAULT: 'az_private_endpoint' }
        }
    },

    service_discovery: {
        id: 'service_discovery',
        terraform: {
            terraform_supported: true,
            moduleId: 'service_discovery',
            resourceType: {
                aws: 'aws_service_discovery_private_dns_namespace',
                gcp: 'google_service_directory_namespace',
                azure: 'azurerm_private_dns_zone'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_service_discovery_private_dns_namespace',
                gcp: 'google_service_directory_namespace',
                azure: 'azurerm_private_dns_zone'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloud_map' },
            GCP: { DEFAULT: 'gcp_service_directory' },
            AZURE: { DEFAULT: 'az_private_dns' }
        }
    },

    service_mesh: {
        id: 'service_mesh',
        terraform: {
            terraform_supported: true,
            moduleId: 'service_mesh',
            resourceType: {
                aws: 'aws_appmesh_mesh',
                gcp: 'google_gke_hub_feature',
                azure: 'azurerm_kubernetes_cluster'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_appmesh_mesh',
                gcp: 'google_gke_hub_feature',
                azure: 'azurerm_kubernetes_cluster'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_app_mesh' },
            GCP: { DEFAULT: 'gcp_anthos_service_mesh' },
            AZURE: { DEFAULT: 'az_service_mesh_aks' }
        }
    },

    websocket_gateway: {
        id: 'websocket_gateway',
        terraform: {
            terraform_supported: true,
            moduleId: 'websocket_gateway',
            resourceType: {
                aws: 'aws_apigatewayv2_api',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_signalr_service'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_apigatewayv2_api',
                gcp: 'google_cloud_run_service',
                azure: 'azurerm_signalr_service'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_apigateway_websocket' },
            GCP: { DEFAULT: 'gcp_cloud_run_websocket' },
            AZURE: { DEFAULT: 'az_signalr' }
        }
    },

    global_load_balancer: {
        id: 'global_load_balancer',
        terraform: {
            terraform_supported: true,
            moduleId: 'global_load_balancer',
            resourceType: {
                aws: 'aws_globalaccelerator_accelerator',
                gcp: 'google_compute_global_forwarding_rule',
                azure: 'azurerm_frontdoor'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_globalaccelerator_accelerator',
                gcp: 'google_compute_global_forwarding_rule',
                azure: 'azurerm_frontdoor'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_global_accelerator' },
            GCP: { DEFAULT: 'gcp_global_load_balancer' },
            AZURE: { DEFAULT: 'az_front_door' }
        }
    },

    // ------------------------
    // Integration / Messaging
    // ------------------------
    messaging_queue: {
        id: 'messaging_queue',
        terraform: {
            terraform_supported: true,
            moduleId: 'messaging_queue',
            resourceType: {
                aws: 'aws_sqs_queue',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_servicebus_queue'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sqs_queue',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_servicebus_queue'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_sqs' },
            GCP: { DEFAULT: 'gcp_pubsub' },
            AZURE: { DEFAULT: 'az_service_bus' }
        }
    },

    event_bus: {
        id: 'event_bus',
        terraform: {
            terraform_supported: true,
            moduleId: 'event_bus',
            resourceType: {
                aws: 'aws_cloudwatch_event_bus',
                gcp: 'google_eventarc_trigger',
                azure: 'azurerm_eventgrid_topic'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudwatch_event_bus',
                gcp: 'google_eventarc_trigger',
                azure: 'azurerm_eventgrid_topic'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_eventbridge' },
            GCP: { DEFAULT: 'gcp_eventarc' },
            AZURE: { DEFAULT: 'az_event_grid' }
        }
    },

    workflow_orchestration: {
        id: 'workflow_orchestration',
        terraform: {
            terraform_supported: true,
            moduleId: 'workflow_orchestration',
            resourceType: {
                aws: 'aws_sfn_state_machine',
                gcp: 'google_workflows_workflow',
                azure: 'azurerm_logic_app_workflow'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sfn_state_machine',
                gcp: 'google_workflows_workflow',
                azure: 'azurerm_logic_app_workflow'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_step_functions' },
            GCP: { DEFAULT: 'gcp_workflows' },
            AZURE: { DEFAULT: 'az_logic_apps' }
        }
    },

    notification: {
        id: 'notification',
        terraform: {
            terraform_supported: true,
            moduleId: 'notification',
            resourceType: {
                aws: 'aws_sns_topic',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_notification_hub'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sns_topic',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_notification_hub'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_sns' },
            GCP: { DEFAULT: 'gcp_pubsub_notifications' },
            AZURE: { DEFAULT: 'az_notification_hubs' }
        }
    },

    email_service: {
        id: 'email_service',
        terraform: {
            terraform_supported: true,
            moduleId: 'email',
            resourceType: {
                aws: 'aws_ses_domain_identity',
                gcp: 'google_cloud_tasks_queue',
                azure: 'azurerm_communication_service'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_ses_domain_identity',
                gcp: 'google_cloud_tasks_queue',
                azure: 'azurerm_communication_service'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_ses' },
            GCP: { DEFAULT: 'gcp_email_tasks' },
            AZURE: { DEFAULT: 'az_communication_services' }
        }
    },

    push_notification_service: {
        id: 'push_notification_service',
        terraform: {
            terraform_supported: true,
            moduleId: 'push_notification',
            resourceType: {
                aws: 'aws_sns_platform_application',
                gcp: 'google_firebase_project',
                azure: 'azurerm_notification_hub'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sns_platform_application',
                gcp: 'google_firebase_project',
                azure: 'azurerm_notification_hub'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_sns_mobile_push' },
            GCP: { DEFAULT: 'gcp_fcm' },
            AZURE: { DEFAULT: 'az_notification_hubs' }
        }
    },

    // Payments Processing (External gateway integration via secrets + webhook endpoints)
    payments_processor: {
        id: 'payments_processor',
        terraform: {
            terraform_supported: true,
            moduleId: 'payments',
            resourceType: {
                // Uses secrets manager + API Gateway webhook endpoint
                aws: 'aws_secretsmanager_secret',
                gcp: 'google_secret_manager_secret',
                azure: 'azurerm_key_vault_secret'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_secretsmanager_secret',
                gcp: 'google_secret_manager_secret',
                azure: 'azurerm_key_vault_secret'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'stripe_via_secrets_manager' },
            GCP: { DEFAULT: 'stripe_via_secret_manager' },
            AZURE: { DEFAULT: 'stripe_via_key_vault' }
        }
    },

    // ------------------------
    // Security
    // ------------------------
    identity_auth: {
        id: 'identity_auth',
        terraform: {
            terraform_supported: true,
            moduleId: 'auth',
            resourceType: {
                aws: 'aws_cognito_user_pool',
                gcp: 'google_identity_platform_config',
                azure: 'azurerm_active_directory_b2c'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cognito_user_pool',
                gcp: 'google_identity_platform_config',
                azure: 'azurerm_active_directory_b2c'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cognito' },
            GCP: { DEFAULT: 'gcp_identity_platform' },
            AZURE: { DEFAULT: 'az_ad_b2c' }
        }
    },

    secrets_management: {
        id: 'secrets_management',
        terraform: {
            terraform_supported: true,
            moduleId: 'secrets',
            resourceType: {
                aws: 'aws_secretsmanager_secret',
                gcp: 'google_secret_manager_secret',
                azure: 'azurerm_key_vault_secret'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_secretsmanager_secret',
                gcp: 'google_secret_manager_secret',
                azure: 'azurerm_key_vault_secret'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_secrets_manager' },
            GCP: { DEFAULT: 'gcp_secret_manager' },
            AZURE: { DEFAULT: 'az_key_vault_secrets' }
        }
    },

    key_management: {
        id: 'key_management',
        terraform: {
            terraform_supported: true,
            moduleId: 'key_management',
            resourceType: {
                aws: 'aws_kms_key',
                gcp: 'google_kms_key_ring',
                azure: 'azurerm_key_vault_key'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_kms_key',
                gcp: 'google_kms_key_ring',
                azure: 'azurerm_key_vault_key'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_kms' },
            GCP: { DEFAULT: 'gcp_cloud_kms' },
            AZURE: { DEFAULT: 'az_key_vault_keys' }
        }
    },

    certificate_management: {
        id: 'certificate_management',
        terraform: {
            terraform_supported: true,
            moduleId: 'certificate_management',
            resourceType: {
                aws: 'aws_acm_certificate',
                gcp: 'google_certificate_manager_certificate',
                azure: 'azurerm_app_service_certificate'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_acm' },
            GCP: { DEFAULT: 'gcp_certificate_manager' },
            AZURE: { DEFAULT: 'az_key_vault_certs' }
        }
    },

    waf: {
        id: 'waf',
        terraform: {
            terraform_supported: true,
            moduleId: 'waf',
            resourceType: {
                aws: 'aws_wafv2_web_acl',
                gcp: 'google_compute_security_policy',
                azure: 'azurerm_web_application_firewall_policy'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_wafv2_web_acl',
                gcp: 'google_compute_security_policy',
                azure: 'azurerm_web_application_firewall_policy'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_waf' },
            GCP: { DEFAULT: 'gcp_cloud_armor' },
            AZURE: { DEFAULT: 'az_waf' }
        }
    },

    ddos_protection: {
        id: 'ddos_protection',
        terraform: {
            terraform_supported: true,
            moduleId: 'ddos_protection',
            resourceType: {
                aws: 'aws_shield_protection',
                gcp: 'google_compute_security_policy',
                azure: 'azurerm_network_ddos_protection_plan'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_shield' },
            GCP: { DEFAULT: 'gcp_cloud_armor_ddos' },
            AZURE: { DEFAULT: 'az_ddos_protection' }
        }
    },

    policy_governance: {
        id: 'policy_governance',
        terraform: {
            terraform_supported: true,
            moduleId: 'policy_governance',
            resourceType: {
                aws: 'aws_organizations_organization',
                gcp: 'google_org_policy_policy',
                azure: 'azurerm_policy_definition'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_organizations' },
            GCP: { DEFAULT: 'gcp_org_policy' },
            AZURE: { DEFAULT: 'az_azure_policy' }
        }
    },

    // ------------------------
    // Observability
    // ------------------------
    logging: {
        id: 'logging',
        terraform: {
            terraform_supported: true,
            moduleId: 'logging',
            resourceType: {
                aws: 'aws_cloudwatch_log_group',
                gcp: 'google_logging_project_sink',
                azure: 'azurerm_log_analytics_workspace'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudwatch_log_group',
                gcp: 'google_logging_project_sink',
                azure: 'azurerm_log_analytics_workspace'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudwatch_logs' },
            GCP: { DEFAULT: 'gcp_cloud_logging' },
            AZURE: { DEFAULT: 'az_log_analytics' }
        }
    },

    monitoring: {
        id: 'monitoring',
        terraform: {
            terraform_supported: true,
            moduleId: 'monitoring',
            resourceType: {
                aws: 'aws_cloudwatch_dashboard',
                gcp: 'google_monitoring_dashboard',
                azure: 'azurerm_monitor_action_group'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudwatch' },
            GCP: { DEFAULT: 'gcp_cloud_monitoring' },
            AZURE: { DEFAULT: 'az_monitor' }
        }
    },

    tracing: {
        id: 'tracing',
        terraform: {
            terraform_supported: true,
            moduleId: 'tracing',
            resourceType: {
                aws: 'aws_xray_group',
                gcp: 'google_project_service',
                azure: 'azurerm_application_insights'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_xray' },
            GCP: { DEFAULT: 'gcp_cloud_trace' },
            AZURE: { DEFAULT: 'az_app_insights' }
        }
    },

    siem: {
        id: 'siem',
        terraform: {
            terraform_supported: true,
            moduleId: 'siem',
            resourceType: {
                aws: 'aws_securityhub_account',
                gcp: 'google_scc_notification_config',
                azure: 'azurerm_sentinel_alert_rule_scheduled'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_security_hub' },
            GCP: { DEFAULT: 'gcp_security_command_center' },
            AZURE: { DEFAULT: 'az_sentinel' }
        }
    },

    // ------------------------
    // DevOps
    // ------------------------
    container_registry: {
        id: 'container_registry',
        terraform: {
            terraform_supported: true,
            moduleId: 'container_registry',
            resourceType: {
                aws: 'aws_ecr_repository',
                gcp: 'google_artifact_registry_repository',
                azure: 'azurerm_container_registry'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_ecr_repository',
                gcp: 'google_artifact_registry_repository',
                azure: 'azurerm_container_registry'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_ecr' },
            GCP: { DEFAULT: 'gcp_artifact_registry' },
            AZURE: { DEFAULT: 'az_acr' }
        }
    },

    ci_cd: {
        id: 'ci_cd',
        terraform: {
            terraform_supported: true,
            moduleId: 'ci_cd',
            resourceType: {
                aws: 'aws_codepipeline',
                gcp: 'google_cloudbuild_trigger',
                azure: 'azurerm_devops' // conceptual placeholder in your earlier mapping style
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_codepipeline' },
            GCP: { DEFAULT: 'gcp_cloud_build' },
            AZURE: { DEFAULT: 'az_devops' }
        }
    },

    artifact_repository: {
        id: 'artifact_repository',
        terraform: {
            terraform_supported: true,
            moduleId: 'artifact_repository',
            resourceType: {
                aws: 'aws_codeartifact_repository',
                gcp: 'google_artifact_registry_repository',
                azure: 'azurerm_container_registry'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_codeartifact_repository',
                gcp: 'google_artifact_registry_repository',
                azure: 'azurerm_container_registry'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_codeartifact' },
            GCP: { DEFAULT: 'gcp_artifact_registry' },
            AZURE: { DEFAULT: 'az_artifacts' }
        }
    },

    // ------------------------
    // IoT / Streaming
    // ------------------------
    iot_core: {
        id: 'iot_core',
        terraform: {
            terraform_supported: true,
            moduleId: 'iot_core',
            resourceType: {
                aws: 'aws_iot_thing', // common TF entrypoint; adjust if you use a different module abstraction
                gcp: 'google_project_service', // IoT Core is deprecated; kept as legacy placeholder
                azure: 'azurerm_iothub'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_iot_core' },
            GCP: { DEFAULT: 'gcp_iot_registry_legacy' },
            AZURE: { DEFAULT: 'az_iot_hub' }
        }
    },

    time_series_database: {
        id: 'time_series_database',
        terraform: {
            terraform_supported: true,
            moduleId: 'time_series_database',
            resourceType: {
                aws: 'aws_timestreamwrite_database',
                gcp: 'google_bigquery_dataset',
                azure: 'azurerm_kusto_cluster'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_timestream' },
            GCP: { DEFAULT: 'gcp_bigquery_timeseries' },
            AZURE: { DEFAULT: 'az_data_explorer' }
        }
    },

    event_stream: {
        id: 'event_stream',
        terraform: {
            terraform_supported: true,
            moduleId: 'event_stream',
            resourceType: {
                aws: 'aws_kinesis_stream',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_eventhub'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_kinesis_stream',
                gcp: 'google_pubsub_topic',
                azure: 'azurerm_eventhub'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_kinesis_streams' },
            GCP: { DEFAULT: 'gcp_pubsub' },
            AZURE: { DEFAULT: 'az_event_hubs' }
        }
    },

    // ------------------------
    // Analytics
    // ------------------------
    data_warehouse: {
        id: 'data_warehouse',
        terraform: {
            terraform_supported: true,
            moduleId: 'data_warehouse',
            resourceType: {
                aws: 'aws_redshift_cluster',
                gcp: 'google_bigquery_dataset',
                azure: 'azurerm_synapse_workspace'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_redshift_cluster',
                gcp: 'google_bigquery_dataset',
                azure: 'azurerm_synapse_workspace'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_redshift' },
            GCP: { DEFAULT: 'gcp_bigquery' },
            AZURE: { DEFAULT: 'az_synapse' }
        }
    },

    stream_processor: {
        id: 'stream_processor',
        terraform: {
            terraform_supported: true,
            moduleId: 'stream_processor',
            resourceType: {
                aws: 'aws_kinesis_analytics_application',
                gcp: 'google_dataflow_job',
                azure: 'azurerm_stream_analytics_job'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_kinesis_analytics' },
            GCP: { DEFAULT: 'gcp_dataflow' },
            AZURE: { DEFAULT: 'az_stream_analytics' }
        }
    },

    // ------------------------
    // ML / AI
    // ------------------------
    ml_training: {
        id: 'ml_training',
        terraform: {
            terraform_supported: true,
            moduleId: 'ml_training',
            resourceType: {
                aws: 'aws_sagemaker_notebook_instance',
                gcp: 'google_vertex_ai_tensorboard',
                azure: 'azurerm_machine_learning_compute_cluster'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sagemaker_notebook_instance',
                gcp: 'google_vertex_ai_tensorboard',
                azure: 'azurerm_machine_learning_compute_cluster'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_training' },
            GCP: { DEFAULT: 'gcp_vertex_ai_training' },
            AZURE: { DEFAULT: 'az_ml_training' }
        }
    },

    ml_inference: {
        id: 'ml_inference',
        terraform: {
            terraform_supported: true,
            moduleId: 'ml_inference',
            resourceType: {
                aws: 'aws_sagemaker_endpoint',
                gcp: 'google_vertex_ai_endpoint',
                azure: 'azurerm_machine_learning_inference_cluster'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_sagemaker_endpoint',
                gcp: 'google_vertex_ai_endpoint',
                azure: 'azurerm_machine_learning_inference_cluster'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_endpoint' },
            GCP: { DEFAULT: 'gcp_vertex_ai_endpoint' },
            AZURE: { DEFAULT: 'az_ml_endpoint' }
        }
    },

    feature_store: {
        id: 'feature_store',
        terraform: {
            terraform_supported: true,
            moduleId: 'feature_store',
            resourceType: {
                aws: 'aws_sagemaker_feature_group',
                gcp: 'google_vertex_ai_featurestore',
                azure: 'azurerm_machine_learning_datastore_blob'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_feature_store' },
            GCP: { DEFAULT: 'gcp_vertex_feature_store' },
            AZURE: { DEFAULT: 'az_ml_feature_store' }
        }
    },

    // ------------------------
    // HA / Multi-region (optional)
    // ------------------------
    multi_region_database: {
        id: 'multi_region_database',
        terraform: {
            terraform_supported: true,
            moduleId: 'multi_region_database',
            resourceType: {
                aws: 'aws_rds_global_cluster',
                gcp: 'google_spanner_instance',
                azure: 'azurerm_cosmosdb_account'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_rds_global_cluster',
                gcp: 'google_spanner_instance',
                azure: 'azurerm_cosmosdb_account'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_aurora_global_database' },
            GCP: { DEFAULT: 'gcp_spanner' },
            AZURE: { DEFAULT: 'az_cosmosdb_multi_region' }
        }
    },

    // ------------------------
    // MLOps
    // ------------------------
    model_registry: {
        id: 'model_registry',
        terraform: {
            terraform_supported: true,
            moduleId: 'model_registry',
            resourceType: {
                aws: 'aws_sagemaker_model_package_group',
                gcp: 'google_vertex_ai_model',
                azure: 'azurerm_machine_learning_model'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_model_registry' },
            GCP: { DEFAULT: 'gcp_vertex_model_registry' },
            AZURE: { DEFAULT: 'az_ml_model_registry' }
        }
    },

    experiment_tracking: {
        id: 'experiment_tracking',
        terraform: {
            terraform_supported: true,
            moduleId: 'experiment_tracking',
            resourceType: {
                aws: 'aws_sagemaker_experiment',
                gcp: 'google_vertex_ai_tensorboard',
                azure: 'azurerm_machine_learning_workspace'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_experiments' },
            GCP: { DEFAULT: 'gcp_vertex_experiments' },
            AZURE: { DEFAULT: 'az_ml_experiments' }
        }
    },

    ml_pipeline_orchestration: {
        id: 'ml_pipeline_orchestration',
        terraform: {
            terraform_supported: true,
            moduleId: 'ml_pipeline',
            resourceType: {
                aws: 'aws_sagemaker_pipeline',
                gcp: 'google_vertex_ai_pipeline_job',
                azure: 'azurerm_machine_learning_compute_cluster'
            }
        },
        pricing: { engine: 'formula' },
        cloud: {
            AWS: { DEFAULT: 'aws_sagemaker_pipelines' },
            GCP: { DEFAULT: 'gcp_vertex_pipelines' },
            AZURE: { DEFAULT: 'az_ml_pipelines' }
        }
    },

    // ------------------------
    // Observability (Added for Azure pricing)
    // ------------------------
    logging: {
        id: 'logging',
        terraform: {
            terraform_supported: true,
            moduleId: 'logging',
            resourceType: {
                aws: 'aws_cloudwatch_log_group',
                gcp: 'google_logging_project_sink',
                azure: 'azurerm_log_analytics_workspace'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudwatch_log_group',
                gcp: 'google_logging_project_sink',
                azure: 'azurerm_log_analytics_workspace'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudwatch_logs' },
            GCP: { DEFAULT: 'gcp_cloud_logging' },
            AZURE: { DEFAULT: 'az_log_analytics' }
        }
    },

    monitoring: {
        id: 'monitoring',
        terraform: {
            terraform_supported: true,
            moduleId: 'monitoring',
            resourceType: {
                aws: 'aws_cloudwatch_metric_alarm',
                gcp: 'google_monitoring_alert_policy',
                azure: 'azurerm_monitor_action_group'
            }
        },
        pricing: {
            engine: 'infracost',
            infracost: {
                aws: 'aws_cloudwatch_metric_alarm',
                gcp: 'google_monitoring_alert_policy',
                azure: 'azurerm_monitor_action_group'
            }
        },
        cloud: {
            AWS: { DEFAULT: 'aws_cloudwatch' },
            GCP: { DEFAULT: 'gcp_cloud_monitoring' },
            AZURE: { DEFAULT: 'az_monitor' }
        }
    }
};

// ----------------------------------------------------------------------------
// Product display names (product id -> readable label)
// ----------------------------------------------------------------------------

const SERVICE_DISPLAY_NAMES = {
    // AWS
    aws_ecs_fargate: 'ECS Fargate',
    aws_eks: 'EKS',
    aws_lambda: 'Lambda',
    aws_instance: 'EC2',
    aws_batch: 'AWS Batch',
    aws_cloudfront_functions: 'CloudFront Functions',
    aws_rds_postgresql: 'RDS PostgreSQL',
    aws_aurora_postgresql: 'Aurora PostgreSQL',
    aws_rds_mysql: 'RDS MySQL',
    aws_aurora_mysql: 'Aurora MySQL',
    aws_dynamodb: 'DynamoDB',
    aws_elasticache_redis: 'ElastiCache (Redis)',
    aws_opensearch: 'OpenSearch',
    aws_s3: 'S3',
    aws_ebs: 'EBS',
    aws_efs: 'EFS',
    aws_backup: 'AWS Backup',
    aws_alb: 'Application Load Balancer',
    aws_apigateway_v2: 'API Gateway (HTTP)',
    aws_api_gateway_rest: 'API Gateway (REST)',
    aws_apigateway_websocket: 'API Gateway (WebSocket)',
    aws_cloudfront: 'CloudFront',
    aws_route53: 'Route 53',
    aws_vpc: 'VPC',
    aws_nat_gateway: 'NAT Gateway',
    aws_vpn: 'Site-to-Site VPN',
    aws_privatelink: 'PrivateLink',
    aws_cloud_map: 'Cloud Map',
    aws_app_mesh: 'App Mesh',
    aws_sqs: 'SQS',
    aws_eventbridge: 'EventBridge',
    aws_step_functions: 'Step Functions',
    aws_sns: 'SNS',
    aws_ses: 'SES',
    aws_sns_mobile_push: 'SNS Mobile Push',
    aws_cognito: 'Cognito',
    aws_secrets_manager: 'Secrets Manager',
    aws_kms: 'KMS',
    aws_acm: 'ACM',
    aws_waf: 'AWS WAF',
    aws_shield: 'AWS Shield',
    aws_organizations: 'Organizations/SCP',
    aws_cloudwatch: 'CloudWatch',
    aws_cloudwatch_logs: 'CloudWatch Logs',
    aws_xray: 'X-Ray',
    aws_security_hub: 'Security Hub',
    aws_ecr: 'ECR',
    aws_codepipeline: 'CodePipeline',
    aws_codeartifact: 'CodeArtifact',
    aws_iot_core: 'AWS IoT Core',
    aws_timestream: 'Timestream',
    aws_kinesis_streams: 'Kinesis Streams',
    aws_redshift: 'Redshift',
    aws_kinesis_analytics: 'Kinesis Analytics',
    aws_sagemaker_training: 'SageMaker Training',
    aws_sagemaker_endpoint: 'SageMaker Endpoint',
    aws_sagemaker_feature_store: 'SageMaker Feature Store',
    aws_global_accelerator: 'Global Accelerator',
    aws_aurora_global_database: 'Aurora Global Database',

    // GCP
    gcp_cloud_run: 'Cloud Run',
    gcp_gke: 'GKE',
    gcp_cloud_functions: 'Cloud Functions',
    gcp_compute_engine: 'Compute Engine',
    gcp_batch: 'Batch',
    gcp_cloud_cdn_edge: 'Cloud CDN (edge)',
    gcp_cloud_sql_postgres: 'Cloud SQL (Postgres)',
    gcp_cloud_sql_postgres_ha: 'Cloud SQL (Postgres HA)',
    gcp_cloud_sql_mysql: 'Cloud SQL (MySQL)',
    gcp_firestore: 'Firestore',
    gcp_memorystore_redis: 'Memorystore (Redis)',
    gcp_elastic_cloud: 'Elastic Cloud',
    gcp_cloud_storage: 'Cloud Storage',
    gcp_persistent_disk: 'Persistent Disk',
    gcp_filestore: 'Filestore',
    gcp_backup_and_dr: 'Backup and DR',
    gcp_cloud_load_balancing: 'Cloud Load Balancing',
    gcp_api_gateway: 'API Gateway',
    gcp_cloud_run_websocket: 'Cloud Run (WebSocket)',
    gcp_cloud_cdn: 'Cloud CDN',
    gcp_cloud_dns: 'Cloud DNS',
    gcp_vpc: 'VPC',
    gcp_cloud_nat: 'Cloud NAT',
    gcp_cloud_vpn: 'Cloud VPN',
    gcp_private_service_connect: 'Private Service Connect',
    gcp_service_directory: 'Service Directory',
    gcp_anthos_service_mesh: 'Anthos Service Mesh',
    gcp_pubsub: 'Pub/Sub',
    gcp_eventarc: 'Eventarc',
    gcp_workflows: 'Workflows',
    gcp_pubsub_notifications: 'Pub/Sub (notifications)',
    gcp_email_tasks: 'Cloud Tasks (email pattern)',
    gcp_fcm: 'Firebase Cloud Messaging',
    gcp_identity_platform: 'Identity Platform',
    gcp_secret_manager: 'Secret Manager',
    gcp_cloud_kms: 'Cloud KMS',
    gcp_certificate_manager: 'Certificate Manager',
    gcp_cloud_armor: 'Cloud Armor',
    gcp_cloud_armor_ddos: 'Cloud Armor (DDoS)',
    gcp_org_policy: 'Org Policy',
    gcp_cloud_monitoring: 'Cloud Monitoring',
    gcp_cloud_logging: 'Cloud Logging',
    gcp_cloud_trace: 'Cloud Trace',
    gcp_security_command_center: 'Security Command Center',
    gcp_artifact_registry: 'Artifact Registry',
    gcp_cloud_build: 'Cloud Build',
    gcp_iot_registry_legacy: 'IoT Registry (legacy)',
    gcp_bigquery_timeseries: 'BigQuery (time-series pattern)',
    gcp_bigquery: 'BigQuery',
    gcp_dataflow: 'Dataflow',
    gcp_vertex_ai_training: 'Vertex AI Training',
    gcp_vertex_ai_endpoint: 'Vertex AI Endpoint',
    gcp_vertex_feature_store: 'Vertex Feature Store',
    gcp_global_load_balancer: 'Global Load Balancer',
    gcp_spanner: 'Cloud Spanner',

    // Azure
    az_container_apps: 'Container Apps',
    az_aks: 'AKS',
    az_functions: 'Azure Functions',
    az_virtual_machines: 'Virtual Machines',
    az_batch: 'Azure Batch',
    az_front_door_edge: 'Front Door (edge)',
    az_postgresql_flexible: 'PostgreSQL Flexible',
    az_postgresql_flexible_ha: 'PostgreSQL Flexible (HA)',
    az_mysql_flexible: 'MySQL Flexible',
    az_cosmosdb: 'Cosmos DB',
    az_cosmosdb_multi_region: 'Cosmos DB (multi-region)',
    az_redis: 'Azure Cache for Redis',
    az_ai_search: 'Azure AI Search',
    az_blob_storage: 'Blob Storage',
    az_managed_disks: 'Managed Disks',
    az_files: 'Azure Files',
    az_recovery_services: 'Recovery Services Vault',
    az_application_gateway: 'Application Gateway',
    az_api_management: 'API Management',
    az_signalr: 'Azure SignalR Service',
    az_cdn: 'Azure CDN',
    az_front_door: 'Azure Front Door',
    az_front_door: 'Azure Front Door',
    az_dns: 'Azure DNS',
    az_virtual_network: 'Virtual Network',
    az_nat_gateway: 'NAT Gateway',
    az_vpn_gateway: 'VPN Gateway',
    az_private_endpoint: 'Private Endpoint',
    az_private_dns: 'Private DNS',
    az_service_mesh_aks: 'Service Mesh (AKS pattern)',
    az_service_bus: 'Service Bus',
    az_event_grid: 'Event Grid',
    az_logic_apps: 'Logic Apps',
    az_notification_hubs: 'Notification Hubs',
    az_communication_services: 'Communication Services',
    az_ad_b2c: 'Azure AD B2C',
    az_key_vault_secrets: 'Key Vault (Secrets)',
    az_key_vault_keys: 'Key Vault (Keys)',
    az_key_vault_certs: 'Key Vault (Certs)',
    az_waf: 'Azure WAF',
    az_ddos_protection: 'Azure DDoS Protection',
    az_azure_policy: 'Azure Policy',
    az_monitor: 'Azure Monitor',
    az_log_analytics: 'Log Analytics',
    az_app_insights: 'Application Insights',
    az_sentinel: 'Microsoft Sentinel',
    az_acr: 'ACR',
    az_devops: 'Azure DevOps',
    az_artifacts: 'Azure Artifacts',
    az_iot_hub: 'IoT Hub',
    az_data_explorer: 'Azure Data Explorer',
    az_event_hubs: 'Event Hubs',
    az_synapse: 'Synapse',
    az_stream_analytics: 'Stream Analytics',
    az_ml_training: 'Azure ML Training',
    az_ml_endpoint: 'Azure ML Endpoint',
    az_ml_feature_store: 'Azure ML Feature Store'
};

// ----------------------------------------------------------------------------
// Derived legacy exports (keeps backward compatibility with older code)
// ----------------------------------------------------------------------------

function buildCloudServiceMap(providerKey) {
    const out = {};
    for (const [svcId, def] of Object.entries(SERVICE_CATALOG)) {
        const cloud = def.cloud?.[providerKey];
        if (!cloud) continue;

        // Normalize to the old shape: { DEFAULT, COST_EFFECTIVE, HIGH_PERFORMANCE, ... }
        out[svcId] = { ...cloud };
    }
    return out;
}

const CLOUD_SERVICE_MAP = {
    AWS: buildCloudServiceMap('AWS'),
    GCP: buildCloudServiceMap('GCP'),
    AZURE: buildCloudServiceMap('AZURE')
};

// ----------------------------------------------------------------------------
// Resolvers
// ----------------------------------------------------------------------------

function getServiceDisplayName(productId) {
    return SERVICE_DISPLAY_NAMES[productId] || productId;
}

function getServiceDefinition(serviceId) {
    return SERVICE_CATALOG[serviceId] || null;
}

function getTerraformResourceType(provider, serviceId) {
    const def = getServiceDefinition(serviceId);
    if (!def?.terraform?.resourceType) return null;

    const p = normProvider(provider);
    if (p === PROVIDERS.AWS) return def.terraform.resourceType.aws || null;
    if (p === PROVIDERS.GCP) return def.terraform.resourceType.gcp || null;
    if (p === PROVIDERS.AZURE) return def.terraform.resourceType.azure || null;
    return null;
}

function getInfracostResourceType(provider, serviceId) {
    const def = getServiceDefinition(serviceId);
    if (!def?.pricing) return null;
    if (def.pricing.engine !== 'infracost') return null;

    const p = normProvider(provider);
    const rc = def.pricing.infracost || {};
    if (p === PROVIDERS.AWS) return rc.aws || null;
    if (p === PROVIDERS.GCP) return rc.gcp || null;
    if (p === PROVIDERS.AZURE) return rc.azure || null;
    return null;
}

/**
 * Canonical service -> provider product id selection
 * Special handling:
 * - relational_database supports engine (postgres/mysql) and profile (cost/perf).
 */
function mapServiceToCloud(provider, serviceId, costProfile = PROFILES.COST_EFFECTIVE, options = {}) {
    const p = normProvider(provider);
    const def = getServiceDefinition(serviceId);
    if (!def?.cloud?.[p]) return null;

    const mapping = def.cloud[p];

    if (serviceId === 'relational_database') {
        const raw = String(options.engine || 'postgres').toLowerCase();
        const engine = raw.includes('mysql') ? 'MYSQL' : 'POSTGRES';
        const perfKey = (normProfile(costProfile) === PROFILES.HIGH_PERFORMANCE) ? 'PERF' : 'COST';
        const key = `${engine}_${perfKey}`;
        return mapping[key] || mapping.DEFAULT || Object.values(mapping)[0];
    }

    const cp = normProfile(costProfile);
    if (mapping[cp]) return mapping[cp];
    return mapping.DEFAULT || Object.values(mapping)[0];
}

/**
 * Resolve a canonical service to a full provider-ready spec:
 * - product id + display name
 * - terraform moduleId + terraform resource type
 * - pricing metadata (infracost resource type or formula engine)
 */
function resolveCloudService(provider, serviceId, costProfile = PROFILES.COST_EFFECTIVE, options = {}) {
    const def = getServiceDefinition(serviceId);
    if (!def) return null;

    const cloudProduct = mapServiceToCloud(provider, serviceId, costProfile, options);
    if (!cloudProduct) return null;

    return {
        service_id: serviceId,
        provider: normProvider(provider),
        profile: normProfile(costProfile),

        cloud_product: cloudProduct,
        display_name: getServiceDisplayName(cloudProduct),

        terraform: {
            terraform_supported: true,
            moduleId: def.terraform?.moduleId || null,
            resourceType: getTerraformResourceType(provider, serviceId)
        },

        pricing: {
            engine: def.pricing?.engine || 'formula',
            infracost: def.pricing?.engine === 'infracost'
                ? { resourceType: getInfracostResourceType(provider, serviceId) }
                : null
        }
    };
}

/**
 * Map a list of canonical services to provider-ready specs.
 * Accepts either:
 * - infraSpec.deployable_services = ['api_gateway','compute_serverless',...]
 * - or a direct array of service ids.
 */
function mapAllServices(provider, infraSpecOrServiceIds, costProfile = PROFILES.COST_EFFECTIVE) {
    const ids = Array.isArray(infraSpecOrServiceIds)
        ? infraSpecOrServiceIds
        : (infraSpecOrServiceIds?.deployable_services || infraSpecOrServiceIds?.canonical_architecture?.deployable_services || []);

    const out = [];
    for (const serviceId of ids) {
        const spec = resolveCloudService(provider, serviceId, costProfile, {
            engine: infraSpecOrServiceIds?.components?.[serviceId]?.engine ||
                infraSpecOrServiceIds?.components?.relational_database?.engine
        });
        if (spec) out.push(spec);
    }
    return out;
}

module.exports = {
    PROFILES,
    SERVICE_CATALOG,

    // Backward-compatible exports
    CLOUD_SERVICE_MAP,
    SERVICE_DISPLAY_NAMES,
    mapServiceToCloud,
    getServiceDisplayName,
    mapAllServices,

    // New helpers
    resolveCloudService,
    getTerraformResourceType,
    getInfracostResourceType
};
