const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');
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

// 🛡️ Helper: Create Service Principal for Terraform (Graph API)
async function createServicePrincipal(accessToken, appName) {
    try {
        console.log(`[AZURE_SP] Starting SP creation for: ${appName}`);
        const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

        // 1. Create AD Application
        const appRes = await axios.post('https://graph.microsoft.com/v1.0/applications', {
            displayName: appName,
            signInAudience: "AzureADMyOrg"
        }, { headers });
        const appId = appRes.data.appId;
        const objectId = appRes.data.id;
        console.log(`[AZURE_SP] App Created: ${appId}`);

        // 2. Create Service Principal
        // Wait a bit for propagation? usually fast enough
        const spRes = await axios.post('https://graph.microsoft.com/v1.0/servicePrincipals', {
            appId: appId
        }, { headers });
        const spId = spRes.data.id;
        console.log(`[AZURE_SP] Service Principal Created: ${spId}`);

        // 3. Create Client Secret
        const secretRes = await axios.post(`https://graph.microsoft.com/v1.0/applications/${objectId}/addPassword`, {
            passwordCredential: {
                displayName: "TerraformAuth"
            }
        }, { headers });
        const clientSecret = secretRes.data.secretText;
        console.log(`[AZURE_SP] Client Secret Generated`);

        return { appId, spId, clientSecret };

    } catch (err) {
        console.error(`[AZURE_SP_ERROR] Failed to create SP: ${err.response?.data?.error?.message || err.message}`);
        return null; // Fail gracefully, fall back to user token (conceptually, though we want to enforce SP)
    }
}

// 🛡️ Helper: Assign Role to SP (ARM API)
async function assignContributorRole(accessToken, subscriptionId, spId) {
    try {
        console.log(`[AZURE_RBAC] Assigning Contributor role to SP: ${spId}`);
        const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

        // Contributor Role Definition ID (Fixed UUID for built-in role)
        const roleDefinitionId = `/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleDefinitions/b24988ac-6180-42a0-ab88-20f7382dd24c`;
        const roleAssignmentName = crypto.randomUUID();

        await axios.put(`https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments/${roleAssignmentName}?api-version=2020-04-01-preview`, {
            properties: {
                roleDefinitionId: roleDefinitionId,
                principalId: spId,
                principalType: 'ServicePrincipal'
            }
        }, { headers });

        console.log(`[AZURE_RBAC] Role Assigned Successfully`);
        return true;
    } catch (err) {
        console.error(`[AZURE_RBAC_ERROR] Failed to assign role: ${err.response?.data?.error?.message || err.message}`);
        // Often fails if user is not Owner/User Access Admin. We should warn but proceed (SP exists at least).
        return false;
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

            // 🧠 FIX: Use credential_pairs to try each (role, externalId) combo independently
            const credentialPairs = metadata.credential_pairs || [
                { role_arn: metadata.role_arn, external_id: metadata.external_id, source: 'default' },
                ...(metadata.role_arn_fallback ? [{ role_arn: metadata.role_arn_fallback, external_id: metadata.external_id, source: 'fallback' }] : [])
            ];

            // Also build a deduped flat list for discovery fallback
            const accountIdFromArn = metadata.role_arn.split(':')[4];
            const externalIdsToTry = [...new Set(credentialPairs.map(p => p.external_id))];

            let assumed = null;
            let lastErr = null;
            let successfulRoleArn = null;

            // Phase 1: Try each credential pair with its CORRECT ExternalId
            for (const pair of credentialPairs) {
                try {
                    console.log(`[AWS_VERIFY] Trying ${pair.source}: ${pair.role_arn} (ExtID: ${pair.external_id})`);
                    const assumeCmd = new AssumeRoleCommand({
                        RoleArn: pair.role_arn,
                        RoleSessionName: "CloudiverseVerificationSession",
                        ExternalId: pair.external_id
                    });
                    assumed = await client.send(assumeCmd);
                    successfulRoleArn = pair.role_arn;
                    metadata.external_id = pair.external_id; // Update metadata with the working ExternalId
                    console.log(`[AWS_VERIFY] ✅ Success: ${pair.role_arn} (${pair.source})`);
                    break;
                } catch (stsErr) {
                    console.warn(`[AWS_VERIFY] Failed for ${pair.role_arn}: ${stsErr.message}`);
                    lastErr = stsErr;
                    continue;
                }
            }

            // Phase 2: Role Discovery (Last Resort) — try each ExternalId with discovered roles
            if (!assumed) {
                try {
                    console.log(`[AWS_VERIFY] All pairs failed. Attempting role discovery...`);
                    const { IAMClient, ListRolesCommand } = require("@aws-sdk/client-iam");
                    const iam = new IAMClient(clientConfig);
                    const roles = await iam.send(new ListRolesCommand({ MaxItems: 100 }));
                    const candidates = roles.Roles.filter(r =>
                        r.RoleName.toLowerCase().startsWith('cloudiverse')
                    ).map(r => r.Arn);

                    const triedArns = new Set(credentialPairs.map(p => p.role_arn));

                    for (const candidateArn of candidates) {
                        if (triedArns.has(candidateArn)) continue;
                        // Try each discovered role with ALL known ExternalIds
                        for (const extId of externalIdsToTry) {
                            try {
                                console.log(`[AWS_VERIFY] Discovered: ${candidateArn}. Testing with ExtID: ${extId}...`);
                                const assumeCmd = new AssumeRoleCommand({
                                    RoleArn: candidateArn,
                                    RoleSessionName: "CloudiverseVerificationSession",
                                    ExternalId: extId
                                });
                                assumed = await client.send(assumeCmd);
                                successfulRoleArn = candidateArn;
                                metadata.external_id = extId;
                                console.log(`[AWS_VERIFY] ✅ Discovered and verified: ${candidateArn} with ExtID: ${extId}`);
                                break;
                            } catch (e) { /* continue */ }
                        }
                        if (assumed) break;
                    }
                } catch (discoveryErr) {
                    console.warn("[AWS_VERIFY] Role discovery failed:", discoveryErr.message);
                }
            }

            if (!assumed) {
                const stsErr = lastErr;
                let identityArn = "unknown";
                try {
                    const idRes = await client.send(new GetCallerIdentityCommand({}));
                    identityArn = idRes.Arn;
                } catch (e) { /* ignore */ }

                const failedRole = lastErr?.message?.includes('arn:aws:iam') ? 'the targeted roles' : metadata.role_arn;

                if (stsErr.Code === 'AccessDenied' || (stsErr.message && stsErr.message.includes('not authorized to perform: sts:AssumeRole'))) {
                    const errorMsg = `Authorization Failed: Backend (${identityArn}) cannot assume role '${failedRole}'.\n\n` +
                        `1. IDENTITY POLICY: Ensure User '${identityArn}' has permission 'sts:AssumeRole' on '${failedRole}'.\n` +
                        `2. TRUST POLICY: Ensure the Role '${failedRole}' trusts '${identityArn}' and matches ExternalId '${metadata.external_id}'.`;
                    throw new Error(errorMsg);
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

            // 4. Capability Detection (CloudFront)
            // Some checks to ensure the account is ready for our stack
            const capabilities = {
                cloudfront: false
            };

            try {
                // We need a separate client for CloudFront (Global Service, us-east-1)
                const { CloudFrontClient, ListDistributionsCommand } = require("@aws-sdk/client-cloudfront");

                // Use the same credentials as identity verification
                const cfClient = new CloudFrontClient({
                    region: "us-east-1", // CloudFront is global, typically accessed via us-east-1
                    credentials: {
                        accessKeyId: assumed.Credentials.AccessKeyId,
                        secretAccessKey: assumed.Credentials.SecretAccessKey,
                        sessionToken: assumed.Credentials.SessionToken
                    }
                });

                console.log("[AWS_CAPABILITY] Checking CloudFront access...");
                await cfClient.send(new ListDistributionsCommand({ MaxItems: 1 }));
                console.log("[AWS_CAPABILITY] CloudFront access CONFIRMED.");
                capabilities.cloudfront = true;
            } catch (cfErr) {
                console.warn(`[AWS_CAPABILITY_WARNING] CloudFront access denied or failed: ${cfErr.message}`);
                // capabilities.cloudfront remains false
            }

            return {
                verified: true,
                account_id: identity.Account,
                role_arn: successfulRoleArn, // 🧠 FIX: Return the ARN that actually worked (Fallback support)
                region: 'ap-south-1', // Default target
                capabilities
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

        // 🧠 CLARITY: Who is the backend?
        // If we trust the root account, the calling identity must have its own sts:AssumeRole permission.
        // If we trust the identity ARNs specifically, it works even without explicit user policies.
        let backendIdentityArn = null;
        try {
            const sts = new STSClient({ region: "ap-south-1" });
            const caller = await sts.send(new GetCallerIdentityCommand({}));
            backendIdentityArn = caller.Arn;
            console.log(`[AWS_TEMPLATE] Detected Backend Identity: ${backendIdentityArn}`);
        } catch (stsErr) {
            console.warn("[AWS_TEMPLATE] Could not detect backend identity, falling back to account root", stsErr.message);
        }

        // 🧠 FIX: Use stable ExternalId (cloudiverse-user-{workspace_id})
        // This matches the strict check in /aws/verify
        const externalId = `cloudiverse-user-${workspace_id}`;
        const accountId = process.env.AWS_ACCOUNT_ID || "123456789012";

        // Construct Principal list
        const principals = [accountId];
        if (backendIdentityArn && !principals.includes(backendIdentityArn)) {
            principals.push(backendIdentityArn);
        }

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
    Description: 'The Cloudiverse AWS Account ID (Root)'
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
              AWS:
                - !Ref CloudiverseAccountId
                ${backendIdentityArn ? `- '${backendIdentityArn}'` : ''}
            Action: 'sts:AssumeRole'
            Condition:
              StringEquals:
                'sts:ExternalId': !Ref ExternalId
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/AmazonS3FullAccess'
        - 'arn:aws:iam::aws:policy/CloudFrontFullAccess'
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

// AWS Template Download Route (Used for manual upload to CloudFormation)
router.get('/aws/template/download/:workspace_id', async (req, res) => {
    try {
        const { workspace_id } = req.params;

        // 1. Get Backend Identity
        let backendIdentityArn = null;
        try {
            const sts = new STSClient({ region: "ap-south-1" });
            const caller = await sts.send(new GetCallerIdentityCommand({}));
            backendIdentityArn = caller.Arn;
        } catch (stsErr) {
            console.warn("[AWS_DOWNLOAD] Could not detect backend identity", stsErr.message);
        }

        const externalId = `cloudiverse-user-${workspace_id}`;
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
    Description: 'The Cloudiverse AWS Account ID (Root)'
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
              AWS:
                - !Ref CloudiverseAccountId
                ${backendIdentityArn ? `- '${backendIdentityArn}'` : ''}
            Action: 'sts:AssumeRole'
            Condition:
              StringEquals:
                'sts:ExternalId': !Ref ExternalId
      ManagedPolicyArns:
        - 'arn:aws:iam::aws:policy/AmazonS3FullAccess'
        - 'arn:aws:iam::aws:policy/CloudFrontFullAccess'
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

        res.setHeader('Content-Type', 'text/yaml');
        res.setHeader('Content-Disposition', `attachment; filename=cloudiverse-aws-setup-${workspace_id}.yaml`);
        res.send(yamlContent);

    } catch (err) {
        console.error("Download Error:", err);
        res.status(500).send("Failed to generate download");
    }
});

router.get('/connections/:provider', authMiddleware, async (req, res) => {
    try {
        const provider = req.params.provider.toLowerCase();
        const { workspace_id } = req.query;

        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID required" });

        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).json({ msg: "Workspace not found" });

        const state = wsRes.rows[0].state_json || {};
        const connection = state.connection || {};

        // Check if connected to requested provider
        if (connection.provider === provider && connection.status === 'connected') {
            // Return public info only
            return res.json({
                connected: true,
                account_id: connection.account_id,
                subscription_id: connection.subscription_id,
                tenant_id: connection.tenant_id,
                region: connection.region,
                provider: provider
            });
        }

        // AUTO-CONNECT: Check User Profile
        const userCreds = await User.getCloudCredentials(req.user.id);
        if (userCreds[provider]) {
            console.log(`[CLOUD] Auto-connecting workspace ${workspace_id} to ${provider} using saved user credentials`);
            const savedConnection = userCreds[provider];

            // Merge into workspace state
            const updatedState = {
                ...state,
                connection: {
                    ...savedConnection,
                    status: 'connected',
                    connected_at: new Date().toISOString()
                }
            };

            await pool.query(
                "UPDATE workspaces SET state_json = $1 WHERE id = $2",
                [JSON.stringify(updatedState), workspace_id]
            );

            return res.json({
                connected: true,
                account_id: savedConnection.account_id,
                subscription_id: savedConnection.subscription_id,
                tenant_id: savedConnection.tenant_id,
                region: savedConnection.region,
                provider: provider
            });
        }

        res.json({ connected: false });

    } catch (err) {
        console.error("Get Connection Status Error:", err);
        res.status(500).json({ msg: "Server Error" });
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

            // 🚀 CLOUDFORMATION SETUP
            // Since we are running on localhost, AWS cannot fetch the template automatically. 
            // We provide a direct download URL for the dynamic template.
            const downloadUrl = `${process.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/cloud/aws/template/download/${workspace_id}`;
            const accountId = process.env.AWS_ACCOUNT_ID;

            if (!accountId) throw new Error("AWS_ACCOUNT_ID is not configured in backend .env");

            const uniqueStackName = `CloudiverseAccess-${safeWorkspaceId.substring(0, 8)}`;

            // 🚀 CLOUDFORMATION DEEP LINK (AUTOMATIC)
            const templateUri = "https://cloudiverse-cloudformation.s3.ap-south-1.amazonaws.com/aws-trust-role.yaml";

            const roleName = `CloudiverseAccessRole-${externalId}`;

            // We pass all parameters, including proposed RoleName. 
            // The current S3 template will ignore RoleName, but future ones will use it.
            authUrl = `https://console.aws.amazon.com/cloudformation/home?region=ap-south-1#/stacks/create/review?templateURL=${encodeURIComponent(templateUri)}&stackName=${uniqueStackName}&param_ExternalId=${externalId}&param_CloudiverseAccountId=${accountId}&param_RoleName=${roleName}`;

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
            const { tenant_id } = req.body;
            const authority = tenant_id
                ? `https://login.microsoftonline.com/${tenant_id}`
                : "https://login.microsoftonline.com/common";

            const authCodeUrlParameters = {
                scopes: [
                    "https://management.azure.com/user_impersonation",
                    "User.Read",
                    "offline_access",
                    "openid",
                    "profile"
                ],
                redirectUri: process.env.AZURE_REDIRECT_URI,
                state: tenant_id ? `${workspace_id}:${tenant_id}` : workspace_id,
                prompt: 'select_account',
                authority: authority
            };
            authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
            console.log(`[AZURE] Generated Auth URL for Authority: ${authority}`);
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
        const { code, state: rawState, error } = req.query;

        if (error) return res.status(400).send(`Authorization failed: ${error}`);
        if (!rawState || !code) return res.status(400).send("Missing workspace context or code");

        // Universal parsing of workspace_id and optional tenant_id from state
        let workspace_id = rawState;
        let tenant_id = null;
        if (typeof rawState === 'string' && rawState.includes(':')) {
            const parts = rawState.split(':');
            workspace_id = parts[0];
            tenant_id = parts[1];
        }

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
            const { encrypt } = require('../services/shared/encryptionService');

            if (req.query.admin_consent === 'True' || req.query.admin_consent === 'true') {
                console.log("[AZURE_AUTO] Admin Consent Granted. Re-initiating login...");
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

            // A. Acquire Tokens (Single Step)
            const criticalScopes = [
                "openid",
                "profile",
                "email",
                "offline_access",
                "https://management.azure.com/user_impersonation"
            ];

            let authority = "https://login.microsoftonline.com/common";
            if (tenant_id) {
                authority = `https://login.microsoftonline.com/${tenant_id}`;
                console.log(`[AZURE] Callback using Tenanted Authority: ${authority}`);
            }

            const tokenRequest = {
                code: code,
                scopes: criticalScopes,
                redirectUri: process.env.AZURE_REDIRECT_URI,
                authority: authority
            };

            const response = await cca.acquireTokenByCode(tokenRequest);
            const tenantId = response.tenantId;
            const account = response.account;

            console.log(`[AZURE] Auth Success. Tenant: ${tenantId}, Account: ${account.username}`);

            // 🔒 SECURITY: Encrypt refresh token
            const encryptedRefreshToken = encrypt(response.refreshToken);

            // B. FORCE ADMIN CONSENT (Logic remains same for Work accounts)
            const isConsumerAccount = tenantId === '9188040d-6c67-4c5b-b112-36a304b66dad';
            if (rawState === 'init' && !isConsumerAccount) {
                const adminConsentUrl = `https://login.microsoftonline.com/${tenantId}/adminconsent?client_id=${process.env.AZURE_CLIENT_ID}&redirect_uri=${process.env.AZURE_REDIRECT_URI}&state=consenting`;
                return res.redirect(adminConsentUrl);
            }

            // C. Validate Subscription (Pre-flight)
            const armToken = response.accessToken;

            const subRes = await axios.get('https://management.azure.com/subscriptions?api-version=2020-01-01', {
                headers: { Authorization: `Bearer ${armToken}` }
            });

            if (!subRes.data.value || subRes.data.value.length === 0) {
                console.warn("[AZURE_ERROR] No subscriptions found.");
                // We return a special error state so frontend can show "Billing Required" UI
                return res.status(400).send(`
                    <h1>Subscription Required</h1>
                    <p>Your Azure account does not have an active subscription.</p>
                    <p>Please log in to the <a href="https://portal.azure.com" target="_blank">Azure Portal</a> and sign up for "Pay-As-You-Go" or "Free Trial".</p>
                `);
            }

            // Auto-select first subscription
            const subscriptionId = subRes.data.value[0].subscriptionId;
            const targetTenantId = subRes.data.value[0].tenantId;

            console.log(`[AZURE_AUTO] Valid Subscription Found: ${subscriptionId}`);

            // D. Create Service Principal (Only for Work Accounts)
            let credentials = {};
            if (!isConsumerAccount) {
                console.log(`[AZURE_AUTO] Work Account Detected - Attempting to create Service Principal...`);

                // Check if we already created one (optimization for re-connects could go here, but strict creation is safer for now)
                const spData = await createServicePrincipal(armToken, "Cloudiverse Terraform");

                if (spData) {
                    // Assign Role
                    const roleAssigned = await assignContributorRole(armToken, subscriptionId, spData.spId);

                    if (roleAssigned) {
                        credentials = {
                            client_id: spData.appId,
                            client_secret: spData.clientSecret,
                            tenant_id: targetTenantId,
                            subscription_id: subscriptionId
                        };
                        console.log(`[AZURE_AUTO] ✅ Service Principal Configured Successfully`);
                    } else {
                        console.warn(`[AZURE_AUTO] ⚠️ SP Created but Role Assignment failed (Permissions?). User may need to assign manually.`);
                        // We still save the SP credentials, as they are valid identities
                        credentials = {
                            client_id: spData.appId,
                            client_secret: spData.clientSecret,
                            tenant_id: targetTenantId,
                            subscription_id: subscriptionId
                        };
                    }
                }
            } else {
                console.log(`[AZURE_AUTO] Consumer Account (Personal) - Skipping SP Creation (Not supported via Graph API easily)`);
            }

            connectionMetadata = {
                ...connectionMetadata,
                account_id: account.username,
                tenant_id: targetTenantId,
                subscription_id: subscriptionId,
                region: 'centralindia',
                principalObjectId: response.idTokenClaims?.oid,
                // Store encrypted refresh token
                tokens: {
                    refreshToken: encryptedRefreshToken, // 🔒 Encrypted
                    accessToken: response.accessToken // REQUIRED: For immediate Terraform execution
                },
                credentials: credentials, // 🛡️ Persist SP Credentials
                verified: true,
                status: 'connected'
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
        const wsRes = await pool.query("SELECT user_id, state_json FROM workspaces WHERE id = $1", [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).send("Workspace not found");

        const workspaceOwnerId = wsRes.rows[0].user_id;
        const currentState = wsRes.rows[0].state_json || {};

        // SAVE TO USER PROFILE (Persistent Connection)
        if (workspaceOwnerId && connectionMetadata.status === 'connected') {
            try {
                await User.updateCloudCredentials(workspaceOwnerId, provider, connectionMetadata);
                console.log(`[CLOUD] Saved ${provider} credentials to user profile ${workspaceOwnerId}`);
            } catch (saveErr) {
                console.error(`[CLOUD] Failed to save credentials to user profile`, saveErr);
            }
        }

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

        // 🧠 FIX: Role Name Consistency (Must match template)
        const workspaceIdFromExtId = external_id.replace('cloudiverse-user-', '');
        const STACK_NAME = `CloudiverseAccess-${workspaceIdFromExtId.substring(0, 8)}`;
        const roleArn = `arn:aws:iam::${account_id}:role/CloudiverseAccessRole-${external_id}`;
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
            let identityArn = "unknown";
            try {
                const idRes = await stsClient.send(new GetCallerIdentityCommand({}));
                identityArn = idRes.Arn;
            } catch (e) { /* ignore */ }

            console.error('[AWS] Failed to assume role for stack deletion:', assumeErr.message);
            return res.status(400).json({
                error: `Backend (${identityArn}) is NOT authorized to assume role '${roleArn}'.`,
                details: assumeErr.message,
                manual_steps: [
                    `1. Identity Policy: Grant User '${identityArn}' permission 'sts:AssumeRole' on '${roleArn}'.`,
                    `2. Trust Policy: Add '${identityArn}' to the Trust Relationship of Role '${roleArn}'.`,
                    `3. Manual: Delete stack '${STACK_NAME}' in AWS Console.`
                ].join('\n')
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

            // 🧠 FIX: Build a priority-ordered list of credential pairs to try
            // Instead of blindly overriding with saved credentials, try BOTH saved AND workspace-specific
            const workspaceExternalId = `cloudiverse-user-${workspace_id}`;
            const workspaceRoleArn = `arn:aws:iam::${account_id}:role/CloudiverseAccessRole-${workspaceExternalId}`;
            const s3RoleArn = `arn:aws:iam::${account_id}:role/cloudiverse-deploy-role`;

            // Start with workspace-specific credentials (these are what the user just created)
            const credentialPairs = [
                { role_arn: workspaceRoleArn, external_id: workspaceExternalId, source: 'workspace' },
                { role_arn: s3RoleArn, external_id: workspaceExternalId, source: 's3_template' }
            ];

            // Check for saved connection and add those credentials to the list
            try {
                if (req.user && req.user.id) {
                    const savedConn = await getUserConnection(req.user.id, 'aws');
                    if (savedConn && savedConn.external_id && savedConn.role_arn) {
                        const savedAccountId = savedConn.account_id;
                        if (!account_id || account_id === savedAccountId) {
                            console.log(`[AWS] Found saved connection for Account ${savedAccountId}. Adding to credential candidates.`);
                            // Add saved credentials as ADDITIONAL candidates, not as overrides
                            credentialPairs.unshift({
                                role_arn: savedConn.role_arn,
                                external_id: savedConn.external_id,
                                source: 'saved_connection'
                            });
                        }
                    }
                }
            } catch (reuseErr) {
                console.warn("[AWS] Failed to check for saved connection", reuseErr);
            }

            // Deduplicate by role_arn+external_id combo
            const seen = new Set();
            const uniquePairs = credentialPairs.filter(pair => {
                const key = `${pair.role_arn}|${pair.external_id}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });

            // Pass ALL candidate pairs to verifyCloudConnection
            metadata = {
                ...metadata,
                account_id,
                role_arn: uniquePairs[0].role_arn,
                external_id: uniquePairs[0].external_id,
                credential_pairs: uniquePairs, // 🧠 All candidates for the verify function
                workspace_external_id: workspaceExternalId // For discovery fallback
            };

            console.log(`[AWS_VERIFY_INTENT] ${uniquePairs.length} credential pairs to try:`,
                uniquePairs.map(p => `${p.source}: ${p.role_arn} (ExtID: ${p.external_id})`));
        }

        const verifyRes = await verifyCloudConnection(provider.toLowerCase(), metadata);

        // Update Success State
        const finalMetadata = {
            ...metadata,
            status: 'connected',
            verified: true,
            account_id: verifyRes.account_id || metadata.account_id,
            role_arn: verifyRes.role_arn || metadata.role_arn, // 🧠 FIX: Persist the role that worked
            subscription_id: verifyRes.subscription_id || metadata.subscription_id,
            tenant_id: verifyRes.tenant_id || metadata.tenant_id,
            project_id: verifyRes.project_id || metadata.project_id,
            region: verifyRes.region || metadata.region,
            capabilities: verifyRes.capabilities, // 🧠 FIX: Persist Capabilities
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
