/**
 * backend/config/canonicalPatterns.config.js
 *
 * JS wrapper around canonicalPatterns.json with:
 * - Pattern loading + validation via patternSchema.js
 * - Service ID normalization via aliases
 * - Fallback pattern and threshold settings
 */

'use strict';

const path = require('path');
const { validatePattern } = require('../catalog/schemas/patternSchema');
const services = require('../catalog/terraform/services');
const { resolveServiceId, resolveServiceIds } = require('./aliases');

// Load raw patterns JSON
const rawPatterns = require('./canonicalPatterns.json');

// Settings
const SETTINGS = {
    fallback_pattern: 'SERVERLESS_WEB_APP',
    minimum_score_threshold: 0.3,
    default_complexity: 'simple'
};

// Normalize patterns and validate
const patterns = {};
const validationErrors = [];

if (rawPatterns.patterns && typeof rawPatterns.patterns === 'object') {
    for (const [patternId, def] of Object.entries(rawPatterns.patterns)) {
        // Normalize service IDs in pattern definitions
        const normalized = {
            ...def,
            services: resolveServiceIds(def.services || []),
            required_services: resolveServiceIds(def.required_services || []),
            optional_services: resolveServiceIds(def.optional_services || []),  // 🔥 FIX: Include optional services
            recommended_services: resolveServiceIds(def.recommended_services || []),
            forbidden_services: resolveServiceIds(def.forbidden_services || []),
            allowed_services: resolveServiceIds(def.allowed_services || [])
        };

        // Validate against catalog
        const errors = validatePattern(patternId, normalized, services);
        if (errors.length > 0) {
            validationErrors.push({ patternId, errors });
        }

        patterns[patternId] = normalized;
    }
}

// Log validation issues (non-fatal)
if (validationErrors.length > 0) {
    console.warn(`⚠️ Pattern validation warnings: ${validationErrors.length} patterns have issues`);
    for (const { patternId, errors } of validationErrors) {
        console.warn(`  - ${patternId}: ${errors.join('; ')}`);
    }
}

/**
 * Get pattern by ID.
 */
function getPattern(patternId) {
    return patterns[patternId] || null;
}

/**
 * Get all pattern IDs.
 */
function getPatternIds() {
    return Object.keys(patterns);
}

/**
 * Get all patterns.
 */
function getAllPatterns() {
    return { ...patterns };
}

/**
 * Get fallback pattern ID.
 */
function getFallbackPattern() {
    return SETTINGS.fallback_pattern;
}

/**
 * Get minimum score threshold.
 */
function getMinScoreThreshold() {
    return SETTINGS.minimum_score_threshold;
}

/**
 * Score a pattern against provided capabilities.
 * @param {string} patternId
 * @param {string[]} capabilities
 * @returns {number} - Score (0-1 range, can exceed 1 with weights)
 */
function scorePattern(patternId, capabilities) {
    const pattern = getPattern(patternId);
    if (!pattern) return 0;

    const weights = pattern.score_weights || {};
    let score = 0;
    let maxScore = 0;

    for (const [cap, weight] of Object.entries(weights)) {
        maxScore += Math.abs(weight);
        if (capabilities.includes(cap)) {
            score += weight;
        }
    }

    return maxScore > 0 ? score / maxScore : 0;
}

/**
 * Find best matching pattern for capabilities.
 * @param {string[]} capabilities
 * @returns {{ patternId: string, score: number }}
 */
function findBestPattern(capabilities) {
    let best = { patternId: SETTINGS.fallback_pattern, score: 0 };

    for (const patternId of getPatternIds()) {
        const score = scorePattern(patternId, capabilities);
        if (score > best.score) {
            best = { patternId, score };
        }
    }

    // Fallback if score too low
    if (best.score < SETTINGS.minimum_score_threshold) {
        return { patternId: SETTINGS.fallback_pattern, score: best.score, fallback: true };
    }

    return best;
}

module.exports = {
    SETTINGS,
    patterns,
    validationErrors,
    getPattern,
    getPatternIds,
    getAllPatterns,
    getFallbackPattern,
    getMinScoreThreshold,
    scorePattern,
    findBestPattern
};
