const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const authMiddleware = require('../middleware/auth');
const monopolyLayers = require('../services/monopolyLayers');
const infracostService = require('../services/infracostService');
const auditService = require('../services/auditService');
const costHistoryService = require('../services/costHistoryService');
const patternResolver = require('../services/patternResolver');
const { ARCHITECTURE_PATTERNS, validateServiceSelection } = require('../services/architecturePatterns');
const integrityService = require('../services/integrityService');
const terraformService = require('../services/terraformService');
const costResultModel = require('../services/costResultModel');
const canonicalValidator = require('../services/canonicalValidator');
const pool = require('../config/db');

// =====================================================
// 3-LAYER QUESTION SELECTION SYSTEM
// =====================================================

// LAYER 1: Fixed Decision Axes
const DECISION_AXES = [
    'scale',
    'availability',
    'data_sensitivity',
    'regulatory_exposure',
    'business_criticality',
    'latency_sensitivity',
    'statefulness',
    'data_durability',
    'cost_sensitivity',
    'observability_level'
];

// TRACKED FEATURES (Three-State Model)
const TRACKED_FEATURES = [
    'static_content',
    'payments',
    'real_time',
    'case_management',
    'document_storage',
    'multi_user_roles',
    'identity_auth',
    'messaging_queue',
    'api_backend'
];

// LAYER 2: Axis Importance Scoring Weights
// Higher score = more important to ask first
const AXIS_WEIGHTS = {
    // Domain-specific weights
    domain_weights: {
        law_firm: { regulatory_exposure: 5, data_sensitivity: 4, business_criticality: 3 },
        healthcare: { regulatory_exposure: 5, data_sensitivity: 5, availability: 4 },
        fintech: { regulatory_exposure: 5, data_sensitivity: 5, latency_sensitivity: 4 },
        e_commerce: { availability: 4, scale: 4, business_criticality: 3 },
        saas: { scale: 4, availability: 3, cost_sensitivity: 3 },
        internal_tool: { cost_sensitivity: 4, observability_level: 2 },
        real_estate: { data_sensitivity: 3, business_criticality: 4, regulatory_exposure: 3 }
    },
    // Feature-specific weights
    feature_weights: {
        payments: { data_sensitivity: 4, regulatory_exposure: 4 },
        user_auth: { data_sensitivity: 3, availability: 2 },
        dashboards: { availability: 3, latency_sensitivity: 2 },
        file_storage: { data_durability: 4, data_sensitivity: 2 },
        real_time: { latency_sensitivity: 5, availability: 3 },
        multi_tenant: { scale: 3, data_sensitivity: 3 }
    },
    // Risk-based weights
    risk_weights: {
        user_facing: { availability: 3, latency_sensitivity: 2 },
        data_at_rest: { data_sensitivity: 3, data_durability: 2 },
        pii_involved: { regulatory_exposure: 4, data_sensitivity: 4 }
    },
    // Irreversibility weights (hard to change later)
    irreversibility_weights: {
        scale: 2,           // Architecture choice affects scale
        data_durability: 3, // Database choice is hard to change
        statefulness: 3,    // Stateful vs stateless is fundamental
        regulatory_exposure: 2 // Compliance is structural
    }
};

// LAYER 3: Context-Specific Question Templates per Axis
// With canonical values, askable flags, and feature guards
const QUESTION_TEMPLATES = {
    scale: {
        askable: true, // Always ask
        infer_from: null,
        default: {
            question: "What is the expected user scale for this application?",
            options: [
                { label: "Proof of Concept (<100 users)", value: "POC", description: "Small-scale testing environment, minimal infrastructure requirements" },
                { label: "Small Business (100-1k users)", value: "SMB", description: "Production-ready for small teams and businesses, moderate scaling needs" },
                { label: "Enterprise (>10k users)", value: "ENTERPRISE", description: "Large-scale deployment with high availability and performance requirements" }
            ]
        },
        saas: {
            question: "How many tenants do you expect to support?",
            options: [
                { label: "Single tenant pilot", value: "SINGLE_TENANT" },
                { label: "10-50 organizations", value: "MULTI_TENANT_SMALL" },
                { label: "100+ organizations with growth", value: "MULTI_TENANT_LARGE" }
            ]
        },
        e_commerce: {
            question: "How many concurrent shoppers do you expect during peak?",
            options: [
                { label: "Low traffic (<500 concurrent)", value: "LOW_TRAFFIC" },
                { label: "Medium (500-5k concurrent)", value: "MEDIUM_TRAFFIC" },
                { label: "High traffic/flash sales (10k+)", value: "HIGH_TRAFFIC" }
            ]
        }
    },
    availability: {
        askable: true,
        infer_from: ["business_criticality", "user_facing"],
        default: {
            question: "How critical is uptime for this system?",
            options: [
                { label: "Standard (99.5%)", value: "STANDARD", description: "~3.6 hours downtime/month - suitable for internal tools and non-critical apps" },
                { label: "High Availability (99.9%)", value: "HIGH", description: "~43 minutes downtime/month - recommended for customer-facing applications" },
                { label: "Mission Critical (99.99%)", value: "MISSION_CRITICAL", description: "~4 minutes downtime/month - required for business-critical and revenue-impacting systems" }
            ]
        },
        healthcare: {
            question: "Patient care systems require specific uptime. What are your needs?",
            options: [
                { label: "Background system (99.5%)", value: "STANDARD" },
                { label: "Clinical system (99.9%)", value: "HIGH" },
                { label: "Life-critical (99.99%)", value: "MISSION_CRITICAL" }
            ]
        },
        e_commerce: {
            question: "What is acceptable downtime during business hours?",
            options: [
                { label: "Minutes acceptable", value: "STANDARD" },
                { label: "Seconds only", value: "HIGH" },
                { label: "Zero downtime required", value: "MISSION_CRITICAL" }
            ]
        }
    },
    data_sensitivity: {
        askable: true,
        infer_from: ["domain", "features"],
        default: {
            question: "What is the sensitivity level of the data stored?",
            options: [
                { label: "Public / Non-Sensitive", value: "PUBLIC", description: "Publicly accessible data with no confidentiality requirements" },
                { label: "Internal Business Data", value: "INTERNAL", description: "Proprietary business information requiring standard security measures" },
                { label: "PII / HIPAA / Highly Sensitive", value: "SENSITIVE", description: "Personal identifiable information or regulated data requiring encryption and compliance" }
            ]
        },
        law_firm: {
            question: "Legal data requires strict handling. What type of data is involved?",
            options: [
                { label: "Public filings only", value: "PUBLIC" },
                { label: "Client business documents", value: "CONFIDENTIAL" },
                { label: "Privileged attorney-client data", value: "PRIVILEGED" }
            ]
        },
        healthcare: {
            question: "What type of health information will be processed?",
            options: [
                { label: "Non-PHI operational data", value: "NON_PHI" },
                { label: "Limited PHI (names, dates)", value: "LIMITED_PHI" },
                { label: "Full PHI / Medical records", value: "FULL_PHI" }
            ]
        }
    },
    regulatory_exposure: {
        askable: true,
        infer_from: ["domain", "data_sensitivity"],
        default: {
            question: "Are there specific compliance or regulatory requirements?",
            options: [
                { label: "None / Standard", value: "NONE", description: "No specific regulatory requirements, standard security practices" },
                { label: "GDPR / CCPA", value: "GDPR_CCPA", description: "Data privacy regulations for EU/California, requires consent management and data rights" },
                { label: "HIPAA / PCI-DSS / GovCloud", value: "HIGH_COMPLIANCE", description: "Strict regulatory compliance for healthcare, payments, or government data" }
            ]
        },
        fintech: {
            question: "Which financial regulations apply?",
            options: [
                { label: "None (internal tool)", value: "NONE" },
                { label: "PCI-DSS for payments", value: "PCI_DSS" },
                { label: "SOC2 + PCI-DSS + AML", value: "FULL_FINANCIAL" }
            ]
        },
        law_firm: {
            question: "What legal data handling requirements apply?",
            options: [
                { label: "Standard confidentiality", value: "STANDARD_LEGAL" },
                { label: "Bar association rules + encryption", value: "BAR_RULES" },
                { label: "Court-mandated retention + audit trails", value: "COURT_MANDATED" }
            ]
        }
    },
    business_criticality: {
        askable: true,
        infer_from: ["user_facing", "domain"],
        default: {
            question: "What is the impact of a system failure?",
            options: [
                { label: "Low (Internal Tool)", value: "LOW", description: "Minimal impact, used internally, acceptable downtime without business disruption" },
                { label: "Medium (Customer Facing)", value: "MEDIUM", description: "Affects customer experience, temporary degradation tolerable but should be minimized" },
                { label: "High (Revenue Impacting)", value: "HIGH", description: "Direct revenue loss during downtime, critical to business operations" }
            ]
        },
        e_commerce: {
            when: (ctx) => ctx.features?.includes('checkout') || ctx.features?.includes('payments'),
            question: "How does downtime affect revenue directly?",
            options: [
                { label: "Minimal (backoffice)", value: "LOW" },
                { label: "Noticeable (catalog)", value: "MEDIUM" },
                { label: "Critical (checkout/payments)", value: "HIGH" }
            ]
        }
    },
    latency_sensitivity: {
        askable: false, // Infer by default
        infer_from: ["features", "domain", "ai_signals"],
        confidence_threshold: 0.6, // Ask only if AI confidence < 60%
        default: {
            question: "How sensitive is the application to latency?",
            options: [
                { label: "Low (Batch / Async)", value: "LOW" },
                { label: "Medium (Web Standard)", value: "MEDIUM" },
                { label: "High (Real-time / Trading)", value: "HIGH" }
            ]
        },
        fintech: {
            when: (ctx) => ctx.features?.includes('trading') || ctx.features?.includes('real_time'),
            question: "What are your latency requirements for transactions?",
            options: [
                { label: "Seconds acceptable", value: "LOW" },
                { label: "Sub-second required", value: "MEDIUM" },
                { label: "Millisecond-critical", value: "HIGH" }
            ]
        }
    },
    statefulness: {
        askable: false, // Infer by default from features
        infer_from: ["features", "domain", "ai_signals"],
        default: {
            question: "Does the application maintain persistent state?",
            options: [
                { label: "Stateless (Ephemeral)", value: "STATELESS" },
                { label: "Mixed State", value: "MIXED" },
                { label: "Stateful (Complex Sessions)", value: "STATEFUL" }
            ]
        }
    },
    data_durability: {
        askable: true,
        infer_from: ["regulatory_exposure", "domain"],
        default: {
            question: "What are the data retention and durability requirements?",
            options: [
                { label: "Standard Backup", value: "STANDARD", description: "Daily backups with short-term retention, suitable for most applications" },
                { label: "Long-term Retention", value: "LONG_TERM", description: "Extended retention periods (months to years) for audit and compliance purposes" },
                { label: "Immutable / Legal Hold", value: "IMMUTABLE", description: "Write-once-read-many storage, tamper-proof for regulatory and legal requirements" }
            ]
        },
        law_firm: {
            when: (ctx) => ctx.features?.includes('document_storage'),
            question: "Legal retention requirements?",
            options: [
                { label: "Standard 7-year retention", value: "STANDARD_7Y" },
                { label: "Case-based retention policies", value: "CASE_BASED" },
                { label: "Immutable litigation hold capable", value: "LITIGATION_HOLD" }
            ]
        }
    },
    cost_sensitivity: {
        askable: true,
        infer_from: ["domain", "scale"],
        default: {
            question: "What is the priority between cost and performance?",
            options: [
                { label: "Cost Optimize (Budget First)", value: "COST_FIRST", description: "Minimize infrastructure costs, prioritize efficient resource usage over peak performance" },
                { label: "Balanced", value: "BALANCED", description: "Balance between cost and performance, suitable for most production workloads" },
                { label: "Performance Max (Speed First)", value: "PERFORMANCE_FIRST", description: "Maximum performance and availability, cost is secondary to user experience" }
            ]
        }
    },
    observability_level: {
        askable: false, // Infer from domain/compliance
        infer_from: ["regulatory_exposure", "business_criticality"],
        default: {
            question: "What level of monitoring and auditing is required?",
            options: [
                { label: "Basic Metrics", value: "BASIC" },
                { label: "Standard Tracing", value: "STANDARD" },
                { label: "Full Audit Trails & Detailed Logs", value: "FULL_AUDIT" }
            ]
        },
        law_firm: {
            when: (ctx) => ctx.regulatory_exposure === 'COURT_MANDATED',
            question: "What audit trail depth is needed for compliance?",
            options: [
                { label: "Standard logging", value: "BASIC" },
                { label: "Access tracking", value: "STANDARD" },
                { label: "Full forensic audit trails", value: "FULL_AUDIT" }
            ]
        }
    }
};

/**
 * Score and prioritize which axes to ask about
 * Returns top N axes sorted by importance score
 */
function scoreAndPrioritizeAxes(missingAxes, intentSignals) {
    const domain = intentSignals?.primary_domain || 'default';
    const features = intentSignals?.features || [];
    const isUserFacing = intentSignals?.user_facing !== false;
    const hasPII = intentSignals?.data_sensitivity === 'pii' || intentSignals?.has_pii;

    const scores = {};

    missingAxes.forEach(axis => {
        let score = 0;

        // Domain weight
        const domainWeights = AXIS_WEIGHTS.domain_weights[domain] || {};
        score += domainWeights[axis] || 0;

        // Feature weight
        features.forEach(feature => {
            const featureWeights = AXIS_WEIGHTS.feature_weights[feature.toLowerCase()] || {};
            score += featureWeights[axis] || 0;
        });

        // Risk weight
        if (isUserFacing) {
            score += AXIS_WEIGHTS.risk_weights.user_facing[axis] || 0;
        }
        if (hasPII) {
            score += AXIS_WEIGHTS.risk_weights.pii_involved[axis] || 0;
        }

        // Irreversibility weight
        score += AXIS_WEIGHTS.irreversibility_weights[axis] || 0;

        // 🔒 THREE-STATE EXCLUSION REFINEMENT
        const excluded = intentSignals?.excluded_features || [];
        if (excluded.includes('database') && (axis === 'data_durability' || axis === 'statefulness')) {
            score -= 10; // Drastically deprioritize
        }
        if (excluded.includes('payments') && axis === 'regulatory_exposure') {
            score -= 5;
        }

        scores[axis] = score;
    });

    // Sort by score descending
    return Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .map(entry => entry[0]);
}

/**
 * Get the most specific question template for an axis
 * Now handles: askable flags, feature guards, label/value normalization
 * @param axis - The axis to get template for
 * @param domain - The detected domain
 * @param context - Additional context for feature guards
 * @returns {object|null} - Template with question and options (labels for UI)
 */
function getQuestionTemplate(axis, domain, context = {}) {
    const axisConfig = QUESTION_TEMPLATES[axis];
    if (!axisConfig) return null;

    // Check if axis is askable (some are inferred by default)
    if (axisConfig.askable === false) {
        // Only ask if AI confidence is low
        const confidence = context.ai_confidence || 1.0;
        const threshold = axisConfig.confidence_threshold || 0.6;
        if (confidence >= threshold) {
            console.log(`Axis ${axis} is inferred (askable=false, confidence=${confidence})`);
            return null;
        }
    }

    // 🔒 THREE-STATE GUARD: Do not ask about data durability if no database
    const excluded = context.excluded_features || [];
    if (excluded.includes('database') && axis === 'data_durability') {
        console.log(`Skipping ${axis} because database is excluded`);
        return null;
    }

    // Try domain-specific template first
    let template = axisConfig[domain];

    // Check feature guard if domain template has a `when` condition
    if (template?.when && typeof template.when === 'function') {
        if (!template.when(context)) {
            console.log(`Feature guard failed for ${axis}/${domain}, using default`);
            template = axisConfig.default;
        }
    }

    // Fallback to default
    if (!template) {
        template = axisConfig.default;
    }

    if (!template) return null;

    // Return processed template with labels extracted for UI
    return {
        question: template.question,
        // Send full option objects (with label, value, description) to frontend
        options: template.options,
        // Store the full options for value extraction
        _optionsWithValues: template.options
    };
}

/**
 * Extract canonical value from user's selected label
 */
function getCanonicalValue(axis, domain, selectedLabel) {
    const axisConfig = QUESTION_TEMPLATES[axis];
    if (!axisConfig) return selectedLabel;

    const template = axisConfig[domain] || axisConfig.default;
    if (!template) return selectedLabel;

    const option = template.options.find(opt =>
        (typeof opt === 'object' ? opt.label : opt) === selectedLabel
    );

    return typeof option === 'object' ? option.value : selectedLabel;
}

/**
 * Get category for a service class (for UI grouping)
 * Covers all 21 provider-agnostic service classes
 */
function getCategoryForService(serviceClass) {
    const CATEGORY_MAP = {
        // 1️⃣ Compute (4 variants)
        compute_container: 'compute',
        compute_serverless: 'compute',
        compute_vm: 'compute',
        compute_static: 'compute',
        // 2️⃣ Data & State
        relational_database: 'data',
        nosql_database: 'data',
        cache: 'data',
        object_storage: 'storage',
        block_storage: 'storage',
        // 3️⃣ Traffic & Integration
        load_balancer: 'traffic',
        api_gateway: 'traffic',
        messaging_queue: 'messaging',
        event_bus: 'messaging',
        search_engine: 'search',
        cdn: 'traffic',
        // 4️⃣ Platform Essentials
        networking: 'networking',
        identity_auth: 'security',
        dns: 'traffic',
        // 5️⃣ Operations
        monitoring: 'observability',
        logging: 'observability',
        secrets_management: 'security'
    };
    return CATEGORY_MAP[serviceClass] || 'other';
}

/**
 * @route POST /api/workflow/analyze
 * @desc Monopoly-Grade Architecture Workload Pipeline (15 Layers)
 *       STRICT 2-STEP EXECUTION CONTRACT
 */
router.post('/analyze', authMiddleware, async (req, res) => {
    try {
        const { userInput, conversationHistory, input_type, ai_snapshot } = req.body;

        // Validation based on input_type
        if (!input_type) {
            // Legacy support: treat as DESCRIPTION if no type specified
            console.log("--- LEGACY MODE: No input_type specified, treating as DESCRIPTION ---");
        }

        console.log("--- WORKFLOW START ---");
        console.log(`Input Type: ${input_type || 'DESCRIPTION (default)'}`);

        // === STEP 1: INTENT ANALYSIS ===
        let step1Result;

        if (req.body.approvedIntent) {
            // User confirmed intent, proceed to Step 2
            console.log("--- USER CONFIRMED INTENT, PROCEEDING TO STEP 2 ---");
            step1Result = req.body.approvedIntent;
        } else if (input_type === 'AXIS_ANSWER' && ai_snapshot) {
            // User answered an MCQ - DO NOT CALL AI
            // Reuse the frozen AI snapshot
            console.log("--- AXIS ANSWER RECEIVED (NO AI CALL) ---");
            step1Result = ai_snapshot;
        } else {
            // DESCRIPTION input - Call AI ONCE
            if (!userInput) return res.status(400).json({ msg: "User input required" });

            // --- STEP 0: PREPROCESSING (NON-AI) ---
            const normalizedInput = userInput.toLowerCase();
            const manualExclusions = [];
            if (normalizedInput.includes('no database') || normalizedInput.includes('without database') || normalizedInput.includes('database excluded')) {
                manualExclusions.push('database');
            }
            if (normalizedInput.includes('no payments') || normalizedInput.includes('without payments')) {
                manualExclusions.push('payments');
            }
            if (normalizedInput.includes('no auth') || normalizedInput.includes('without auth')) {
                manualExclusions.push('auth');
            }

            console.log("--- STEP 1: AI Intent Normalization (ONCE) ---");
            const rawStep1 = await aiService.normalizeIntent(userInput, conversationHistory || []);

            // --- STEP 1.5: FEATURE RESOLUTION (DETERMINISTIC) ---
            const resolvedFeatures = {};
            const explicitExclusions = [...new Set([...(rawStep1.explicit_exclusions || []), ...manualExclusions])];
            const explicitFeatures = rawStep1.explicit_features || {};
            const inferredFeatures = rawStep1.inferred_features || {};

            TRACKED_FEATURES.forEach(feature => {
                // Priority 1: Explicit Exclusions
                if (explicitExclusions.includes(feature) || explicitExclusions.includes(feature.split('_')[0])) {
                    resolvedFeatures[feature] = false;
                }
                // Priority 2: Explicit Features
                else if (explicitFeatures[feature] === true) {
                    resolvedFeatures[feature] = true;
                }
                // Priority 3: Inferred (Threshold 0.6)
                else if (inferredFeatures[feature] && inferredFeatures[feature].confidence >= 0.6) {
                    resolvedFeatures[feature] = inferredFeatures[feature].value;
                }
                // Default: Unknown
                else {
                    resolvedFeatures[feature] = 'unknown';
                }
            });

            // Special handling for 'database' (common exclusion target)
            if (explicitExclusions.includes('database')) {
                resolvedFeatures['database'] = false;
            } else if (explicitFeatures['database']) {
                resolvedFeatures['database'] = true;
            }

            step1Result = {
                ...rawStep1,
                feature_signals: resolvedFeatures, // Override with resolved ones
                explicit_exclusions: explicitExclusions
            };
            console.log("AI Snapshot Created & Resolved");
            console.log("Resolved Features:", JSON.stringify(resolvedFeatures));
        }

        // AMBIGUITY CHECK (Backend Logic Step 1)
        // Check for "missing_decision_axes"

        let missingAxes = step1Result.missing_decision_axes || [];

        // Filter out axes that might have been answered in conversation history if AI didn't catch them?
        // Actually, let's trust the AI's "missing_decision_axes" output if we are feeding it history.
        // But if this is the FIRST run (no history), the list is full.

        // Store conversation history for filtering
        const storedHistory = conversationHistory || [];

        // === 3-LAYER QUESTION SELECTION ===
        // Layer 1: Fixed axes (DECISION_AXES array)
        // Layer 2: Importance scoring based on domain/features/risk
        // Layer 3: Context-specific question templates

        // Get domain from intent for scoring
        const domain = step1Result.intent_classification?.primary_domain || 'default';
        const features = step1Result.feature_signals || {};
        const confirmedFeatures = Object.keys(features).filter(k => features[k] === true);
        const excludedFeatures = Object.keys(features).filter(k => features[k] === false);
        const unknownFeatures = Object.keys(features).filter(k => features[k] === 'unknown');

        // FILTER: Remove axes already asked in conversation history
        const filteredMissingAxes = missingAxes.filter(axis => {
            // Get the template for this axis
            const template = getQuestionTemplate(axis, domain);
            if (!template) return false;

            // Check if any question for this axis was already asked
            const alreadyAsked = storedHistory.some(msg =>
                msg.role === 'assistant' &&
                (msg.content.includes(template.question) ||
                    (QUESTION_TEMPLATES[axis] && Object.values(QUESTION_TEMPLATES[axis]).some(t =>
                        t && t.question && msg.content.includes(t.question)
                    )))
            );
            return !alreadyAsked;
        });
        // Build context for feature guards and askable logic
        const questionContext = {
            domain: domain,
            features: confirmedFeatures,
            excluded_features: excludedFeatures,
            unknown_features: unknownFeatures,
            user_facing: step1Result.intent_classification?.user_facing,
            data_sensitivity: step1Result.semantic_signals?.data_sensitivity,
            has_pii: step1Result.risk_domains?.includes('pii'),
            regulatory_exposure: step1Result.intent_classification?.regulatory_exposure,
            ai_confidence: step1Result.confidence || 0.8
        };

        // SCORE AND PRIORITIZE using Layer 2 weights
        const prioritizedAxes = scoreAndPrioritizeAxes(filteredMissingAxes, {
            primary_domain: domain,
            features: confirmedFeatures,
            excluded_features: excludedFeatures,
            user_facing: step1Result.intent_classification?.user_facing,
            data_sensitivity: step1Result.semantic_signals?.data_sensitivity,
            has_pii: step1Result.risk_domains?.includes('pii')
        });

        console.log(`Question Selection: Domain=${domain}, Prioritized=${prioritizedAxes.slice(0, 3).join(', ')}`);

        // LIMIT: Ask at most 3 questions TOTAL (across history)
        const questionsAskedCount = storedHistory.filter(m => m.role === 'assistant').length;

        if (prioritizedAxes.length > 0 && questionsAskedCount < 3) {
            // Pick the HIGHEST SCORED axis (first in prioritized list)
            const nextAxis = prioritizedAxes[0];

            // Get context-specific template (Layer 3) with feature guards
            const template = getQuestionTemplate(nextAxis, domain, questionContext);

            if (template) {
                console.log(`Asking about ${nextAxis} (domain: ${domain}): "${template.question}"`);
                return res.json({
                    step: 'refine_requirements',
                    data: {
                        status: 'NEEDS_CLARIFICATION',
                        clarifying_question: template.question,
                        suggested_options: template.options, // Labels for UI
                        axis: nextAxis, // Include axis name for provenance tracking
                        extracted_data: step1Result.intent_classification,
                        full_analysis: step1Result
                    }
                });
            } else {
                console.warn(`Missing Template or axis not askable: ${nextAxis}`);
                // If config missing or askable=false, skip it and try next
                // Recursively try next axis
                const remainingAxes = prioritizedAxes.slice(1);
                for (const axis of remainingAxes) {
                    const fallbackTemplate = getQuestionTemplate(axis, domain, questionContext);
                    if (fallbackTemplate) {
                        console.log(`Fallback: Asking about ${axis} (domain: ${domain})`);
                        return res.json({
                            step: 'refine_requirements',
                            data: {
                                status: 'NEEDS_CLARIFICATION',
                                clarifying_question: fallbackTemplate.question,
                                suggested_options: fallbackTemplate.options,
                                axis: axis,
                                extracted_data: step1Result.intent_classification,
                                full_analysis: step1Result
                            }
                        });
                    }
                }
            }
        }


        // --- STEP 1: CONFIRMATION GATE (MANDATORY per Step1.txt) ---
        // If we get here, either no ambiguities exist, or we hit the 3-question limit.
        // We MUST ask the user to confirm the intent before generating the spec.

        if (!req.body.approvedIntent) {
            console.log("--- WAITING FOR USER CONFIRMATION ---");
            return res.json({
                step: 'confirm_intent',
                data: {
                    status: 'WAITING_FOR_CONFIRMATION',
                    intent: step1Result.intent_classification,
                    semantic_signals: step1Result.semantic_signals,
                    features: step1Result.feature_signals,
                    risk_domains: step1Result.risk_domains,
                    exclusions: step1Result.explicit_exclusions, // Add explicit exclusions here
                    full_analysis: step1Result // Send full result to be sent back as 'approvedIntent'
                }
            });
        }

        // If approvedIntent IS present (req.body.approvedIntent), we fall through to Step 2.
        step1Result = req.body.approvedIntent; // Ensure we use the approved version format

        // === STEP 2: INFRA SPEC GENERATION (PATTERN-BASED CONSTRUCTION) ===
        console.log("--- STEP 2: Starting Pattern-Based InfraSpec Construction ---");

        // 🔒 PATTERN RESOLUTION: Deterministic selection based on intent signals
        // AI is NOT used for pattern/service selection - this is rule-based
        let patternResolution;
        try {
            const resolvedArchitecture = patternResolver.resolveArchitecture(step1Result);
            patternResolution = resolvedArchitecture.canonicalArchitecture;
        } catch (patternError) {
            console.error("Pattern Resolution Error:", patternError);
            return res.status(500).json({
                error: 'Pattern resolution failed',
                message: patternError.message
            });
        }
        
        if (!patternResolution || !patternResolution.pattern) {
            console.error("Pattern Resolution failed - no pattern returned");
            return res.status(500).json({
                error: 'Pattern resolution failed',
                message: 'Could not determine appropriate architecture pattern'
            });
        }
        
        const fixedPattern = patternResolution.pattern;
        console.log(`Pattern Resolved: ${fixedPattern} (${patternResolution.pattern_name})`);
        console.log(`Services Selected: ${patternResolution.services.map(s => s.name).join(', ')}`);

        // 🔒 FIX 3: AI MODE BASED ON PATTERN
        // For STATIC_WEB_HOSTING: Skip AI architecture analysis entirely
        // For other patterns: AI explains but CANNOT change pattern
        let step2Result;
        const patternConfig = ARCHITECTURE_PATTERNS[fixedPattern] || {};

        if (fixedPattern === 'STATIC_WEB_HOSTING' || patternConfig.ai_mode === 'EXPLAIN_ONLY') {
            // 🔒 STATIC: DO NOT ask AI for architecture
            console.log('[FIX 3] STATIC_WEB_HOSTING detected - SKIPPING AI architecture analysis');
            step2Result = {
                architecture_pattern: 'STATIC_WEB_HOSTING',
                project_name: "Static Website",
                project_summary: "Simple static website with CDN delivery",
                component_roles: {
                    networking: { isolation_required: false },
                    compute: null,  // No compute for static
                    data: null,     // No database for static
                    cache: null,    // No cache for static
                    observability: { importance: "low" }
                },
                risk_review: { security: [], availability: [], cost: [] },
                review_scores: { architecture_soundness: 100, security_posture: 100, operational_readiness: 95 },
                explanations: { key_decision: "Static hosting with CDN for optimal performance and minimal cost" }
            };
        } else {
            // Non-static: AI can explain but NOT override pattern
            step2Result = await aiService.generateConstrainedProposal(step1Result);

            // 🔒 FIX 3: DISCARD any AI output that tries to override pattern
            if (step2Result.architecture_pattern && step2Result.architecture_pattern !== fixedPattern) {
                console.log(`[FIX 3] AI tried to change pattern from ${fixedPattern} to ${step2Result.architecture_pattern} - DISCARDED`);
                step2Result.architecture_pattern = fixedPattern;
                step2Result.pattern_override_blocked = true;
            }
        }
        console.log("AI Architecture Analysis Complete (scoring/explanation only)");

        // === PATTERN-BASED INFRASPEC CONSTRUCTION ===

        // 1️⃣ Identity & Metadata
        const identity = {
            system_name: step2Result.project_name || "CloudiverseApp",
            environment: "production",
            version: "1.0",
            generated_by: "cloudiverse_pattern_engine",
            generated_at: new Date().toISOString(),
            pattern: fixedPattern,
            pattern_name: patternResolution.pattern_name
        };

        // 2️⃣ Locked Intent (copied, never modified)
        const lockedIntent = { ...step1Result };

        // 3️⃣ Architecture Skeleton - PATTERN-DRIVEN SERVICE SELECTION
        // The pattern resolver determines exactly which services are needed
        
        // Map canonical service names to expected service class names
        const canonicalToServiceClassMap = {
            'relational_db': 'relational_database',
            'message_queue': 'message_queue',  // 🔥 FIXED: Keep as message_queue (not messaging_queue)
            'messaging_queue': 'message_queue',  // 🔥 ALIAS: Normalize to message_queue
            'websocket_gateway': 'event_bus',
            'payment_gateway': 'payment_gateway',  // 🔥 FIXED: Keep as payment_gateway
            'ml_inference': 'compute_serverless', // Closest match
            'object_storage': 'object_storage',
            'cache': 'cache',
            'api_gateway': 'api_gateway',
            'authentication': 'identity_auth',
            'identity_auth': 'identity_auth',  // 🔥 ADDED: Direct mapping
            'compute': 'compute_vm', // Default compute mapping
            'app_compute': 'app_compute',  // 🔥 ADDED: Direct mapping
            'serverless_compute': 'compute_serverless',  // 🔥 ADDED: Map to compute_serverless
            'load_balancer': 'load_balancer',
            'monitoring': 'monitoring',
            'logging': 'logging',
            'cdn': 'cdn'  // 🔥 ADDED: Direct mapping
        };
        
        const selectedServiceClasses = new Set(patternResolution.services.map(s => {
            // Map canonical name to expected service class name
            return canonicalToServiceClassMap[s.name] || s.name;
        }));
        const requiredServiceClasses = new Set(); // Not available in canonical architecture
        const optionalServiceClasses = new Set(); // Not available in canonical architecture
        const forbiddenServiceClasses = new Set(); // Not available in canonical architecture

        console.log(`Pattern ${fixedPattern}: ${selectedServiceClasses.size} services selected, ${forbiddenServiceClasses.size} forbidden`);

        // Build service required flags from pattern, not from AI guesses
        const isContainerized = selectedServiceClasses.has('compute_container');
        const isServerless = selectedServiceClasses.has('compute_serverless');
        const isVM = selectedServiceClasses.has('compute_vm');
        const isStatic = selectedServiceClasses.has('compute_static');

        // SERVICE_CLASSES now driven by pattern resolution, not AI guesses
        // Each service is marked required if the pattern resolver included it
        const SERVICE_CLASS_DESCRIPTIONS = {
            // Compute
            compute_container: "Containerized application runtime (K8s, ECS, etc.)",
            compute_serverless: "Serverless/FaaS execution (Lambda, Cloud Functions)",
            compute_vm: "Virtual machine based compute (EC2, Compute Engine)",
            compute_static: "Static site hosting (S3+CloudFront, Netlify)",
            // Data & State
            relational_database: "SQL/Relational data store (RDS, Cloud SQL)",
            nosql_database: "NoSQL/Document data store (DynamoDB, MongoDB)",
            cache: "In-memory caching layer (Redis, Memcached)",
            object_storage: "Blob/Object storage (S3, GCS)",
            block_storage: "Persistent block volumes (EBS, Persistent Disk)",
            // Traffic & Integration
            load_balancer: "Traffic distribution (ALB, Cloud Load Balancer)",
            api_gateway: "API management and routing (API Gateway)",
            messaging_queue: "Message queue for async processing (SQS, Cloud Tasks)",
            event_bus: "Event-driven architecture bus (EventBridge, Pub/Sub)",
            search_engine: "Full-text search engine (Elasticsearch, Algolia)",
            cdn: "Content delivery network (CloudFront, Cloud CDN)",
            // Platform Essentials
            networking: "VPC / VNet, subnets, security groups, NAT",
            identity_auth: "Identity and authentication (Cognito, Firebase Auth)",
            dns: "Domain routing (Route53, Cloud DNS)",
            // Operations
            monitoring: "Metrics and alerting (CloudWatch, Stackdriver)",
            logging: "Centralized logging (CloudWatch Logs, Cloud Logging)",
            secrets_management: "Secrets and key management (Secrets Manager, Vault)"
        };

        // Build SERVICE_CLASSES from pattern resolver output
        const SERVICE_CLASSES = {};
        for (const [name, description] of Object.entries(SERVICE_CLASS_DESCRIPTIONS)) {
            SERVICE_CLASSES[name] = {
                required: selectedServiceClasses.has(name),
                description: description,
                pattern_required: true, // All services from canonical architecture are required
                pattern_optional: false,
                pattern_forbidden: false
            };
        }

        // Build skeleton from pattern-resolved service classes
        const skeleton = {
            pattern: patternResolution.pattern,
            pattern_name: patternResolution.pattern_name,
            cost_range: patternResolution.cost_range || { min: 0, max: 0 },
            required_services: patternResolution.services.map(service => ({
                service_class: canonicalToServiceClassMap[service.name] || service.name, // Map to expected service class name
                description: service.description,
                pattern_required: true
            })),
            optional_services: [],
            forbidden_services: []
        };

        console.log(`Pattern ${patternResolution.pattern}: ${skeleton.required_services.length} required, ${skeleton.optional_services.length} optional, ${skeleton.forbidden_services.length} forbidden`);

        // 4️⃣ Logical Components (AI-informed, backend-final)
        // Detailed config for each of the 20 service classes
        const components = {
            // Compute variants (only one is active)
            compute_container: SERVICE_CLASSES.compute_container.required ? {
                orchestrator: "kubernetes",
                scaling_driver: step2Result.component_roles?.compute?.scaling_driver || "cpu_utilization",
                min_replicas: 2,
                max_replicas: 10
            } : null,
            compute_serverless: SERVICE_CLASSES.compute_serverless.required ? {
                memory: "512MB",
                timeout: "30s",
                concurrency: 100
            } : null,
            compute_vm: SERVICE_CLASSES.compute_vm.required ? {
                size: "medium",
                auto_scaling: true,
                min_instances: 2
            } : null,
            compute_static: SERVICE_CLASSES.compute_static.required ? {
                framework: "spa",
                build_output: "dist"
            } : null,

            // Data layer
            relational_database: SERVICE_CLASSES.relational_database.required ? {
                engine: "postgresql",
                consistency: step2Result.component_roles?.data?.consistency || "strong",
                write_intensity: step2Result.component_roles?.data?.write_intensity || "medium",
                multi_az: true
            } : null,
            nosql_database: SERVICE_CLASSES.nosql_database.required ? {
                engine: "document",
                consistency: "eventual",
                partition_key: "required"
            } : null,
            cache: SERVICE_CLASSES.cache.required ? {
                engine: "redis",
                purpose: step2Result.component_roles?.cache?.purpose || "read_acceleration",
                eviction_policy: "lru",
                cluster_mode: true
            } : null,

            // Traffic management
            load_balancer: SERVICE_CLASSES.load_balancer.required ? {
                type: "application",
                ssl_termination: true,
                health_check: true
            } : null,
            api_gateway: SERVICE_CLASSES.api_gateway.required ? {
                throttling: true,
                authentication: true,
                rate_limiting: true
            } : null,
            cdn: SERVICE_CLASSES.cdn.required ? {
                cache_behavior: "optimized",
                ssl: true,
                compression: true
            } : null,
            dns: {
                hosted_zone: true,
                health_checks: true
            },

            // Storage
            object_storage: SERVICE_CLASSES.object_storage.required ? {
                versioning: true,
                encryption: true,
                lifecycle_rules: true
            } : null,
            block_storage: SERVICE_CLASSES.block_storage.required ? {
                type: "ssd",
                iops: "standard",
                encrypted: true
            } : null,

            messaging_queue: SERVICE_CLASSES.messaging_queue.required ? {
                delivery_guarantee: "at_least_once",
                dead_letter_queue: true
            } : null,
            event_bus: SERVICE_CLASSES.event_bus.required ? {
                schema_registry: true,
                retention: "7_days"
            } : null,
            search_engine: SERVICE_CLASSES.search_engine.required ? {
                type: "full_text",
                replicas: 2,
                shards: 5
            } : null,

            // Identity & Security
            identity_auth: SERVICE_CLASSES.identity_auth.required ? {
                mfa_support: true,
                social_login: false,
                jwt_tokens: true
            } : null,
            secrets_management: SERVICE_CLASSES.secrets_management.required ? {
                rotation: true,
                encryption: "kms"
            } : null,

            // Networking
            networking: {
                vpc: true,
                private_subnets: true,
                nat_gateway: true,
                security_groups: true
            },

            // Observability
            monitoring: {
                metrics_retention: "30_days",
                alerting: true,
                dashboards: true
            },
            logging: {
                retention: "90_days",
                structured: true,
                searchable: true
            }
        };

        // Filter out null components
        const activeComponents = Object.fromEntries(
            Object.entries(components).filter(([_, v]) => v !== null)
        );

        // 5️⃣ Networking Model
        const networking = {
            public_entry: true,
            private_application: true,
            database_public_access: false
        };

        // 6️⃣ Non-Functional Requirements (NFRs)
        const nfr = {
            security: {
                encryption_at_rest: true,
                encryption_in_transit: true
            },
            reliability: {
                availability_target: "99.9"
            },
            scalability: {
                horizontal_scaling: true
            }
        };

        // 7️⃣ Constraints & Policies (HARD RULES)
        const constraints = {
            public_database_access: "forbidden",
            backups_required: true,
            minimum_backup_retention_days: 7
        };

        // 8️⃣ Decision Provenance (CRITICAL)
        const decisionTrace = [
            { decision: "network_isolation", reason: "security_requirement", source: "backend_rule" },
            { decision: "encryption_enabled", reason: "data_sensitivity", source: "backend_rule" }
        ];

        // Add AI-informed decisions (backend decides, AI informs)
        if (components.cache?.recommended) {
            decisionTrace.push({ decision: "cache_enabled", reason: "read_heavy_workload", source: "backend_rule (ai_informed)" });
        }
        if (components.data?.database_type === "relational") {
            decisionTrace.push({ decision: "relational_database", reason: "data_consistency", source: "backend_rule (ai_informed)" });
        }

        // 9️⃣ Scores & Risk Summary (AI provides category scores, BACKEND computes overall)

        // Build intent provenance (which axes were user-provided vs defaulted)
        const answeredAxes = (conversationHistory || [])
            .filter(msg => msg.role === 'user' && msg.content)
            .map(msg => msg.content);

        const provenance = {
            user_provided_axes: DECISION_AXES.filter(axis =>
                answeredAxes.some(answer => answer.toLowerCase().includes(axis.toLowerCase()))
            ),
            defaulted_axes: DECISION_AXES.filter(axis =>
                !answeredAxes.some(answer => answer.toLowerCase().includes(axis.toLowerCase()))
            )
        };

        // Call AI Scoring with provenance (separate from architecture analysis)
        const scoringResult = await aiService.scoreInfraSpec(step1Result, {
            components,
            nfr,
            networking,
            constraints,
            skeleton
        }, provenance);
        console.log("AI Scoring Complete");

        // BACKEND computes final overall score (weighted average)
        let categoryScores = scoringResult.category_scores || {};

        // === BACKEND RELIABILITY CALIBRATION ===
        // If HA is required (user-facing) but redundancy is only implicit, cap reliability at 75
        const isUserFacing = step1Result.intent_classification?.user_facing !== false;
        const hasExplicitRedundancy = nfr.reliability?.multi_az === true ||
            skeleton.resilience?.includes('multi_az') ||
            skeleton.resilience?.includes('redundancy');

        if (isUserFacing && !hasExplicitRedundancy) {
            const pattern = skeleton?.pattern || step2Result.architecture_pattern;
            const currentReliability = categoryScores.reliability || 80;

            if (pattern === 'STATIC_WEB_HOSTING') {
                // Static workloads have implicit high availability via CDN/Object Storage
                categoryScores.reliability = Math.min(currentReliability, 92);
                console.log(`BACKEND CALIBRATION: Reliability for static workload adjusted to ${categoryScores.reliability}`);
            } else if (currentReliability > 75) {
                console.log(`BACKEND CALIBRATION: Reliability capped at 75 (was ${currentReliability}) - HA required but redundancy implicit`);
                categoryScores.reliability = 75;
            }
        }

        const weights = {
            architecture_soundness: 0.30,
            security_posture: 0.25,
            reliability: 0.25,
            operational_readiness: 0.20
        };

        const weightedSum =
            (categoryScores.architecture_soundness || 75) * weights.architecture_soundness +
            (categoryScores.security_posture || 75) * weights.security_posture +
            (categoryScores.reliability || 75) * weights.reliability +
            (categoryScores.operational_readiness || 75) * weights.operational_readiness;

        const overallScore = Math.round(weightedSum);

        const scores = {
            overall: overallScore,
            security: categoryScores.security_posture || 75,
            reliability: categoryScores.reliability || 75,
            architecture: categoryScores.architecture_soundness || 75,
            operational_readiness: categoryScores.operational_readiness || 75,
            cost_risk: "medium",
            // Include AI review data
            risk_alignment: scoringResult.risk_alignment || {},
            strengths: scoringResult.strengths || [],
            weaknesses: scoringResult.weaknesses || [],
            confidence_statement: scoringResult.confidence_statement || ""
        };

        // 🔟 User-Facing Explanation Blocks
        const explanations = Object.entries(step2Result.explanations || {}).map(([key, value]) =>
            `${key.replace(/_/g, ' ')}: ${value}`
        );

        // Add default explanations if empty
        if (explanations.length === 0) {
            explanations.push(
                "High availability enforced due to production requirements",
                "Encryption enforced for data security",
                "Network isolation applied for security"
            );
        }

        // === CONSTRUCT FINAL INFRASPEC ===
        const infraSpec = {
            // Tier 1 Data (Default View)
            project_name: step2Result.project_name || identity.system_name,
            project_summary: step2Result.project_summary || "Cloud-native infrastructure specification",
            architecture_pattern: step2Result.architecture_pattern || "three_tier_web",
            scores: scores,
            explanations: explanations,
            risk_review: step2Result.risk_review || { security: [], availability: [], cost: [] },

            // 🔒 FIX 1: STORE CANONICAL ARCHITECTURE (IMMUTABLE)
            // This becomes the single source of truth for all downstream steps
            canonical_architecture: patternResolution,

            // Tier 2 Data (Engineering View)
            components: activeComponents,
            service_classes: skeleton, // 15 provider-agnostic service classes
            nfr: nfr,
            networking: networking,

            // Tier 3 Data (Advanced/Audit)
            identity: identity,
            locked_intent: lockedIntent,
            constraints: constraints,
            decision_trace: decisionTrace,

            // Modules derived from required service classes
            modules: skeleton.required_services.map(service => ({
                service_class: service.service_class,
                category: getCategoryForService(service.service_class),
                service_name: service.service_class.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                description: service.description,
                required: true,
                specs: activeComponents[service.service_class] || {}
            })),

            // Summary counts
            service_summary: {
                total_services: 15,
                required: skeleton.required_services.length,
                optional: skeleton.optional_services.length
            },

            compliance: { level: "Standard" },
            assumptions: {
                traffic_tier: "Medium",
                workload_type: step1Result.intent_classification?.workload_type || "web_application"
            }
        };

        console.log(`InfraSpec Complete. Required Services: ${skeleton.required_services.length}/15`);

        // ═══════════════════════════════════════════════════════════════════════════
        // CANONICAL VALIDATION & ENFORCEMENT (CRITICAL)
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Step 1: Validate and fix canonical architecture
        try {
            const validated = canonicalValidator.validateAndFixCanonicalArchitecture(
                infraSpec.canonical_architecture,
                step1Result.intent_classification
            );
            infraSpec.canonical_architecture = validated.canonicalArchitecture;
            console.log('[VALIDATOR] ✓ Canonical architecture validated and fixed');
        } catch (validationError) {
            console.error('[VALIDATOR] ✗ Validation failed:', validationError.message);
            return res.status(400).json({
                error: 'Architecture validation failed',
                message: validationError.message,
                details: validationError.stack
            });
        }

        // 🔒 FIX 1 & 2: Integrity Guard
        // Enforce hard constraints on the finalized spec
        integrityService.sanitizeInfraSpec(step2Result.architecture_pattern, infraSpec);
        integrityService.enforcePatternMinimums(step2Result.architecture_pattern, infraSpec);

        res.json({
            step: 'infra_spec_generated',
            data: infraSpec
        });

    } catch (error) {
        console.error("Workflow Error:", error);
        res.status(500).send('Server Error in Workflow');
    }
});

// =====================================================
// STEP 2.5: USAGE PREDICTION (Layer A)
// =====================================================

/**
 * @route POST /api/workflow/predict-usage
 * @desc Get realistic usage range estimates from AI
 */
router.post('/predict-usage', authMiddleware, async (req, res) => {
    try {
        const { intent, infraSpec } = req.body;

        if (!intent) {
            return res.status(400).json({ error: 'Missing intent object' });
        }

        console.log("--- STEP 2.5: usage-prediction ---");
        const usagePrediction = await aiService.predictUsage(intent, infraSpec || {});

        // 🔒 FIX 3: Usage Integrity
        if (usagePrediction.usage_profile) {
            usagePrediction.usage_profile = integrityService.normalizeUsage(usagePrediction.usage_profile, intent);
        }

        res.json({
            step: 'usage_prediction',
            data: usagePrediction
        });
    } catch (error) {
        console.error("Usage Prediction Error:", error);
        res.status(500).json({ error: 'Failed to predict usage' });
    }
});

/**
 * @route POST /api/workflow/cost-analysis
 * @desc Step 3: Generate cost estimates and cloud recommendations
 * @access Private
 * 
 * Core Principles:
 * 1. Backend decides what services are used
 * 2. Backend decides how big they are
 * 3. Infracost decides how much they cost
 * 4. AI only explains decisions
 * 5. User only approves recommendations
 */
router.post('/cost-analysis', authMiddleware, async (req, res) => {
    try {
        const { infraSpec, intent, cost_profile, usage_profile } = req.body;

        console.log("--- STEP 3: Cost Analysis Started ---");
        console.log(`Cost Profile: ${cost_profile || 'COST_EFFECTIVE'}`);

        // BUG #1: Prevent Step 3 loop
        if (req.body.step3_completed) {
            console.log("STEP 3 already completed — skipping to prevent state overwrite");
            return res.json({ status: 'SKIPPED', message: 'Step 3 already completed' });
        }

        // Validate inputs
        if (!infraSpec || !intent) {
            return res.status(400).json({
                error: 'Missing required fields: infraSpec and intent'
            });
        }

        const costProfile = cost_profile || 'COST_EFFECTIVE';
        let costAnalysis;
        let scenarios = null;

        // 🔒 INFRASPEC VALIDATION (Problem 1 Fix)
        // InfraSpec must have services before cost analysis can proceed
        const requiredServices = infraSpec.service_classes?.required_services || [];
        if (requiredServices.length === 0) {
            console.error('[VALIDATION] InfraSpec has 0 services - cannot proceed with cost analysis');
            return res.status(400).json({
                error: 'Invalid InfraSpec',
                message: 'No services selected. Pattern resolution may have failed.',
                analysis_status: 'FAILED',
                recommended: null,
                cost_range: { min: 0, max: 0, formatted: '$0 - $0/month' }
            });
        }
        console.log(`[VALIDATION] InfraSpec has ${requiredServices.length} services - proceeding`);

        // LAYER B: If usage_profile is provided, convert ranges to scenarios and calculate range
        if (usage_profile && usage_profile.monthly_users) {
            console.log("Using Usage Profile for Realistic Estimation");

            // Convert AI ranges (min/max) to scenarios
            // Convert AI ranges (min/max) to scenarios
            const profileScenarios = {
                low: {
                    monthly_users: usage_profile.monthly_users.min,
                    requests_per_user: usage_profile.requests_per_user.min,
                    peak_concurrency: usage_profile.peak_concurrency.min,
                    data_transfer_gb: usage_profile.data_transfer_gb.min,
                    data_storage_gb: usage_profile.data_storage_gb.min
                },
                expected: {
                    monthly_users: Math.round((usage_profile.monthly_users.min + usage_profile.monthly_users.max) / 2),
                    requests_per_user: Math.round((usage_profile.requests_per_user.min + usage_profile.requests_per_user.max) / 2),
                    peak_concurrency: Math.round((usage_profile.peak_concurrency.min + usage_profile.peak_concurrency.max) / 2),
                    data_transfer_gb: Math.round((usage_profile.data_transfer_gb.min + usage_profile.data_transfer_gb.max) / 2),
                    data_storage_gb: Math.round((usage_profile.data_storage_gb.min + usage_profile.data_storage_gb.max) / 2)
                },
                high: {
                    monthly_users: usage_profile.monthly_users.max,
                    requests_per_user: usage_profile.requests_per_user.max,
                    peak_concurrency: usage_profile.peak_concurrency.max,
                    data_transfer_gb: usage_profile.data_transfer_gb.max,
                    data_storage_gb: usage_profile.data_storage_gb.max
                }
            };

            // Calculate costs for all scenarios
            const scenarioResults = await infracostService.calculateScenarios(
                infraSpec,
                intent,
                profileScenarios
            );

            // Use the new canonical scenario results
            costAnalysis = scenarioResults.details;

            // Attach CANONICAL scenario structure
            costAnalysis.scenarios = scenarioResults.scenarios;
            costAnalysis.cost_range = scenarioResults.cost_range;
            costAnalysis.recommended = scenarioResults.recommended;
            costAnalysis.confidence = scenarioResults.confidence;
            costAnalysis.services = scenarioResults.services;
            costAnalysis.drivers = scenarioResults.drivers;
            
            // Set recommended provider to avoid fallback to AWS
            costAnalysis.recommended_provider = scenarioResults.recommended?.provider;

            // 🔒 FIX 5: Safe Recommendation Fallback
            costAnalysis = integrityService.safeRecommendation(costAnalysis);

            scenarios = {
                low: scenarioResults.low,
                expected: scenarioResults.expected,
                high: scenarioResults.high
            };

            // Override the recommended cost range with our calculated scenarios
            costAnalysis.recommended_cost_range = scenarioResults.cost_range;

        } else {
            // Fallback to legacy single-point estimation
            costAnalysis = await infracostService.performCostAnalysis(
                infraSpec,
                intent,
                costProfile
            );
        }

        // Bug #3: Guard AI call
        if (!costAnalysis || !costAnalysis.rankings || costAnalysis.rankings.length === 0) {
            console.warn("Skipping AI explanation: cost data incomplete");
            aiExplanation = null;
        } else {
            try {
                // Calculate dominant cost drivers for context
                const dominantDrivers = costAnalysis.category_breakdown
                    ?.sort((a, b) => b.total - a.total)
                    .slice(0, 3) || [];

                aiExplanation = await aiService.explainOutcomes(
                    costAnalysis.rankings,
                    costProfile,
                    infraSpec,
                    usage_profile, // Available from Layer 2 scope
                    {
                        dominant_drivers: dominantDrivers,
                        missing_components: costAnalysis.missing_components
                    }
                );

                // Preserve existing confidence if available, otherwise calculate AI confidence
                // Define variables that might be used in both branches
                let aiUsageConf = usage_profile?.confidence || 0.5;
                const axisScore = 0.8; // improving hardcoded proxy
                const patternCertainty = 1.0;
                
                if (!costAnalysis.confidence) {
                    // Bug #4: CONFIDENCE CALCULATION
                    // Formula: 0.5 * usage + 0.3 * axis + 0.2 * pattern

                    const confidence = (aiUsageConf * 0.5) + (axisScore * 0.3) + (patternCertainty * 0.2);

                    // Override/Augment AI confidence
                    aiExplanation.confidence_score = Math.min(0.95, parseFloat(confidence.toFixed(2)));

                    // Persist to summary (Bug #4)
                    if (costAnalysis.summary) {
                        costAnalysis.summary.confidence = aiExplanation.confidence_score;
                    }
                } else {
                    // Use the confidence from calculateScenarios
                    aiExplanation.confidence_score = costAnalysis.confidence;
                }

                aiExplanation.confidence_details = {
                    usage_confidence: aiUsageConf,
                    axis_score: axisScore,
                    pattern_certainty: patternCertainty
                };

            } catch (aiError) {
                console.error("AI Explanation Error:", aiError);
                // Fallback
                aiExplanation = {
                    outcome_narrative: `${costAnalysis.recommended_provider || 'AWS'} offers the best balance for your needs.`,
                    confidence_score: 0.6,
                    critical_cost_drivers: ["Base Infrastructure"],
                    architectural_fit: "Standard pattern matching your request."
                };
            }
        }

        console.log(`--- STEP 3: Analysis Complete ---`);
        console.log(`Recommended: ${costAnalysis.recommended_provider}`);
        console.log(`Cost Range: ${costAnalysis.recommended_cost_range?.formatted}`);

        // Defensive Patching for Step 3 Response
        const safeProvider = costAnalysis.recommended_provider || 'AWS';
        const safeDetails = costAnalysis.provider_details?.[safeProvider] || {};
        const safeRange = costAnalysis.recommended_cost_range || { formatted: '$0 - $0/month' };

        // Ensure explicit undefined checks for critical fields
        const responseData = {
            step: 'cost_estimation',
            data: {
                // Return PARTIAL_SUCCESS if AI failed or data incomplete
                status: aiExplanation ? 'SUCCESS' : 'PARTIAL_SUCCESS',
                analysis_status: aiExplanation ? 'SUCCESS' : 'PARTIAL_SUCCESS',

                cost_profile: costProfile,
                deployment_type: costAnalysis.deployment_type || 'standard',
                scale_tier: costAnalysis.scale_tier || 'medium',

                // Rankings (sorted by score)
                rankings: costAnalysis.rankings || [],

                // Recommended provider with safe fallback
                recommended: {
                    provider: safeProvider,
                    monthly_cost: safeDetails.total_monthly_cost ?? safeDetails.total ?? 0,
                    formatted_cost: safeDetails.formatted_cost ?? '$0.00',
                    service_count: safeDetails.service_count ?? 0,
                    cost_range: safeRange,
                    // 🔒 FIX: Ensure drivers are passed with proper fallbacks
                    drivers: costAnalysis.recommended?.drivers || 
                             costAnalysis.drivers || 
                             (costAnalysis.scenarios ? 
                                Object.values(costAnalysis.scenarios)
                                    .find(profile => profile && profile[safeProvider])?.[safeProvider]?.drivers || []
                             : []),
                    score: costAnalysis.recommended?.score || Math.round((costAnalysis.confidence || 0.75) * 100)
                },

                // Canonical Aggregation (Critical for Fix #2)
                aggregated_estimates: costAnalysis.aggregated_estimates || {},

                // Category breakdown
                category_breakdown: costAnalysis.category_breakdown || [],

                // ═══════════════════════════════════════════════════════
                // CANONICAL COST SCENARIOS (per profile + per provider)
                // ═══════════════════════════════════════════════════════
                scenarios: costAnalysis.scenarios || {},

                // Overall cost range across all profiles
                cost_range: costAnalysis.cost_range || safeRange,

                // Per-service costs with cloud-specific names and reasons
                services_breakdown: costAnalysis.services || [],

                // Cost drivers (quantified with values + impact)
                drivers: costAnalysis.drivers || [],

                // Confidence with explanation (deterministic, not AI)
                confidence: costAnalysis.confidence || 0.75,
                confidence_percentage: costAnalysis.confidence_percentage || 75,
                confidence_explanation: costAnalysis.confidence_explanation ||
                    ['Heuristic pricing (not SKU-level)'],

                // Make sure ai_explanation exists for frontend confidence dial
                ai_explanation: {
                    confidence_score: costAnalysis.confidence || 0.75,
                    rationale: Array.isArray(costAnalysis.confidence_explanation) ? costAnalysis.confidence_explanation.join(', ') : 'Based on usage and service selection.'
                },

                // ═══════════════════════════════════════════════════════
                // COST INTENT (hobby/startup/production)
                // ═══════════════════════════════════════════════════════
                cost_intent: costAnalysis.recommended?.cost_intent || 'startup',
                cost_intent_description: costAnalysis.recommended?.cost_intent_description ||
                    'Balanced for growth-stage applications',

                // ═══════════════════════════════════════════════════════
                // UX DISCLAIMER (critical for user clarity)
                // ═══════════════════════════════════════════════════════
                estimate_disclaimer: {
                    type: 'planning_estimate',
                    message: 'This is a planning-stage estimate based on usage assumptions and architectural patterns. Exact service-level costs will be generated after Terraform is produced and validated.',
                    accuracy: 'directional',
                    next_step: 'Select a provider and profile to generate Terraform and get exact costs'
                },

                // Selected cloud services 
                selected_services: safeDetails.selected_services || [],

                // Service costs
                service_costs: safeDetails.service_costs || {},

                // Feature 1: Assumption Source
                assumption_source: usage_profile?.source || 'ai_inferred',

                // Feature 2: Cost Sensitivity Meter
                cost_sensitivity: (() => {
                    const type = costAnalysis.deployment_type;
                    if (['static', 'serverless'].includes(type)) return { level: 'high', factor: 'traffic', label: 'Sensitive to Traffic' };
                    if (['container', 'kubernetes'].includes(type)) return { level: 'moderate', factor: 'compute', label: 'Sensitive to Compute' };
                    return { level: 'moderate', factor: 'storage', label: 'Sensitive to Storage' };
                })(),

                // Scenario Analysis
                scenario_analysis: {
                    traffic_doubles: {
                        impact: 'moderate',
                        description: 'Cost scales linearly with active users',
                        estimated_increase: '30-40%'
                    },
                    storage_doubles: {
                        impact: 'low',
                        description: 'Storage is cheap, minimal impact',
                        estimated_increase: '5-10%'
                    }
                },

                // Full provider details
                providers: {
                    AWS: costAnalysis.provider_details?.AWS || {},
                    GCP: costAnalysis.provider_details?.GCP || {},
                    AZURE: costAnalysis.provider_details?.AZURE || {}
                },

                // Summary
                summary: costAnalysis.summary || { confidence: 0.5 },

                // Cost Profiles
                cost_profiles: costAnalysis.cost_profiles || {},

                // Missing components
                missing_components: costAnalysis.missing_components || [],
                future_cost_warning: costAnalysis.future_cost_warning || null,

                // AI Explanation (Defensive Null Check)
                explanation: aiExplanation || {
                    outcome_narrative: "Cost analysis completed using pattern-based fallback.",
                    confidence_score: 0.5,
                    critical_cost_drivers: [],
                    architectural_fit: "Standard pattern."
                },
                
                // Structured recommendation facts (deterministic, auditable)
                recommendation_facts: costResultModel.generateRecommendationFacts(
                    costAnalysis.recommended, 
                    costAnalysis.scenarios, 
                    usage_profile, 
                    infraSpec.architecture_pattern
                )
            }
        };

        res.json(responseData);

    } catch (error) {
        console.error("Step 3 Cost Analysis Error:", error);
        res.status(500).json({
            error: 'Cost analysis failed',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: FEEDBACK COLLECTION (stored in Neon before Terraform)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/feedback', authMiddleware, async (req, res) => {
    try {
        const {
            workspace_id,
            cost_intent,
            estimated_min,
            estimated_max,
            selected_provider,
            selected_profile,
            user_feedback,
            feedback_details
        } = req.body;

        console.log(`[STEP 4] Storing feedback for workspace ${workspace_id}: ${user_feedback}`);

        // Validate required fields
        if (!workspace_id || !selected_provider || !selected_profile || !user_feedback) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['workspace_id', 'selected_provider', 'selected_profile', 'user_feedback']
            });
        }

        // Store feedback in Neon
        const result = await pool.query(
            `INSERT INTO cost_feedback 
             (workspace_id, cost_intent, estimated_min, estimated_max, selected_provider, selected_profile, user_feedback, feedback_details)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, created_at`,
            [
                workspace_id,
                cost_intent || 'startup',
                estimated_min || 0,
                estimated_max || 0,
                selected_provider,
                selected_profile,
                user_feedback,
                feedback_details ? JSON.stringify(feedback_details) : null
            ]
        );

        console.log(`[STEP 4] Feedback stored with ID: ${result.rows[0].id}`);

        // Log to audit
        if (auditService && req.user) {
            auditService.logAction(
                req.user.id,
                workspace_id,
                'COST_FEEDBACK_SUBMITTED',
                { selected_provider, selected_profile, user_feedback, cost_intent },
                req
            );
        }

        res.json({
            success: true,
            feedback_id: result.rows[0].id,
            created_at: result.rows[0].created_at,
            message: 'Feedback recorded successfully. Ready for Terraform generation.',
            next_step: '/api/workflow/terraform'
        });

    } catch (error) {
        console.error('[STEP 4] Feedback Error:', error);
        res.status(500).json({
            error: 'Failed to store feedback',
            message: error.message
        });
    }
});

// 
// STEP 4.5: ARCHITECTURE DIAGRAM GENERATION
// 
router.post('/architecture', authMiddleware, async (req, res) => {
    try {
        const {
            workspace_id,
            infraSpec,
            provider,
            profile,
            usage_profile,
            intent
        } = req.body;

        console.log(`[STEP 4.5] Generating architecture diagram for ${provider} (${profile})`);

        // Validate required fields
        if (!infraSpec || !provider || !profile) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['infraSpec', 'provider', 'profile']
            });
        }

        // Use the pattern resolver to generate architecture based on intent
        
        // Extract requirements from intent
        let requirements = patternResolver.extractRequirements(intent?.intent_classification?.project_description || "");
        
        // Merge with frontend requirements if provided
        if (req.body.requirements) {
            requirements = {
                ...requirements,
                ...req.body.requirements,
                nfr: {
                    ...requirements.nfr,
                    ...req.body.requirements.nfr
                },
                region: {
                    ...requirements.region,
                    ...req.body.requirements.region
                },
                data_classes: {
                    ...requirements.data_classes,
                    ...req.body.requirements.data_classes
                },
                data_retention: {
                    ...requirements.data_retention,
                    ...req.body.requirements.data_retention
                },
                observability: {
                    ...requirements.observability,
                    ...req.body.requirements.observability
                }
            };
        }
        
        // 🔒 FIX 1: USE CANONICAL ARCHITECTURE FROM STEP 2 (IMMUTABLE)
        // DO NOT regenerate - reuse the finalized services contract from infraSpec
        let canonicalArchitecture;
        
        if (infraSpec.canonical_architecture) {
            // Use the stored canonical architecture from Step 2
            console.log('[FIX 1] Using stored canonical architecture from Step 2');
            canonicalArchitecture = infraSpec.canonical_architecture;
        } else {
            // Fallback: reconstruct from infraSpec services (legacy compatibility)
            console.warn('[FIX 1] No stored canonical architecture - reconstructing from infraSpec');
            canonicalArchitecture = {
                pattern: infraSpec.architecture_pattern || infraSpec.service_classes?.pattern,
                pattern_name: infraSpec.service_classes?.pattern_name || 'Unknown Pattern',
                services: (infraSpec.service_classes?.required_services || []).map(s => ({
                    name: s.service_class,
                    canonical_type: s.service_class,
                    description: s.description,
                    category: getCategoryForService(s.service_class)
                })),
                total_services: infraSpec.service_classes?.required_services?.length || 0
            };
        }
        
        console.log(`[FIX 1] Canonical Architecture: ${canonicalArchitecture.pattern}, Services: ${canonicalArchitecture.services?.length || 0}`);

        // Map to provider-specific services
        const architectureDiagramService = require('../services/architectureDiagramService');
        const providerArchitecture = architectureDiagramService.mapToProvider(canonicalArchitecture, provider);

        // Generate services list
        const services = architectureDiagramService.generateServicesList(providerArchitecture, provider);

        // Generate architecture notes
        const notes = architectureDiagramService.generateArchitectureNotes(infraSpec, usage_profile, requirements);

        console.log(`[STEP 4.5] Generated architecture with ${providerArchitecture.nodes.length} nodes and ${services.length} services`);

        // Log to audit
        if (auditService && req.user && workspace_id) {
            auditService.logAction(
                req.user.id,
                workspace_id,
                'ARCHITECTURE_GENERATED',
                { provider, profile, services_count: services.length },
                req
            );
        }

        res.json({
            success: true,
            data: {
                architecture: providerArchitecture,
                services,
                notes,
                provider,
                profile,
                requirements
            },
            message: 'Architecture diagram generated successfully',
            next_step: '/api/workflow/terraform'
        });

    } catch (error) {
        console.error('[STEP 4.5] Architecture Error:', error);
        res.status(500).json({
            error: 'Failed to generate architecture',
            message: error.message
        });
    }
});

/**
 * @route POST /api/workflow/terraform
 * @desc Generate Terraform code for infrastructure
 * @access Private
 */
router.post('/terraform', authMiddleware, async (req, res) => {
    try {
        const { workspace_id, infraSpec, provider, profile, project_name, requirements } = req.body;

        console.log(`[TERRAFORM] Generating modular code for ${provider} (${profile})`);
        console.log(`[TERRAFORM] InfraSpec:`, JSON.stringify(infraSpec, null, 2));
        console.log(`[TERRAFORM] InfraSpec pattern:`, infraSpec?.service_classes?.pattern);
        console.log(`[TERRAFORM] Services:`, infraSpec?.service_classes?.required_services?.map(s => s.service_class));

        // Validate required fields
        if (!infraSpec || !provider) {
            console.error('[TERRAFORM] Missing required fields:', { hasInfraSpec: !!infraSpec, hasProvider: !!provider });
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['infraSpec', 'provider']
            });
        }

        // Validate infraSpec structure
        if (!infraSpec.service_classes || !infraSpec.service_classes.required_services) {
            console.error('[TERRAFORM] Invalid infraSpec structure:', infraSpec);
            return res.status(400).json({
                error: 'Invalid infraSpec structure',
                message: 'infraSpec must contain service_classes with required_services'
            });
        }

        // Generate modular Terraform project (V2)
        const terraformService = require('../services/terraformService');
        
        console.log('[TERRAFORM] Calling generateModularTerraform...');
        const terraformProject = await terraformService.generateModularTerraform(
            infraSpec,
            provider,
            project_name || 'cloudiverse-project',
            requirements || {}
        );
        console.log('[TERRAFORM] Project generated successfully');

        // Get services list
        const services = terraformService.getTerraformServices(infraSpec, provider);
        console.log(`[TERRAFORM] Generated modular project with ${Object.keys(terraformProject).length} root files`);
        console.log(`[TERRAFORM] Modules:`, Object.keys(terraformProject.modules || {}));

        // ═══════════════════════════════════════════════════════════════════════════
        // TERRAFORM INTEGRITY GATE (CRITICAL - NO BYPASS)
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Validate Terraform project integrity
        if (!terraformProject.modules || Object.keys(terraformProject.modules).length === 0) {
            console.error('[TERRAFORM INTEGRITY] ✗ FAILED: No modules generated');
            return res.status(500).json({
                error: 'Terraform integrity check failed',
                message: 'No Terraform modules were generated. Infrastructure is invalid.',
                details: 'Each canonical service must generate at least one module.',
                terraform_valid: false
            });
        }
        
        // Validate main.tf exists
        if (!terraformProject['main.tf']) {
            console.error('[TERRAFORM INTEGRITY] ✗ FAILED: No main.tf generated');
            return res.status(500).json({
                error: 'Terraform integrity check failed',
                message: 'main.tf is missing. Infrastructure is invalid.',
                terraform_valid: false
            });
        }
        
        console.log('[TERRAFORM INTEGRITY] ✓ PASSED: Valid Terraform project');
        console.log(`[TERRAFORM INTEGRITY] ✓ ${Object.keys(terraformProject.modules).length} modules generated`);
        console.log(`[TERRAFORM INTEGRITY] ✓ main.tf exists with ${terraformProject['main.tf'].split('\n').length} lines`);

        res.json({
            success: true,
            terraform: {
                project: terraformProject, // Folder structure with modules
                provider,
                profile,
                structure: 'modular' // V2 indicator
            },
            services,
            terraform_valid: true,
            message: 'Terraform generated successfully (modular structure)'
        });
    } catch (error) {
        console.error('[TERRAFORM] Generation Error:', error);
        console.error('[TERRAFORM] Error stack:', error.stack);
        res.status(500).json({
            error: 'Failed to generate Terraform',
            message: error.message,
            details: error.stack
        });
    }
});

module.exports = router;
