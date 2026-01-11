/**
 * OBSERVABILITY PACK
 * Observability stack services.
 * Note: tracing already in core.js
 */

module.exports = {
    name: 'OBSERVABILITY_PACK',
    description: 'Observability stack: APM, alerting, audit logs, metrics',
    services: {
        // ═════════════════════════════════════════════════════════════════════
        // APM & PERFORMANCE
        // ═════════════════════════════════════════════════════════════════════
        apm: {
            id: 'apm',
            name: 'Application Performance Monitoring',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_xray_group', name: 'AWS X-Ray APM' },
                gcp: { resource: 'google_monitoring_dashboard', name: 'Cloud Monitoring APM' },
                azure: { resource: 'azurerm_application_insights', name: 'Application Insights APM' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // METRICS
        // ═════════════════════════════════════════════════════════════════════
        metrics: {
            id: 'metrics',
            name: 'Custom Metrics',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudwatch_metric_alarm' } },
            mappings: {
                aws: { resource: 'aws_cloudwatch_metric_alarm', name: 'CloudWatch Metrics' },
                gcp: { resource: 'google_monitoring_metric_descriptor', name: 'Custom Metrics' },
                azure: { resource: 'azurerm_monitor_metric_alert', name: 'Metric Alerts' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // ALERTING & ON-CALL
        // ═════════════════════════════════════════════════════════════════════
        alerting: {
            id: 'alerting',
            name: 'Alerting & On-Call',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_cloudwatch_metric_alarm', name: 'CloudWatch Alarms' },
                gcp: { resource: 'google_monitoring_alert_policy', name: 'Cloud Alerting' },
                azure: { resource: 'azurerm_monitor_action_group', name: 'Action Groups' }
            }
        },
        incidentmanagement: {
            id: 'incidentmanagement',
            name: 'Incident Management',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_ssm_ops_center', name: 'Systems Manager OpsCenter' },
                gcp: { resource: 'google_monitoring_alert_policy', name: 'Cloud Alerting' },
                azure: { resource: 'azurerm_monitor_action_group', name: 'Action Groups' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // AUDIT LOGGING
        // ═════════════════════════════════════════════════════════════════════
        auditlogging: {
            id: 'auditlogging',
            name: 'Audit Logs',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'logging' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_cloudtrail' } },
            mappings: {
                aws: { resource: 'aws_cloudtrail', name: 'AWS CloudTrail' },
                gcp: { resource: 'google_logging_project_sink', name: 'Audit Logs' },
                azure: { resource: 'azurerm_monitor_diagnostic_setting', name: 'Activity Log' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // LOG AGGREGATION
        // ═════════════════════════════════════════════════════════════════════
        logaggregation: {
            id: 'logaggregation',
            name: 'Log Aggregation',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'logging' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kinesis_firehose_delivery_stream' } },
            mappings: {
                aws: { resource: 'aws_kinesis_firehose_delivery_stream', name: 'Kinesis Firehose' },
                gcp: { resource: 'google_logging_project_sink', name: 'Log Router' },
                azure: { resource: 'azurerm_log_analytics_workspace', name: 'Log Analytics' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // DASHBOARDS
        // ═════════════════════════════════════════════════════════════════════
        dashboard: {
            id: 'dashboard',
            name: 'Monitoring Dashboard',
            category: 'observability',
            domain: 'observability',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_cloudwatch_dashboard', name: 'CloudWatch Dashboard' },
                gcp: { resource: 'google_monitoring_dashboard', name: 'Cloud Monitoring Dashboard' },
                azure: { resource: 'azurerm_dashboard', name: 'Azure Dashboard' }
            }
        }
    }
};
