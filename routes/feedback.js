const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const pool = require('../config/db');
const auditService = require('../services/shared/auditService');

// POST /api/feedback - New dedicated feedback endpoint
router.post('/feedback', authMiddleware, async (req, res) => {
  try {
    const {
      workspace_id,
      cost_intent,
      estimated_min,
      estimated_max,
      selected_provider,
      selected_profile,
      user_feedback,
      feedback_details
    } = req.body;

    console.log("Feedback received:", req.body);

    // Validate required fields
    if (!workspace_id || !selected_provider || !selected_profile || !user_feedback) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['workspace_id', 'selected_provider', 'selected_profile', 'user_feedback']
      });
    }

    // Store feedback in Neon
    const result = await pool.query(
      `INSERT INTO cost_feedback 
       (workspace_id, cost_intent, estimated_min, estimated_max, selected_provider, selected_profile, user_feedback, feedback_details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        workspace_id,
        cost_intent || 'startup',
        estimated_min || 0,
        estimated_max || 0,
        selected_provider,
        selected_profile,
        user_feedback,
        feedback_details ? JSON.stringify(feedback_details) : null
      ]
    );

    console.log(`Feedback stored with ID: ${result.rows[0].id}`);

    // Log to audit
    if (auditService && req.user) {
      auditService.logAction(
        req.user.id,
        workspace_id,
        'COST_FEEDBACK_SUBMITTED',
        { selected_provider, selected_profile, user_feedback, cost_intent },
        req
      );
    }

    res.json({
      success: true,
      feedback_id: result.rows[0].id,
      created_at: result.rows[0].created_at,
      message: 'Feedback recorded successfully. Ready for Terraform generation.',
      next_step: '/api/workflow/terraform'
    });

  } catch (err) {
    console.error("Feedback error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;