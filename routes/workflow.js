const express = require('express');
const router = express.Router();
const aiService = require('../services/aiService');
const authMiddleware = require('../middleware/auth');
const monopolyLayers = require('../services/monopolyLayers');
const infracostService = require('../services/infracostService');
const auditService = require('../services/auditService');
const costHistoryService = require('../services/costHistoryService');
const { resolvePatternWithServices, resolvePattern } = require('../services/patternResolver');
const { ARCHITECTURE_PATTERNS, validateServiceSelection } = require('../services/architecturePatterns');

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
                { label: "Proof of Concept (<100 users)", value: "POC" },
                { label: "Small Business (100-1k users)", value: "SMB" },
                { label: "Enterprise (>10k users)", value: "ENTERPRISE" }
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
                { label: "Standard (99.5%)", value: "STANDARD" },
                { label: "High Availability (99.9%)", value: "HIGH" },
                { label: "Mission Critical (99.99%)", value: "MISSION_CRITICAL" }
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
                { label: "Public / Non-Sensitive", value: "PUBLIC" },
                { label: "Internal Business Data", value: "INTERNAL" },
                { label: "PII / HIPAA / Highly Sensitive", value: "SENSITIVE" }
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
                { label: "None / Standard", value: "NONE" },
                { label: "GDPR / CCPA", value: "GDPR_CCPA" },
                { label: "HIPAA / PCI-DSS / GovCloud", value: "HIGH_COMPLIANCE" }
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
                { label: "Low (Internal Tool)", value: "LOW" },
                { label: "Medium (Customer Facing)", value: "MEDIUM" },
                { label: "High (Revenue Impacting)", value: "HIGH" }
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
                { label: "Standard Backup", value: "STANDARD" },
                { label: "Long-term Retention", value: "LONG_TERM" },
                { label: "Immutable / Legal Hold", value: "IMMUTABLE" }
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
                { label: "Cost Optimize (Budget First)", value: "COST_FIRST" },
                { label: "Balanced", value: "BALANCED" },
                { label: "Performance Max (Speed First)", value: "PERFORMANCE_FIRST" }
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
        // Send labels to frontend, keep values for backend
        options: template.options.map(opt =>
            typeof opt === 'object' ? opt.label : opt
        ),
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
            console.log("--- STEP 1: AI Intent Normalization (ONCE) ---");
            step1Result = await aiService.normalizeIntent(userInput, conversationHistory || []);
            console.log("AI Snapshot Created");
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
        const features = Object.keys(step1Result.feature_signals || {});

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
            features: features,
            user_facing: step1Result.intent_classification?.user_facing,
            data_sensitivity: step1Result.semantic_signals?.data_sensitivity,
            has_pii: step1Result.risk_domains?.includes('pii'),
            regulatory_exposure: step1Result.intent_classification?.regulatory_exposure,
            ai_confidence: step1Result.confidence || 0.8
        };

        // SCORE AND PRIORITIZE using Layer 2 weights
        const prioritizedAxes = scoreAndPrioritizeAxes(filteredMissingAxes, {
            primary_domain: domain,
            features: features,
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
        const patternResolution = resolvePatternWithServices(step1Result);
        const fixedPattern = patternResolution.pattern;
        console.log(`Pattern Resolved: ${fixedPattern} (${patternResolution.pattern_name})`);
        console.log(`Services Selected: ${patternResolution.services.map(s => s.service_class).join(', ')}`);

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
        const selectedServiceClasses = new Set(patternResolution.services.map(s => s.service_class));
        const requiredServiceClasses = new Set(patternResolution.required_services);
        const optionalServiceClasses = new Set(patternResolution.optional_services);
        const forbiddenServiceClasses = new Set(patternResolution.forbidden_services);

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
                pattern_required: requiredServiceClasses.has(name),
                pattern_optional: optionalServiceClasses.has(name),
                pattern_forbidden: forbiddenServiceClasses.has(name)
            };
        }

        // Build skeleton from pattern-resolved service classes
        const skeleton = {
            pattern: patternResolution.pattern,
            pattern_name: patternResolution.pattern_name,
            cost_range: patternResolution.cost_range,
            required_services: Object.entries(SERVICE_CLASSES)
                .filter(([_, config]) => config.required)
                .map(([name, config]) => ({
                    service_class: name,
                    description: config.description,
                    pattern_required: config.pattern_required
                })),
            optional_services: Object.entries(SERVICE_CLASSES)
                .filter(([_, config]) => !config.required && config.pattern_optional)
                .map(([name, config]) => ({
                    service_class: name,
                    description: config.description
                })),
            forbidden_services: patternResolution.forbidden_services
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
            const currentReliability = categoryScores.reliability || 80;
            if (currentReliability > 75) {
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
// STEP 3: COST ESTIMATION & CLOUD RECOMMENDATION
// =====================================================

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
        const { infraSpec, intent, cost_profile } = req.body;

        console.log("--- STEP 3: Cost Analysis Started ---");
        console.log(`Cost Profile: ${cost_profile || 'COST_EFFECTIVE'}`);

        // Validate inputs
        if (!infraSpec || !intent) {
            return res.status(400).json({
                error: 'Missing required fields: infraSpec and intent'
            });
        }

        const costProfile = cost_profile || 'COST_EFFECTIVE';

        // Perform cost analysis (backend decides everything)
        const costAnalysis = await infracostService.performCostAnalysis(
            infraSpec,
            intent,
            costProfile
        );

        // Get AI explanation for the recommendations
        let aiExplanation = null;
        try {
            aiExplanation = await aiService.explainCostRecommendation(
                costAnalysis.rankings,
                costProfile,
                infraSpec,
                costAnalysis.missing_components // Pass missing components for context
            );
        } catch (aiError) {
            console.error("AI Explanation Error:", aiError);
            // Continue without AI explanation
            aiExplanation = {
                recommendation_reason: `${costAnalysis.recommended_provider} offers the best balance of cost and performance for your needs.`,
                tradeoffs: "Each cloud provider has unique strengths. Consider your team's expertise and existing infrastructure.",
                cost_optimization_tips: [
                    "Start with the recommended tier and scale as needed",
                    "Use reserved instances for predictable workloads",
                    "Monitor usage and adjust sizing monthly"
                ],
                future_considerations: "Adding async processing, search, or caching later may increase monthly costs."
            };
        }

        console.log(`--- STEP 3: Analysis Complete ---`);
        console.log(`Recommended: ${costAnalysis.recommended_provider}`);
        console.log(`Cost Range: ${costAnalysis.recommended_cost_range?.formatted}`);

        res.json({
            step: 'cost_estimation',
            data: {
                status: 'SUCCESS',
                cost_profile: costProfile,
                deployment_type: costAnalysis.deployment_type,
                scale_tier: costAnalysis.scale_tier,

                // Rankings (sorted by score) - now includes cost_range
                rankings: costAnalysis.rankings,

                // Recommended provider - now includes cost_range
                recommended: {
                    provider: costAnalysis.recommended_provider,
                    monthly_cost: costAnalysis.provider_details[costAnalysis.recommended_provider]?.total_monthly_cost,
                    formatted_cost: costAnalysis.provider_details[costAnalysis.recommended_provider]?.formatted_cost,
                    service_count: costAnalysis.provider_details[costAnalysis.recommended_provider]?.service_count,
                    cost_range: costAnalysis.recommended_cost_range
                },

                // NEW: Category breakdown for Tier 2 view
                category_breakdown: costAnalysis.category_breakdown,

                // FIX 1: Selected cloud services by category (for UI display)
                selected_services: costAnalysis.provider_details[costAnalysis.recommended_provider]?.selected_services,

                // FIX 3: Aggregated costs per service category (for UI table)
                service_costs: costAnalysis.provider_details[costAnalysis.recommended_provider]?.service_costs,

                // Full provider details (includes services array with cloud_service, display_name, cost)
                providers: {
                    AWS: costAnalysis.provider_details.AWS,
                    GCP: costAnalysis.provider_details.GCP,
                    AZURE: costAnalysis.provider_details.AZURE
                },

                // Summary
                summary: costAnalysis.summary,

                // FIX 3: Both profiles for accurate comparison
                cost_profiles: costAnalysis.cost_profiles,

                // NEW: Missing components (future cost risks)
                missing_components: costAnalysis.missing_components,
                future_cost_warning: costAnalysis.future_cost_warning,

                // AI Explanation (AI only explains, never decides)
                explanation: aiExplanation
            }
        });

    } catch (error) {
        console.error("Step 3 Cost Analysis Error:", error);
        res.status(500).json({
            error: 'Cost analysis failed',
            message: error.message
        });
    }
});

module.exports = router;
