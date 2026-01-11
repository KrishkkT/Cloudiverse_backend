/**
 * IOT DOMAIN PACK
 * Services for Device Connectivity, Telemetry, and Time-Series Data.
 */

module.exports = {
    name: 'IOT_PACK',
    description: 'Services for Internet of Things workloads',
    domain: 'iot',

    services: {
        iotcore: {
            id: 'iotcore',
            name: 'IoT Core / Hub',
            category: 'iot',
            domain: 'iot',
            terraform: { moduleId: 'iot_core' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_iot_topic_rule' } },
            mappings: {
                aws: { resource: 'aws_iot_topic_rule', name: 'AWS IoT Core (rules/topic routing)' },
                gcp: { resource: 'google_cloudiot_registry', name: 'Cloud IoT Registry (legacy/alt)' },
                azure: { resource: 'azurerm_iothub', name: 'IoT Hub' }
            }
        },

        deviceregistry: {
            id: 'deviceregistry',
            name: 'Device Registry / Provisioning',
            category: 'iot',
            domain: 'iot',
            terraform: { moduleId: 'device_registry' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_iot_thing', name: 'IoT Things (Registry)' },
                gcp: { resource: 'google_cloudiot_registry', name: 'Device Registry (legacy/alt)' },
                azure: { resource: 'azurerm_iothub', name: 'IoT Hub (device identities)' }
            }
        },

        digitaltwin: {
            id: 'digitaltwin',
            name: 'Device Shadow / Digital Twin',
            category: 'iot',
            domain: 'iot',
            terraform: { moduleId: 'digital_twin' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_iot_thing', name: 'Device Shadow (conceptual)' },
                gcp: { resource: 'google_firestore_document', name: 'Twin via Firestore/DB (pattern)' },
                azure: { resource: 'azurerm_iothub', name: 'Device Twin (conceptual)' }
            }
        },

        eventstream: {
            id: 'eventstream',
            name: 'Telemetry Event Stream',
            category: 'integration',
            domain: 'iot',
            terraform: { moduleId: 'event_stream' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kinesis_stream' } },
            mappings: {
                aws: { resource: 'aws_kinesis_stream', name: 'Kinesis Data Streams' },
                gcp: { resource: 'google_pubsub_topic', name: 'Pub/Sub' },
                azure: { resource: 'azurerm_eventhub', name: 'Event Hubs' }
            }
        },

        streamprocessor: {
            id: 'streamprocessor',
            name: 'Stream Processing',
            category: 'analytics',
            domain: 'iot',
            terraform: { moduleId: 'stream_processor' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kinesis_analytics_application' } },
            mappings: {
                aws: { resource: 'aws_kinesis_analytics_application', name: 'Kinesis Data Analytics' },
                gcp: { resource: 'google_dataflow_job', name: 'Dataflow' },
                azure: { resource: 'azurerm_stream_analytics_job', name: 'Stream Analytics' }
            }
        },

        timeseriesdatabase: {
            id: 'timeseriesdatabase',
            name: 'Time Series Database',
            category: 'database',
            domain: 'iot',
            terraform: { moduleId: 'time_series_database' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_timestream_table' } },
            mappings: {
                aws: { resource: 'aws_timestream_table', name: 'Amazon Timestream' },
                gcp: { resource: 'google_bigquery_table', name: 'BigQuery (time-series pattern)' },
                azure: { resource: 'azurerm_data_explorer_cluster', name: 'Azure Data Explorer (Kusto)' }
            }
        },

        iotedgegateway: {
            id: 'iotedgegateway',
            name: 'IoT Edge Gateway',
            category: 'iot',
            domain: 'iot',
            terraform: { moduleId: 'iot_edge' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_instance', name: 'Greengrass on EC2 (pattern)' },
                gcp: { resource: 'google_compute_instance', name: 'Edge gateway on VM (pattern)' },
                azure: { resource: 'azurerm_virtual_machine', name: 'IoT Edge on VM (pattern)' }
            }
        },

        otaupdates: {
            id: 'otaupdates',
            name: 'Over-the-Air (OTA) Updates',
            category: 'iot',
            domain: 'iot',
            terraform: { moduleId: 'ota_updates' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_iot_job', name: 'IoT Jobs (OTA)' },
                gcp: { resource: 'google_cloud_scheduler_job', name: 'OTA (custom pipeline)' },
                azure: { resource: 'azurerm_iothub', name: 'IoT Hub (jobs/updates pattern)' }
            }
        }
    }
};
