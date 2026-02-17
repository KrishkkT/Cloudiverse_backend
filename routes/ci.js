const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../config/db');
const deployService = require('../services/infrastructure/deployService');
const githubService = require('../services/infrastructure/githubService');
const auth = require('../middleware/auth');

// 🛡️ Helper: Verify GitHub Signature
const verifySignature = (payload, signature, secret) => {
    if (!signature || !secret) return false;
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
    const sigBuffer = Buffer.from(signature);
    const digestBuffer = Buffer.from(digest);
    if (sigBuffer.length !== digestBuffer.length) return false;
    return crypto.timingSafeEqual(sigBuffer, digestBuffer);
};

// -------------------------------------------------------------------------
// 1️⃣ WEBHOOK ENDPOINT (Public, Secured by HMAC)
// -------------------------------------------------------------------------
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-hub-signature-256'];
        const event = req.headers['x-github-event'];
        const { repository, ref, pusher } = req.body;

        if (event === 'ping') return res.status(200).send('PONG');
        if (event !== 'push') return res.status(200).send('Ignored event');

        // Extract branch name from ref (refs/heads/main -> main)
        const branch = ref ? ref.replace('refs/heads/', '') : null;
        if (!branch) return res.status(400).send('Missing branch ref');

        console.log(`[CI] Webhook received for ${repository.full_name} on branch ${branch}`);

        // 1. Find Workspace by Repo URL (or stored full_name)
        // We look for workspaces that have this repo linked AND match the branch logic
        // For now, simpler: repo_url match
        const { rows } = await pool.query(
            `SELECT id, name, user_id, state_json, ci_config 
             FROM workspaces 
             WHERE repo_url = $1 OR ci_config->>'repo_full_name' = $2`,
            [repository.html_url, repository.full_name]
        );

        if (rows.length === 0) {
            console.warn(`[CI] No workspace found for ${repository.full_name}`);
            return res.status(404).send('No linked workspace found');
        }

        // 2. Filter & Authenticate Workspaces
        const targetWorkspace = rows.find(ws => {
            const config = ws.ci_config || {};
            // Match Branch (if configured, otherwise default to main/master)
            if (config.branch && config.branch !== branch) return false;

            // Verify Signature (if secret is configured)
            if (config.webhook_secret) {
                if (!verifySignature(req.body, signature, config.webhook_secret)) {
                    console.warn(`[CI] Signature verification failed for workspace ${ws.id}`);
                    return false;
                }
            }
            return true;
        });

        if (!targetWorkspace) {
            return res.status(403).send('Verification failed or branch mismatch');
        }

        // 3. Trigger Deployment
        console.log(`[CI] Triggering deployment for workspace ${targetWorkspace.id} (${targetWorkspace.name})`);

        // Lock check (simple rate limit)
        if (targetWorkspace.last_deployment_at && (Date.now() - new Date(targetWorkspace.last_deployment_at).getTime() < 60000)) {
            return res.status(429).send('Rate limited: Cooldown active');
        }

        // Update last_deployment_at
        await pool.query('UPDATE workspaces SET last_deployment_at = NOW() WHERE id = $1', [targetWorkspace.id]);

        // Create & Start Deployment
        const deploymentId = await deployService.createDeployment(targetWorkspace.id, 'github', {
            repoUrl: repository.html_url,
            branch: branch,
            commitHash: req.body.after,
            commitMessage: req.body.head_commit?.message,
            trigger: 'webhook'
        });

        // Run Async
        deployService.deployFromGithub(deploymentId, targetWorkspace, {
            repoUrl: repository.html_url,
            branch: branch
        }).catch(err => console.error(`[CI] Async deploy error:`, err));

        res.status(202).json({
            message: 'Deployment triggered',
            deploymentId,
            workspaceId: targetWorkspace.id
        });

    } catch (err) {
        console.error('[CI] Webhook Error:', err);
        res.status(500).send('Internal Server Error');
    }
});

// -------------------------------------------------------------------------
// 2️⃣ MANUAL TRIGGER (Via Action or Curl)
// -------------------------------------------------------------------------
router.post('/trigger', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).send('Missing Bearer Token');
        }
        const token = authHeader.split(' ')[1];
        const { repository, branch } = req.body; // Sent by Action

        // Find matches
        const { rows } = await pool.query(
            `SELECT id, name, ci_config FROM workspaces WHERE ci_config->>'ci_token' = $1`,
            [token]
        );

        if (rows.length === 0) return res.status(403).send('Invalid CI Token');
        const workspace = rows[0];

        // Optional: Match repo/branch params if provided for extra safety
        if (repository && workspace.ci_config.repo_full_name && repository !== workspace.ci_config.repo_full_name) {
            console.warn(`[CI] Repo mismatch for trigger. Token belongs to ${workspace.ci_config.repo_full_name}, got ${repository}`);
        }

        console.log(`[CI] Manual trigger for workspace ${workspace.id}`);

        // Update last_deployment_at
        await pool.query('UPDATE workspaces SET last_deployment_at = NOW() WHERE id = $1', [workspace.id]);

        const deploymentId = await deployService.createDeployment(workspace.id, 'github', {
            repoUrl: workspace.repo_url || `https://github.com/${repository}`,
            branch: branch || workspace.ci_config.branch || 'main',
            trigger: 'api_trigger'
        });

        deployService.deployFromGithub(deploymentId, workspace, {
            repoUrl: workspace.repo_url,
            branch: branch || 'main'
        });

        res.status(202).json({ deploymentId, status: 'started' });

    } catch (err) {
        console.error('[CI] Trigger Error:', err);
        res.status(500).send(err.message);
    }
});

// -------------------------------------------------------------------------
// 3️⃣ SETUP CI (Generate Secrets & Save Config)
// -------------------------------------------------------------------------
router.post('/setup/:workspaceId', auth, async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { repoUrl, branch } = req.body;

        // Extract owner/repo
        const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
        if (!match) return res.status(400).json({ error: "Invalid GitHub URL" });
        const [_, owner, repo] = match;
        const repoFullName = `${owner}/${repo}`;

        // 1. Generate Secrets
        const webhookSecret = crypto.randomBytes(24).toString('hex');
        const ciToken = crypto.randomBytes(32).toString('hex');

        // 2. Save to Workspace
        const ciConfig = {
            webhook_secret: webhookSecret,
            ci_token: ciToken,
            repo_full_name: repoFullName,
            branch: branch || 'main',
            enabled: true
        };

        await pool.query(
            `UPDATE workspaces 
             SET repo_url = $1, ci_config = $2
             WHERE id = $3 AND user_id = $4`,
            [repoUrl, JSON.stringify(ciConfig), workspaceId, req.user.id]
        );

        // 3. Try to Auto-Create Webhook (Best Effort)
        try {
            // Get user's GitHub token
            const { rows } = await pool.query('SELECT access_token FROM github_installations WHERE user_id = $1', [req.user.id]);
            if (rows.length > 0 && rows[0].access_token) {
                const token = rows[0].access_token;
                const apiUrl = process.env.VITE_API_BASE_URL || 'https://cloudiverse.app';
                const webhookUrl = `${apiUrl}/api/ci/webhook`;

                // Auto-create Webhook
                await githubService.createWebhook(token, owner, repo, webhookUrl, webhookSecret);
            }
        } catch (e) {
            console.warn("Failed to auto-create webhook:", e.message);
        }

        res.json({
            message: "CI/CD Configured",
            secrets: {
                webhook_secret: webhookSecret,
                ci_token: ciToken,
                webhook_url: `${process.env.VITE_API_BASE_URL}/api/ci/webhook`
            }
        });

    } catch (err) {
        console.error('[CI] Setup Error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
