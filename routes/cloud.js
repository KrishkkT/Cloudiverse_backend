const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { STSClient, AssumeRoleCommand, GetCallerIdentityCommand } = require("@aws-sdk/client-sts");
const { google } = require('googleapis');
const msal = require('@azure/msal-node');
const axios = require('axios'); // For Azure REST API

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
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID || 'common'}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);

// Unified Verification Helper
const verifyCloudConnection = async (provider, metadata) => {
    try {
        if (provider === 'aws') {
            // AWS Verification (AssumeRole + GetCallerIdentity)
            const client = new STSClient({ region: "us-east-1" });

            // 1. Assume Role
            const assumeCmd = new AssumeRoleCommand({
                RoleArn: metadata.role_arn,
                RoleSessionName: "CloudiverseVerificationSession",
                ExternalId: metadata.external_id
            });
            const assumed = await client.send(assumeCmd);

            // 2. Verify Identity with Temp Creds
            const identityClient = new STSClient({
                region: "us-east-1",
                credentials: {
                    accessKeyId: assumed.Credentials.AccessKeyId,
                    secretAccessKey: assumed.Credentials.SecretAccessKey,
                    sessionToken: assumed.Credentials.SessionToken
                }
            });
            const identity = await identityClient.send(new GetCallerIdentityCommand({}));

            return {
                verified: true,
                account_id: identity.Account,
                region: 'ap-south-1' // Default target
            };
        }
        else if (provider === 'gcp') {
            // GCP Verification (Projects.get)
            oauth2Client.setCredentials(metadata.tokens);
            const crm = google.cloudresourcemanager('v1');

            // Verify access to list projects or get specific project if ID known
            // For now, we just list to ensure API access works
            const res = await crm.projects.list({ auth: oauth2Client, pageSize: 1 });

            return {
                verified: true,
                account_id: metadata.account_email,
                region: 'asia-south1'
            };
        }
        else if (provider === 'azure') {
            // Azure Verification (List Subscriptions)
            const token = metadata.tokens.accessToken;
            const res = await axios.get('https://management.azure.com/subscriptions?api-version=2020-01-01', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.data.value || res.data.value.length === 0) {
                throw new Error("No subscriptions found or accessible.");
            }

            return {
                verified: true,
                account_id: res.data.value[0].subscriptionId, // Use first sub ID as ref
                region: 'centralindia'
            };
        }
    } catch (err) {
        console.error(`[VERIFY_FAIL] ${provider}: ${err.message}`);
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
            const externalId = `cloudiverse-${workspace_id}-${Math.random().toString(36).substring(7)}`;
            const templateUri = "https://cloudiverse-cloudformation.s3.amazonaws.com/aws-trust-role.yaml";
            const accountId = process.env.AWS_ACCOUNT_ID;

            authUrl = `https://console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review?templateURL=${templateUri}&stackName=CloudiverseAccess&param_ExternalId=${externalId}&param_CloudiverseAccountId=${accountId}`;
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
                scopes: ["https://management.azure.com/user_impersonation"],
                redirectUri: process.env.AZURE_REDIRECT_URI,
                state: workspace_id
            };
            authUrl = await cca.getAuthCodeUrl(authCodeUrlParameters);
        }

        res.json({
            msg: "Auth URL generated",
            url: authUrl,
            extra,
            provider
        });

    } catch (err) {
        console.error("Cloud Connect Error:", err);
        res.status(500).send("Server Error");
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
        else if (provider === 'azure') {
            const tokenRequest = {
                code: code,
                scopes: ["https://management.azure.com/user_impersonation"],
                redirectUri: process.env.AZURE_REDIRECT_URI,
            };
            const response = await cca.acquireTokenByCode(tokenRequest);

            connectionMetadata = {
                ...connectionMetadata,
                account_id: response.account.username,
                tenant_id: response.tenantId,
                tokens: response,
                region: 'centralindia'
            };
        }

        // 2. Attempt Auto-Verification (Best Effort)
        try {
            const verifyRes = await verifyCloudConnection(provider.toLowerCase(), connectionMetadata);
            connectionMetadata.status = 'connected';
            connectionMetadata.verified = true;
            connectionMetadata.account_id = verifyRes.account_id || connectionMetadata.account_id;
        } catch (verifyErr) {
            console.warn(`Auto-verification failed for ${provider}, remaining in pending state:`, verifyErr.message);
            // Stays as 'pending', user must click verify manually
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
                    setTimeout(() => window.close(), 2000);
                </script>
                <button onclick="window.close()" style="margin-top: 20px; padding: 10px 20px; background: #334155; border: none; color: white; border-radius: 8px; cursor: pointer;">Close Window</button>
            </body>
            </html>
        `;
        res.send(successHtml);

    } catch (err) {
        console.error("Cloud Callback Error:", err);
        res.status(500).send("Connection Failed: " + err.message);
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
            metadata = { ...metadata, role_arn, external_id, account_id };
        }

        const verifyRes = await verifyCloudConnection(provider.toLowerCase(), metadata);

        // Update Success State
        const finalMetadata = {
            ...metadata,
            status: 'connected',
            verified: true,
            account_id: verifyRes.account_id || metadata.account_id,
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

        res.json({ msg: "Verified Successfully", connection: finalMetadata });

    } catch (err) {
        console.error("Verification Endpt Error:", err);
        res.status(400).json({ msg: "Verification Failed", error: err.message });
    }
});

module.exports = router;
