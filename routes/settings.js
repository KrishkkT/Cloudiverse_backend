const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Get User Settings & Usage
router.get('/', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.*, u.email, u.role 
             FROM user_settings s 
             RIGHT JOIN users u ON u.id = s.user_id 
             WHERE u.id = $1`,
            [req.user.id]
        );

        // Fetch usage stats (Real-time count of active projects)
        const projectCountRes = await pool.query(
            "SELECT count(*) FROM projects WHERE owner_id = $1", // Assuming projects table has owner_id matching user.id (which is uuid/string)
            [req.user.id]
        );
        const activeProjects = parseInt(projectCountRes.rows[0].count, 10) || 0;

        const responseData = {
            ...result.rows[0],
            usage: {
                projects_used: activeProjects
            }
        };

        res.json(responseData);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch settings" });
    }
});

// Update Preferences
router.put('/preferences', authMiddleware, async (req, res) => {
    try {
        const { preferences } = req.body;
        await pool.query(
            `INSERT INTO user_settings (user_id, preferences) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET preferences = $2, updated_at = NOW()`,
            [req.user.id, preferences]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Failed to update preferences" });
    }
});


module.exports = router;
