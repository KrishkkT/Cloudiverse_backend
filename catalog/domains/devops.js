/**
 * DEVOPS PACK
 * DevOps tooling services.
 * Note: ci_cd, container_registry, artifact_repository already in core.js
 */

module.exports = {
    name: 'DEVOPS_PACK',
    description: 'DevOps tooling: build services, config management, IaC state',
    services: {
        // ═════════════════════════════════════════════════════════════════════
        // BUILD SERVICES
        // ═════════════════════════════════════════════════════════════════════
        buildservice: {
            id: 'buildservice',
            name: 'Build Service',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_codebuild_project', name: 'AWS CodeBuild' },
                gcp: { resource: 'google_cloudbuild_trigger', name: 'Cloud Build' },
                azure: { resource: 'azurerm_container_registry_task', name: 'ACR Tasks' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // CONFIG MANAGEMENT
        // ═════════════════════════════════════════════════════════════════════
        configmanagement: {
            id: 'configmanagement',
            name: 'Config Management',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_appconfig_application', name: 'AWS AppConfig' },
                gcp: { resource: 'google_runtimeconfig_config', name: 'Runtime Configurator' },
                azure: { resource: 'azurerm_app_configuration', name: 'App Configuration' }
            }
        },
        parameterstore: {
            id: 'parameterstore',
            name: 'Parameter Store',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'secrets' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_ssm_parameter', name: 'Systems Manager Parameter Store' },
                gcp: { resource: 'google_secret_manager_secret', name: 'Secret Manager' },
                azure: { resource: 'azurerm_app_configuration', name: 'App Configuration' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // IAC STATE & LOCKING
        // ═════════════════════════════════════════════════════════════════════
        iacstate: {
            id: 'iacstate',
            name: 'IaC State Backend',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'object_storage' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_s3_bucket' } },
            mappings: {
                aws: { resource: 'aws_s3_bucket', name: 'S3 State Bucket' },
                gcp: { resource: 'google_storage_bucket', name: 'GCS State Bucket' },
                azure: { resource: 'azurerm_storage_account', name: 'Blob State Container' }
            }
        },
        statelocking: {
            id: 'statelocking',
            name: 'State Locking',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'nosql_database' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_dynamodb_table' } },
            mappings: {
                aws: { resource: 'aws_dynamodb_table', name: 'DynamoDB Lock Table' },
                gcp: { resource: 'google_storage_bucket', name: 'GCS State Lock' },
                azure: { resource: 'azurerm_storage_account', name: 'Blob Lease Lock' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // SOURCE CONTROL
        // ═════════════════════════════════════════════════════════════════════
        sourcecontrol: {
            id: 'sourcecontrol',
            name: 'Source Control',
            category: 'devops',
            domain: 'devops',
            terraform: { moduleId: 'external' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_codecommit_repository', name: 'AWS CodeCommit' },
                gcp: { resource: 'google_sourcerepo_repository', name: 'Cloud Source Repositories' },
                azure: { resource: 'azurerm_devops_git_repository', name: 'Azure Repos' }
            }
        }
    }
};
