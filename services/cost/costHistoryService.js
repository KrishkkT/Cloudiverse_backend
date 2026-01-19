// backend/services/costHistoryService.js
/**
 * COST HISTORY SERVICE
 * Tracks historical cost estimates for analytics and comparison
 */

'use strict';

const pool = require('../../config/db');

function extractRange(costRange) {
    if (!costRange) return { low: null, high: null, confidence: 'medium' };

    // Accept multiple shapes:
    // 1) { range: { low, high }, confidence }
    // 2) { low, high, confidence }
    // 3) { formatted: "$x - $y/month" } -> store nulls
    const low = costRange?.range?.low ?? costRange?.low ?? null;
    const high = costRange?.range?.high ?? costRange?.high ?? null;
    const confidence = costRange?.confidence ?? 'medium';

    return { low, high, confidence };
}

/**
 * Save a cost estimate to history
 * @param {number} workspaceId
 * @param {object} costData - result from infracostService.performCostAnalysis(...)
 */
async function saveCostEstimate(workspaceId, costData) {
    try {
        const {
            cost_profile,
            scale_tier,
            rankings = [],
            category_breakdown = []
        } = costData || {};

        if (!workspaceId) throw new Error('saveCostEstimate: workspaceId is required');
        if (!Array.isArray(rankings) || rankings.length === 0) {
            return { saved: 0 };
        }

        const inserts = rankings.map(async (ranking) => {
            const { low, high, confidence } = extractRange(ranking.cost_range);

            return pool.query(
                `
        INSERT INTO cost_history
          (workspace_id, provider, cost_profile, estimated_cost,
           cost_range_low, cost_range_high, confidence,
           category_breakdown, service_count, scale_tier)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        `,
                [
                    workspaceId,
                    ranking.provider,
                    cost_profile || null,
                    ranking.monthly_cost ?? null,
                    low,
                    high,
                    confidence,
                    JSON.stringify(category_breakdown),
                    ranking.service_count ?? null,
                    scale_tier || null
                ]
            );
        });

        await Promise.all(inserts);

        return { saved: rankings.length };
    } catch (error) {
        console.error('[COST HISTORY ERROR]', error.message);
        throw error;
    }
}

async function getWorkspaceCostHistory(workspaceId, options = {}) {
    const { provider, limit = 50 } = options;

    let query = `
    SELECT
      id, provider, cost_profile, estimated_cost,
      cost_range_low, cost_range_high, confidence,
      service_count, scale_tier, created_at
    FROM cost_history
    WHERE workspace_id = $1
  `;

    const params = [workspaceId];

    if (provider) {
        query += ` AND provider = $2`;
        params.push(provider);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);
    return result.rows;
}

async function getCostTrends(workspaceId, days = 30) {
    const result = await pool.query(
        `
    SELECT
      provider,
      estimated_cost,
      cost_range_low,
      cost_range_high,
      DATE_TRUNC('day', created_at) as date
    FROM cost_history
    WHERE workspace_id = $1
      AND created_at >= NOW() - INTERVAL '${days} days'
    ORDER BY created_at ASC
    `,
        [workspaceId]
    );

    const trends = {};
    for (const row of result.rows) {
        if (!trends[row.provider]) trends[row.provider] = [];
        trends[row.provider].push({
            date: row.date,
            cost: row.estimated_cost != null ? parseFloat(row.estimated_cost) : null,
            low: row.cost_range_low != null ? parseFloat(row.cost_range_low) : null,
            high: row.cost_range_high != null ? parseFloat(row.cost_range_high) : null
        });
    }

    return trends;
}

async function getProviderComparison(userId) {
    const result = await pool.query(
        `
    SELECT
      ch.provider,
      COUNT(*) as estimate_count,
      AVG(ch.estimated_cost) as avg_cost,
      MIN(ch.estimated_cost) as min_cost,
      MAX(ch.estimated_cost) as max_cost,
      COUNT(DISTINCT ch.workspace_id) as workspace_count
    FROM cost_history ch
    JOIN workspaces w ON ch.workspace_id = w.id
    WHERE w.user_id = $1
    GROUP BY ch.provider
    ORDER BY avg_cost ASC
    `,
        [userId]
    );

    return result.rows.map(row => ({
        provider: row.provider,
        estimate_count: parseInt(row.estimate_count, 10),
        avg_cost: Math.round(parseFloat(row.avg_cost || 0) * 100) / 100,
        min_cost: parseFloat(row.min_cost || 0),
        max_cost: parseFloat(row.max_cost || 0),
        workspace_count: parseInt(row.workspace_count, 10)
    }));
}

async function getCostStatistics(userId = null) {
    let whereClause = '';
    const params = [];

    if (userId) {
        whereClause = `WHERE w.user_id = $1`;
        params.push(userId);
    }

    const result = await pool.query(
        `
    SELECT
      COUNT(*) as total_estimates,
      AVG(ch.estimated_cost) as avg_cost,
      SUM(ch.estimated_cost) as total_estimated_spend,
      COUNT(DISTINCT ch.workspace_id) as workspaces_analyzed,
      MODE() WITHIN GROUP (ORDER BY ch.provider) as most_recommended_provider,
      MODE() WITHIN GROUP (ORDER BY ch.cost_profile) as most_used_profile
    FROM cost_history ch
    ${userId ? 'JOIN workspaces w ON ch.workspace_id = w.id' : ''}
    ${whereClause}
    `,
        params
    );

    const stats = result.rows[0] || {};
    return {
        total_estimates: parseInt(stats.total_estimates || 0, 10),
        avg_cost: Math.round(parseFloat(stats.avg_cost || 0) * 100) / 100,
        total_estimated_spend: Math.round(parseFloat(stats.total_estimated_spend || 0) * 100) / 100,
        workspaces_analyzed: parseInt(stats.workspaces_analyzed || 0, 10),
        most_recommended_provider: stats.most_recommended_provider || 'N/A',
        most_used_profile: stats.most_used_profile || 'N/A'
    };
}

module.exports = {
    saveCostEstimate,
    getWorkspaceCostHistory,
    getCostTrends,
    getProviderComparison,
    getCostStatistics
};
