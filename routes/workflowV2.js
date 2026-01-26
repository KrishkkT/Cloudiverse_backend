/**
 * Workflow V2 Router
 * Production-Grade Deterministic Pipeline
 * 
 * Step 1: Pre-Intent Fusion (Rules)
 * Step 2: Intent Analysis (AI - Axes Only)
 * Step 3: Constraint Validation (Guardrails)
 * Step 4: Pattern Resolution (Deterministic)
 * Step 5: InfraSpec Generation (Frozen)
 */

const express = require('express');
const router = express.Router();
const fusionService = require('../services/core/fusionService');
const constraintService = require('../services/core/constraintService');
const aiService = require('../services/ai/aiService');
const patternResolver = require('../services/core/patternResolver');
const integrityService = require('../services/core/integrityService');
const serviceDisplay = require('../services/shared/serviceDisplay');
const authMiddleware = require('../middleware/auth');

// POST /api/workflow/v2/analyze
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        console.log("--- WORKFLOW V2 START ---");
        const userInput = req.body;
        console.log("[V2] Incoming payload:", JSON.stringify(userInput, null, 2));
        console.log("[V2] Incoming payload:", JSON.stringify(userInput, null, 2));

        // 1️⃣ Pre-Intent Fusion (Deterministic)
        console.log("[V2] Step 1: Fusion");
        const preIntentContext = fusionService.fuse(userInput);
        console.log(`[V2] Fusion: ${preIntentContext.detected.capability_hints.length} capabilities detected`);

        // 2️⃣ Intent Analysis (AI - Axes Only)
        // If we have a cached intent (e.g. from confirmation step), use it.
        // For now, we assume fresh run or re-run.
        console.log("[V2] Step 2: AI Intent Generation");
        const aiIntent = await aiService.normalizeIntentV2(preIntentContext);

        if (!aiIntent || !aiIntent.axes) {
            return res.status(500).json({ error: "AI Intent Generation Failed" });
        }

        // 3️⃣ Constraint Validation (Guardrails)
        console.log("[V2] Step 3: Constraint Validation");
        // We validate effectively effectively effectively capabilities vs exclusions
        const validation = constraintService.validate(preIntentContext);
        // 1.5️⃣ Fail-Fast Contradiction Check (Determinism Rule)
        // Rule: Payments or Auth IMPLY Persistence.
        const forbiddenClasses = preIntentContext.constraints?.forbid_service_classes || [];
        const hasPayments = preIntentContext.detected.capability_hints.includes('payments');
        const hasAuth = preIntentContext.detected.capability_hints.includes('authentication') ||
            preIntentContext.detected.capability_hints.includes('identity_access');

        const requiresPersistence = hasPayments || hasAuth;
        const persistenceForbidden = forbiddenClasses.includes('relational_db'); // Simplified check

        if (requiresPersistence && persistenceForbidden) {
            console.warn("[V2] CONTRADICTION DETECTED: Persistence required but DB excluded.");
            return res.status(400).json({
                error: "INVALID_EXCLUSION",
                message: "Configuration Conflict: You requested features (Payments/Auth) that require a Database, but you explicitly excluded Databases.",
                conflict: {
                    required_by: hasPayments ? ['payments'] : ['authentication'],
                    excluded: ['relational_db']
                },
                fix_options: [
                    "Remove the 'No Database' exclusion.",
                    "Remove 'Payments' and 'Authentication' from requirements."
                ]
            });
        }


        // 4️⃣ Clarification Check (Optional - V2 spec says "max 1 question")
        // We check confidence on critical axes: workload_type, statefulness, etc.
        // For this implementation, we will proceed to resolution but mark uncertainties.
        // Logic for returning NEEDS_CLARIFICATION can be added here akin to V1.

        // 5️⃣ Pattern Resolution (Deterministic)
        console.log("[V2] Step 4: Pattern Resolution");
        const architecture = patternResolver.resolveArchitectureV2(preIntentContext, aiIntent.axes);

        if (!architecture.selectedPattern) {
            return res.status(500).json({ error: "Pattern Resolution Failed" });
        }

        // 6️⃣ Integrity & Freeze (Step 5)

        // POLYFILL: Generate missing frontend fields
        const displayServices = serviceDisplay.generateServiceDisplay(architecture.servicesContract.services);
        const frontendModules = displayServices.map(s => ({
            service_name: s.name,
            category: s.category,
            type: s.canonical_type,
            icon: s.icon,
            description: s.description
        }));

        // POLYFILL: Features for Badges (V1 Compatibility)
        // Map detected capabilities to V1-style feature flags
        const features = {};
        if (preIntentContext.detected?.capability_hints) {
            preIntentContext.detected.capability_hints.forEach(cap => {
                features[cap] = true;
            });
        }
        // Add derived requirements as features
        if (architecture.requirements.realtime) features.realtime = true;
        if (architecture.requirements.payments) features.payments = true;
        if (architecture.requirements.ml) features.ml_workload = true;
        if (architecture.requirements.stateful) features.stateful = true;

        // Apply Exclusions to Features (for Red Badges)
        if (preIntentContext.exclusions) {
            Object.entries(preIntentContext.exclusions).forEach(([k, v]) => {
                if (v === true) {
                    features[k] = false; // Base key
                    // ... (existing helper logic) ...
                }
            });
        }

        // 🔥 AI-DRIVEN EXCLUSIONS (V2)
        // If AI says "no_db", treat it as a hard exclusion for the frontend
        if (aiIntent.axes?.managed_db_preference?.value === 'no_db') {
            features.database = false;
            features.relational_db = false;
            features.nosql_db = false;
        }

        // Generate explanations (Frontend expects array of strings)
        const explanations = [];
        explanations.push(`Detected ${aiIntent.intent_classification.primary_domain} domain logic.`);

        // Exclusions
        if (preIntentContext.exclusions) {
            Object.entries(preIntentContext.exclusions).forEach(([k, v]) => {
                if (v === true) explanations.push(`Explicitly excluded ${k} services.`);
            });
        }

        // Compliance
        if (architecture.requirements.nfr?.compliance?.length > 0) {
            explanations.push(`Compliance controls: ${architecture.requirements.nfr.compliance.join(', ')}.`);
        }

        // Clarifications / Questions (Mapped to Assumptions)
        if (aiIntent.ranked_axes_for_questions && aiIntent.ranked_axes_for_questions.length > 0) {
            const topQ = aiIntent.ranked_axes_for_questions[0];
            if (topQ.priority > 0.6) {
                // Format as an assumption we made
                const val = aiIntent.axes[topQ.axis_key]?.value || "default settings";
                explanations.push(`Assumed ${topQ.axis_key.replace(/_/g, ' ')} is '${val}' (Confidence: ${Math.round((aiIntent.axes[topQ.axis_key]?.confidence || 0) * 100)}%).`);
            }
        }

        if (architecture.requirements.stateful) explanations.push("Stateful capabilities configured.");
        else explanations.push("Stateless architecture optimized for scaling.");

        // Attach features to intent for frontend snapshot
        aiIntent.features = features;

        const infraSpec = {
            schema_version: "infraspec.v2",
            metadata: {
                project_name: aiIntent.project_info?.name || aiIntent.project_name || "New Project",
                generated_at: new Date().toISOString()
            },
            // V1 Compatibility Fields
            project_name: aiIntent.project_info?.name || aiIntent.project_name || "New Project",
            project_summary: aiIntent.project_info?.description || `Optimized ${aiIntent.intent_classification.workload_type} architecture for ${aiIntent.intent_classification.primary_domain}.`,
            architecture_pattern: typeof architecture.selectedPattern === 'string' ? architecture.selectedPattern : architecture.selectedPattern.id,
            explanations: explanations,
            // 🔥 REQUIRED for Cost Analysis fallback
            services: architecture.servicesContract.required_services || architecture.servicesContract.services || [],
            assumptions: {
                traffic_tier: preIntentContext.toggles.traffic || 'Medium',
                ...preIntentContext.assumptions
            },
            modules: frontendModules,

            context: {
                domains: preIntentContext.domain_tags,
                toggles: preIntentContext.toggles,
                assumptions: preIntentContext.assumptions
            },
            intent: aiIntent, // Store the axes
            canonical_architecture: architecture.canonicalArchitecture,
            services_contract: architecture.servicesContract,
            service_classes: {
                required_services: architecture.servicesContract.required_services || architecture.servicesContract.services || []
            },
            // Empty placeholders for downstream steps
            sizing: null,
            costs: null
        };

        // Enforce integrity (reuse V1 logic)
        integrityService.sanitizeInfraSpec(architecture.selectedPattern, infraSpec);

        console.log("[V2] Workflow Complete. Returning InfraSpec.");
        res.json({
            step: 'infra_spec_generated',
            data: infraSpec
        });

    } catch (error) {
        console.error("V2 Workflow Error:", error);
        res.status(500).json({ error: "Internal Server Error", details: error.message });
    }
});

// Reuse V1 cost/usage endpoints for now, or route them via V2 if needed types differ.
// usage/cost endpoints expect 'intent' and 'infraSpec'. 
// Our V2 infraSpec structure closely mimics V1 so they might work seamlessly or need minor adapters.

module.exports = router;
