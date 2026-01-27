const express = require('express');
const router = express.Router();
const billingService = require('../services/billing/billingService');
const razorpayService = require('../services/billing/razorpayService');
const authMiddleware = require('../middleware/auth');
const pool = require('../config/db');

// 0. Get Usage Stats
router.get('/usage', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRes = await pool.query("SELECT ai_usage_count, terraform_export_count, report_export_count FROM users WHERE id = $1", [userId]);
        const usage = userRes.rows[0] || {};

        // Also get Plan Status for limits
        const planStatus = await billingService.getPlanStatus(userId);

        // Count projects
        const projectRes = await pool.query("SELECT COUNT(*) as count FROM workspaces WHERE user_id = $1", [userId]);
        const projectCount = parseInt(projectRes.rows[0].count);

        res.json({
            usage: {
                ai_requests: usage.ai_usage_count || 0,
                terraform_exports: usage.terraform_export_count || 0,
                report_downloads: usage.report_export_count || 0,
                projects: projectCount
            },
            limits: planStatus.limits
        });
    } catch (err) {
        console.error("Get Usage Error:", err);
        res.status(500).json({ error: "Failed to fetch usage data" });
    }
});

// 0.1 Track Usage (For client-side actions like Report/Terraform download)
router.post('/track-usage', authMiddleware, async (req, res) => {
    try {
        const { type } = req.body; // 'terraform', 'report', 'diagram'
        const userId = req.user.id;

        let column = '';
        if (type === 'terraform') column = 'terraform_export_count';
        else if (type === 'report') column = 'report_export_count';
        else if (type === 'diagram') column = 'diagram_export_count';
        else return res.status(400).json({ error: "Invalid usage type" });

        await pool.query(`UPDATE users SET ${column} = COALESCE(${column}, 0) + 1 WHERE id = $1`, [userId]);

        res.json({ success: true, type, msg: "Usage tracked" });
    } catch (err) {
        console.error("Track Usage Error:", err);
        res.status(500).json({ error: "Failed to track usage" });
    }
});

// 1. Get Status
router.get('/status', authMiddleware, async (req, res) => {
    try {
        const status = await billingService.getPlanStatus(req.user.id);
        res.json(status);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Create Subscription Intent
router.post('/subscription', authMiddleware, async (req, res) => {
    try {
        const sub = await billingService.createSubscriptionIntent(req.user.id);
        res.json({
            subscription_id: sub.id,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 3. Verify Payment & Link Subscription
router.post('/verify', authMiddleware, async (req, res) => {
    try {
        const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = req.body;
        await billingService.linkSubscription(
            req.user.id,
            razorpay_subscription_id,
            razorpay_payment_id,
            razorpay_signature
        );
        res.json({ success: true, message: 'Subscription activated' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// 4. Cancel Subscription
router.post('/cancel', authMiddleware, async (req, res) => {
    try {
        await billingService.cancelSubscription(req.user.id);
        res.json({ success: true, message: 'Subscription cancelled successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 5. Webhook Handler
router.post('/webhook', async (req, res) => {
    try {
        const signature = req.headers['x-razorpay-signature'];
        const isValid = razorpayService.verifyWebhookSignature(req.body, signature);

        if (!isValid) {
            console.error("Invalid Webhook Signature");
            return res.status(400).send('Invalid Signature');
        }

        await billingService.handleWebhook(req.body);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error("Webhook Error", err);
        res.status(500).send('Webhook Processing Failed');
    }
});

module.exports = router;
