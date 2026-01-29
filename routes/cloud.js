const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

/**
 * @route POST /api/cloud/:provider/connect
 * @desc Generate auth URL for the selected provider (MOCKED)
 * @access Private
 */
router.post('/:provider/connect', authMiddleware, async (req, res) => {
    try {
        const { provider } = req.params;
        const { workspace_id, redirect_url } = req.body;

        if (!workspace_id) {
            return res.status(400).json({ msg: "Workspace ID is required" });
        }

        const validProviders = ['aws', 'gcp', 'azure'];
        if (!validProviders.includes(provider.toLowerCase())) {
            return res.status(400).json({ msg: "Invalid provider" });
        }

        // --- MOCK LOGIC START ---

        let mockAuthUrl = '';
        const callbackBase = `${process.env.VITE_API_BASE_URL || 'http://localhost:5000'}/api/cloud/${provider}/callback`;

        if (provider === 'aws') {
            // AWS use IAM Role Trust. 
            // In real world, we would generate an ExternalID here and return a CloudFormation Console URL.
            // Mock: Simulate immediate specific "success" redirect.
            // We pretend the user went to AWS, created the stack, and is now returning.
            mockAuthUrl = `${callbackBase}?workspace_id=${workspace_id}&mock_auth_code=aws_iam_success`;
        }
        else if (provider === 'gcp') {
            // GCP uses OAuth.
            // Mock: Simulate Google Consent Screen redirect.
            mockAuthUrl = `${callbackBase}?workspace_id=${workspace_id}&mock_auth_code=gcp_oauth_code`;
        }
        else if (provider === 'azure') {
            // Azure uses OAuth (AD).
            // Mock: Simulate Microsoft Login redirect.
            mockAuthUrl = `${callbackBase}?workspace_id=${workspace_id}&mock_auth_code=azure_oauth_code`;
        }

        // --- MOCK LOGIC END ---

        res.json({
            msg: "Auth URL generated",
            url: mockAuthUrl,
            provider
        });

    } catch (err) {
        console.error("Cloud Connect Error:", err);
        res.status(500).send("Server Error");
    }
});

/**
 * @route GET /api/cloud/:provider/callback
 * @desc Handle provider callback, verify (MOCK), and update workspace
 */
router.get('/:provider/callback', async (req, res) => {
    try {
        const { provider } = req.params;
        const { workspace_id, mock_auth_code } = req.query;

        console.log(`[CLOUD_CALLBACK] Provider: ${provider}, Workspace: ${workspace_id}`);

        if (!workspace_id) {
            return res.status(400).send("Missing workspace context");
        }

        // 1. VERIFY (Mock)
        if (!mock_auth_code) {
            return res.status(400).send("Authorization failed");
        }

        // 2. GENERATE CONNECTION METADATA (Provider Specific Mock)
        let connectionMetadata = {
            provider: provider.toLowerCase(),
            status: 'connected',
            connected_at: new Date().toISOString(),
            verified: true
        };

        if (provider === 'aws') {
            // Simulate AWS IAM Role Metadata
            connectionMetadata = {
                ...connectionMetadata,
                account_id: process.env.AWS_ACCOUNT_ID || '123456789012', // The Cloudiverse Account ID (Host)
                external_id: 'mock-ext-id-' + Math.random().toString(36).substring(7),
                // The Role ARN user created (Mocked)
                role_arn: `arn:aws:iam::${Math.floor(Math.random() * 100000000000)}:role/CloudiverseAccessRole`,
                region: 'ap-south-1' // India
            };
        }
        else if (provider === 'gcp') {
            // Simulate GCP OAuth Metadata
            connectionMetadata = {
                ...connectionMetadata,
                project_id: `mock-gcp-project-${Math.floor(Math.random() * 1000)}`,
                service_account_email: `cloudiverse-sa@mock-gcp-project.iam.gserviceaccount.com`,
                oauth_scopes: ['https://www.googleapis.com/auth/cloud-platform'],
                region: 'asia-south1' // India
            };
        }
        else if (provider === 'azure') {
            // Simulate Azure AD Metadata
            connectionMetadata = {
                ...connectionMetadata,
                tenant_id: process.env.AZURE_TENANT_ID || 'mock-tenant-id-guid',
                subscription_id: 'mock-subscription-id-guid',
                client_id: process.env.AZURE_CLIENT_ID || 'mock-client-id-guid',
                region: 'centralindia' // India
            };
        }

        // 3. UPDATE WORKSPACE STATE
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

        console.log(`[CLOUD_CONNECTED] Workspace ${workspace_id} linked to ${provider}`);

        // 4. REDIRECT BACK TO FRONTEND
        const frontendUrl = process.env.VITE_FRONTEND_URL || 'http://localhost:3000';

        // Ensure trailing slash consistency
        const redirectBase = frontendUrl.endsWith('/') ? frontendUrl : `${frontendUrl}/`;
        res.redirect(`${redirectBase}workspace/${workspace_id}?connection=success`);

    } catch (err) {
        console.error("Cloud Callback Error:", err);
        res.status(500).send("Connection Failed");
    }
});

module.exports = router;
