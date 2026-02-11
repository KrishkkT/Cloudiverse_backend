/**
 * Credential Provider Service
 * 
 * Extracts cloud credentials from workspace connection data and formats them
 * as environment variables for Terraform CLI execution.
 * 
 * Supports: AWS (STS AssumeRole), GCP (OAuth tokens), Azure (MSAL tokens)
 */

const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const msal = require('@azure/msal-node');
const fs = require('fs').promises;
const path = require('path');

class CredentialProvider {

    constructor() {
        // Initialize MSAL Client for Azure Token Refresh
        if (process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET) {
            this.msalConfig = {
                auth: {
                    clientId: process.env.AZURE_CLIENT_ID,
                    clientSecret: process.env.AZURE_CLIENT_SECRET,
                    authority: "https://login.microsoftonline.com/common"
                }
            };
            this.cca = new msal.ConfidentialClientApplication(this.msalConfig);
        }
    }

    /**
     * Get credentials for Terraform execution based on provider
     * @param {string} provider - aws | gcp | azure
     * @param {object} connectionData - state_json.connection from workspace
     * @param {string} workDir - Working directory for writing credential files
     * @returns {object} { envVars: {}, credentialFiles: [] }
     */
    async getCredentials(provider, connectionData, workDir) {
        const providerKey = provider?.toLowerCase();

        switch (providerKey) {
            case 'aws':
                return await this.getAwsCredentials(connectionData);
            case 'gcp':
                return await this.getGcpCredentials(connectionData, workDir);
            case 'azure':
                return await this.getAzureCredentials(connectionData);
            default:
                throw new Error(`Unsupported provider: ${provider}`);
        }
    }

    /**
     * AWS: Get temporary credentials via STS AssumeRole
     */
    async getAwsCredentials(connectionData) {
        console.log('[CREDENTIAL] Getting AWS credentials...');

        // If we have stored temporary credentials, use them directly
        if (connectionData.credentials?.accessKeyId) {
            return {
                envVars: {
                    AWS_ACCESS_KEY_ID: connectionData.credentials.accessKeyId,
                    AWS_SECRET_ACCESS_KEY: connectionData.credentials.secretAccessKey,
                    AWS_SESSION_TOKEN: connectionData.credentials.sessionToken || '',
                    AWS_DEFAULT_REGION: connectionData.region || 'ap-south-1'
                },
                credentialFiles: []
            };
        }

        // Otherwise, assume role to get fresh credentials
        if (!connectionData.role_arn || !connectionData.external_id) {
            throw new Error('AWS connection missing role_arn or external_id');
        }

        const rawRegion = connectionData.region || 'ap-south-1';

        // FIX 1: Normalize Region (Handle 'ap-south1' typo)
        const normalizeAwsRegion = (r) => {
            if (!r) return "ap-south-1";
            // Fix missing dash (ap-south1 -> ap-south-1)
            if (r.match(/^[a-z]+-[a-z]+\d$/)) {
                return r.replace(/([a-z]+)-([a-z]+)(\d)/, "$1-$2-$3");
            }
            return r;
        };
        const region = normalizeAwsRegion(rawRegion);

        // FIX 2: Enforce Role ARN Name (CloudiverseDeployRole)
        // Do not trust the name in the DB, only trust the Account ID.
        let accountId = connectionData.account_id;
        if (!accountId && connectionData.role_arn) {
            const parts = connectionData.role_arn.split(':');
            if (parts.length >= 5) accountId = parts[4];
        }

        const ROLE_NAME = "cloudiverse-deploy-role";
        const correctRoleArn = accountId ?
            `arn:aws:iam::${accountId}:role/${ROLE_NAME}` :
            connectionData.role_arn; // Fallback if no account ID (should fail elsewhere)

        console.log(`[CREDENTIAL] Using Region: ${region}, Role: ${correctRoleArn}`);

        const clientConfig = { region: region };

        // Use bootstrap credentials if available
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            clientConfig.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
            };
        }

        const client = new STSClient(clientConfig);
        const assumeCmd = new AssumeRoleCommand({
            RoleArn: correctRoleArn,
            RoleSessionName: `CloudiverseTerraform-${Date.now()}`,
            ExternalId: connectionData.external_id,
            DurationSeconds: 3600 // 1 hour
        });

        const assumed = await client.send(assumeCmd);

        console.log('[CREDENTIAL] AWS AssumeRole successful');

        return {
            envVars: {
                AWS_ACCESS_KEY_ID: assumed.Credentials.AccessKeyId,
                AWS_SECRET_ACCESS_KEY: assumed.Credentials.SecretAccessKey,
                AWS_SESSION_TOKEN: assumed.Credentials.SessionToken,
                AWS_DEFAULT_REGION: region,
                AWS_REGION: region, // Critical for some SDKs
                // Inject Terraform variables for the provider configuration
                TF_VAR_role_arn: correctRoleArn,
                TF_VAR_external_id: connectionData.external_id,
                TF_VAR_region: region
            },
            credentialFiles: []
        };
    }

    /**
     * GCP: Use OAuth access token or write service account credentials
     */
    async getGcpCredentials(connectionData, workDir) {
        console.log('[CREDENTIAL] Getting GCP credentials...');

        if (!connectionData.tokens?.access_token) {
            throw new Error('GCP connection missing OAuth access token');
        }

        // GCP Terraform provider can use GOOGLE_OAUTH_ACCESS_TOKEN
        // However, for long-running operations, we might need to write a credentials file

        const envVars = {
            GOOGLE_OAUTH_ACCESS_TOKEN: connectionData.tokens.access_token,
            GOOGLE_REGION: connectionData.region || 'asia-south1',
            GOOGLE_ZONE: `${connectionData.region || 'asia-south1'}-a`
        };

        // If we have project info, add it
        if (connectionData.project_id) {
            envVars.GOOGLE_PROJECT = connectionData.project_id;
            envVars.GCLOUD_PROJECT = connectionData.project_id;
        }

        const credentialFiles = [];

        // If refresh token is available, write a credentials file for longer operations
        if (connectionData.tokens.refresh_token) {
            const credPath = path.join(workDir, 'gcp-credentials.json');
            const credContent = {
                type: 'authorized_user',
                client_id: process.env.GCP_CLIENT_ID,
                client_secret: process.env.GCP_CLIENT_SECRET,
                refresh_token: connectionData.tokens.refresh_token
            };

            await fs.writeFile(credPath, JSON.stringify(credContent, null, 2));
            envVars.GOOGLE_APPLICATION_CREDENTIALS = credPath;
            credentialFiles.push(credPath);

            console.log('[CREDENTIAL] Wrote GCP credentials file');
        }

        return { envVars, credentialFiles };
    }

    /**
     * Azure: Extract ARM credentials from MSAL tokens
     */
    async getAzureCredentials(connectionData) {
        console.log('[CREDENTIAL] Getting Azure credentials...');

        if (!connectionData.tokens?.accessToken) {
            throw new Error('Azure connection missing access token');
        }

        // Standardize Azure Service Principal / User Auth Environment Variables
        const envVars = {
            ARM_USE_CLI: 'false',
            ARM_USE_OIDC: 'false',
            ARM_TENANT_ID: connectionData.tenant_id || process.env.AZURE_TENANT_ID,
            ARM_SUBSCRIPTION_ID: connectionData.subscription_id || connectionData.credentials?.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID,
            ARM_CLIENT_ID: process.env.AZURE_CLIENT_ID // Always include client ID if available
        };

        if (!envVars.ARM_SUBSCRIPTION_ID) {
            console.warn('[CREDENTIAL] ⚠️  Warning: ARM_SUBSCRIPTION_ID is missing from connectionData');
        }

        // Check for stored Service Principal credentials first (Production Flow)
        if (connectionData.credentials?.client_id && connectionData.credentials?.client_secret) {
            envVars.ARM_CLIENT_ID = connectionData.credentials.client_id;
            // Clear any potential contamination from backend Identity
            if (envVars.ARM_CLIENT_ID !== process.env.AZURE_CLIENT_ID) {
                console.log(`[CREDENTIAL] Switched to Service Principal Client ID (Different from Backend App)`);
            }
            envVars.ARM_CLIENT_SECRET = connectionData.credentials.client_secret;
            envVars.ARM_TENANT_ID = connectionData.credentials.tenant_id || envVars.ARM_TENANT_ID;
            envVars.ARM_SUBSCRIPTION_ID = connectionData.credentials.subscription_id || envVars.ARM_SUBSCRIPTION_ID;
            console.log('[CREDENTIAL] Using Azure Service Principal credentials');
        }
        // DELEGATED AUTH: Use User Access Token (with Auto-Refresh)
        else if (connectionData.tokens?.refreshToken || connectionData.tokens?.refresh_token) {
            try {
                const refreshToken = connectionData.tokens.refreshToken || connectionData.tokens.refresh_token;
                console.log('[CREDENTIAL] Refreshing Azure Access Token for delegated verification...');

                const response = await this.cca.acquireTokenByRefreshToken({
                    refreshToken: refreshToken,
                    scopes: ["https://management.azure.com/user_impersonation", "User.Read"]
                });

                if (response && response.accessToken) {
                    envVars.ARM_ACCESS_TOKEN = response.accessToken;
                    console.log('[CREDENTIAL] ✅ Azure Token Refreshed Successfully');

                    // CRITICAL: Unset CLIENT_SECRET to force Terraform to use the ACCESS_TOKEN
                    delete envVars.ARM_CLIENT_SECRET;
                } else {
                    throw new Error("Failed to refresh token: No access token in response");
                }
            } catch (refreshErr) {
                console.warn(`[CREDENTIAL] ⚠️ Token Refresh Failed: ${refreshErr.message}`);
                // Fallback to existing access token if available (might still work if not expired)
                if (connectionData.tokens.accessToken) {
                    envVars.ARM_ACCESS_TOKEN = connectionData.tokens.accessToken;
                    delete envVars.ARM_CLIENT_SECRET;
                    console.log('[CREDENTIAL] Using existing Azure Access Token (Fallback)');
                }
            }
        }
        // Fallback: Backend Identity (Only if no user credentials found)
        else if (process.env.AZURE_CLIENT_SECRET) {
            envVars.ARM_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
            console.log('[CREDENTIAL] Using Backend Service Principal (Fallback)');
        }

        else if (connectionData.tokens?.accessToken) {
            // Use the user's access token via the standard ARM_ACCESS_TOKEN env var
            envVars.ARM_ACCESS_TOKEN = connectionData.tokens.accessToken;
            delete envVars.ARM_CLIENT_SECRET;
            console.log('[CREDENTIAL] Using Azure User Access Token (No Refresh Token available)');
        }

        return { envVars, credentialFiles: [] };
    }

    /**
     * Cleanup credential files after execution
     */
    async cleanup(credentialFiles) {
        for (const file of credentialFiles) {
            try {
                await fs.unlink(file);
                console.log(`[CREDENTIAL] Cleaned up: ${file}`);
            } catch (err) {
                console.warn(`[CREDENTIAL] Cleanup warning: ${err.message}`);
            }
        }
    }

    /**
     * Sanitize log output to remove sensitive credential values
     */
    sanitizeLog(message, envVars) {
        let sanitized = message;

        // List of env var patterns to redact
        const sensitiveKeys = [
            'AWS_SECRET_ACCESS_KEY',
            'AWS_SESSION_TOKEN',
            'GOOGLE_OAUTH_ACCESS_TOKEN',
            'ARM_CLIENT_SECRET',
            'ARM_ACCESS_TOKEN'
        ];

        for (const key of sensitiveKeys) {
            if (envVars[key]) {
                // Replace the actual value with [REDACTED]
                // Escape special regex characters to prevent "Nothing to repeat" errors
                const escapedValue = envVars[key].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                sanitized = sanitized.replace(new RegExp(escapedValue, 'g'), '[REDACTED]');
            }
        }

        return sanitized;
    }
}

module.exports = new CredentialProvider();
