const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const deployService = require('../services/infrastructure/deployService');
const preflightService = require('../services/infrastructure/preflightService');
const { getUserConnection } = require('./cloud');
const pool = require('../config/db');

// POST /api/deploy
// Start a new deployment
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { workspace_id, source, config } = req.body;
        const userId = req.user.id;

        if (!workspace_id || !source || !config) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        // 1. Get Workspace & Validation
        const wsRes = await pool.query('SELECT * FROM workspaces WHERE id = $1', [workspace_id]);
        if (wsRes.rows.length === 0) return res.status(404).json({ error: "Workspace not found" });
        const workspace = wsRes.rows[0];

        // 🛡️ PREFLIGHT VALIDATION (3-Layer Refactor Layer 3)
        const provider = workspace.state_json?.infraSpec?.resolved_region?.provider || workspace.state_json?.connection?.provider || 'aws';
        if (provider === 'aws') {
            console.log(`[PREFLIGHT] Starting AWS validation for workspace ${workspace_id}...`);
            const conn = await getUserConnection(userId, 'aws');
            if (!conn) {
                return res.status(400).json({ error: "No AWS connection found. Please connect your cloud account first." });
            }

            // Extract services for targeted preflight checks
            const services = workspace.state_json?.infraSpec?.services?.map(s => s.service_id) || [];
            const preflight = await preflightService.validateAWS(workspace.state_json?.region || 'ap-south-1', conn, services);
            if (!preflight.valid) {
                return res.status(403).json({
                    error: "Preflight Validation Failed",
                    details: preflight.checks.filter(c => c.status === 'FAIL')
                });
            }
            console.log(`[PREFLIGHT] AWS validation PASSED.`);
        }

        // 2. Create Deployment Record
        const deploymentId = await deployService.createDeployment(workspace_id, source, config);

        // 3. Trigger Async Deployment
        if (source === 'github') {
            deployService.deployFromGithub(deploymentId, workspace, config);
        } else if (source === 'docker') {
            deployService.deployFromDocker(deploymentId, workspace, config);
        } else {
            return res.status(400).json({ error: "Invalid source type" });
        }

        res.json({ deploymentId, status: 'pending' });

    } catch (err) {
        console.error("Deploy Route Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deploy/:id/status
router.get('/:id/status', authMiddleware, async (req, res) => {
    try {
        const deployment = await deployService.getDeploymentStatus(req.params.id);
        if (!deployment) return res.status(404).json({ error: "Deployment not found" });
        res.json(deployment);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deploy/workspace/:workspaceId/latest
// Fetch the most recent deployment for a workspace (to hydrate logs)
router.get('/workspace/:workspaceId/latest', authMiddleware, async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const result = await pool.query(
            'SELECT * FROM deployments WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1',
            [workspaceId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No deployments found for this workspace" });
        }

        res.json(result.rows[0]);
    } catch (err) {
        console.error("Latest Deploy Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// DESTROY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

const destroyService = require('../services/infrastructure/destroyService');

// POST /api/deploy/:workspaceId/destroy
// Initiate infrastructure destruction (requires typed confirmation)
router.post('/:workspaceId/destroy', authMiddleware, async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { confirmation } = req.body;
        const userId = req.user.id;

        // Server-side validation of typed confirmation
        if (!destroyService.validateConfirmation(confirmation)) {
            return res.status(400).json({
                error: "Invalid confirmation",
                details: "You must type exactly 'DELETE' to confirm destruction."
            });
        }

        const result = await destroyService.initiateDestroy(
            parseInt(workspaceId),
            userId,
            confirmation
        );

        res.json(result);

    } catch (err) {
        console.error("Destroy Route Error:", err);
        res.status(err.message.includes('Cannot destroy') ? 400 : 500).json({ error: err.message });
    }
});

// GET /api/deploy/:workspaceId/destroy/:jobId/status
// Poll destroy job status
router.get('/:workspaceId/destroy/:jobId/status', authMiddleware, async (req, res) => {
    try {
        const { jobId } = req.params;
        const status = destroyService.getJobStatus(jobId);

        if (!status) {
            return res.status(404).json({ error: "Destroy job not found" });
        }

        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
