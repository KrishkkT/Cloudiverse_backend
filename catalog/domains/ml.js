/**
 * ML / AI DOMAIN PACK
 * Services for Machine Learning training, deployment, and lifecycle.
 */

module.exports = {
    name: 'ML_PACK',
    description: 'Services for AI and Machine Learning',
    domain: 'ml',

    services: {
        mltraining: {
            id: 'mltraining',
            name: 'ML Training',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'ml_training' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sagemaker_notebook_instance' } },
            mappings: {
                aws: { resource: 'aws_sagemaker_notebook_instance', name: 'SageMaker (notebook/training pattern)' },
                gcp: { resource: 'google_vertex_ai_tensorboard', name: 'Vertex AI Training (pattern)' },
                azure: { resource: 'azurerm_machine_learning_compute_cluster', name: 'Azure ML Compute Cluster' }
            }
        },

        mlinference: {
            id: 'mlinference',
            name: 'ML Inference / Endpoint',
            category: 'ml',
            domain: 'ml',
            terraform_supported: true,  // 🔥 FIX: Mark as terraform-deployable for LLM API apps
            terraform: { moduleId: 'ml_inference' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sagemaker_endpoint' } },
            mappings: {
                aws: { resource: 'aws_sagemaker_endpoint', name: 'SageMaker Endpoint' },
                gcp: { resource: 'google_vertex_ai_endpoint', name: 'Vertex AI Endpoint' },
                azure: { resource: 'azurerm_machine_learning_inference_cluster', name: 'Azure ML Inference (pattern)' }
            }
        },

        featurestore: {
            id: 'featurestore',
            name: 'Feature Store',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'feature_store' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sagemaker_feature_group' } },
            mappings: {
                aws: { resource: 'aws_sagemaker_feature_group', name: 'SageMaker Feature Store' },
                gcp: { resource: 'google_vertex_ai_featurestore', name: 'Vertex AI Feature Store' },
                azure: { resource: 'azurerm_machine_learning_datastore_blob', name: 'Azure ML Datastore (feature pattern)' }
            }
        },

        modelregistry: {
            id: 'modelregistry',
            name: 'Model Registry',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'model_registry' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_sagemaker_model_package_group', name: 'SageMaker Model Registry' },
                gcp: { resource: 'google_vertex_ai_model', name: 'Vertex AI Model Registry (pattern)' },
                azure: { resource: 'azurerm_machine_learning_workspace', name: 'Azure ML Registry (workspace pattern)' }
            }
        },

        experimenttracking: {
            id: 'experimenttracking',
            name: 'Experiment Tracking',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'experiment_tracking' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_sagemaker_experiment', name: 'SageMaker Experiments (conceptual)' },
                gcp: { resource: 'google_vertex_ai_metadata_store', name: 'Vertex AI Metadata' },
                azure: { resource: 'azurerm_machine_learning_workspace', name: 'Azure ML Tracking (workspace pattern)' }
            }
        },

        mlpipelineorchestration: {
            id: 'mlpipelineorchestration',
            name: 'ML Pipelines / Orchestration',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'workflow_orchestration' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sfn_state_machine' } },
            mappings: {
                aws: { resource: 'aws_sfn_state_machine', name: 'Step Functions (ML pipelines pattern)' },
                gcp: { resource: 'google_workflows_workflow', name: 'Workflows (pipelines pattern)' },
                azure: { resource: 'azurerm_logic_app_workflow', name: 'Logic Apps (pipelines pattern)' }
            }
        },

        vectordatabase: {
            id: 'vectordatabase',
            name: 'Vector Database (RAG / Semantic Search)',
            category: 'database',
            domain: 'ml',
            terraform: { moduleId: 'vector_database' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_opensearch_domain', name: 'OpenSearch Vector (pattern)' },
                gcp: { resource: 'google_alloydb_cluster', name: 'AlloyDB/Vertex Vector (pattern)' },
                azure: { resource: 'azurerm_search_service', name: 'Azure AI Search Vector (pattern)' }
            }
        },

        modelmonitoring: {
            id: 'modelmonitoring',
            name: 'Model Monitoring / Drift',
            category: 'ml',
            domain: 'ml',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_cloudwatch_metric_alarm', name: 'CloudWatch Alarms (pattern)' },
                gcp: { resource: 'google_monitoring_alert_policy', name: 'Alerting (pattern)' },
                azure: { resource: 'azurerm_monitor_metric_alert', name: 'Azure Monitor Alerts (pattern)' }
            }
        }
    }
};
