/**
 * AUDIT LOG SERVICE
 * Tracks all user actions for compliance, debugging, and analytics
 * 
 * USE CASES:
 * 1. Compliance: Track who did what and when
 * 2. Debugging: Trace issues back to specific actions
 * 3. Analytics: Understand user behavior patterns
 * 4. Security: Detect suspicious activity
 */

const pool = require('../config/db');

// Action types for consistency
const ACTIONS = {
    // Authentication
    USER_LOGIN: 'user_login',
    USER_LOGOUT: 'user_logout',
    PASSWORD_RESET_REQUESTED: 'password_reset_requested',
    PASSWORD_RESET_COMPLETED: 'password_reset_completed',

    // Workspace lifecycle
    WORKSPACE_CREATED: 'workspace_created',
    WORKSPACE_UPDATED: 'workspace_updated',
    WORKSPACE_DELETED: 'workspace_deleted',
    WORKSPACE_SAVED: 'workspace_saved',

    // Workflow steps
    STEP_1_STARTED: 'step_1_started',
    STEP_1_COMPLETED: 'step_1_completed',
    STEP_2_QUESTION_ANSWERED: 'step_2_question_answered',
    STEP_2_SPEC_GENERATED: 'step_2_spec_generated',
    STEP_3_COST_ANALYSIS: 'step_3_cost_analysis',
    STEP_3_PROVIDER_SELECTED: 'step_3_provider_selected',

    // Project actions
    PROJECT_CREATED: 'project_created',
    PROJECT_UPDATED: 'project_updated',
    PROJECT_DELETED: 'project_deleted',

    // Template actions
    TEMPLATE_USED: 'template_used',
    TEMPLATE_CREATED: 'template_created'
};

/**
 * Log an action to the audit log
 * @param {string} userId - User performing the action
 * @param {string} action - Action type (use ACTIONS constants)
 * @param {object} details - Additional context (stored as JSONB)
 * @param {object} options - Optional: workspaceId, ipAddress, userAgent
 */
async function logAction(userId, action, details = {}, options = {}) {
    try {
        const { workspaceId, ipAddress, userAgent } = options;

        await pool.query(`
            INSERT INTO audit_log (user_id, workspace_id, action, details, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            userId,
            workspaceId || null,
            action,
            JSON.stringify(details),
            ipAddress || null,
            userAgent || null
        ]);

        console.log(`[AUDIT] ${action} by ${userId}`);

    } catch (error) {
        // Don't throw - audit logging should never break the app
        console.error('[AUDIT ERROR]', error.message);
    }
}

/**
 * Get audit log entries for a user
 * @param {string} userId - User ID
 * @param {object} options - Filters: limit, offset, action, startDate, endDate
 */
async function getUserAuditLog(userId, options = {}) {
    const { limit = 50, offset = 0, action, startDate, endDate } = options;

    let query = `
        SELECT id, action, workspace_id, details, ip_address, created_at
        FROM audit_log
        WHERE user_id = $1
    `;
    const params = [userId];
    let paramIndex = 2;

    if (action) {
        query += ` AND action = $${paramIndex++}`;
        params.push(action);
    }

    if (startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(startDate);
    }

    if (endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(endDate);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
}

/**
 * Get audit log entries for a workspace
 * @param {number} workspaceId - Workspace ID
 */
async function getWorkspaceAuditLog(workspaceId, limit = 100) {
    const result = await pool.query(`
        SELECT id, user_id, action, details, created_at
        FROM audit_log
        WHERE workspace_id = $1
        ORDER BY created_at DESC
        LIMIT $2
    `, [workspaceId, limit]);

    return result.rows;
}

/**
 * Get action statistics for analytics
 * @param {string} userId - User ID (optional, for user-specific stats)
 * @param {number} days - Number of days to look back
 */
async function getActionStats(userId = null, days = 30) {
    let query = `
        SELECT 
            action,
            COUNT(*) as count,
            DATE_TRUNC('day', created_at) as date
        FROM audit_log
        WHERE created_at >= NOW() - INTERVAL '${days} days'
    `;

    const params = [];
    if (userId) {
        query += ` AND user_id = $1`;
        params.push(userId);
    }

    query += ` GROUP BY action, DATE_TRUNC('day', created_at) ORDER BY date DESC`;

    const result = await pool.query(query, params);
    return result.rows;
}

module.exports = {
    ACTIONS,
    logAction,
    getUserAuditLog,
    getWorkspaceAuditLog,
    getActionStats
};
