/**
 * SECURITY PACK
 * Key management, certificates, IAM, vulnerability scanning, DLP, posture management.
 * Note: waf, secrets_management, siem already defined in core.js
 */

module.exports = {
    name: 'SECURITY_PACK',
    description: 'Security infrastructure: KMS, certificates, IAM, vulnerability scanning, DLP',
    services: {
        // ═════════════════════════════════════════════════════════════════════
        // KEY MANAGEMENT
        // ═════════════════════════════════════════════════════════════════════
        kms: {
            name: 'Key Management Service',
            category: 'security',
            domain: 'security',
            terraform: { moduleId: 'kms' },
            pricing: { engine: 'infracost', infracost: { resourceType: 'aws_kms_key' } },
            mappings: {
                aws: { resource: 'aws_kms_key', name: 'AWS KMS' },
                gcp: { resource: 'google_kms_crypto_key', name: 'Cloud KMS' },
                azure: { resource: 'azurerm_key_vault_key', name: 'Key Vault Keys' }
            }
        },



        // ═════════════════════════════════════════════════════════════════════
        // IAM & GOVERNANCE
        // ═════════════════════════════════════════════════════════════════════
        iampolicy: {
            id: 'iampolicy',
            name: 'IAM Policies & Governance',
            category: 'security',
            domain: 'security',
            terraform: { moduleId: 'iam' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_iam_policy', name: 'IAM Policies' },
                gcp: { resource: 'google_organization_policy', name: 'Organization Policies' },
                azure: { resource: 'azurerm_policy_definition', name: 'Azure Policy' }
            }
        },

        // ═════════════════════════════════════════════════════════════════════
        // VULNERABILITY & COMPLIANCE
        // ═════════════════════════════════════════════════════════════════════
        vulnerabilityscanner: {
            id: 'vulnerabilityscanner',
            name: 'Vulnerability Scanning',
            category: 'security',
            domain: 'security',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_inspector_assessment_target', name: 'AWS Inspector' },
                gcp: { resource: 'google_artifact_registry_repository', name: 'Container Analysis' },
                azure: { resource: 'azurerm_security_center_subscription_pricing', name: 'Defender for Cloud' }
            }
        },
        dlp: {
            name: 'Data Loss Prevention',
            category: 'security',
            domain: 'security',
            terraform: { moduleId: 'serverless_compute' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_macie2_account', name: 'Amazon Macie' },
                gcp: { resource: 'google_data_loss_prevention_job_trigger', name: 'Cloud DLP' },
                azure: { resource: 'azurerm_purview_account', name: 'Microsoft Purview' }
            }
        },
        securityposture: {
            id: 'securityposture',
            name: 'Cloud Security Posture Management',
            category: 'security',
            domain: 'security',
            terraform: { moduleId: 'monitoring' },
            pricing: { engine: 'formula' },
            mappings: {
                aws: { resource: 'aws_config_configuration_recorder', name: 'AWS Config' },
                gcp: { resource: 'google_scc_notification_config', name: 'Security Command Center' },
                azure: { resource: 'azurerm_security_center_contact', name: 'Defender for Cloud' }
            }
        }
    }
};

