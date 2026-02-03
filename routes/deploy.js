const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const deployService = require('../services/infrastructure/deployService');
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

module.exports = router;
