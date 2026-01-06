/**
 * COST ENGINE DISPATCHER
 * 
 * Routes patterns to their dedicated cost calculation engine.
 * This is the single entry point for all cost calculations.
 * 
 * CORE PRINCIPLE:
 *   Pattern → Cost Engine → Pricing Model
 *   AI NEVER bypasses this.
 */

const staticEngine = require('./staticEngine');
const serverlessEngine = require('./serverlessEngine');
const containerEngine = require('./containerEngine');
const mobileEngine = require('./mobileEngine');
const vmEngine = require('./vmEngine');
const pipelineEngine = require('./pipelineEngine');
const hybridEngine = require('./hybridEngine');

const ENGINES = {
    // V1 Pattern Catalog Mappings
    STATIC_SITE: staticEngine,
    STATIC_SITE_WITH_AUTH: staticEngine, // Auth doesn't change cost model
    SERVERLESS_WEB_APP: serverlessEngine,
    SERVERLESS_API: serverlessEngine,
    CONTAINERIZED_WEB_APP: containerEngine,
    STATEFUL_WEB_PLATFORM: containerEngine,
    HYBRID_PLATFORM: hybridEngine,
    REALTIME_PLATFORM: hybridEngine,
    MOBILE_BACKEND_API: mobileEngine,
    MOBILE_BACKEND: mobileEngine,
    MOBILE_BACKEND_PLATFORM: containerEngine, // Stateful mobile uses container engine
    DATA_PLATFORM: pipelineEngine, // Analytics/batch workloads use pipeline/compute pricing
    ML_INFERENCE_PLATFORM: containerEngine, // 🔥 FIX 3: Model serving (requests + model size, not generic API)
    ML_TRAINING_PLATFORM: pipelineEngine, // Batch training uses pipeline/compute pricing
    TRADITIONAL_VM_APP: vmEngine,
    DATA_PROCESSING_PIPELINE: pipelineEngine
};

/**
 * Get the cost engine for a pattern.
 * @param {string} patternName - One of the 6 canonical patterns
 * @returns {Object|null} The engine module or null if not found
 */
function getEngine(patternName) {
    return ENGINES[patternName] || null;
}

/**
 * Calculate costs for a given pattern and usage profile.
 * This is the main entry point for all cost calculations.
 * 
 * @param {string} patternName - One of the 6 canonical patterns
 * @param {Object} usageProfile - AI-inferred or user-provided usage data
 * @param {Object} options - Additional options (costProfile, etc.)
 * @returns {Promise<Object>} Cost estimation results for all 3 clouds
 */
async function calculateCost(patternName, usageProfile, options = {}) {
    const engine = getEngine(patternName);

    if (!engine) {
        throw new Error(`[COST ENGINE] Unknown pattern: ${patternName}`);
    }

    console.log(`[COST ENGINE] Dispatching to ${patternName} engine`);

    // All engines must implement the same interface
    return engine.calculate(usageProfile, options);
}

/**
 * Get the engine type for a pattern.
 * @param {string} patternName 
 * @returns {'formula' | 'hybrid' | 'infracost' | null}
 */
function getEngineType(patternName) {
    const engine = getEngine(patternName);
    return engine ? engine.type : null;
}

module.exports = {
    getEngine,
    calculateCost,
    getEngineType,
    ENGINES
};
