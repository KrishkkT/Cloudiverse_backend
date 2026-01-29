const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const { google } = require('googleapis');
const msal = require('@azure/msal-node');

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

/**
 * @route POST /api/cloud/:provider/connect
 * @desc Generate auth URL for the selected provider (MOCKED)
 * @access Private
 */
/**
 * @route POST /api/cloud/aws/template
 * @desc Generate CloudFormation Template Content (Manual Flow)
 */
router.post('/aws/template', authMiddleware, async (req, res) => {
    try {
        const { workspace_id } = req.body;
        if (!workspace_id) return res.status(400).json({ msg: "Workspace ID is required" });

        const externalId = `cloudiverse-${workspace_id}-${Math.random().toString(36).substring(7)}`;
        const accountId = process.env.AWS_ACCOUNT_ID || "123456789012"; // Fallback for dev

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
        const { provider } = req.params;
        const { workspace_id } = req.body;

        if (!workspace_id) {
            return res.status(400).json({ msg: "Workspace ID is required" });
        }

        let authUrl = '';
        let extra = {};

        if (provider === 'aws') {
            // AWS IAM Role Flow
            // Generate a unique ExternalID for this workspace/project
            const externalId = `cloudiverse-${workspace_id}-${Math.random().toString(36).substring(7)}`;

            // Construct CloudFormation URL
            const templateUri = "https://cloudiverse-public.s3.amazonaws.com/templates/trust-role.yaml"; // Hypothetical
            const accountId = process.env.AWS_ACCOUNT_ID; // The Cloudiverse Account ID to trust

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
                state: workspace_id, // Pass workspace_id in state
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

        console.log(`[CLOUD_CALLBACK] Provider: ${provider}, Workspace: ${workspace_id}`);

        if (error) {
            console.error(`AUTH ERROR: ${error}`);
            return res.status(400).send(`Authorization failed: ${error}`);
        }

        if (!workspace_id || !code) {
            return res.status(400).send("Missing workspace context or authorization code");
        }

        let connectionMetadata = {
            provider: provider.toLowerCase(),
            status: 'connected',
            connected_at: new Date().toISOString(),
            verified: true
        };

        if (provider === 'gcp') {
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);

            // Get user info to identify the account
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();

            connectionMetadata = {
                ...connectionMetadata,
                account_email: userInfo.data.email,
                tokens: tokens, // Contains refresh_token
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
                tokens: response, // Contains access tokens
                region: 'centralindia'
            };
        }

        // UPDATE WORKSPACE STATE
        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);

        if (wsRes.rows.length === 0) {
            return res.status(404).send("Workspace not found");
        }

        const currentState = wsRes.rows[0].state_json || {};
        const updatedState = {
            ...currentState,
            step: 'deploy',
            deploymentMethod: 'oneclick',
            connection: connectionMetadata
        };

        await pool.query(
            "UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2",
            [JSON.stringify(updatedState), workspace_id]
        );

        // Return HTML that communicates with the opener
        const successHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Success</title>
                <style>
                    body { background: #0f172a; color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: sans-serif; }
                    .icon { font-size: 48px; color: #4ade80; margin-bottom: 20px; }
                    p { color: #94a3b8; }
                </style>
            </head>
            <body>
                <div class="icon">✓</div>
                <h1>Connection Successful</h1>
                <p>You can close this window now.</p>
                <script>
                    // Communicate to the main window
                    if (window.opener) {
                        window.opener.postMessage({ type: 'CLOUD_AUTH_SUCCESS', provider: '${provider}', workspaceId: '${workspace_id}' }, '*');
                    }
                    // Attempt to close self
                    setTimeout(() => {
                        window.close();
                    }, 1500);
                </script>
            </body>
            </html>
        `;

        res.send(successHtml);

    } catch (err) {
        console.error("Cloud Callback Error:", err);
        res.status(500).send("Connection Failed: " + err.message);
    }
});

/**
 * @route POST /api/cloud/aws/verify
 * @desc Verify AWS Role ARN (Real STS Check)
 */
router.post('/aws/verify', authMiddleware, async (req, res) => {
    try {
        const { workspace_id, role_arn, external_id } = req.body;

        if (!role_arn || !workspace_id) {
            return res.status(400).json({ msg: "Missing Role ARN or Workspace ID" });
        }

        // Verify with STS
        const client = new STSClient({ region: "us-east-1" });
        const command = new AssumeRoleCommand({
            RoleArn: role_arn,
            RoleSessionName: "CloudiverseVerificationSession",
            ExternalId: external_id
        });

        const stsRes = await client.send(command);
        console.log("[AWS_VERIFY] Successfully assumed role:", role_arn);

        // Update Workspace
        const wsRes = await pool.query("SELECT state_json FROM workspaces WHERE id = $1", [workspace_id]);
        const currentState = wsRes.rows[0].state_json || {};

        const connectionMetadata = {
            provider: 'aws',
            status: 'connected',
            connected_at: new Date().toISOString(),
            verified: true,
            role_arn: role_arn,
            external_id: external_id,
            account_id: stsRes.AssumedRoleUser.Arn.split(":")[4],
            region: 'ap-south-1'
        };

        const updatedState = {
            ...currentState,
            connection: connectionMetadata
        };

        await pool.query(
            "UPDATE workspaces SET state_json = $1, step = 'deploy', updated_at = NOW() WHERE id = $2",
            [JSON.stringify(updatedState), workspace_id]
        );

        res.json({ msg: "AWS Connection Verified", connection: connectionMetadata });

    } catch (err) {
        console.error("AWS Verification Error:", err);
        res.status(403).json({ msg: "AWS Verification Failed. Please ensure the IAM Role is created with the correct ExternalID and Trusts our Account.", error: err.message });
    }
});

module.exports = router;
