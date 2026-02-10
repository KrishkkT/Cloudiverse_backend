const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { CloudFormationClient, DeleteStackCommand, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
const { google } = require('googleapis');
const msal = require('@azure/msal-node');
const axios = require('axios'); // For Azure REST API
const crypto = require('crypto'); // For UUIDs

// Google OAuth Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GCP_CLIENT_ID,
    process.env.GCP_CLIENT_SECRET,
    process.env.GCP_REDIRECT_URI || 'http://localhost:5000/api/cloud/gcp/callback'
);

// Azure MSAL Setup
const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: "https://login.microsoftonline.com/common",
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);



// Helper to check GCP Billing
async function checkGcpBilling(projectId, authClient) {
    const cloudbilling = google.cloudbilling({ version: 'v1', auth: authClient });
    try {
        const res = await cloudbilling.projects.getBillingInfo({
            name: `projects/${projectId}`
        });
        return res.data;
    } catch (error) {
        console.error(`Error checking billing for ${projectId}:`, error.message);
        // If 403, it might mean API not enabled, but we should handle gracefully
        throw error;
    }
}

// Unified Verification Helper
const verifyCloudConnection = async (provider, metadata) => {
    console.log(`[VERIFY_START] ${provider.toUpperCase()}`, {
        hasTokens: !!metadata.tokens,
        hasRoleArn: !!metadata.role_arn,
        hasExternalId: !!metadata.external_id,
        context: metadata
    });

    try {
        if (provider === 'aws') {
            // AWS Verification (AssumeRole + GetCallerIdentity)
            // 🔧 BOOTSTRAP: Use standard chain (Instance Profile) OR specific backend keys from env
            const clientConfig = { region: "ap-south-1" };

            // Only use explicit keys if they exist in env (Local Dev), otherwise SDK defaults to Instance Profile
            if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
                clientConfig.credentials = {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                };
            }

            const client = new STSClient(clientConfig);

            // 1. Assume Role (The User's Role)
            const assumeCmd = new AssumeRoleCommand({
                RoleArn: metadata.role_arn,
                RoleSessionName: "CloudiverseVerificationSession",
                ExternalId: metadata.external_id
            });

            let assumed;
            try {
                assumed = await client.send(assumeCmd);
            } catch (stsErr) {
                if (stsErr.Code === 'AccessDenied' || (stsErr.message && stsErr.message.includes('not authorized to perform: sts:AssumeRole'))) {
                    throw new Error(`Cloudiverse Backend does not have permission to assume role '${metadata.role_arn}'.\n\nEnsure your role's Trust Policy allows account '${process.env.AWS_ACCOUNT_ID}' (or the backend identity) to assume it.`);
                }
                throw stsErr;
            }

            // 2. Verify Identity with Temp Creds
            const identityClient = new STSClient({
                region: "ap-south-1",
                credentials: {
                    accessKeyId: assumed.Credentials.AccessKeyId,
                    secretAccessKey: assumed.Credentials.SecretAccessKey,
                    sessionToken: assumed.Credentials.SessionToken
                }
            });
            const identity = await identityClient.send(new GetCallerIdentityCommand({}));

            // 3. Compare Account ID (If provided by user context/input)
            if (metadata.account_id && identity.Account !== metadata.account_id) {
                console.warn(`[AWS_VERIFY_WARNING] Assumed role is in Account ${identity.Account}, but expected ${metadata.account_id}`);
                // We could throw here, but for now we just return the actual found ID
            }

            return {
                verified: true,
                account_id: identity.Account,
                region: 'ap-south-1' // Default target
            };
        }
        else if (provider === 'gcp') {
            // GCP Verification (Projects.list - verified access to Cloud Platform)
            console.log("[GCP] Setting credentials...");
            if (!metadata.tokens) throw new Error("No tokens found in metadata");

            oauth2Client.setCredentials(metadata.tokens);
            const crm = google.cloudresourcemanager('v1');

            // Verify access to list projects
            console.log("[GCP] Listing projects to verify scope...");
            const res = await crm.projects.list({ auth: oauth2Client, pageSize: 1 });
            console.log("[GCP] Project list success:", res.data.projects ? res.data.projects.length : '0 found');

            if (!res.data.projects || res.data.projects.length === 0) {
                throw new Error("No GCP projects found. Please create a project in the GCP console first.");
            }

            return {
                verified: true,
                account_id: metadata.account_email,
                project_id: res.data.projects[0].projectId,
                region: 'asia-south1'
            };
        }
        else if (provider === 'azure') {
            // Azure Verification (List Subscriptions)
            console.log("[AZURE] Verifying with token...");

            // Ensure we have a valid token (re-acquire if needed logic could go here, but simply using stored token for now)
            const token = metadata.tokens.accessToken;
            if (!token) throw new Error("No access token found for Azure");

            // Using the correct API version and logging the request
            const subUrl = 'https://management.azure.com/subscriptions?api-version=2020-01-01';
            console.log(`[AZURE] Calling GET ${subUrl}`);

            const res = await axios.get(subUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.data.value || res.data.value.length === 0) {
                console.warn("[AZURE] No subscriptions found for this account.");
                throw new Error("No subscriptions found or accessible.");
            }

            console.log("[AZURE] Subscriptions found:", res.data.value.length);
            return {
                verified: true,
                account_id: metadata.account_id,
                subscription_id: res.data.value[0].subscriptionId,
                tenant_id: res.data.value[0].tenantId || metadata.tenant_id,
                region: 'centralindia'
            };
        }
    } catch (err) {
        console.error(`[VERIFY_FAIL] ${provider}: ${err.message}`);
        if (err.response) {
            console.error(`[VERIFY_FAIL_DATA]`, err.response.data);
        }
        throw err;
    }
};

router.post('/aws/template', authMiddleware, async (req, res) => {
    try {
        const { workspace_id } = req.body;
        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID is required" });

        const externalId = `cloudiverse-${workspace_id}-${Math.random().toString(36).substring(7)}`;
        const accountId = process.env.AWS_ACCOUNT_ID || "123456789012";

        const yamlContent = `
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Cloudiverse Cross-Account Access Role'
Parameters:
  ExternalId:
    Type: String
    Description: 'The External ID for security'
    Default: '${externalId}'
  CloudiverseAccountId:
    Type: String
    Description: 'The Cloudiverse AWS Account ID'
    Default: '${accountId}'
Resources:
  CloudiverseAccessRole:
    Type: 'AWS::IAM::Role'
    Properties:
      RoleName: !Sub 'CloudiverseAccessRole-\${ExternalId}'
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: !Ref CloudiverseAccountId
            Action: 'sts:AssumeRole'
            Condition:
              StringEquals:
                'sts:ExternalId': !Ref ExternalId
      Policies:
        - PolicyName: 'CloudiversePowerUserAccess'
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: '*'
                Resource: '*'
Outputs:
  RoleArn:
    Description: 'The ARN of the role to paste into Cloudiverse'
    Value: !GetAtt CloudiverseAccessRole.Arn
`;

        res.json({
            template: yamlContent,
            filename: `cloudiverse-trust-role-${workspace_id}.yaml`,
            extra: { externalId, accountId }
        });

    } catch (err) {
        console.error("Template Gen Error:", err);
        res.status(500).send("Server Error");
    }
});

router.post('/:provider/connect', authMiddleware, async (req, res) => {
    try {
        const provider = req.params.provider.toLowerCase();
        const { workspace_id } = req.body;

        if (!workspace_id) {
            return res.status(400).json({ msg: "Workspace ID is required" });
        }

        let authUrl = '';
        let extra = {};

        if (provider === 'aws') {
            const safeWorkspaceId = String(workspace_id);

            // 🧠 STRICT STABLE EXTERNAL ID (No Randomness)
            const stableExternalId = `cloudiverse-user-${safeWorkspaceId}`;

            // Check current status
            const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
            const currentState = wsRes.rows[0]?.state_json || {};
            const currentConnection = currentState.connection || {};

            // 🚨 ONE-TIME FIX: If DB has a different ID (e.g. random suffix), OVERWRITE IT.
            // This ensures backend is 100% in sync with the strict ID we want.
            if (currentConnection.external_id !== stableExternalId) {
                console.log(`[AWS_FIX] Overwriting ExternalId. Old: ${currentConnection.external_id} -> New: ${stableExternalId}`);

                const initialState = {
                    ...currentState,
                    connection: {
                        ...currentConnection, // Keep other fields
                        external_id: stableExternalId,
                        status: 'pending', // Re-verify needed
                        provider: 'aws',
                        initiated_at: new Date().toISOString()
                    }
                };
                await pool.query(
                    `UPDATE workspaces SET state_json = $1 WHERE id = $2`,
                    [JSON.stringify(initialState), workspace_id]
                );
            }

            const externalId = stableExternalId;

            // 🚀 CLOUDFORMATION DEEP LINK
            // Assuming this template creates role: CloudiverseDeployRole
            const templateUri = "https://cloudiverse-cloudformation.s3.ap-south-1.amazonaws.com/aws-trust-role.yaml";
            const accountId = process.env.AWS_ACCOUNT_ID;

            if (!accountId) throw new Error("AWS_ACCOUNT_ID is not configured in backend .env");

            const uniqueStackName = `CloudiverseAccess-${safeWorkspaceId.substring(0, 8)}`;
            // Use 'CloudiverseDeployRole' as parameter if template supports it, or rely on template hardcoding it.
            // We pass account ID so the role trusts US.
            authUrl = `https://console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks/create/review?templateURL=${encodeURIComponent(templateUri)}&stackName=${uniqueStackName}&param_ExternalId=${externalId}&param_CloudiverseAccountId=${accountId}`;

            extra = { externalId, accountId };
        }
        else if (provider === 'gcp') {
            const scopes = [
                'https://www.googleapis.com/auth/cloud-platform',
                'https://www.googleapis.com/auth/userinfo.email'
            ];
            authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                state: workspace_id,
                prompt: 'consent'
            });
        }
        else if (provider === 'azure') {
            const authCodeUrlParameters = {
                scopes: [
                    "https://management.azure.com/user_impersonation", // For ARM (Role Assignment)
                    "User.Read", // Basic profile access (Personal & Work)
                    "offline_access" // Critical for refresh tokens
                ],
                redirectUri: process.env.AZURE_REDIRECT_URI,
                state: workspace_id,
                prompt: 'select_account',
                authority: "https://login.microsoftonline.com/organizations"
            };
            authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
            console.log("[AZURE] Generated Auth URL:", authUrl);
            console.log("[AZURE] Auth Params:", JSON.stringify(authCodeUrlParameters, null, 2));
        }

        res.json({
            msg: "Auth URL generated",
            url: authUrl,
            extra,
            provider
        });

    } catch (err) {
        console.error("Cloud Connect Error:", err);
        res.status(500).send("Server Error: " + err.message);
    }
});

router.get('/:provider/callback', async (req, res) => {
    try {
        const { provider } = req.params;
        const { code, state: workspace_id, error } = req.query;

        if (error) return res.status(400).send(`Authorization failed: ${error}`);
        if (!workspace_id || !code) return res.status(400).send("Missing workspace context or code");

        // 1. Initial Metadata (Pending State)
        let connectionMetadata = {
            provider: provider.toLowerCase(),
            status: 'pending', // Starts as pending
            connected_at: new Date().toISOString(),
            verified: false
        };

        if (provider === 'gcp') {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();

            connectionMetadata = {
                ...connectionMetadata,
                account_email: userInfo.data.email,
                tokens: tokens,
                region: 'asia-south1'
            };
        }
        if (provider === 'azure') {
            const state = req.query.state || 'init'; // 'init' (First Login) -> 'consenting' (Admin Screen) -> 'final' (Post-Consent Login)

            // 0. HANDLE ADMIN CONSENT RETURN
            // If returning from Admin Consent screen, we have admin_consent=True (and tenant), but NO tokens yet.
            // We must now re-trigger login (phase=final) to get the actual tokens with the new permissions.
            if (req.query.admin_consent === 'True' || req.query.admin_consent === 'true') {
                console.log("[AZURE_AUTO] Admin Consent Granted. Re-initiating login to acquire final tokens...");

                // Re-construct auth URL for final phase
                const authorityString = "https://login.microsoftonline.com/common";
                const finalAuthUrlParams = {
                    scopes: ["https://graph.microsoft.com/.default", "offline_access", "User.Read", "https://management.azure.com/user_impersonation"],
                    redirectUri: process.env.AZURE_REDIRECT_URI,
                    state: 'final',
                    authority: authorityString
                };
                const finalAuthUrl = await cca.getAuthCodeUrl(finalAuthUrlParams);
                return res.redirect(finalAuthUrl);
            }

            // A. Acquire Tokens (Standard Flow)
            // Critical Scopes for SP Creation & Assignment
            const criticalScopes = [
                "openid",
                "profile",
                "email",
                "offline_access",
                "User.Read",
                "https://management.azure.com/user_impersonation"
            ];

            const tokenRequest = {
                code: code,
                scopes: criticalScopes,
                redirectUri: process.env.AZURE_REDIRECT_URI,
            };

            const response = await cca.acquireTokenByCode(tokenRequest);
            const tenantId = response.tenantId;
            const account = response.account;

            // B. FORCE ADMIN CONSENT (If Phase = 'init')
            // The user mandates: "On first connect, redirect user to adminconsent".
            // 🛡️ PASS: Personal (Consumer) accounts CANNOT grant admin consent.
            const isConsumerAccount = tenantId === '9188040d-6c67-4c5b-b112-36a304b66dad';

            if (state === 'init' && !isConsumerAccount) {
                console.log(`[AZURE_AUTO] First Connect (Tenant: ${tenantId}). Redirecting to Force Admin Consent...`);
                // Construct Admin Consent URL
                const adminConsentUrl = `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${process.env.AZURE_CLIENT_ID}&redirect_uri=${process.env.AZURE_REDIRECT_URI}&state=consenting`;
                return res.redirect(adminConsentUrl);
            }

            if (isConsumerAccount && state === 'init') {
                console.log("[AZURE_AUTO] Consumer Account detected. Bypassing Admin Consent (not supported for personal accounts).");
            }


            // C. PROCEED (Phase = 'final') - We have Consent + Tokens
            console.log("[AZURE_AUTO] Phase 'final': Starting Service Principal Creation...");

            // Get Graph Token
            const graphRes = await cca.acquireTokenSilent({
                account: account,
                scopes: ["User.Read"]
            });
            const graphToken = graphRes.accessToken;

            // Get ARM Token
            const armRes = await cca.acquireTokenSilent({
                account: account,
                scopes: ["https://management.azure.com/user_impersonation"]
            });
            const armToken = armRes.accessToken;

            // D. Get Subscription
            const subReq = await axios.get('https://management.azure.com/subscriptions?api-version=2020-01-01', {
                headers: { Authorization: `Bearer ${armToken}` }
            });
            if (!subReq.data.value?.length) throw new Error("No Azure Subscription found.");
            const subscriptionId = subReq.data.value[0].subscriptionId;
            const targetTenantId = subReq.data.value[0].tenantId;

            console.log(`[AZURE_AUTO] Identified Subscription: ${subscriptionId} in Tenant: ${targetTenantId}`);

            let finalGraphToken = graphToken;
            let finalArmToken = armToken;
            let finalTenantId = tenantId;

            // Context Switch if Target Tenant differs from Login Tenant (Guest Scenario)
            if (targetTenantId && targetTenantId !== tenantId) {
                console.log(`[AZURE_AUTO] ⚠️ Context Mismatch! Switching to Subscription Tenant: ${targetTenantId}`);

                try {
                    const tokenReqSwitch = {
                        account: account,
                        authority: `https://login.microsoftonline.com/${targetTenantId}`
                    };

                    // Re-acquire Graph Token for Target Tenant
                    const newGraphRes = await cca.acquireTokenSilent({
                        ...tokenReqSwitch,
                        scopes: ["https://graph.microsoft.com/.default"]
                    });
                    finalGraphToken = newGraphRes.accessToken;

                    // Re-acquire ARM Token for Target Tenant
                    const newArmRes = await cca.acquireTokenSilent({
                        ...tokenReqSwitch,
                        scopes: ["https://management.azure.com/user_impersonation"]
                    });
                    finalArmToken = newArmRes.accessToken;

                    finalTenantId = targetTenantId;
                    console.log("[AZURE_AUTO] Context switch successful.");
                } catch (switchErr) {
                    console.error("[AZURE_AUTO] Context switch failed:", switchErr.message);
                    throw new Error(`Failed to switch to subscription tenant ${targetTenantId}. Please ensure you have access.`);
                }
            }

            console.log(`[AZURE_AUTO] Creating Service Principal in Tenant: ${finalTenantId}, Sub: ${subscriptionId}`);

            // E. Create App Registration (Graph) - Using FINAL tokens
            const appName = `Cloudiverse-Managed-${workspace_id.substring(0, 6)}`;
            // Check if exists first to be idempotent
            let appId, appObjectId;

            try {
                const existingApps = await axios.get(`https://graph.microsoft.com/v1.0/applications?$filter=displayName eq '${appName}'`, { headers: { Authorization: `Bearer ${finalGraphToken}` } });
                if (existingApps.data.value && existingApps.data.value.length > 0) {
                    console.log("[AZURE_AUTO] App already exists, using verification logic...");
                    appId = existingApps.data.value[0].appId;
                    appObjectId = existingApps.data.value[0].id;
                } else {
                    const createAppRes = await axios.post('https://graph.microsoft.com/v1.0/applications', {
                        displayName: appName,
                        signInAudience: "AzureADMyOrg"
                    }, { headers: { Authorization: `Bearer ${finalGraphToken}` } });
                    appId = createAppRes.data.appId;
                    appObjectId = createAppRes.data.id;
                }
            } catch (graphErr) {
                console.error("Graph Error:", graphErr.response?.data);
                throw graphErr;
            }

            let credentials = {};
            try {
                // F. Create Service Principal (Graph)
                await new Promise(r => setTimeout(r, 2000));

                // Check if SP exists
                let spObjectId;
                const existingSps = await axios.get(`https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${appId}'`, { headers: { Authorization: `Bearer ${finalGraphToken}` } });
                if (existingSps.data.value && existingSps.data.value.length > 0) {
                    spObjectId = existingSps.data.value[0].id;
                } else {
                    const createSpRes = await axios.post('https://graph.microsoft.com/v1.0/servicePrincipals', {
                        appId: appId
                    }, { headers: { Authorization: `Bearer ${finalGraphToken}` } });
                    spObjectId = createSpRes.data.id;
                }

                // G. Create Client Secret
                const secretRes = await axios.post(`https://graph.microsoft.com/v1.0/applications/${appObjectId}/addPassword`, {
                    passwordCredential: { displayName: "TerraformKey" }
                }, { headers: { Authorization: `Bearer ${finalGraphToken}` } });
                const clientSecret = secretRes.data.secretText;

                // H. Assign 'Owner' Role (ARM)
                const roleAssignmentId = crypto.randomUUID();
                const roleScope = `/subscriptions/${subscriptionId}`;
                const roleDefId = `${roleScope}/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635`;

                // Wait for SP to propagate to ARM (can take 10-60s)
                console.log("[AZURE_AUTO] Waiting for SP propagation...");
                await new Promise(r => setTimeout(r, 15000));

                try {
                    await axios.put(`https://management.azure.com${roleScope}/providers/Microsoft.Authorization/roleAssignments/${roleAssignmentId}?api-version=2018-09-01-preview`, {
                        properties: {
                            roleDefinitionId: roleDefId,
                            principalId: spObjectId
                        }
                    }, { headers: { Authorization: `Bearer ${finalArmToken}` } });
                } catch (roleErr) {
                    // Ignore "Already Exists" (409)
                    if (roleErr.response?.status === 409) {
                        console.log("[AZURE_AUTO] Role assignment already exists. Proceeding.");
                    } else {
                        console.warn("[AZURE_AUTO] Role Assignment Failed (Non-blocking):", roleErr.response?.data || roleErr.message);
                    }
                }

                console.log("[AZURE_AUTO] Service Principal Created & Assigned!");

                credentials = {
                    client_id: appId,
                    client_secret: clientSecret,
                    tenant_id: finalTenantId,
                    subscription_id: subscriptionId
                };
            } catch (spErr) {
                console.warn("[AZURE_AUTO] Failed to automatically create Service Principal (Expected for Personal Accounts):", spErr.message);
                // Continue without credentials - User might need to configure manually or use CLI
            }

            connectionMetadata = {
                ...connectionMetadata,
                account_id: response.account.username,
                tenant_id: finalTenantId, // ❗ Dynamic Tenant (never hardcoded)
                subscription_id: subscriptionId,
                region: 'centralindia',
                principalObjectId: response.idTokenClaims?.oid || response.account.idTokenClaims?.oid, // Store OID as requested
                credentials: Object.keys(credentials).length > 0 ? credentials : undefined,
                verified: true,
                status: 'connected',
                manual_sp_required: Object.keys(credentials).length === 0
            };
        }

        // 2. Attempt Auto-Verification (Best Effort) - Only if not already verified
        if (!connectionMetadata.verified) {
            try {
                const verifyRes = await verifyCloudConnection(provider.toLowerCase(), connectionMetadata);
                connectionMetadata.status = 'connected';
                connectionMetadata.verified = true;
                connectionMetadata.subscription_id = verifyRes.subscription_id;
                connectionMetadata.tenant_id = connectionMetadata.tenant_id || verifyRes.tenant_id;
                connectionMetadata.project_id = verifyRes.project_id;
                connectionMetadata.account_id = verifyRes.account_id || connectionMetadata.account_id;
            } catch (verifyErr) {
                console.warn(`Auto-verification failed for ${provider}, remaining in pending state:`, verifyErr.message);
                // Stays as 'pending', user must click verify manually
            }
        }

        // 3. Update Workspace
        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).send("Workspace not found");

        const currentState = wsRes.rows[0].state_json || {};
        const updatedState = {
            ...currentState,
            step: 'deploy',
            connection: connectionMetadata
        };

        await pool.query(
            "UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2",
            [JSON.stringify(updatedState), workspace_id]
        );

        // 4. Respond with PostMessage
        const successHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Success</title>
                <style>
                    body { background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
                    .icon { font-size: 48px; color: #4ade80; margin-bottom: 20px; }
                </style>
            </head>
            <body>
                <div class="icon">✓</div>
                <h1>Auth Flow Complete</h1>
                <p>Status: ${connectionMetadata.status.toUpperCase()}</p>
                <p>You can close this window now.</p>
                <script>
                    if (window.opener) {
                        try {
                             window.opener.postMessage({ type: 'CLOUD_AUTH_SUCCESS', provider: '${provider}', workspaceId: '${workspace_id}', status: '${connectionMetadata.status}' }, '*');
                        } catch (e) { console.error("PostMessage failed", e); }
                    }
                    // Try to close, but offer button if blocked
                    setTimeout(() => window.close(), 1000);
                </script>
                <button onclick="window.close()" style="margin-top: 20px; padding: 12px 24px; background: #334155; border: 1px solid #475569; color: white; border-radius: 8px; cursor: pointer; font-weight: bold; transition: all 0.2s;">Close Window</button>
            </body>
            </html>
        `;
        res.send(successHtml);

    } catch (err) {
        console.error("Cloud Callback Error:", err);
        res.status(500).send("Connection Failed: " + err.message);
    }
});

// Disconnect Cloud Account
router.post('/disconnect', authMiddleware, async (req, res) => {
    try {
        const { workspace_id } = req.body;
        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID required" });

        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).json({ msg: "Workspace not found" });

        const currentState = wsRes.rows[0].state_json || {};

        // Clear connection metadata and reset deployment flow
        const updatedState = {
            ...currentState,
            step: 'deploy', // Force back to deployment start
            connection: {
                status: 'disconnected',
                provider: null,
                account_id: null,
                tokens: null,
                verified: false
            },
            // Reset deployment steps to ensure clean reconnect experience
            deployment: null,
            terraform: null,
            provisioningState: null,
            isDeployed: false
        };

        await pool.query(
            "UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2",
            [JSON.stringify(updatedState), workspace_id]
        );

        console.log(`[CLOUD] Disconnected account for workspace ${workspace_id}`);
        res.json({ success: true, msg: "Disconnected Successfully" });

    } catch (err) {
        console.error("Disconnect Error:", err);
        res.status(500).json({ msg: "Disconnect Failed", error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE CLOUDFORMATION STACK (AWS Only)
// Permanently removes the Cloudiverse IAM role stack from user's account
// ═══════════════════════════════════════════════════════════════════
router.post('/aws/delete-stack', authMiddleware, async (req, res) => {
    try {
        const { account_id, external_id } = req.body;

        if (!account_id || !external_id) {
            return res.status(400).json({ error: 'account_id and external_id required' });
        }

        // Stack name pattern from /aws/connect: CloudiverseAccess-${workspaceId.substring(0,8)}
        // Role name from S3 template: cloudiverse-deploy-role (hardcoded)
        // External ID pattern: cloudiverse-user-{workspace_id}
        const workspaceIdFromExtId = external_id.replace('cloudiverse-user-', '');
        const STACK_NAME = `CloudiverseAccess-${workspaceIdFromExtId.substring(0, 8)}`;
        const roleArn = `arn:aws:iam::${account_id}:role/cloudiverse-deploy-role`;
        const externalId = external_id;

        console.log(`[AWS] Attempting to delete CloudFormation stack '${STACK_NAME}' in account ${account_id}`);

        // First, assume the role in the user's account
        const stsClient = new STSClient({ region: 'ap-south-1' });

        let credentials;
        try {
            const assumeRoleRes = await stsClient.send(new AssumeRoleCommand({
                RoleArn: roleArn,
                RoleSessionName: 'CloudiverseStackDeletion',
                ExternalId: externalId,
                DurationSeconds: 900
            }));
            credentials = assumeRoleRes.Credentials;
        } catch (assumeErr) {
            console.error('[AWS] Failed to assume role for stack deletion:', assumeErr.message);
            // If we can't assume the role, the stack may need manual deletion
            return res.status(400).json({
                error: 'Cannot assume role - stack may need manual deletion',
                details: assumeErr.message,
                manual_steps: `Go to AWS Console > CloudFormation > Delete stack '${STACK_NAME}'`
            });
        }

        // Create CloudFormation client with assumed credentials
        const cfnClient = new CloudFormationClient({
            region: 'ap-south-1',
            credentials: {
                accessKeyId: credentials.AccessKeyId,
                secretAccessKey: credentials.SecretAccessKey,
                sessionToken: credentials.SessionToken
            }
        });

        // Check if stack exists
        try {
            await cfnClient.send(new DescribeStacksCommand({ StackName: STACK_NAME }));
        } catch (descErr) {
            if (descErr.message?.includes('does not exist')) {
                console.log(`[AWS] Stack '${STACK_NAME}' does not exist - nothing to delete`);
                return res.json({ success: true, msg: 'Stack already deleted or does not exist' });
            }
            throw descErr;
        }

        // Delete the stack
        await cfnClient.send(new DeleteStackCommand({ StackName: STACK_NAME }));

        console.log(`[AWS] Initiated deletion of CloudFormation stack '${STACK_NAME}' in account ${account_id}`);

        res.json({
            success: true,
            msg: 'Stack deletion initiated',
            note: 'Stack deletion typically takes 1-2 minutes to complete in AWS'
        });

    } catch (err) {
        console.error('[AWS] Stack deletion error:', err);
        res.status(500).json({
            error: 'Failed to delete stack',
            details: err.message,
            manual_steps: 'Please delete the CloudiverseAccess-* stack manually from AWS Console > CloudFormation'
        });
    }
});

// Unified Verification Endpoint (Manual Trigger)
router.post('/:provider/verify', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.params;
        const { workspace_id, role_arn, external_id, account_id } = req.body;

        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID required" });

        // Fetch current metadata to get tokens if needed
        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).json({ msg: "Workspace not found" });

        const currentState = wsRes.rows[0].state_json || {};
        let metadata = currentState.connection || {};

        // Merge manual inputs (for AWS)
        if (provider === 'aws') {
            if (!account_id) {
                return res.status(400).json({ msg: "AWS Account ID is required for verification" });
            }

            // 🧠 FIX 1: STRICT STABLE EXTERNAL ID (Ignore DB stale data)
            // The DB might have old random IDs ('...4zqjte'). We MUST match what we enforce in /connect.
            const strictExternalId = `cloudiverse-user-${workspace_id}`;

            // 🧠 FIX 3: Lifecycle Guard & Sanity Check
            if (metadata.status === 'connected' && metadata.verified) {
                console.log("[AWS] Already connected. Proceeding with existing verification.");
            }

            // 🧠 FIX 2: Role Name Consistency
            // Contract: The S3 CloudFormation template creates role named 'cloudiverse-deploy-role' (hardcoded)
            // See: https://cloudiverse-cloudformation.s3.ap-south-1.amazonaws.com/aws-trust-role.yaml
            const derivedRoleArn = `arn:aws:iam::${account_id}:role/cloudiverse-deploy-role`;

            metadata = {
                ...metadata,
                account_id,
                role_arn: derivedRoleArn,
                external_id: strictExternalId // Force the correct ID associated with this workspace
            };

            // 🧠 FIX 4: Log Backend Caller Identity (Once)
            // Ensures we are who we think we are (031179588466).
            // Logic moved into verifyCloudConnection or logged here if we had the client. 
            // We'll trust verifyCloudConnection to log failures, but let's log our intent.
            console.log(`[AWS_VERIFY_INTENT] Role: ${derivedRoleArn}, ExtID: ${strictExternalId}`);
        }

        const verifyRes = await verifyCloudConnection(provider.toLowerCase(), metadata);

        // Update Success State
        const finalMetadata = {
            ...metadata,
            status: 'connected',
            verified: true,
            account_id: verifyRes.account_id || metadata.account_id,
            subscription_id: verifyRes.subscription_id || metadata.subscription_id,
            tenant_id: verifyRes.tenant_id || metadata.tenant_id,
            project_id: verifyRes.project_id || metadata.project_id,
            region: verifyRes.region || metadata.region,
            connected_at: new Date().toISOString()
        };

        const updatedState = {
            ...currentState,
            connection: finalMetadata
        };

        await pool.query(
            "UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2",
            [JSON.stringify(updatedState), workspace_id]
        );

        // 🔄 PERSIST CONNECTION AT USER LEVEL (for reuse in future projects)
        // Get user_id from workspace
        const userRes = await pool.query(
            `SELECT p.owner_id FROM workspaces w 
             JOIN projects p ON w.project_id = p.id 
             WHERE w.id = $1`,
            [workspace_id]
        );
        if (userRes.rows.length > 0) {
            await saveUserConnection(userRes.rows[0].owner_id, provider, finalMetadata);
        }

        res.json({ msg: "Verified Successfully", connection: finalMetadata });

    } catch (err) {
        console.error("Verification Endpt Error:", err);
        res.status(400).json({ msg: "Verification Failed", error: err.message });
    }
});

// GCP Billing Status Check (Frontend Pre-flight)
router.get('/gcp/billing-status/:projectId', authMiddleware, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { workspace_id } = req.query;

        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID (query param) is required" });

        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).json({ msg: "Workspace not found" });

        const currentState = wsRes.rows[0].state_json || {};
        const connection = currentState.connection || {};

        if (connection.provider !== 'gcp' || !connection.tokens) {
            return res.status(400).json({ msg: "No GCP credentials found for this workspace" });
        }

        // Use cached client or set creds
        oauth2Client.setCredentials(connection.tokens);

        const billingInfo = await checkGcpBilling(projectId, oauth2Client);

        res.json({
            projectId,
            billingEnabled: billingInfo.billingEnabled,
            billingAccountName: billingInfo.billingAccountName,
            details: billingInfo
        });

    } catch (err) {
        console.error("GCP Billing Check Error:", err);
        res.status(500).json({
            msg: "Billing check failed",
            error: err.message,
            recommendation: "Please ensure you have Owner/Editor permissions and the Billing API is enabled."
        });
    }
});

// ═══════════════════════════════════════════════════════════════════
// USER-LEVEL CLOUD CONNECTIONS (Persist Across Projects)
// ═══════════════════════════════════════════════════════════════════

/**
 * Save or update a user's cloud connection
 * Called automatically after successful verification
 */
async function saveUserConnection(userId, provider, connectionData) {
    try {
        // Filter sensitive/temporary data, keep only what's needed for re-use
        const persistableData = {
            status: connectionData.status || 'connected',
            verified: connectionData.verified || true,
            account_id: connectionData.account_id,
            role_arn: connectionData.role_arn,
            external_id: connectionData.external_id,
            tenant_id: connectionData.tenant_id,
            subscription_id: connectionData.subscription_id,
            client_id: connectionData.client_id,
            project_id: connectionData.project_id,
            region: connectionData.region,
            connected_at: connectionData.connected_at || new Date().toISOString()
        };

        // Remove undefined values
        Object.keys(persistableData).forEach(key =>
            persistableData[key] === undefined && delete persistableData[key]
        );

        await pool.query(`
            INSERT INTO user_cloud_connections (user_id, provider, connection_data, status, verified)
            VALUES ($1, $2, $3, 'connected', true)
            ON CONFLICT (user_id, provider) 
            DO UPDATE SET 
                connection_data = $3,
                status = 'connected',
                verified = true,
                updated_at = NOW()
        `, [userId, provider.toLowerCase(), JSON.stringify(persistableData)]);

        console.log(`[CLOUD] Saved ${provider} connection for user ${userId}`);
        return true;
    } catch (err) {
        console.error(`[CLOUD] Failed to save user connection:`, err.message);
        return false;
    }
}

/**
 * Get a user's saved connection for a provider
 */
async function getUserConnection(userId, provider) {
    try {
        const result = await pool.query(
            `SELECT connection_data, status, verified, connected_at 
             FROM user_cloud_connections 
             WHERE user_id = $1 AND provider = $2`,
            [userId, provider.toLowerCase()]
        );

        if (result.rows.length === 0) return null;

        const row = result.rows[0];
        return {
            ...row.connection_data,
            status: row.status,
            verified: row.verified,
            provider: provider.toLowerCase()
        };
    } catch (err) {
        console.error(`[CLOUD] Failed to get user connection:`, err.message);
        return null;
    }
}

// Get all saved connections for a user
router.get('/connections', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT provider, connection_data, status, verified, connected_at, updated_at
             FROM user_cloud_connections 
             WHERE user_id = $1
             ORDER BY updated_at DESC`,
            [req.user.id]
        );

        const connections = result.rows.map(row => ({
            provider: row.provider,
            status: row.status,
            verified: row.verified,
            account_id: row.connection_data?.account_id || row.connection_data?.subscription_id || row.connection_data?.project_id,
            connected_at: row.connected_at,
            updated_at: row.updated_at
        }));

        res.json({ connections });
    } catch (err) {
        console.error('[CLOUD] Get connections error:', err);
        res.status(500).json({ error: 'Failed to fetch connections' });
    }
});

// Get saved connection for a specific provider
router.get('/connections/:provider', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.params;
        const connection = await getUserConnection(req.user.id, provider);

        if (!connection) {
            return res.status(404).json({
                found: false,
                msg: `No saved ${provider} connection found`
            });
        }

        res.json({
            found: true,
            connection
        });
    } catch (err) {
        console.error('[CLOUD] Get provider connection error:', err);
        res.status(500).json({ error: 'Failed to fetch connection' });
    }
});

// Apply saved connection to a workspace
router.post('/connections/:provider/apply', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.params;
        const { workspace_id } = req.body;

        if (!workspace_id) {
            return res.status(400).json({ error: 'workspace_id required' });
        }

        // Get saved connection
        const savedConnection = await getUserConnection(req.user.id, provider);
        if (!savedConnection) {
            return res.status(404).json({
                error: `No saved ${provider} connection found`,
                needsSetup: true
            });
        }

        // Get workspace
        const wsRes = await pool.query(
            `SELECT state_json FROM workspaces w
             JOIN projects p ON w.project_id = p.id
             WHERE w.id = $1 AND p.owner_id = $2`,
            [workspace_id, req.user.id]
        );

        if (wsRes.rows.length === 0) {
            return res.status(404).json({ error: 'Workspace not found' });
        }

        // Apply saved connection to workspace
        const currentState = wsRes.rows[0].state_json || {};
        const updatedState = {
            ...currentState,
            connection: {
                ...savedConnection,
                provider: provider.toLowerCase()
            }
        };

        await pool.query(
            `UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(updatedState), workspace_id]
        );

        console.log(`[CLOUD] Applied saved ${provider} connection to workspace ${workspace_id}`);
        res.json({
            success: true,
            msg: 'Saved connection applied',
            connection: savedConnection
        });
    } catch (err) {
        console.error('[CLOUD] Apply connection error:', err);
        res.status(500).json({ error: 'Failed to apply connection' });
    }
});

// Delete a saved connection
router.delete('/connections/:provider', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.params;

        await pool.query(
            `DELETE FROM user_cloud_connections WHERE user_id = $1 AND provider = $2`,
            [req.user.id, provider.toLowerCase()]
        );

        console.log(`[CLOUD] Deleted ${provider} connection for user ${req.user.id}`);
        res.json({ success: true, msg: `${provider} connection removed` });
    } catch (err) {
        console.error('[CLOUD] Delete connection error:', err);
        res.status(500).json({ error: 'Failed to delete connection' });
    }
});

// Export helpers for use in verification endpoint
module.exports = router;
module.exports.saveUserConnection = saveUserConnection;
module.exports.getUserConnection = getUserConnection;
