/**
 * ANALYTICS & TEMPLATES API ROUTES
 * Endpoints for cost history, templates, and audit logs
 */

const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const costHistoryService = require('../services/costHistoryService');
const templateService = require('../services/templateService');
const auditService = require('../services/auditService');

// ============================================================
// TEMPLATES ENDPOINTS
// ============================================================

/**
 * GET /api/analytics/templates
 * Get all public templates, optionally filtered by category
 */
router.get('/templates', async (req, res) => {
    try {
        const { category } = req.query;
        const templates = await templateService.getPublicTemplates(category);

        res.json({
            success: true,
            count: templates.length,
            templates
        });
    } catch (error) {
        console.error('Templates Error:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

/**
 * GET /api/analytics/templates/categories
 * Get template categories with counts
 */
router.get('/templates/categories', async (req, res) => {
    try {
        const categories = await templateService.getCategoryCounts();
        res.json({ success: true, categories });
    } catch (error) {
        console.error('Categories Error:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

/**
 * GET /api/analytics/templates/:id
 * Get a specific template by ID
 */
router.get('/templates/:id', async (req, res) => {
    try {
        const template = await templateService.getTemplateById(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        res.json({ success: true, template });
    } catch (error) {
        console.error('Template Error:', error);
        res.status(500).json({ error: 'Failed to fetch template' });
    }
});

/**
 * POST /api/analytics/templates/:id/use
 * Use a template (increments usage count, returns template data)
 */
router.post('/templates/:id/use', authMiddleware, async (req, res) => {
    try {
        const template = await templateService.useTemplate(req.params.id);
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }

        // Log the action
        await auditService.logAction(
            req.user.userId,
            auditService.ACTIONS.TEMPLATE_USED,
            { template_id: req.params.id, template_name: template.name }
        );

        res.json({ success: true, template });
    } catch (error) {
        console.error('Use Template Error:', error);
        res.status(500).json({ error: 'Failed to use template' });
    }
});

/**
 * POST /api/analytics/templates
 * Create a custom template (authenticated)
 */
router.post('/templates', authMiddleware, async (req, res) => {
    try {
        const { name, description, category, template_json, is_public } = req.body;

        if (!name || !category || !template_json) {
            return res.status(400).json({ error: 'Missing required fields: name, category, template_json' });
        }

        const template = await templateService.createTemplate(req.user.userId, {
            name,
            description,
            category,
            template_json,
            is_public
        });

        await auditService.logAction(
            req.user.userId,
            auditService.ACTIONS.TEMPLATE_CREATED,
            { template_id: template.id, template_name: template.name }
        );

        res.json({ success: true, template });
    } catch (error) {
        console.error('Create Template Error:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
});

/**
 * GET /api/analytics/templates/user/my
 * Get templates created by the current user
 */
router.get('/templates/user/my', authMiddleware, async (req, res) => {
    try {
        const templates = await templateService.getUserTemplates(req.user.userId);
        res.json({ success: true, templates });
    } catch (error) {
        console.error('User Templates Error:', error);
        res.status(500).json({ error: 'Failed to fetch user templates' });
    }
});

// ============================================================
// COST HISTORY ENDPOINTS
// ============================================================

/**
 * GET /api/analytics/costs/workspace/:workspaceId
 * Get cost history for a specific workspace
 */
router.get('/costs/workspace/:workspaceId', authMiddleware, async (req, res) => {
    try {
        const { provider, limit } = req.query;
        const history = await costHistoryService.getWorkspaceCostHistory(
            req.params.workspaceId,
            { provider, limit: parseInt(limit) || 50 }
        );

        res.json({ success: true, history });
    } catch (error) {
        console.error('Cost History Error:', error);
        res.status(500).json({ error: 'Failed to fetch cost history' });
    }
});

/**
 * GET /api/analytics/costs/trends/:workspaceId
 * Get cost trends over time for charts
 */
router.get('/costs/trends/:workspaceId', authMiddleware, async (req, res) => {
    try {
        const { days } = req.query;
        const trends = await costHistoryService.getCostTrends(
            req.params.workspaceId,
            parseInt(days) || 30
        );

        res.json({ success: true, trends });
    } catch (error) {
        console.error('Cost Trends Error:', error);
        res.status(500).json({ error: 'Failed to fetch cost trends' });
    }
});

/**
 * GET /api/analytics/costs/comparison
 * Get provider comparison across all user workspaces
 */
router.get('/costs/comparison', authMiddleware, async (req, res) => {
    try {
        const comparison = await costHistoryService.getProviderComparison(req.user.userId);
        res.json({ success: true, comparison });
    } catch (error) {
        console.error('Provider Comparison Error:', error);
        res.status(500).json({ error: 'Failed to fetch provider comparison' });
    }
});

/**
 * GET /api/analytics/costs/stats
 * Get cost statistics summary
 */
router.get('/costs/stats', authMiddleware, async (req, res) => {
    try {
        const stats = await costHistoryService.getCostStatistics(req.user.userId);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Cost Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch cost statistics' });
    }
});

// ============================================================
// AUDIT LOG ENDPOINTS
// ============================================================

/**
 * GET /api/analytics/audit
 * Get audit log for current user
 */
router.get('/audit', authMiddleware, async (req, res) => {
    try {
        const { action, limit, offset, startDate, endDate } = req.query;
        const logs = await auditService.getUserAuditLog(req.user.userId, {
            action,
            limit: parseInt(limit) || 50,
            offset: parseInt(offset) || 0,
            startDate,
            endDate
        });

        res.json({ success: true, logs });
    } catch (error) {
        console.error('Audit Log Error:', error);
        res.status(500).json({ error: 'Failed to fetch audit log' });
    }
});

/**
 * GET /api/analytics/audit/workspace/:workspaceId
 * Get audit log for a specific workspace
 */
router.get('/audit/workspace/:workspaceId', authMiddleware, async (req, res) => {
    try {
        const logs = await auditService.getWorkspaceAuditLog(
            req.params.workspaceId,
            parseInt(req.query.limit) || 100
        );

        res.json({ success: true, logs });
    } catch (error) {
        console.error('Workspace Audit Error:', error);
        res.status(500).json({ error: 'Failed to fetch workspace audit log' });
    }
});

/**
 * GET /api/analytics/audit/stats
 * Get action statistics for analytics dashboard
 */
router.get('/audit/stats', authMiddleware, async (req, res) => {
    try {
        const { days } = req.query;
        const stats = await auditService.getActionStats(req.user.userId, parseInt(days) || 30);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Action Stats Error:', error);
        res.status(500).json({ error: 'Failed to fetch action statistics' });
    }
});

// ============================================================
// DASHBOARD SUMMARY
// ============================================================

/**
 * GET /api/analytics/dashboard
 * Get combined analytics dashboard data
 */
router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const [costStats, comparison, recentLogs, templates] = await Promise.all([
            costHistoryService.getCostStatistics(req.user.userId),
            costHistoryService.getProviderComparison(req.user.userId),
            auditService.getUserAuditLog(req.user.userId, { limit: 10 }),
            templateService.getUserTemplates(req.user.userId)
        ]);

        res.json({
            success: true,
            dashboard: {
                cost_stats: costStats,
                provider_comparison: comparison,
                recent_activity: recentLogs,
                my_templates: templates.length,
                available_templates: await templateService.getPublicTemplates().then(t => t.length)
            }
        });
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

module.exports = router;
