const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const authMiddleware = require('../middleware/auth');
const monopolyLayers = require('../services/monopolyLayers');

/**
 * @route POST /api/workflow/analyze
 * @desc Monopoly-Grade Architecture Workload Pipeline (15 Layers)
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        const { userInput, conversationHistory } = req.body;
        if (!userInput) return res.status(400).json({ msg: "User input required" });

        // --- LAYER 1: Intent Normalization (AI) ---
        const normalization = await aiService.normalizeIntent(userInput, conversationHistory || []);
        console.log("L1 Normalization:", normalization);

        // Ambiguity Check / Loop Handling
        const historyLength = conversationHistory ? conversationHistory.length : 0;
        if (normalization.is_ambiguous && historyLength < 6) {
            return res.json({
                step: 'refine_requirements',
                data: {
                    status: 'MISSING_INFO',
                    clarifying_question: normalization.clarifying_question,
                    suggested_options: normalization.suggested_options || [],
                    extracted_data: normalization.intent_tags
                }
            });
        }

        // --- LAYER 2: Workload Classification (Deterministic) ---
        const classification = monopolyLayers.classifyWorkload(normalization.intent_tags || []);
        console.log("L2 Classification:", classification);

        // --- LAYER 3: Architecture Skeleton (Deterministic) ---
        const skeleton = monopolyLayers.buildSkeleton(classification, normalization.intent_tags || []);
        console.log("L3 Skeleton Built:", skeleton.length, "modules");

        // --- LAYER 4: AI Proposal Intake (Constrained) ---
        const context = [
            ...(conversationHistory || []),
            { role: 'user', content: userInput },
            { role: 'system', content: `Workload: ${classification.type}` }
        ];
        // We pass the Skeleton as the MANDATORY constraint
        let spec = await aiService.generateConstrainedProposal(skeleton, "Standard", context);
        console.log("L4 AI Proposal Received");

        // --- LAYER 5: Structural Validation (Monopoly) ---
        // Ensure AI didn't delete the enforced Skeleton
        spec = monopolyLayers.validateStructure(spec, skeleton);

        // --- LAYERS 6-14: Deterministic Enforcement ---
        // 6. Security Policy
        spec = monopolyLayers.enforceSecurity(spec);

        // 7. Compliance Resolution
        spec = monopolyLayers.resolveCompliance(spec, normalization.intent_tags || []);

        // 8. Conflict Detection (Monopoly)
        spec = monopolyLayers.detectConflicts(spec);

        // 9. Default Materialization
        spec.assumptions = {
            traffic_tier: normalization.estimated_users || "Medium",
            workload_type: classification.type
        };
        spec = monopolyLayers.materializeDefaults(spec, classification);

        // 13. Scoring
        spec = monopolyLayers.scoreSpec(spec);

        // 14. Canonical Output
        const finalOutput = monopolyLayers.canonicalizeOutput(spec);

        res.json(finalOutput);

    } catch (error) {
        console.error("Workflow Error:", error);
        res.status(500).send('Server Error in Workflow');
    }
});

module.exports = router;
