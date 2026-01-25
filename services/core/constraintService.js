/**
 * Constraint Service (V2)
 * Exclusion Validation & Guardrails
 * 
 * Responsibilities:
 * 1. Validate Exclusions against Detected Capabilities
 * 2. Enforce Hard Constraints (Fail Fast)
 */

class ConstraintService {

    /**
     * Validate Pre-Intent Context for conflicts
     * @param {object} preIntentContext
     * @returns {object} { valid: boolean, error: object | null }
     */
    validate(preIntentContext) {
        const { exclusions, detected } = preIntentContext;
        const capabilities = new Set(detected.capability_hints);

        // Map exclusions to their blocking capabilities
        // exclude: true means "I do NOT want this"

        // 1. Check: Database Exclusion vs Persistence Requirements
        if (exclusions.database === true) { // User explicitly excluded DB
            if (capabilities.has("payments")) {
                return this.createError("INVALID_EXCLUSION", "Payments require persistent storage (database).", "database");
            }
            if (capabilities.has("relational_db")) {
                return this.createError("INVALID_EXCLUSION", "Detected Intent (relational_db) conflicts with Database Exclusion.", "database");
            }
            if (capabilities.has("auth")) {
                // Auth usually requires DB, but could be SaaS auth. 
                // We'll be strict for now as per "Production-Grade" request.
                return this.createError("INVALID_EXCLUSION", "User Authentication requires persistent storage.", "database");
            }
        }

        // 2. Check: Queue Exclusion vs Realtime/Async
        if (exclusions.queue === true) {
            // Some realtime architectures use queues (but not all). 
            // Analytics often implies batch/queues.
            if (preIntentContext.domain_tags.includes("analytics") && capabilities.has("batch_processing")) {
                return this.createError("INVALID_EXCLUSION", "Analytics batch processing typically requires queuing.", "queue");
            }
        }

        // 3. Check: Cache Exclusion vs High Traffic
        // Soft constraint? User said "Hard constraints fail fast".
        // A cache exclusion at high traffic might be unwise but not "impossible" (just expensive).
        // leaving strict fail checks for "impossible" combinations only.

        return { valid: true, error: null };
    }

    createError(code, reason, blockedService) {
        return {
            valid: false,
            error: {
                code,
                reason,
                blocked_service: blockedService
            }
        };
    }
}

module.exports = new ConstraintService();
