/**
 * backend/config/index.js
 *
 * Config layer aggregator.
 * Provides centralized access to:
 * - Service ID aliases
 * - Canonical patterns configuration
 * - Terraform registry configuration
 * - Database configuration
 */

'use strict';

const aliases = require('./aliases');
const patternsConfig = require('./canonicalPatterns.config');
const terraformRegistry = require('./terraformRegistry.config');
const db = require('./db');

// Re-export commonly used functions at top level
const {
    resolveServiceId,
    resolveServiceIds,
    resolveCapabilityId,
    SERVICE_ALIASES
} = aliases;

const {
    getPattern,
    getPatternIds,
    findBestPattern,
    getFallbackPattern
} = patternsConfig;

const {
    getModuleSource,
    hasModule,
    hasVariants
} = terraformRegistry;

module.exports = {
    // Aliases
    aliases,
    resolveServiceId,
    resolveServiceIds,
    resolveCapabilityId,
    SERVICE_ALIASES,

    // Patterns
    patterns: patternsConfig,
    getPattern,
    getPatternIds,
    findBestPattern,
    getFallbackPattern,

    // Terraform Registry
    terraform: terraformRegistry,
    getModuleSource,
    hasModule,
    hasVariants,

    // Database
    db
};
