/**
 * MESSAGING PACK
 * Messaging infrastructure services.
 * Note: event_bus, workflow_orchestration already in core.js
 */

module.exports = {
    name: 'MESSAGING_PACK',
    description: 'Messaging infrastructure: queues, pub/sub, streaming, notifications',
    services: {

        deadletterqueue: {
            id: 'deadletterqueue',
            name: 'Dead Letter Queue',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'mq' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sqs_queue' } },
            mappings: {
                aws: { resource: 'aws_sqs_queue', name: 'SQS Dead Letter Queue' },
                gcp: { resource: 'google_pubsub_subscription', name: 'Pub/Sub DLQ' },
                azure: { resource: 'azurerm_servicebus_queue', name: 'Service Bus DLQ' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // PUB-SUB
        // ═════════════════════════════════════════════════════════════════════
        pubsub: {
            id: 'pubsub',
            name: 'Pub/Sub Topic',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'mq' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_sns_topic' } },
            mappings: {
                aws: { resource: 'aws_sns_topic', name: 'Amazon SNS' },
                gcp: { resource: 'google_pubsub_topic', name: 'Pub/Sub Topic' },
                azure: { resource: 'azurerm_servicebus_topic', name: 'Service Bus Topic' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // EVENT STREAMING
        // ═════════════════════════════════════════════════════════════════════
        eventstreaming: {
            id: 'eventstreaming',
            name: 'Event Streaming (Kafka)',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'mq' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_msk_cluster' } },
            mappings: {
                aws: { resource: 'aws_msk_cluster', name: 'Amazon MSK' },
                gcp: { resource: 'google_pubsub_topic', name: 'Pub/Sub Streaming' },
                azure: { resource: 'azurerm_eventhub', name: 'Event Hubs' }
            }
        },
        kinesisstream: {
            id: 'kinesisstream',
            name: 'Data Stream',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'mq' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kinesis_stream' } },
            mappings: {
                aws: { resource: 'aws_kinesis_stream', name: 'Kinesis Data Streams' },
                gcp: { resource: 'google_dataflow_job', name: 'Dataflow' },
                azure: { resource: 'azurerm_eventhub', name: 'Event Hubs' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // BATCH JOBS
        // ═════════════════════════════════════════════════════════════════════
        batchjob: {
            id: 'batchjob',
            name: 'Batch Job Processing',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_batch_job_definition' } },
            mappings: {
                aws: { resource: 'aws_batch_job_definition', name: 'AWS Batch' },
                gcp: { resource: 'google_cloud_scheduler_job', name: 'Cloud Scheduler' },
                azure: { resource: 'azurerm_batch_account', name: 'Azure Batch' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // NOTIFICATIONS
        // ═════════════════════════════════════════════════════════════════════
        smsnotification: {
            id: 'smsnotification',
            name: 'SMS Notification',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_sns_topic', name: 'SNS SMS' },
                gcp: { resource: 'google_pubsub_topic', name: 'Firebase/Twilio' },
                azure: { resource: 'azurerm_communication_service', name: 'Communication Services SMS' }
            }
        },
        webhook: {
            name: 'Webhook Integration',
            category: 'messaging',
            domain: 'messaging',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_lambda_function_url', name: 'Lambda Function URL' },
                gcp: { resource: 'google_cloudfunctions_function', name: 'Cloud Functions HTTP' },
                azure: { resource: 'azurerm_function_app', name: 'Function App HTTP Trigger' }
            }
        }
    }
};
