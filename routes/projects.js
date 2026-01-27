const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

// Get all projects for a user
router.get('/', authMiddleware, async (req, res) => {
    try {
        // Assuming projects table has owner_id matching user.id or similar
        // If projects table uses UUID for owner_id or VARCHAR matching Auth0/User ID
        const result = await pool.query('SELECT * FROM projects WHERE owner_id = $1', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching projects' });
    }
});

// Create a project
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { name, description } = req.body;
        const result = await pool.query(
            'INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING *',
            [name, description, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error creating project' });
    }
});

module.exports = router;
