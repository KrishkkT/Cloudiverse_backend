/**
 * CORE INFRASTRUCTURE PACK
 * Foundation services required by almost every architecture.
 *
 * Contract:
 * - Each service MUST have: id, name, category, domain, terraform.moduleId, pricing.engine, mappings
 * - pricing.engine: 'infracost' | 'formula' | 'hybrid'
 */

module.exports = {
    name: 'CORE_PACK',
    description: 'Foundational Compute, Storage, Database, Networking, Security, Observability, and Integration services',
    domain: 'core',

    services: {
        // ───────────────────────────────────────────────────────────────────
        // COMPUTE
        // ───────────────────────────────────────────────────────────────────
        computeserverless: {
            id: 'computeserverless',
            name: 'Serverless Functions',
            category: 'compute',
            domain: 'core',
            tags: ['compute', 'functions'],
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_lambda_function' } },
            mappings: {
                aws: { resource: 'aws_lambda_function', name: 'AWS Lambda' },
                gcp: { resource: 'google_cloudfunctions_function', name: 'Cloud Functions' },
                azure: { resource: 'azurerm_function_app', name: 'Azure Functions' }
            }
        },

        computecontainer: {
            id: 'computecontainer',
            name: 'Container Service',
            category: 'compute',
            domain: 'core',
            tags: ['compute', 'containers'],
            terraform: { moduleId: 'app_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_ecs_service' } },
            mappings: {
                aws: { resource: 'aws_ecs_service', name: 'Amazon ECS' },
                gcp: { resource: 'google_cloud_run_service', name: 'Cloud Run' },
                azure: { resource: 'azurerm_container_app', name: 'Container Apps' }
            }
        },

        computevm: {
            id: 'computevm',
            name: 'Virtual Machine',
            category: 'compute',
            domain: 'core',
            tags: ['compute', 'vm'],
            terraform: { moduleId: 'app_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_instance' } },
            mappings: {
                aws: { resource: 'aws_instance', name: 'Amazon EC2' },
                gcp: { resource: 'google_compute_instance', name: 'Compute Engine' },
                azure: { resource: 'azurerm_virtual_machine', name: 'Virtual Machines' }
            }
        },

        computebatch: {
            id: 'computebatch',
            name: 'Batch Compute',
            category: 'compute',
            domain: 'core',
            tags: ['compute', 'batch'],
            terraform: { moduleId: 'batch_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_batch_compute_environment' } },
            mappings: {
                aws: { resource: 'aws_batch_compute_environment', name: 'AWS Batch' },
                gcp: { resource: 'google_batch_job', name: 'Batch (GCP)' },
                azure: { resource: 'azurerm_batch_account', name: 'Azure Batch' }
            }
        },

        computeedge: {
            id: 'computeedge',
            name: 'Edge Compute',
            category: 'compute',
            domain: 'core',
            tags: ['compute', 'edge'],
            terraform: { moduleId: 'edge_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudfront_function' } },
            mappings: {
                aws: { resource: 'aws_cloudfront_function', name: 'CloudFront Functions' },
                gcp: { resource: 'google_cloud_run_service', name: 'Cloud Run (edge via CDN setup)' },
                azure: { resource: 'azurerm_frontdoor_rule_set', name: 'Front Door Rules (edge)' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // DATABASES
        // ───────────────────────────────────────────────────────────────────
        relationaldatabase: {
            id: 'relationaldatabase',
            name: 'Relational Database',
            category: 'database',
            domain: 'core',
            tags: ['database', 'sql'],
            terraform: { moduleId: 'relational_database' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_db_instance' } },
            mappings: {
                aws: { resource: 'aws_db_instance', name: 'Amazon RDS' },
                gcp: { resource: 'google_sql_database_instance', name: 'Cloud SQL' },
                azure: { resource: 'azurerm_postgresql_flexible_server', name: 'Azure Database (Postgres Flexible)' }
            }
        },

        nosqldatabase: {
            id: 'nosqldatabase',
            name: 'NoSQL Database',
            category: 'database',
            domain: 'core',
            tags: ['database', 'nosql'],
            terraform: { moduleId: 'nosql_database' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_dynamodb_table' } },
            mappings: {
                aws: { resource: 'aws_dynamodb_table', name: 'DynamoDB' },
                gcp: { resource: 'google_firestore_database', name: 'Firestore' },
                azure: { resource: 'azurerm_cosmosdb_account', name: 'Cosmos DB' }
            }
        },

        cache: {
            id: 'cache',
            name: 'In-Memory Cache',
            category: 'database',
            domain: 'core',
            tags: ['database', 'cache'],
            terraform: { moduleId: 'cache' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_elasticache_cluster' } },
            mappings: {
                aws: { resource: 'aws_elasticache_cluster', name: 'ElastiCache' },
                gcp: { resource: 'google_redis_instance', name: 'Memorystore (Redis)' },
                azure: { resource: 'azurerm_redis_cache', name: 'Azure Cache for Redis' }
            }
        },

        searchengine: {
            id: 'searchengine',
            name: 'Search Engine',
            category: 'database',
            domain: 'core',
            tags: ['search', 'index'],
            terraform: { moduleId: 'search_engine' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_opensearch_domain' } },
            mappings: {
                aws: { resource: 'aws_opensearch_domain', name: 'OpenSearch' },
                gcp: { resource: 'google_discovery_engine_data_store', name: 'Vertex AI Search / Discovery Engine' },
                azure: { resource: 'azurerm_search_service', name: 'Azure AI Search' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // STORAGE
        // ───────────────────────────────────────────────────────────────────
        objectstorage: {
            id: 'objectstorage',
            name: 'Object Storage',
            category: 'storage',
            domain: 'core',
            tags: ['storage', 'object'],
            terraform: { moduleId: 'object_storage' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_s3_bucket' } },
            mappings: {
                aws: { resource: 'aws_s3_bucket', name: 'Amazon S3' },
                gcp: { resource: 'google_storage_bucket', name: 'Cloud Storage' },
                azure: { resource: 'azurerm_storage_account', name: 'Storage Account (Blob)' }
            }
        },

        blockstorage: {
            id: 'blockstorage',
            name: 'Block Storage',
            category: 'storage',
            domain: 'core',
            tags: ['storage', 'block'],
            terraform: { moduleId: 'block_storage' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_ebs_volume' } },
            mappings: {
                aws: { resource: 'aws_ebs_volume', name: 'EBS' },
                gcp: { resource: 'google_compute_disk', name: 'Persistent Disk' },
                azure: { resource: 'azurerm_managed_disk', name: 'Managed Disks' }
            }
        },

        filestorage: {
            id: 'filestorage',
            name: 'File Storage',
            category: 'storage',
            domain: 'core',
            tags: ['storage', 'nfs'],
            terraform: { moduleId: 'file_storage' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_efs_file_system' } },
            mappings: {
                aws: { resource: 'aws_efs_file_system', name: 'EFS' },
                gcp: { resource: 'google_filestore_instance', name: 'Filestore' },
                azure: { resource: 'azurerm_storage_share', name: 'Azure Files' }
            }
        },

        backup: {
            id: 'backup',
            name: 'Backup / Disaster Recovery',
            category: 'storage',
            domain: 'core',
            tags: ['backup', 'dr'],
            terraform: { moduleId: 'backup' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_backup_plan' } },
            mappings: {
                aws: { resource: 'aws_backup_plan', name: 'AWS Backup' },
                gcp: { resource: 'google_backup_dr_backup_plan', name: 'Backup and DR' },
                azure: { resource: 'azurerm_recovery_services_vault', name: 'Recovery Services Vault' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // NETWORKING
        // ───────────────────────────────────────────────────────────────────
        apigateway: {
            id: 'apigateway',
            name: 'API Gateway',
            category: 'network',
            domain: 'core',
            tags: ['api', 'gateway'],
            terraform: { moduleId: 'api_gateway' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_apigatewayv2_api' } },
            mappings: {
                aws: { resource: 'aws_apigatewayv2_api', name: 'API Gateway' },
                gcp: { resource: 'google_api_gateway_api', name: 'API Gateway' },
                azure: { resource: 'azurerm_api_management', name: 'API Management' }
            }
        },

        loadbalancer: {
            id: 'loadbalancer',
            name: 'Load Balancer',
            category: 'network',
            domain: 'core',
            tags: ['network', 'lb'],
            terraform: { moduleId: 'load_balancer' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_lb' } },
            mappings: {
                aws: { resource: 'aws_lb', name: 'Elastic Load Balancing' },
                gcp: { resource: 'google_compute_url_map', name: 'Cloud Load Balancing' },
                azure: { resource: 'azurerm_lb', name: 'Azure Load Balancer' }
            }
        },

        cdn: {
            id: 'cdn',
            name: 'CDN',
            category: 'network',
            domain: 'core',
            tags: ['cdn', 'delivery'],
            terraform: { moduleId: 'cdn' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudfront_distribution' } },
            mappings: {
                aws: { resource: 'aws_cloudfront_distribution', name: 'CloudFront' },
                gcp: { resource: 'google_compute_backend_bucket', name: 'Cloud CDN (backend bucket)' },
                azure: { resource: 'azurerm_cdn_profile', name: 'Azure CDN' }
            }
        },

        dns: {
            id: 'dns',
            name: 'DNS',
            category: 'network',
            domain: 'core',
            tags: ['dns'],
            terraform: { moduleId: 'dns' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_route53_zone', name: 'Route 53' },
                gcp: { resource: 'google_dns_managed_zone', name: 'Cloud DNS' },
                azure: { resource: 'azurerm_dns_zone', name: 'Azure DNS' }
            }
        },

        vpcnetworking: {
            id: 'vpcnetworking',
            name: 'VPC / VNet Networking',
            category: 'network',
            domain: 'core',
            tags: ['network', 'vpc'],
            terraform: { moduleId: 'vpc_networking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_vpc', name: 'VPC' },
                gcp: { resource: 'google_compute_network', name: 'VPC Network' },
                azure: { resource: 'azurerm_virtual_network', name: 'Virtual Network (VNet)' }
            }
        },

        natgateway: {
            id: 'natgateway',
            name: 'NAT Gateway',
            category: 'network',
            domain: 'core',
            tags: ['network', 'egress'],
            terraform: { moduleId: 'nat_gateway' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_nat_gateway' } },
            mappings: {
                aws: { resource: 'aws_nat_gateway', name: 'NAT Gateway' },
                gcp: { resource: 'google_compute_router_nat', name: 'Cloud NAT' },
                azure: { resource: 'azurerm_nat_gateway', name: 'NAT Gateway' }
            }
        },

        vpn: {
            id: 'vpn',
            name: 'VPN',
            category: 'network',
            domain: 'core',
            tags: ['network', 'hybrid'],
            terraform: { moduleId: 'vpn' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_vpn_connection' } },
            mappings: {
                aws: { resource: 'aws_vpn_connection', name: 'Site-to-Site VPN' },
                gcp: { resource: 'google_compute_vpn_gateway', name: 'Cloud VPN' },
                azure: { resource: 'azurerm_virtual_network_gateway', name: 'VPN Gateway' }
            }
        },

        privatelink: {
            id: 'privatelink',
            name: 'Private Connectivity (PrivateLink/PSC)',
            category: 'network',
            domain: 'core',
            tags: ['network', 'private'],
            terraform: { moduleId: 'private_link' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_vpc_endpoint', name: 'AWS PrivateLink (VPC Endpoint)' },
                gcp: { resource: 'google_compute_service_attachment', name: 'Private Service Connect' },
                azure: { resource: 'azurerm_private_endpoint', name: 'Private Endpoint' }
            }
        },

        servicediscovery: {
            id: 'servicediscovery',
            name: 'Service Discovery',
            category: 'network',
            domain: 'core',
            tags: ['network', 'discovery'],
            terraform: { moduleId: 'service_discovery' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_service_discovery_private_dns_namespace' } },
            mappings: {
                aws: { resource: 'aws_service_discovery_private_dns_namespace', name: 'Cloud Map' },
                gcp: { resource: 'google_service_directory_namespace', name: 'Service Directory' },
                azure: { resource: 'azurerm_private_dns_zone', name: 'Private DNS (discovery)' }
            }
        },

        servicemesh: {
            id: 'servicemesh',
            name: 'Service Mesh',
            category: 'network',
            domain: 'core',
            tags: ['mesh', 'mTLS'],
            terraform: { moduleId: 'service_mesh' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_appmesh_mesh' } },
            mappings: {
                aws: { resource: 'aws_appmesh_mesh', name: 'App Mesh' },
                gcp: { resource: 'google_gke_hub_feature', name: 'Service Mesh (Anthos/ASM)' },
                azure: { resource: 'azurerm_kubernetes_cluster', name: 'Service Mesh (AKS add-on)' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // INTEGRATION / MESSAGING
        // ───────────────────────────────────────────────────────────────────
        messagequeue: {
            id: 'messagequeue',
            name: 'Message Queue',
            category: 'integration',
            domain: 'core',
            tags: ['queue', 'async'],
            terraform: { moduleId: 'messaging_queue' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sqs_queue' } },
            mappings: {
                aws: { resource: 'aws_sqs_queue', name: 'SQS' },
                gcp: { resource: 'google_pubsub_topic', name: 'Pub/Sub (topic/queue)' },
                azure: { resource: 'azurerm_servicebus_queue', name: 'Service Bus Queue' }
            }
        },

        eventbus: {
            id: 'eventbus',
            name: 'Event Bus',
            category: 'integration',
            domain: 'core',
            tags: ['events', 'pubsub'],
            terraform: { moduleId: 'event_bus' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudwatch_event_bus' } },
            mappings: {
                aws: { resource: 'aws_cloudwatch_event_bus', name: 'EventBridge' },
                gcp: { resource: 'google_eventarc_trigger', name: 'Eventarc' },
                azure: { resource: 'azurerm_eventgrid_topic', name: 'Event Grid' }
            }
        },

        workfloworchestration: {
            id: 'workfloworchestration',
            name: 'Workflow Orchestration',
            category: 'integration',
            domain: 'core',
            tags: ['workflow', 'orchestration'],
            terraform: { moduleId: 'workflow_orchestration' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sfn_state_machine' } },
            mappings: {
                aws: { resource: 'aws_sfn_state_machine', name: 'Step Functions' },
                gcp: { resource: 'google_workflows_workflow', name: 'Workflows' },
                azure: { resource: 'azurerm_logic_app_workflow', name: 'Logic Apps' }
            }
        },

        notification: {
            id: 'notification',
            name: 'Notification Service',
            category: 'integration',
            domain: 'core',
            tags: ['notifications'],
            terraform: { moduleId: 'notification' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sns_topic' } },
            mappings: {
                aws: { resource: 'aws_sns_topic', name: 'SNS' },
                gcp: { resource: 'google_pubsub_topic', name: 'Pub/Sub (notifications)' },
                azure: { resource: 'azurerm_notification_hub', name: 'Notification Hubs' }
            }
        },

        emailnotification: {
            id: 'emailnotification',
            name: 'Email Service',
            category: 'integration',
            domain: 'core',
            tags: ['email'],
            terraform: { moduleId: 'email' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_ses_domain_identity' } },
            mappings: {
                aws: { resource: 'aws_ses_domain_identity', name: 'Amazon SES' },
                gcp: { resource: 'google_cloud_tasks_queue', name: 'Email via provider (external) / task queue' },
                azure: { resource: 'azurerm_communication_service', name: 'Azure Communication Services' }
            }
        },

        paymentgateway: {
            id: 'paymentgateway',
            name: 'Payment Gateway',
            category: 'integration',
            domain: 'core',
            tags: ['payments', 'fintech'],
            terraform: { moduleId: 'payment_gateway' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_lambda_function', name: 'Stripe/PCI Integration (L3)' },
                gcp: { resource: 'google_cloudfunctions_function', name: 'Stripe Integration' },
                azure: { resource: 'azurerm_function_app', name: 'Payment Bridge' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // SECURITY
        // ───────────────────────────────────────────────────────────────────
        identityauth: {
            id: 'identityauth',
            name: 'Identity & Auth',
            category: 'security',
            domain: 'core',
            tags: ['iam', 'auth'],
            terraform: { moduleId: 'auth' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cognito_user_pool' } },
            mappings: {
                aws: { resource: 'aws_cognito_user_pool', name: 'Cognito' },
                gcp: { resource: 'google_identity_platform_config', name: 'Identity Platform' },
                azure: { resource: 'azurerm_active_directory_b2c', name: 'Azure AD B2C' }
            }
        },

        secretsmanagement: {
            id: 'secretsmanagement',
            name: 'Secrets Management',
            category: 'security',
            domain: 'core',
            tags: ['secrets'],
            terraform: { moduleId: 'secrets' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_secretsmanager_secret' } },
            mappings: {
                aws: { resource: 'aws_secretsmanager_secret', name: 'Secrets Manager' },
                gcp: { resource: 'google_secret_manager_secret', name: 'Secret Manager' },
                azure: { resource: 'azurerm_key_vault_secret', name: 'Key Vault Secret' }
            }
        },

        keymanagement: {
            id: 'keymanagement',
            name: 'Key Management (KMS)',
            category: 'security',
            domain: 'core',
            tags: ['kms', 'encryption'],
            terraform: { moduleId: 'key_management' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kms_key' } },
            mappings: {
                aws: { resource: 'aws_kms_key', name: 'AWS KMS' },
                gcp: { resource: 'google_kms_key_ring', name: 'Cloud KMS' },
                azure: { resource: 'azurerm_key_vault_key', name: 'Key Vault Key' }
            }
        },

        certificatemanagement: {
            id: 'certificatemanagement',
            name: 'Certificate Management',
            category: 'security',
            domain: 'core',
            tags: ['tls', 'cert'],
            terraform: { moduleId: 'certificate_management' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_acm_certificate', name: 'ACM' },
                gcp: { resource: 'google_certificate_manager_certificate', name: 'Certificate Manager' },
                azure: { resource: 'azurerm_app_service_certificate', name: 'App Service Certificate' }
            }
        },

        waf: {
            id: 'waf',
            name: 'Web Application Firewall',
            category: 'security',
            domain: 'core',
            tags: ['waf'],
            terraform: { moduleId: 'waf' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_wafv2_web_acl' } },
            mappings: {
                aws: { resource: 'aws_wafv2_web_acl', name: 'AWS WAF' },
                gcp: { resource: 'google_compute_security_policy', name: 'Cloud Armor (WAF)' },
                azure: { resource: 'azurerm_web_application_firewall_policy', name: 'Azure WAF' }
            }
        },

        ddosprotection: {
            id: 'ddosprotection',
            name: 'DDoS Protection',
            category: 'security',
            domain: 'core',
            tags: ['ddos'],
            terraform: { moduleId: 'ddos_protection' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_shield_protection', name: 'AWS Shield' },
                gcp: { resource: 'google_compute_security_policy', name: 'Cloud Armor (DDoS)' },
                azure: { resource: 'azurerm_network_ddos_protection_plan', name: 'Azure DDoS Protection' }
            }
        },

        policygovernance: {
            id: 'policygovernance',
            name: 'Policy / Governance',
            category: 'security',
            domain: 'core',
            tags: ['governance', 'policy'],
            terraform: { moduleId: 'policy_governance' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_organizations_organization', name: 'Organizations/SCP (conceptual)' },
                gcp: { resource: 'google_org_policy_policy', name: 'Org Policy' },
                azure: { resource: 'azurerm_policy_definition', name: 'Azure Policy' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // OBSERVABILITY
        // ───────────────────────────────────────────────────────────────────
        logging: {
            id: 'logging',
            name: 'Logging',
            category: 'observability',
            domain: 'core',
            tags: ['logs'],
            terraform: { moduleId: 'logging' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudwatch_log_group' } },
            mappings: {
                aws: { resource: 'aws_cloudwatch_log_group', name: 'CloudWatch Logs' },
                gcp: { resource: 'google_logging_project_sink', name: 'Cloud Logging' },
                azure: { resource: 'azurerm_log_analytics_workspace', name: 'Log Analytics Workspace' }
            }
        },

        monitoring: {
            id: 'monitoring',
            name: 'Monitoring',
            category: 'observability',
            domain: 'core',
            tags: ['metrics', 'alerts'],
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_cloudwatch_dashboard', name: 'CloudWatch' },
                gcp: { resource: 'google_monitoring_dashboard', name: 'Cloud Monitoring' },
                azure: { resource: 'azurerm_monitor_action_group', name: 'Azure Monitor' }
            }
        },

        tracing: {
            id: 'tracing',
            name: 'Distributed Tracing / APM',
            category: 'observability',
            domain: 'core',
            tags: ['tracing', 'apm'],
            terraform: { moduleId: 'tracing' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_xray_group', name: 'X-Ray (conceptual)' },
                gcp: { resource: 'google_project_service', name: 'Cloud Trace (enable API)' },
                azure: { resource: 'azurerm_application_insights', name: 'Application Insights' }
            }
        },

        siem: {
            id: 'siem',
            name: 'SIEM / Security Analytics',
            category: 'observability',
            domain: 'core',
            tags: ['siem', 'security'],
            terraform: { moduleId: 'siem' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_securityhub_account', name: 'Security Hub (conceptual)' },
                gcp: { resource: 'google_security_center_notification_config', name: 'Security Command Center (conceptual)' },
                azure: { resource: 'azurerm_sentinel_alert_rule_scheduled', name: 'Microsoft Sentinel (conceptual)' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // DEVOPS (core essentials)
        // ───────────────────────────────────────────────────────────────────
        containerregistry: {
            id: 'containerregistry',
            name: 'Container Registry',
            category: 'devops',
            domain: 'core',
            tags: ['registry', 'containers'],
            terraform: { moduleId: 'container_registry' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_ecr_repository' } },
            mappings: {
                aws: { resource: 'aws_ecr_repository', name: 'ECR' },
                gcp: { resource: 'google_artifact_registry_repository', name: 'Artifact Registry' },
                azure: { resource: 'azurerm_container_registry', name: 'ACR' }
            }
        },

        cicd: {
            id: 'cicd',
            name: 'CI/CD',
            category: 'devops',
            domain: 'core',
            tags: ['cicd', 'pipelines'],
            terraform: { moduleId: 'ci_cd' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_codepipeline', name: 'CodePipeline' },
                gcp: { resource: 'google_cloudbuild_trigger', name: 'Cloud Build' },
                azure: { resource: 'azurerm_dev_test_global_vm_shutdown_schedule', name: 'Azure DevOps (conceptual)' }
            }
        },

        artifactrepository: {
            id: 'artifactrepository',
            name: 'Artifact Repository',
            category: 'devops',
            domain: 'core',
            tags: ['artifacts'],
            terraform: { moduleId: 'artifact_repository' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_codeartifact_repository' } },
            mappings: {
                aws: { resource: 'aws_codeartifact_repository', name: 'CodeArtifact' },
                gcp: { resource: 'google_artifact_registry_repository', name: 'Artifact Registry' },
                azure: { resource: 'azurerm_container_registry', name: 'Artifacts (via ACR/feeds)' }
            }
        },

        // ───────────────────────────────────────────────────────────────────
        // ADDITIONAL CRITICAL SERVICES
        // ───────────────────────────────────────────────────────────────────
        pushnotificationservice: {
            id: 'pushnotificationservice',
            name: 'Push Notification Service',
            category: 'integration',
            domain: 'core',
            tags: ['mobile', 'notifications', 'push'],
            terraform: { moduleId: 'push_notification' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sns_platform_application' } },
            mappings: {
                aws: { resource: 'aws_sns_platform_application', name: 'SNS Mobile Push' },
                gcp: { resource: 'google_firebase_project', name: 'Firebase Cloud Messaging' },
                azure: { resource: 'azurerm_notification_hub', name: 'Notification Hubs' }
            }
        },

        websocketgateway: {
            id: 'websocketgateway',
            name: 'WebSocket Gateway',
            category: 'network',
            domain: 'core',
            tags: ['realtime', 'websocket', 'pubsub'],
            terraform: { moduleId: 'websocket_gateway' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_apigatewayv2_api' } },
            mappings: {
                aws: { resource: 'aws_apigatewayv2_api', name: 'API Gateway WebSocket' },
                gcp: { resource: 'google_cloud_run_service', name: 'Cloud Run (WebSocket)' },
                azure: { resource: 'azurerm_signalr_service', name: 'Azure SignalR Service' }
            }
        },

        globalloadbalancer: {
            id: 'globalloadbalancer',
            name: 'Global Load Balancer',
            category: 'network',
            domain: 'core',
            tags: ['network', 'global', 'multi-region'],
            terraform: { moduleId: 'global_load_balancer' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_globalaccelerator_accelerator' } },
            mappings: {
                aws: { resource: 'aws_globalaccelerator_accelerator', name: 'Global Accelerator' },
                gcp: { resource: 'google_compute_global_forwarding_rule', name: 'Global Load Balancer' },
                azure: { resource: 'azurerm_frontdoor', name: 'Azure Front Door' }
            }
        },

        multiregiondb: {
            id: 'multiregiondb',
            name: 'Multi-Region Database',
            category: 'database',
            domain: 'core',
            tags: ['database', 'multi-region', 'ha'],
            terraform: { moduleId: 'multi_region_db' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_rds_global_cluster' } },
            mappings: {
                aws: { resource: 'aws_rds_global_cluster', name: 'Aurora Global Database' },
                gcp: { resource: 'google_spanner_instance', name: 'Cloud Spanner' },
                azure: { resource: 'azurerm_cosmosdb_account', name: 'Cosmos DB (multi-region)' }
            }
        }
    }
};
