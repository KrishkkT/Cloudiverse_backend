/**
 * ANALYTICS & DATA DOMAIN PACK
 * Services for big data platforms, streaming, and analytical storage.
 */

module.exports = {
    name: 'ANALYTICS_PACK',
    description: 'Services for analytics, data warehousing, streaming analytics, and governance',
    domain: 'analytics',

    services: {
        datawarehouse: {
            id: 'datawarehouse',
            name: 'Data Warehouse',
            description: 'Analytical storage for BI and reporting.',
            category: 'database',
            domain: 'analytics',
            tags: ['analytics', 'olap'],
            terraform: {
                moduleId: 'data_warehouse',
                variables: {
                    node_count: { default: 2 },
                    encryption: { default: true }
                }
            },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_redshift_cluster' } },
            mappings: {
                aws: { resource: 'aws_redshift_cluster', name: 'Redshift' },
                gcp: { resource: 'google_bigquery_dataset', name: 'BigQuery' },
                azure: { resource: 'azurerm_synapse_workspace', name: 'Azure Synapse' }
            }
        },

        datalake: {
            id: 'datalake',
            name: 'Data Lake',
            description: 'Low-cost storage layer for raw/curated datasets.',
            category: 'storage',
            domain: 'analytics',
            tags: ['lake', 'storage'],
            terraform: { moduleId: 'data_lake' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_s3_bucket' } },
            mappings: {
                aws: { resource: 'aws_s3_bucket', name: 'S3 (data lake)' },
                gcp: { resource: 'google_storage_bucket', name: 'Cloud Storage (data lake)' },
                azure: { resource: 'azurerm_storage_account', name: 'ADLS Gen2 (via Storage Account)' }
            }
        },


        etlorchestration: {
            id: 'etlorchestration',
            name: 'ETL Orchestration',
            description: 'Schedules and orchestrates data pipelines.',
            category: 'analytics',
            domain: 'analytics',
            tags: ['etl', 'orchestration'],
            terraform: { moduleId: 'workflow_orchestration' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sfn_state_machine' } },
            mappings: {
                aws: { resource: 'aws_sfn_state_machine', name: 'Step Functions (ETL)' },
                gcp: { resource: 'google_workflows_workflow', name: 'Workflows (ETL)' },
                azure: { resource: 'azurerm_data_factory', name: 'Data Factory (pipelines)' }
            }
        },

        datacatalog: {
            id: 'datacatalog',
            name: 'Data Catalog / Governance',
            description: 'Metadata catalog, discovery, and governance controls.',
            category: 'security',
            domain: 'analytics',
            tags: ['catalog', 'governance'],
            terraform: { moduleId: 'data_catalog' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_glue_catalog_database', name: 'Glue Data Catalog' },
                gcp: { resource: 'google_dataplex_lake', name: 'Dataplex' },
                azure: { resource: 'azurerm_purview_account', name: 'Microsoft Purview' }
            }
        },

        bidashboard: {
            id: 'bidashboard',
            name: 'BI Dashboards',
            description: 'Dashboards and reports over warehouse/lake.',
            category: 'analytics',
            domain: 'analytics',
            tags: ['bi', 'dashboard'],
            terraform: { moduleId: 'bi_dashboard' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_quicksight_account_subscription', name: 'QuickSight (conceptual)' },
                gcp: { resource: 'google_looker_instance', name: 'Looker' },
                azure: { resource: 'azurerm_powerbi_embedded', name: 'Power BI Embedded (conceptual)' }
            }
        }
    }
};
