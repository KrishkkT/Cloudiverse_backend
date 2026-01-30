const express = require('express');
const router = express.Router();
const aiService = require('../services/ai/aiService');
const authMiddleware = require('../middleware/auth');
const monopolyLayers = require('../services/core/monopolyLayers');
const infracostService = require('../services/cost/infracostService');
const auditService = require('../services/shared/auditService');
const costHistoryService = require('../services/cost/costHistoryService');
const patternResolver = require('../services/core/patternResolver');
const ARCHITECTURE_PATTERNS = require('../catalog/patterns/index');
const { validateServiceSelection } = require('../catalog/terraform/utils');
const integrityService = require('../services/core/integrityService');
const terraformService = require('../services/infrastructure/terraformService');
const costResultModel = require('../services/cost/costResultModel');
const canonicalValidator = require('../services/core/canonicalValidator');
const { generateServiceDisplay, groupServicesByCategory, getCategoryDisplayName, SERVICE_DISPLAY } = require('../services/shared/serviceDisplay');
const pool = require('../config/db');
const archiver = require('archiver');
const fs = require('fs');
const path = require('path');


// ═══════════════════════════════════════════════════════════════════
// NEW STEP 1 CONFIG-BASED SYSTEM (from Step1.txt specification)
// ═══════════════════════════════════════════════════════════════════
const axesConfig = require('../config/axesConfig.json');
const questionBank = require('../config/questionBank.json');

// ═══════════════════════════════════════════════════════════════════
// CONFIDENCE THRESHOLDS (from user specification)
// ═══════════════════════════════════════════════════════════════════
const CONFIDENCE_THRESHOLDS = {
    HIGH_CONFIDENCE_SKIP: 0.85,  // ≥0.85 → LOCKED (no question)
    LOW_PRIORITY: 0.75,          // 0.75-0.84 → OPTIONAL (low priority)
    MUST_ASK: 0.74,              // ≤0.74 → MUST ASK
    AUTO_LOCK_RATIO: 0.8         // 80%+ high confidence → auto-lock
};

const MAX_QUESTIONS = {
    SIMPLE: 1,
    MEDIUM: 2,
    COMPLEX: 3
};

/**
 * NEW: Check if intent should auto-lock based on high-confidence ratio
 * @param {Object} axes - The axes object with confidence scores
 * @returns {boolean} - True if should auto-lock
 */
function shouldAutoLock(axes) {
    if (!axes || typeof axes !== 'object') return false;

    const allAxes = Object.values(axes);
    if (allAxes.length === 0) return false;

    const highConfidenceCount = allAxes.filter(axis =>
        axis?.confidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE_SKIP
    ).length;

    const ratio = highConfidenceCount / allAxes.length;

    if (ratio >= CONFIDENCE_THRESHOLDS.AUTO_LOCK_RATIO) {
        console.log(`[AUTO-LOCK] ${highConfidenceCount}/${allAxes.length} axes ≥0.85 confidence (${(ratio * 100).toFixed(0)}%)`);
        return true;
    }

    return false;
}

/**
 * NEW: Prioritize axes for questions using config-based impact × (1 - confidence)
 * SKIPS high-confidence axes (≥0.85) - they don't need confirmation
 * @param {Object} aiResult - The AI result with axes and confidence scores
 * @returns {Array} - Array of {axis_key, priority} sorted by priority descending
 */
function prioritizeAxesForQuestions(aiResult) {
    const { axes, complexity, ranked_axes_for_questions } = aiResult;

    // Use reduced question limits based on complexity
    const maxQuestions = MAX_QUESTIONS[complexity] || MAX_QUESTIONS.MEDIUM;
    const threshold = axesConfig.priority_threshold || 0.3;

    // If AI already ranked axes, filter out high-confidence ones
    if (ranked_axes_for_questions && ranked_axes_for_questions.length > 0) {
        return ranked_axes_for_questions
            .filter(a => {
                // Skip high-confidence axes
                const axisData = axes?.[a.axis_key];
                if (axisData?.confidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE_SKIP) {
                    console.log(`[SKIP] ${a.axis_key}: ${axisData.confidence} confidence (high)`);
                    return false;
                }
                return a.priority >= threshold;
            })
            .slice(0, maxQuestions);
    }

    // Fallback: Calculate priority from axes if AI didn't rank
    if (!axes || typeof axes !== 'object') return [];

    const priorities = Object.entries(axes)
        .filter(([key, data]) => {
            // SKIP if AI confidence is HIGH (≥0.85)
            if (data?.confidence >= CONFIDENCE_THRESHOLDS.HIGH_CONFIDENCE_SKIP) {
                console.log(`[SKIP] ${key}: ${data.confidence} confidence (high)`);
                return false;
            }
            return true;
        })
        .map(([key, data]) => {
            const impact = axesConfig.axes[key]?.impact || 0.5;
            const confidence = data?.confidence || 0;

            // Higher priority for low-confidence, high-impact axes
            let priority = impact * (1 - confidence);

            // Boost priority if MUST_ASK threshold
            if (confidence <= CONFIDENCE_THRESHOLDS.MUST_ASK) {
                priority *= 1.2;
            }

            return { axis_key: key, priority };
        })
        .filter(a => a.priority >= threshold)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, maxQuestions);

    return priorities;
}


/**
 * NEW: Generate questions from config for given axes
 * @param {Array} prioritizedAxes - Array of {axis_key, priority}
 * @returns {Array} - Array of question objects for frontend
 */
function generateQuestionsFromConfig(prioritizedAxes) {
    return prioritizedAxes
        .map(({ axis_key }) => {
            const template = questionBank[axis_key];
            if (!template) return null;
            return {
                axis_key,
                question: template.question,
                suggested_answers: template.suggested_answers || []
            };
        })
        .filter(q => q !== null);
}

/**
 * NEW: Merge user answers into the intent object
 * @param {Object} currentIntent - The current intent object
 * @param {Array} answers - Array of {axis_key, value} pairs
 * @returns {Object} - Updated intent object
 */
function mergeAnswersIntoIntent(currentIntent, answers) {
    if (!currentIntent.axes) currentIntent.axes = {};

    answers.forEach(({ axis_key, value }) => {
        const mappedValue = mapAnswerToAxisValue(axis_key, value);
        currentIntent.axes[axis_key] = {
            value: mappedValue,
            confidence: 1.0 // User-provided = full confidence
        };
    });

    return currentIntent;
}

/**
 * NEW: Map user's answer text to axis enum value
 * @param {string} axisKey - The axis key
 * @param {string} answerText - The user's selected answer text
 * @returns {*} - The mapped value
 */
function mapAnswerToAxisValue(axisKey, answerText) {
    const axisType = axesConfig.axes[axisKey]?.type;
    const template = questionBank[axisKey];

    if (!template || !template.suggested_answers) return answerText;

    const answerIndex = template.suggested_answers.indexOf(answerText);

    // Special handling for boolean axes
    if (axisType === 'boolean') {
        // First answer typically means "no/false", middle means "some/true", last means "yes/true"
        if (answerIndex === 0) return false;
        return true;
    }

    // For enum axes, map to enum values from config
    const enumValues = axesConfig.enums[axisKey];
    if (enumValues && answerIndex >= 0 && answerIndex < enumValues.length) {
        return enumValues[answerIndex];
    }

    // For arrays like regulatory_compliance
    if (axisType === 'array') {
        if (answerText.toLowerCase().includes('none') || answerText.toLowerCase().includes('not sure')) {
            return [];
        }
        if (answerText.toLowerCase().includes('multiple')) {
            return ['multiple_selected']; // Frontend may need to handle this
        }
        // Return as single-item array matching the answer
        const complianceValues = axesConfig.enums.regulatory_compliance || [];
        const matched = complianceValues.find(v => answerText.toUpperCase().includes(v.replace('_', '-')));
        return matched ? [matched] : [answerText];
    }

    // For provider selection
    if (axisKey === 'allowed_providers') {
        if (answerText.toLowerCase().includes('no strong preference') || answerText.toLowerCase().includes('any')) {
            return ['aws', 'azure', 'gcp'];
        }
        const providers = [];
        if (answerText.toLowerCase().includes('aws')) providers.push('aws');
        if (answerText.toLowerCase().includes('azure')) providers.push('azure');
        if (answerText.toLowerCase().includes('gcp')) providers.push('gcp');
        return providers.length > 0 ? providers : ['aws', 'azure', 'gcp'];
    }

    // Default: return the answer text as-is
    return answerText;
}

/**
 * NEW: Check if intent should be locked (no more questions needed)
 * @param {Object} intent - The current intent object
 * @param {number} questionsAsked - Number of questions already asked
 * @returns {boolean} - True if intent should be locked
 */
function shouldLockIntent(intent, questionsAsked) {
    const maxQuestions = intent.complexity === 'COMPLEX' ?
        axesConfig.question_limits.COMPLEX :
        axesConfig.question_limits.SIMPLE;

    // Lock if we've asked max questions
    if (questionsAsked >= maxQuestions) return true;

    // Lock if no high-priority axes remaining
    const remainingHighPriority = prioritizeAxesForQuestions(intent);
    if (remainingHighPriority.length === 0) return true;

    return false;
}

/**
 * NEW: Map axes to capabilities (FIX for Bug 3)
 * Converts the new axes format to the legacy capabilities format
 * @param {Object} axes - The axes object with {value, confidence} pairs
 * @returns {Object} - Legacy capabilities object
 */
function mapAxesToCapabilities(axes) {
    if (!axes || typeof axes !== 'object') return {};

    return {
        // Map boolean axes to capabilities
        data_persistence: resolveAxisToCapability(axes.stateful),
        identity_access: resolveAxisToCapability(axes.user_authentication),
        content_delivery: resolveAxisToCapability(axes.static_content),
        payments: resolveAxisToCapability(axes.payments),
        realtime: resolveAxisToCapability(axes.realtime_updates),
        messaging: resolveAxisToCapability(axes.messaging_queue),
        document_storage: resolveAxisToCapability(axes.file_storage),
        static_content: resolveAxisToCapability(axes.static_content),
        api_backend: resolveAxisToCapability(axes.api_backend),
        multi_user_roles: resolveAxisToCapability(axes.multi_tenancy),

        // Additional mappings
        search: resolveAxisToCapability(axes.search),
        scheduled_jobs: resolveAxisToCapability(axes.scheduled_jobs),
        admin_dashboard: resolveAxisToCapability(axes.admin_dashboard),
        mobile_clients: resolveAxisToCapability(axes.mobile_clients),
        third_party_integrations: resolveAxisToCapability(axes.third_party_integrations)
    };
}

/**
 * Helper to resolve axis {value, confidence} to capability value
 */
function resolveAxisToCapability(axis) {
    if (!axis) return 'unknown';

    // If confidence is high enough, use the value
    if (axis.confidence >= 0.6) {
        return axis.value === true ? true : (axis.value === false ? false : 'unknown');
    }

    // Low confidence = unknown
    return 'unknown';
}


// =====================================================
// LEGACY 3-LAYER QUESTION SELECTION SYSTEM (kept for backward compatibility)
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

// ═══════════════════════════════════════════════════════════════════
// TRACKED CAPABILITIES (Provider-Agnostic Intent, NOT Services)
// ═══════════════════════════════════════════════════════════════════
// RULE: Step 1 outputs CAPABILITIES, not services.
// Capabilities represent user intent WITHOUT deployment assumptions.
// Mapping to services happens later in Step 2 (pattern resolution).
// ═══════════════════════════════════════════════════════════════════
const TRACKED_CAPABILITIES = [
    'data_persistence',      // User needs to store/retrieve data (NOT database/storage service)
    'identity_access',       // User needs authentication/authorization (NOT Cognito/Auth0)
    'content_delivery',      // User needs CDN/edge delivery (NOT CloudFront/CDN service)
    'payments',              // User needs payment processing (NOT Stripe module)
    'eventing',              // User needs event-driven architecture (NOT EventBridge)
    'messaging',             // User needs async messaging (NOT SQS/queue)
    'realtime',              // User needs real-time communication (NOT WebSocket service)
    'document_storage',      // User needs document/file management (NOT S3/blob storage)
    'static_content',        // User serves static assets (NOT static hosting service)
    'api_backend',           // User needs backend API (NOT compute service)
    'case_management',       // Domain-specific: workflow/case tracking
    'multi_user_roles'       // User needs RBAC/multi-tenancy
];

// LEGACY ALIAS (for backward compatibility during migration)
const TRACKED_FEATURES = TRACKED_CAPABILITIES;

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
            // Reuse the frozen AI snapshot BUT UPDATE with user's answer
            console.log("--- AXIS ANSWER RECEIVED (NO AI CALL) ---");
            step1Result = { ...ai_snapshot };

            // INCREMENT AI USAGE COUNT
            if (req.user && req.user.id) {
                // Increment usage count for the user
                try {
                    await pool.query("UPDATE users SET ai_usage_count = COALESCE(ai_usage_count, 0) + 1 WHERE id = $1", [req.user.id]);
                    console.log(`[USAGE] Incremented AI usage count for user ${req.user.id}`);
                } catch (usageErr) {
                    console.error("Failed to increment usage count:", usageErr);
                }
            }


            // ═══════════════════════════════════════════════════════════════════
            // FIX: Extract and apply user's answer to the axes object
            // ═══════════════════════════════════════════════════════════════════
            const answeredAxis = req.body.answered_axis || req.body.axis;
            const userAnswer = req.body.answer || req.body.userInput;

            // Get the axis from conversation history if not in request body
            let axisKey = answeredAxis;
            let answerValue = userAnswer;

            // Try to extract from conversation history (last user message after question)
            if (!axisKey && conversationHistory && conversationHistory.length > 0) {
                const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === 'assistant');
                const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user');

                // Find which axis was being asked
                if (lastAssistantMsg) {
                    for (const [key, template] of Object.entries(questionBank)) {
                        if (lastAssistantMsg.content.includes(template.question)) {
                            axisKey = key;
                            break;
                        }
                    }
                }
                if (lastUserMsg) {
                    answerValue = lastUserMsg.content;
                }
            }

            if (axisKey && answerValue) {
                console.log(`[FIX] Updating axis '${axisKey}' with answer: ${answerValue}`);

                // Ensure axes object exists
                if (!step1Result.axes) step1Result.axes = {};

                // Map answer text to canonical value
                const mappedValue = mapAnswerToAxisValue(axisKey, answerValue);

                // UPDATE the axis with user's answer and full confidence
                step1Result.axes[axisKey] = {
                    value: mappedValue,
                    confidence: 1.0  // User answered = 100% confidence
                };

                // Remove this axis from ranked_axes_for_questions if present
                if (step1Result.ranked_axes_for_questions) {
                    step1Result.ranked_axes_for_questions = step1Result.ranked_axes_for_questions
                        .filter(a => a.axis_key !== axisKey);
                }

                console.log(`[FIX] Updated axes[${axisKey}] = { value: ${JSON.stringify(mappedValue)}, confidence: 1.0 }`);
            } else {
                console.warn("[WARNING] Could not determine axis or answer from request");
            }

        } else {
            // DESCRIPTION input - Call AI ONCE
            if (!userInput) return res.status(400).json({ msg: "User input required" });

            // --- STEP 0: PREPROCESSING (NON-AI) ---
            const normalizedInput = userInput.toLowerCase();
            const manualExclusions = [];

            // 🔒 DATABASE EXCLUSIONS (15 patterns)
            if (normalizedInput.includes('no database') || normalizedInput.includes('without database') ||
                normalizedInput.includes('database excluded') || normalizedInput.includes('no db') ||
                normalizedInput.includes('stateless') || normalizedInput.includes('no persistence') ||
                normalizedInput.includes('no storage') || normalizedInput.includes('ephemeral') ||
                normalizedInput.includes('no sql') || normalizedInput.includes('no nosql') ||
                normalizedInput.includes('memory only') || normalizedInput.includes('no data store') ||
                normalizedInput.includes('static site') || normalizedInput.includes('just frontend')) {
                manualExclusions.push('database', 'datapersistence', 'nosqldatabase', 'relationaldatabase');
            }

            // 🔒 PAYMENTS EXCLUSIONS (12 patterns)
            if (normalizedInput.includes('no payments') || normalizedInput.includes('without payments') ||
                normalizedInput.includes('no payment') || normalizedInput.includes('free only') ||
                normalizedInput.includes('no billing') || normalizedInput.includes('no checkout') ||
                normalizedInput.includes('no stripe') || normalizedInput.includes('no paypal') ||
                normalizedInput.includes('non monetized') || normalizedInput.includes('no subscription') ||
                normalizedInput.includes('marketing site') || normalizedInput.includes('portfolio')) {
                manualExclusions.push('payments');
            }

            // 🔒 AUTH/LOGIN EXCLUSIONS (25 patterns)
            if (normalizedInput.includes('no auth') || normalizedInput.includes('without auth') ||
                normalizedInput.includes('no login') || normalizedInput.includes('no user login') ||
                normalizedInput.includes('without login') || normalizedInput.includes('no authentication') ||
                normalizedInput.includes('no user accounts') || normalizedInput.includes('no signup') ||
                normalizedInput.includes('public only') || normalizedInput.includes('anonymous access') ||
                normalizedInput.includes('no users') || normalizedInput.includes('no accounts') ||
                normalizedInput.includes('guest only') || normalizedInput.includes('open access') ||
                normalizedInput.includes('no registration') || normalizedInput.includes('no passwords') ||
                normalizedInput.includes('static landing') || normalizedInput.includes('brochure site') ||
                normalizedInput.includes('no jwt') || normalizedInput.includes('no oauth') ||
                normalizedInput.includes('marketing page') || normalizedInput.includes('showcase')) {
                manualExclusions.push('auth', 'identityaccess', 'userauthentication');
            }

            // 🔒 BACKEND/API EXCLUSIONS (20 patterns)
            if (normalizedInput.includes('no backend') || normalizedInput.includes('without backend') ||
                normalizedInput.includes('no api') || normalizedInput.includes('no server') ||
                normalizedInput.includes('just static') || normalizedInput.includes('static only') ||
                normalizedInput.includes('frontend only') || normalizedInput.includes('no compute') ||
                normalizedInput.includes('no lambda') || normalizedInput.includes('no functions') ||
                normalizedInput.includes('pure static') || normalizedInput.includes('html css js') ||
                normalizedInput.includes('no node') || normalizedInput.includes('no python') ||
                normalizedInput.includes('landing page') || normalizedInput.includes('portfolio site') ||
                normalizedInput.includes('no app server') || normalizedInput.includes('client side only') ||
                normalizedInput.includes('no rest') || normalizedInput.includes('no graphql')) {
                manualExclusions.push('backend', 'api', 'apibackend', 'computeserverless', 'computevm');
            }

            // 🔒 REALTIME EXCLUSIONS (10 patterns)
            if (normalizedInput.includes('no realtime') || normalizedInput.includes('no live') ||
                normalizedInput.includes('no websocket') || normalizedInput.includes('no chat') ||
                normalizedInput.includes('no streaming') || normalizedInput.includes('batch only') ||
                normalizedInput.includes('no updates') || normalizedInput.includes('static content') ||
                normalizedInput.includes('no notifications') || normalizedInput.includes('no socket')) {
                manualExclusions.push('realtime', 'websocketgateway');
            }

            // 🔒 QUEUES/MESSAGING EXCLUSIONS (8 patterns)
            if (normalizedInput.includes('no queue') || normalizedInput.includes('no messaging') ||
                normalizedInput.includes('no kafka') || normalizedInput.includes('no rabbitmq') ||
                normalizedInput.includes('no sqs') || normalizedInput.includes('direct only') ||
                normalizedInput.includes('no events') || normalizedInput.includes('no pubsub')) {
                manualExclusions.push('messaging', 'message_queue');
            }

            // 🔒 SEARCH EXCLUSIONS (8 patterns)
            if (normalizedInput.includes('no search') || normalizedInput.includes('no elasticsearch') ||
                normalizedInput.includes('no algolia') || normalizedInput.includes('static menu') ||
                normalizedInput.includes('no index') || normalizedInput.includes('no fulltext') ||
                normalizedInput.includes('simple nav') || normalizedInput.includes('no query')) {
                manualExclusions.push('search');
            }

            // 🔒 ADMIN DASHBOARD EXCLUSIONS (10 patterns)
            if (normalizedInput.includes('no admin') || normalizedInput.includes('no dashboard') ||
                normalizedInput.includes('no panel') || normalizedInput.includes('public only') ||
                normalizedInput.includes('no cms') || normalizedInput.includes('hardcoded content') ||
                normalizedInput.includes('no control panel') || normalizedInput.includes('marketing only') ||
                normalizedInput.includes('no backend ui') || normalizedInput.includes('static html')) {
                manualExclusions.push('admindashboard');
            }

            // 🔒 MOBILE EXCLUSIONS (6 patterns)
            if (normalizedInput.includes('web only') || normalizedInput.includes('no mobile') ||
                normalizedInput.includes('no app') || normalizedInput.includes('desktop only') ||
                normalizedInput.includes('responsive web') || normalizedInput.includes('no react native')) {
                manualExclusions.push('mobileclients');
            }

            // 🔒 MULTI-TENANT EXCLUSIONS (8 patterns)
            if (normalizedInput.includes('single tenant') || normalizedInput.includes('no multi tenant') ||
                normalizedInput.includes('personal use') || normalizedInput.includes('no teams') ||
                normalizedInput.includes('solo project') || normalizedInput.includes('no workspaces') ||
                normalizedInput.includes('no orgs') || normalizedInput.includes('individual only')) {
                manualExclusions.push('multitenancy', 'multi_user_roles');
            }

            // 🔒 FILE UPLOAD EXCLUSIONS (8 patterns)
            if (normalizedInput.includes('no uploads') || normalizedInput.includes('no files') ||
                normalizedInput.includes('static assets') || normalizedInput.includes('no storage') ||
                normalizedInput.includes('embedded images') || normalizedInput.includes('no documents') ||
                normalizedInput.includes('no blob') || normalizedInput.includes('no cdn uploads')) {
                manualExclusions.push('filestorage', 'document_storage');
            }

            console.log('[EXCLUSION DETECTOR] Manual exclusions found:', manualExclusions);

            console.log("--- STEP 1: AI Intent Normalization (ONCE) ---");
            const rawStep1 = await aiService.normalizeIntent(userInput, conversationHistory || []);

            // ═════════════════════════════════════════════════════════════════
            // STEP 1.5: CAPABILITY RESOLUTION (DETERMINISTIC)
            // ═════════════════════════════════════════════════════════════════
            // CRITICAL RULE: Capabilities are INTENT, not SERVICES.
            // Mapping to services happens in Step 2 (pattern resolution).
            // ═════════════════════════════════════════════════════════════════

            // START with capabilities derived from NEW axes format (if present)
            let resolvedCapabilities = mapAxesToCapabilities(rawStep1.axes);

            // MERGE with legacy explicit_capabilities and inferred_capabilities
            const explicitExclusions = [...new Set([...(rawStep1.explicit_exclusions || []), ...manualExclusions])];
            const explicitCapabilities = rawStep1.explicit_capabilities || {};
            const inferredCapabilities = rawStep1.inferred_capabilities || {};

            TRACKED_CAPABILITIES.forEach(capability => {
                // Priority 1: Explicit Exclusions (HIGHEST - TERMINAL)
                if (explicitExclusions.includes(capability) || explicitExclusions.includes(capability.split('_')[0])) {
                    resolvedCapabilities[capability] = false;
                }
                // Priority 2: Explicit Capabilities (from legacy format)
                else if (explicitCapabilities[capability] === true) {
                    resolvedCapabilities[capability] = true;
                }
                // Priority 3: Inferred from legacy format (Threshold 0.6)
                else if (inferredCapabilities[capability] && inferredCapabilities[capability].confidence >= 0.6) {
                    resolvedCapabilities[capability] = inferredCapabilities[capability].value;
                }
                // Priority 4: Already resolved from axes (keep if not unknown)
                else if (resolvedCapabilities[capability] !== undefined && resolvedCapabilities[capability] !== 'unknown') {
                    // Already set from axes mapping, keep it
                }
                // Default: Unknown
                else {
                    resolvedCapabilities[capability] = 'unknown';
                }
            });

            // ═════════════════════════════════════════════════════════════════
            // TERMINAL EXCLUSIONS: Once excluded, NEVER reappear
            // ═════════════════════════════════════════════════════════════════
            const terminalExclusions = Object.keys(resolvedCapabilities)
                .filter(cap => resolvedCapabilities[cap] === false);

            step1Result = {
                ...rawStep1,
                capabilities: resolvedCapabilities,           // 🆕 NEW: Provider-agnostic intent
                terminal_exclusions: terminalExclusions,      // 🔒 NEW: Immutable exclusions
                explicit_exclusions: explicitExclusions,      // Original AI output (preserved)

                // ⚠️ LEGACY COMPATIBILITY: Keep for gradual migration
                feature_signals: resolvedCapabilities         // Alias for backward compat
            };
            console.log("AI Snapshot Created & Resolved");
            console.log("Resolved Capabilities:", JSON.stringify(resolvedCapabilities));
            console.log("Terminal Exclusions:", JSON.stringify(terminalExclusions));
        }


        // ═══════════════════════════════════════════════════════════════════
        // NEW: CONFIG-BASED QUESTION SELECTION (from Step1.txt specification)
        // Uses axesConfig.json impact scores and AI confidence for prioritization
        // ═══════════════════════════════════════════════════════════════════

        // Store conversation history for tracking questions asked
        const storedHistory = conversationHistory || [];
        const questionsAskedCount = storedHistory.filter(m => m.role === 'assistant').length;

        // ═══════════════════════════════════════════════════════════════════
        // AUTO-LOCK CHECK: If 80%+ axes have high confidence, skip questions
        // ═══════════════════════════════════════════════════════════════════
        if (shouldAutoLock(step1Result.axes)) {
            console.log('[AUTO-LOCK] Skipping questions - high confidence intent');
            step1Result.lock_status = 'auto_locked';
            // Fall through to confirmation gate (no questions needed)
        } else {
            // Get prioritized axes using the new config-based system
            const prioritizedAxes = prioritizeAxesForQuestions(step1Result);
            const questions = generateQuestionsFromConfig(prioritizedAxes);

            // Use updated question limits
            const maxQuestions = MAX_QUESTIONS[step1Result.complexity] || MAX_QUESTIONS.MEDIUM;

            console.log(`[NEW SYSTEM] Complexity: ${step1Result.complexity || 'SIMPLE'}`);
            console.log(`[NEW SYSTEM] Questions asked: ${questionsAskedCount}`);
            console.log(`[NEW SYSTEM] Prioritized axes: ${prioritizedAxes.map(a => a.axis_key).join(', ')}`);

            // Check if we should ask more questions
            if (questions.length > 0 && questionsAskedCount < maxQuestions) {
                // Ask the highest priority question
                const nextQuestion = questions[0];

                console.log(`[NEW SYSTEM] Asking: ${nextQuestion.axis_key} - "${nextQuestion.question}"`);

                // Format options for frontend (support both string and object answers)
                const formattedOptions = nextQuestion.suggested_answers.map(answer => {
                    if (typeof answer === 'object') {
                        return {
                            label: answer.label,
                            value: answer.value || answer.label,
                            description: answer.description || null
                        };
                    }
                    // Legacy fallback for string answers
                    return { label: answer, value: answer, description: null };
                });

                return res.json({
                    step: 'refine_requirements',
                    data: {
                        status: 'NEEDS_CLARIFICATION',
                        clarifying_question: nextQuestion.question,
                        suggested_options: formattedOptions,
                        axis: nextQuestion.axis_key,
                        complexity: step1Result.complexity,
                        questions_asked: questionsAskedCount,
                        max_questions: maxQuestions,
                        extracted_data: step1Result.intent_classification,
                        full_analysis: step1Result
                    }
                });
            }
        }



        // --- STEP 1: CONFIRMATION GATE (MANDATORY per Step1.txt) ---
        // If we get here, either no ambiguities exist, or we hit the question limit.
        // We MUST ask the user to confirm the intent before generating the spec.

        if (!req.body.approvedIntent) {
            console.log("--- WAITING FOR USER CONFIRMATION ---");
            console.log(`[NEW SYSTEM] Intent complexity: ${step1Result.complexity || 'SIMPLE'}`);

            // ═════════════════════════════════════════════════════════════════
            // 🔒 VALIDATION LOGIC: Check for Conflicts
            // ═════════════════════════════════════════════════════════════════
            // Warn user if their exclusions contradict functional requirements
            const warnings = [];
            const caps = step1Result.capabilities || {};
            const exclusions = step1Result.terminal_exclusions || [];

            // 1. No Database vs Payments
            if ((exclusions.includes('data_persistence') || exclusions.includes('database'))) {
                if (caps.payments === true) {
                    warnings.push({
                        type: 'CONFLICT',
                        severity: 'high',
                        message: 'You requested "No Database", but Payment systems require secure transaction storage.',
                        resolution: 'A relational database will be included for PCI compliance.'
                    });
                }
                // 2. No Database vs Auth (Stateful)
                else if (caps.authentication === true && caps.stateful === true) {
                    warnings.push({
                        type: 'CONFLICT',
                        severity: 'medium',
                        message: 'You requested "No Database", but User Accounts require a store for profiles/sessions.',
                        resolution: 'A database/store will be included for identity management.'
                    });
                }
            }

            // 3. No Backend vs Dynamic Features
            if ((exclusions.includes('backend') || exclusions.includes('api'))) {
                const dynamicFeatures = [];
                if (caps.payments) dynamicFeatures.push('Payments');
                if (caps.realtime) dynamicFeatures.push('Real-time sync');
                if (caps.ml) dynamicFeatures.push('ML Inference');

                if (dynamicFeatures.length > 0) {
                    warnings.push({
                        type: 'CRITICAL_CONFLICT',
                        severity: 'critical',
                        message: `You requested "No Backend", but active features (${dynamicFeatures.join(', ')}) require server-side logic.`,
                        resolution: 'A backend service will be provisioned to support these features.'
                    });
                }
            }

            if (warnings.length > 0) {
                console.log('[VALIDATION] Generated warnings:', JSON.stringify(warnings));
            }

            // Mark intent as ready for locking
            step1Result.lock_status = 'ready_to_lock';

            return res.json({
                step: 'confirm_intent',
                data: {
                    status: 'WAITING_FOR_CONFIRMATION',
                    intent: step1Result.intent_classification,
                    warnings: warnings, // 🔥 NEW: Warning payload for frontend

                    // 🆕 NEW: Axes with confidence (from new 50+ axis system)
                    axes: step1Result.axes,
                    complexity: step1Result.complexity,

                    // Legacy compatibility
                    semantic_signals: step1Result.semantic_signals,
                    capabilities: step1Result.capabilities,
                    terminal_exclusions: step1Result.terminal_exclusions,
                    features: step1Result.feature_signals,
                    exclusions: step1Result.explicit_exclusions,
                    risk_domains: step1Result.risk_domains,

                    full_analysis: step1Result // Send full result to be sent back as 'approvedIntent'
                }
            });
        }


        // ═════════════════════════════════════════════════════════════════
        // LOCK APPROVED INTENT (immutable from this point)
        // ═════════════════════════════════════════════════════════════════
        // CRITICAL RULE: Terminal exclusions cannot be modified by any downstream step.
        // If a capability is in terminal_exclusions, it must NEVER appear in:
        // - Architecture diagram
        // - Cost estimation
        // - Terraform generation
        // - AI scoring
        // ═════════════════════════════════════════════════════════════════
        // If approvedIntent IS present (req.body.approvedIntent), we fall through to Step 2.
        step1Result = {
            ...req.body.approvedIntent,
            locked: true  // 🔒 Mark as immutable
        };

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
            // 🔒 FIX 2: Override hallucinated "Ecommerce" names
            project_name: (step2Result.project_name && !step2Result.project_name.toLowerCase().includes('ecommerce') && !step2Result.project_name.toLowerCase().includes('shopping'))
                ? step2Result.project_name
                : (identity.system_name !== 'Cloudiverse System' ? identity.system_name : (step1Result.intent?.project_description ? "Custom Project" : "REST API Backend")),
            project_summary: step2Result.project_summary || "Cloud-native infrastructure specification",
            architecture_pattern: step2Result.architecture_pattern || "three_tier_web",
            scores: scores,
            explanations: explanations,
            risk_review: step2Result.risk_review || { security: [], availability: [], cost: [] },

            // 🔒 FIX 1: STORE CANONICAL ARCHITECTURE (IMMUTABLE)
            // This becomes the single source of truth for all downstream steps
            canonical_architecture: patternResolution,

            // Region information (FIX 2: Ensure region is set in Step 2)
            region: {
                logical_region: "IN_PRIMARY", // Default to US_PRIMARY
                resolved_region: "ap-south-1",   // Default to ap-south-1 for AWS
                provider: null,                 // Will be set in Step 3 after provider selection
                intent: "AUTO"                  // Auto-select based on provider
            },

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
            modules: skeleton.required_services.map(service => {
                // 1. Normalize the service key (handle snake_case, PascalCase, etc.)
                // Example: 'Loadbalancer' -> 'loadbalancer', 'load_balancer' -> 'loadbalancer'
                const rawKey = service.service_class;
                const normalizedKey = rawKey.toLowerCase().replace(/_/g, '');

                // 2. Lookup in Centralized Display Map (Try strict match first, then normalized)
                let displayInfo = SERVICE_DISPLAY[rawKey] || SERVICE_DISPLAY[normalizedKey];

                // 3. Fallback: Lookup by known variants or partial matches
                if (!displayInfo) {
                    // map common variants to canonical keys in SERVICE_DISPLAY
                    const variants = {
                        'loadbalancer': 'loadbalancer',
                        'apigateway': 'apigateway',
                        'relationaldatabase': 'relationaldatabase',
                        'nosqldatabase': 'nosqldatabase',
                        'identityauth': 'identityauth',
                        'computevm': 'compute_vm', // SERVICE_DISPLAY might use underscores
                        'computeserverless': 'computeserverless',
                        'computecontainer': 'computecontainer',
                        'objectstorage': 'objectstorage',
                        'blockstorage': 'block_storage', // SERVICE_DISPLAY uses block_storage
                        'cdn': 'cdn',
                        'dns': 'dns',
                        'waf': 'waf',
                        'secretsmanager': 'secretsmanager',
                        'messagequeue': 'messagequeue',
                        'eventbus': 'eventbus',
                        'logging': 'logging',
                        'monitoring': 'monitoring',
                        'cache': 'cache'
                    };
                    const canonicalKey = variants[normalizedKey];
                    if (canonicalKey) {
                        displayInfo = SERVICE_DISPLAY[canonicalKey];
                    }
                }

                // 4. Ultimate Fallback (if still missing)
                if (!displayInfo) {
                    displayInfo = {
                        name: rawKey.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                        category: getCategoryForService(rawKey) || 'other',
                        description: service.description || 'Infrastructure Service',
                        icon: 'cloud'
                    };
                }

                return {
                    service_class: service.service_class, // Keep original for reference
                    category: displayInfo.category,
                    service_name: displayInfo.name, // The PRETTY name (e.g. "Load Balancer")
                    description: displayInfo.description,
                    icon: displayInfo.icon,
                    required: true,
                    specs: activeComponents[service.service_class] || {}
                };
            }),

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

        // 🔥 FIX 3: Enrich services with Descriptions for Frontend
        if (infraSpec.canonical_architecture) {
            infraSpec.canonical_architecture.display_services = generateServiceDisplay(
                infraSpec.canonical_architecture.architecture_services || []
            );
            // Also enrich nodes if they exist
            if (infraSpec.canonical_architecture.nodes) {
                infraSpec.canonical_architecture.nodes = infraSpec.canonical_architecture.nodes.map(node => {
                    const display = generateServiceDisplay([{ canonical_type: node.type }])[0];
                    return { ...node, description: display.description, label: display.name };
                });
            }
        }

        // 🔒 FIX 1 & 2: Integrity Guard
        // Enforce hard constraints on the finalized spec
        integrityService.sanitizeInfraSpec(step2Result.architecture_pattern, infraSpec);
        integrityService.enforcePatternMinimums(step2Result.architecture_pattern, infraSpec);

        // 🔒 FREEZE INFRASPEC: Step 3+ must be pure consumers
        // Prevent accidental mutation of canonical architecture and service classes
        Object.freeze(infraSpec.canonical_architecture);
        Object.freeze(infraSpec.service_classes);
        if (infraSpec.canonical_architecture?.deployable_services) {
            Object.freeze(infraSpec.canonical_architecture.deployable_services);
        }
        if (infraSpec.service_classes?.required_services) {
            Object.freeze(infraSpec.service_classes.required_services);
        }

        console.log('[STEP 2] ✓ InfraSpec frozen: canonical_architecture and service_classes are immutable');

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
        const { workspace_id, infraSpec, intent, cost_profile, usage_profile } = req.body;

        console.log("--- STEP 3: Cost Analysis Started ---");
        console.log(`Workspace ID: ${workspace_id || 'unknown'}`);
        console.log(`Cost Profile: ${cost_profile || 'COST_EFFECTIVE'}`);

        // 🔒 INVARIANT CHECK: Step 2 must complete before Step 3
        if (!infraSpec?.canonical_architecture?.deployable_services ||
            infraSpec.canonical_architecture.deployable_services.length === 0) {
            return res.status(400).json({
                error: 'Step-to-Step Invariant Violation',
                message: 'Step 3 requires Step 2 to complete first. infraSpec.canonical_architecture.deployable_services must exist.',
                step_required: 'Step 2 (Infrastructure Specification)',
                current_step: 'Step 3 (Cost Analysis)'
            });
        }

        console.log(`[INVARIANT CHECK] ✓ Step 2 completed: ${infraSpec.canonical_architecture.deployable_services.length} deployable services`);

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

        const costProfile = cost_profile || 'cost_effective';
        const selected_provider = req.body.selected_provider || 'AWS'; // Need to extract provider from request
        let costAnalysis;
        let scenarios = null;

        // 🔒 STEP 3: Profile → Sizing resolver (CORE IMPLEMENTATION)
        // Same services, different numbers + tiers
        function resolveSizingForAllServices(deployableServices, profile, provider) {
            const sizingModel = require('../services/cost/sizingModel');

            const resolvedSizing = {};

            for (const service of deployableServices) {
                // Use the sizing model to get appropriate sizing based on profile
                const sizing = sizingModel.getSizing(service, 'MEDIUM', profile);
                resolvedSizing[service] = sizing;
            }

            return resolvedSizing;
        }

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

        // 🔒 STEP 3 INVARIANT CHECK: Ensure canonical architecture deployable_services are frozen
        if (!infraSpec.canonical_architecture?.deployable_services ||
            infraSpec.canonical_architecture.deployable_services.length === 0) {
            return res.status(400).json({
                error: 'Step 3 Invariant Violation',
                message: 'Step 3 requires canonical architecture deployable services to exist. These must never change between cost profiles.',
                step_required: 'Step 2 (Infrastructure Specification)',
                current_step: 'Step 3 (Cost Analysis)'
            });
        }

        // 🔒 INVALID EXCLUSION CHECK: payments/auth + no_database conflict
        // If user excluded database but requires features that need persistent storage, fail fast
        const terminalExclusions = infraSpec.locked_intent?.terminal_exclusions || [];
        const hasNoDatabase = terminalExclusions.includes('database') ||
            terminalExclusions.includes('relational_database') ||
            infraSpec.features?.database === false;

        if (hasNoDatabase) {
            const requiredSvcs = infraSpec.service_classes?.required_services || [];
            const hasPayments = requiredSvcs.some(s => {
                const name = typeof s === 'string' ? s : (s?.service_class || s?.id || '');
                return name.includes('payment') || name === 'paymentgateway';
            });
            const hasAuth = requiredSvcs.some(s => {
                const name = typeof s === 'string' ? s : (s?.service_class || s?.id || '');
                return name.includes('identity') || name.includes('auth') || name === 'identity_auth';
            });

            if (hasPayments || hasAuth) {
                console.error('[INVALID_EXCLUSION] Payments/auth require persistent storage but database is excluded');
                return res.status(400).json({
                    error: 'INVALID_EXCLUSION',
                    reason: 'Payments and authentication require persistent storage. You cannot exclude database while requiring payment or auth features.',
                    conflicting_features: {
                        excluded: 'database',
                        required: hasPayments && hasAuth ? ['payments', 'authentication'] : hasPayments ? ['payments'] : ['authentication']
                    },
                    suggestion: 'Either remove the "no database" constraint or remove payment/authentication requirements from your project.'
                });
            }
        }

        // 🔥 FIX 1: HARD NORMALIZATION of services BEFORE sizing
        // Services must be objects with service_class for sizing to work
        if (infraSpec.service_classes?.required_services) {
            infraSpec.service_classes.required_services = infraSpec.service_classes.required_services
                .map(s => {
                    if (!s) return null;
                    if (typeof s === 'object' && s.service_class) return s;
                    if (typeof s === 'string') {
                        return { service_id: s, service_class: s, terraform: { supported: true } };
                    }
                    if (typeof s === 'object') {
                        const svcName = s.service || s.canonical_type || s.name || s.id || null;
                        if (!svcName) return null;
                        return { service_id: svcName, service_class: svcName, terraform: { supported: true } };
                    }
                    return null;
                })
                .filter(Boolean);
            console.log(`[NORMALIZATION] Required services normalized: ${infraSpec.service_classes.required_services.length}`);
        }

        if (infraSpec.canonical_architecture && infraSpec.canonical_architecture.deployable_services) {
            const originalLength = infraSpec.canonical_architecture.deployable_services.length;
            infraSpec.canonical_architecture.deployable_services = infraSpec.canonical_architecture.deployable_services
                .map(s => {
                    if (!s) return null;
                    if (typeof s === 'object' && s.service_class) return s;
                    if (typeof s === 'string') {
                        return { service_id: s, service_class: s, terraform: { supported: true } };
                    }
                    if (typeof s === 'object') {
                        const svcName = s.service || s.canonical_type || s.name || s.id || null;
                        if (!svcName) return null;
                        return { service_id: svcName, service_class: svcName, terraform: { supported: true } };
                    }
                    return null;
                })
                .filter(Boolean);

            console.log(`[NORMALIZATION] Deployable services: ${originalLength} → ${infraSpec.canonical_architecture.deployable_services.length} (normalized to objects)`);

            if (originalLength > 0 && infraSpec.canonical_architecture.deployable_services.length === 0) {
                console.error(`[NORMALIZATION] CRITICAL: All ${originalLength} services lost during normalization!`);
                return res.status(500).json({
                    error: 'SERVICE_NORMALIZATION_FAILURE',
                    message: 'All deployable services were lost during normalization. Check service data format.',
                    original_count: originalLength
                });
            }
        }

        // 🔥 FIX D: Pattern SSOT (Single Source of Truth)
        // Ensure we use the persisted pattern, do not re-calculate default
        if (!infraSpec.pattern && infraSpec.canonical_architecture?.pattern) {
            infraSpec.pattern = infraSpec.canonical_architecture.pattern;
        }
        if (!infraSpec.pattern && infraSpec.service_classes?.pattern) {
            infraSpec.pattern = infraSpec.service_classes.pattern;
        }

        console.log(`[COST ANALYSIS] Pattern SSOT: ${infraSpec.pattern || 'UNKNOWN'}`);

        // ✅ NOW calculate sizing AFTER normalization
        const sizingModel = require('../services/cost/sizingModel');
        const calculatedSizing = sizingModel.getSizingForInfraSpec(infraSpec, intent, costProfile);

        // Persist to infraSpec (will be returned to frontend and saved to workspace)
        infraSpec.sizing = calculatedSizing;

        console.log(`[STEP 3] ✓ Sizing calculated and persisted: tier=${calculatedSizing.tier}, profile=${calculatedSizing.profile}, services=${Object.keys(calculatedSizing.services).length}`);

        // 🔥 CRITICAL: Check if this is an operational analysis request before proceeding with cost analysis
        const description = intent?.intent_classification?.project_description?.toLowerCase() || '';
        if (description.includes('fail') ||
            description.includes('outage') ||
            description.includes('downtime') ||
            description.includes('operational') ||
            description.includes('impact') ||
            description.includes('blast radius') ||
            description.includes('mitigation')) {
            console.log(`[OPERATIONAL ANALYSIS] Detected operational analysis request: ${description.substring(0, 100)}...`);

            // For operational analysis, we return a specialized response
            // The cost calculation will handle this as an operational analysis
            console.log(`[OPERATIONAL ANALYSIS] Proceeding with operational analysis cost calculation...`);
        }

        // LAYER B: If usage_profile is provided, convert ranges to scenarios and calculate range
        // 🔥 FIX: Handle string inputs from frontend forms by parsing them
        // 🔥 FIX: Relaxed check to allow string inputs for monthly_users
        if (usage_profile && (usage_profile.monthly_users || usage_profile.monthly_users === 0)) {
            console.log("Using Usage Profile for Realistic Estimation");

            // Convert AI ranges (min/max) to scenarios
            const profileScenarios = {
                low: {
                    monthly_users: typeof usage_profile.monthly_users === 'object' ? usage_profile.monthly_users.min : Math.round(usage_profile.monthly_users * 0.2),
                    requests_per_user: typeof usage_profile.requests_per_user === 'object' ? usage_profile.requests_per_user.min : 10,
                    peak_concurrency: typeof usage_profile.peak_concurrency === 'object' ? usage_profile.peak_concurrency.min : 5,
                    data_transfer_gb: typeof usage_profile.data_transfer_gb === 'object' ? usage_profile.data_transfer_gb.min : 10,
                    data_storage_gb: typeof usage_profile.data_storage_gb === 'object' ? usage_profile.data_storage_gb.min : 5
                },
                expected: {
                    monthly_users: typeof usage_profile.monthly_users === 'object'
                        ? Math.round((usage_profile.monthly_users.min + usage_profile.monthly_users.max) / 2)
                        : usage_profile.monthly_users,
                    requests_per_user: typeof usage_profile.requests_per_user === 'object'
                        ? Math.round((usage_profile.requests_per_user.min + usage_profile.requests_per_user.max) / 2)
                        : usage_profile.requests_per_user || 30,
                    peak_concurrency: typeof usage_profile.peak_concurrency === 'object'
                        ? Math.round((usage_profile.peak_concurrency.min + usage_profile.peak_concurrency.max) / 2)
                        : usage_profile.peak_concurrency || 10,
                    data_transfer_gb: typeof usage_profile.data_transfer_gb === 'object'
                        ? Math.round((usage_profile.data_transfer_gb.min + usage_profile.data_transfer_gb.max) / 2)
                        : usage_profile.data_transfer_gb || 50,
                    data_storage_gb: typeof usage_profile.data_storage_gb === 'object'
                        ? Math.round((usage_profile.data_storage_gb.min + usage_profile.data_storage_gb.max) / 2)
                        : usage_profile.data_storage_gb || 20
                },
                high: {
                    monthly_users: typeof usage_profile.monthly_users === 'object' ? usage_profile.monthly_users.max : Math.round(usage_profile.monthly_users * 3),
                    requests_per_user: typeof usage_profile.requests_per_user === 'object' ? usage_profile.requests_per_user.max : 100,
                    peak_concurrency: typeof usage_profile.peak_concurrency === 'object' ? usage_profile.peak_concurrency.max : 50,
                    data_transfer_gb: typeof usage_profile.data_transfer_gb === 'object' ? usage_profile.data_transfer_gb.max : 200,
                    data_storage_gb: typeof usage_profile.data_storage_gb === 'object' ? usage_profile.data_storage_gb.max : 100
                }
            };

            // Calculate costs for all scenarios
            let scenarioResults;
            let scenarioSuccess = false;
            try {
                scenarioResults = await infracostService.calculateScenarios(
                    infraSpec,
                    intent,
                    profileScenarios
                );
                scenarioSuccess = true;
            } catch (scenarioError) {
                console.error('[SCENARIO CALCULATION ERROR]:', scenarioError);
                // Fallback will be handled after this if block
            }

            if (scenarioSuccess && scenarioResults) {
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
                // Fallback to legacy single-point estimation if scenario calculation fails
                try {
                    costAnalysis = await infracostService.performCostAnalysis(
                        infraSpec,
                        intent,
                        costProfile,
                        usage_profile // 🔥 FIX: Pass usage_profile to fallback verification
                    );
                } catch (analysisError) {
                    console.error('[COST ANALYSIS ERROR]:', analysisError);
                    // Ultimate fallback: Return a comprehensive valid response to prevent frontend crashes
                    return res.status(200).json({
                        step: 'cost_estimation',
                        data: {
                            status: 'PARTIAL_SUCCESS',
                            analysis_status: 'PARTIAL_SUCCESS',
                            cost_profile: costProfile,
                            deployment_type: 'fallback',
                            scale_tier: 'MEDIUM',
                            cost_mode: 'FALLBACK_MODE',
                            pricing_method_used: 'fallback_calculation',
                            rankings: [
                                {
                                    provider: 'AWS',
                                    monthly_cost: 100,
                                    formatted_cost: '$100.00',
                                    rank: 1,
                                    recommended: true,
                                    confidence: 0.5,
                                    score: 50,
                                    cost_range: { formatted: '$80 - $120/month' }
                                },
                                {
                                    provider: 'GCP',
                                    monthly_cost: 110,
                                    formatted_cost: '$110.00',
                                    rank: 2,
                                    recommended: false,
                                    confidence: 0.5,
                                    score: 45,
                                    cost_range: { formatted: '$90 - $130/month' }
                                },
                                {
                                    provider: 'AZURE',
                                    monthly_cost: 105,
                                    formatted_cost: '$105.00',
                                    rank: 3,
                                    recommended: false,
                                    confidence: 0.5,
                                    score: 48,
                                    cost_range: { formatted: '$85 - $125/month' }
                                }
                            ],
                            provider_details: {
                                AWS: {
                                    provider: 'AWS',
                                    total_monthly_cost: 100,
                                    formatted_cost: '$100.00/month',
                                    service_count: 1,
                                    is_mock: true,
                                    confidence: 0.5,
                                    cost_range: { formatted: '$80 - $120/month' }
                                },
                                GCP: {
                                    provider: 'GCP',
                                    total_monthly_cost: 110,
                                    formatted_cost: '$110.00/month',
                                    service_count: 1,
                                    is_mock: true,
                                    confidence: 0.5,
                                    cost_range: { formatted: '$90 - $130/month' }
                                },
                                AZURE: {
                                    provider: 'AZURE',
                                    total_monthly_cost: 105,
                                    formatted_cost: '$105.00/month',
                                    service_count: 1,
                                    is_mock: true,
                                    confidence: 0.5,
                                    cost_range: { formatted: '$85 - $125/month' }
                                }
                            },
                            recommended_provider: 'AWS',
                            recommended: {
                                provider: 'AWS',
                                monthly_cost: 100,
                                formatted_cost: '$100.00',
                                service_count: 1,
                                score: 50,
                                cost_range: {
                                    formatted: '$80 - $120/month'
                                }
                            },
                            confidence: 0.5,
                            confidence_percentage: 50,
                            confidence_explanation: ['Fallback calculation due to processing error'],
                            ai_explanation: {
                                confidence_score: 0.5,
                                rationale: 'Fallback cost estimate provided due to processing error.'
                            },
                            summary: {
                                cheapest: 'AWS',
                                most_performant: 'GCP',
                                best_value: 'AWS',
                                confidence: 0.5
                            },
                            assumption_source: 'fallback',
                            cost_sensitivity: {
                                level: 'medium',
                                label: 'Standard sensitivity',
                                factor: 'overall usage'
                            },
                            selected_services: {},
                            missing_components: [],
                            future_cost_warning: null,
                            category_breakdown: [
                                { category: 'Infrastructure', total: 100, service_count: 1 }
                            ],
                            cost_profiles: {
                                COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
                                HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
                            },
                            recommended_cost_range: {
                                formatted: '$80 - $120/month'
                            },
                            scenarios: {
                                low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
                                expected: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
                                high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
                            },
                            cost_range: { formatted: '$80 - $160/month' },
                            services: [],
                            drivers: [],
                            used_real_pricing: false
                        }
                    });
                }
            }

        } else {
            // Fallback to legacy single-point estimation
            try {
                costAnalysis = await infracostService.performCostAnalysis(
                    infraSpec,
                    intent,
                    costProfile,
                    usage_profile // 🔥 FIX: Pass usage_profile to fallback verification
                );
            } catch (analysisError) {
                console.error('[COST ANALYSIS ERROR]:', analysisError);
                // Ultimate fallback: Return a comprehensive valid response to prevent frontend crashes
                return res.status(200).json({
                    step: 'cost_estimation',
                    data: {
                        status: 'PARTIAL_SUCCESS',
                        analysis_status: 'PARTIAL_SUCCESS',
                        cost_profile: costProfile,
                        deployment_type: 'fallback',
                        scale_tier: 'MEDIUM',
                        cost_mode: 'FALLBACK_MODE',
                        pricing_method_used: 'fallback_calculation',
                        rankings: [
                            {
                                provider: 'AWS',
                                monthly_cost: 100,
                                formatted_cost: '$100.00',
                                rank: 1,
                                recommended: true,
                                confidence: 0.5,
                                score: 50,
                                cost_range: { formatted: '$80 - $120/month' }
                            },
                            {
                                provider: 'GCP',
                                monthly_cost: 110,
                                formatted_cost: '$110.00',
                                rank: 2,
                                recommended: false,
                                confidence: 0.5,
                                score: 45,
                                cost_range: { formatted: '$90 - $130/month' }
                            },
                            {
                                provider: 'AZURE',
                                monthly_cost: 105,
                                formatted_cost: '$105.00',
                                rank: 3,
                                recommended: false,
                                confidence: 0.5,
                                score: 48,
                                cost_range: { formatted: '$85 - $125/month' }
                            }
                        ],
                        provider_details: {
                            AWS: {
                                provider: 'AWS',
                                total_monthly_cost: 100,
                                formatted_cost: '$100.00/month',
                                service_count: 1,
                                is_mock: true,
                                confidence: 0.5,
                                cost_range: { formatted: '$80 - $120/month' }
                            },
                            GCP: {
                                provider: 'GCP',
                                total_monthly_cost: 110,
                                formatted_cost: '$110.00/month',
                                service_count: 1,
                                is_mock: true,
                                confidence: 0.5,
                                cost_range: { formatted: '$90 - $130/month' }
                            },
                            AZURE: {
                                provider: 'AZURE',
                                total_monthly_cost: 105,
                                formatted_cost: '$105.00/month',
                                service_count: 1,
                                is_mock: true,
                                confidence: 0.5,
                                cost_range: { formatted: '$85 - $125/month' }
                            }
                        },
                        recommended_provider: 'AWS',
                        recommended: {
                            provider: 'AWS',
                            monthly_cost: 100,
                            formatted_cost: '$100.00',
                            service_count: 1,
                            score: 50,
                            cost_range: {
                                formatted: '$80 - $120/month'
                            }
                        },
                        confidence: 0.5,
                        confidence_percentage: 50,
                        confidence_explanation: ['Fallback calculation due to processing error'],
                        ai_explanation: {
                            confidence_score: 0.5,
                            rationale: 'Fallback cost estimate provided due to processing error.'
                        },
                        summary: {
                            cheapest: 'AWS',
                            most_performant: 'GCP',
                            best_value: 'AWS',
                            confidence: 0.5
                        },
                        assumption_source: 'fallback',
                        cost_sensitivity: {
                            level: 'medium',
                            label: 'Standard sensitivity',
                            factor: 'overall usage'
                        },
                        selected_services: {},
                        missing_components: [],
                        future_cost_warning: null,
                        category_breakdown: [
                            { category: 'Infrastructure', total: 100, service_count: 1 }
                        ],
                        cost_profiles: {
                            COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
                            HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
                        },
                        recommended_cost_range: {
                            formatted: '$80 - $120/month'
                        },
                        scenarios: {
                            low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
                            expected: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
                            high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
                        },
                        cost_range: { formatted: '$80 - $160/month' },
                        services: [],
                        drivers: [],
                        used_real_pricing: false
                    }
                });
            }
        }

        // Bug #3: Guard AI call
        let aiExplanation = null;
        if (!costAnalysis || !costAnalysis.rankings || costAnalysis.rankings.length === 0) {
            console.warn("Skipping AI explanation: cost data incomplete");
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

                // 🔥 NEW: Generate dynamic provider reasoning (Step 3.5)
                try {
                    const providerReasoning = await aiService.generateProviderReasoning(
                        intent,
                        infraSpec,
                        costAnalysis
                    );

                    if (providerReasoning) {
                        console.log("Injecting AI provider reasoning into rankings");
                        costAnalysis.rankings.forEach(r => {
                            // Handle casing flexibility
                            const reasoning = providerReasoning[r.provider] ||
                                providerReasoning[r.provider.toUpperCase()] ||
                                providerReasoning[r.provider.toLowerCase()];

                            if (reasoning) {
                                r.pros = reasoning.pros || [];
                                r.cons = reasoning.cons || [];
                                r.best_for = reasoning.best_for || [];
                                r.not_ideal_for = reasoning.not_ideal_for || [];
                            }
                        });
                    }
                } catch (reasoningError) {
                    console.error("Reasoning injection failed:", reasoningError);
                    // Fallback to hardcoded defaults in model
                }

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

        // ✅ FIX 2: Update region with provider-specific resolved region
        const regionResolver = require('../services/infrastructure/regionResolver');
        const selectedProvider = safeProvider.toLowerCase();

        // Update region with provider-specific resolved region
        if (infraSpec.region) {
            const logicalRegion = infraSpec.region.logical_region || 'US_PRIMARY';
            const resolvedRegion = regionResolver.resolveRegion(logicalRegion, selectedProvider);

            infraSpec.region = {
                ...infraSpec.region,
                logical_region: logicalRegion,
                resolved_region: resolvedRegion,
                provider: selectedProvider,
                intent: 'AUTO'
            };

            console.log(`[STEP 3] Region updated: logical=${logicalRegion} → resolved=${resolvedRegion} for ${selectedProvider}`);
        }

        // ✅ FIX 3: Save updated infraSpec back to workspace with step completion flag
        if (workspace_id) {
            const { pool } = require('../config/db');
            try {
                // Fetch existing workspace
                const wsResult = await pool.query(
                    'SELECT state_json FROM workspaces WHERE id = $1',
                    [workspace_id]
                );

                if (wsResult.rows.length > 0) {
                    let stateJson = wsResult.rows[0].state_json || {};

                    // Update the infraSpec in the state
                    stateJson.infraSpec = infraSpec;

                    // Mark step 3 as completed
                    if (!stateJson.workflow_state) stateJson.workflow_state = {};
                    stateJson.workflow_state.step3_completed = true;
                    stateJson.workflow_state.last_step_completed = 'cost_estimation';

                    // Update workspace with new state
                    await pool.query(
                        'UPDATE workspaces SET state_json = $1, updated_at = NOW() WHERE id = $2',
                        [JSON.stringify(stateJson), workspace_id]
                    );

                    console.log(`[STEP 3] Updated workspace ${workspace_id} with completed region and sizing`);
                }
            } catch (saveError) {
                console.error('[STEP 3] Error saving updated infraSpec to workspace:', saveError);
            }
        }

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

                // ✅ PROFESSIONAL REPORT (Added via reportGenerator)
                professional_report: require('../services/shared/reportGenerator').generateProfessionalReport(
                    infraSpec,
                    costAnalysis,
                    safeProvider,
                    aiExplanation
                ),


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
                ),

                // ✅ FIX 3: Include sizing in response for frontend persistence
                // This ensures Step 4 Terraform uses the EXACT sizing from Step 3 cost calculation
                sizing: infraSpec.sizing
            }
        };

        res.json(responseData);

    } catch (error) {
        console.error("Step 3 Cost Analysis Error:", error);
        res.status(200).json({
            step: 'cost_estimation',
            data: {
                status: 'PARTIAL_SUCCESS',
                analysis_status: 'PARTIAL_SUCCESS',
                cost_profile: 'cost_effective',  // Fallback value
                deployment_type: 'fallback',
                scale_tier: 'MEDIUM',
                cost_mode: 'FALLBACK_MODE',
                pricing_method_used: 'fallback_calculation',
                rankings: [
                    {
                        provider: 'AWS',
                        monthly_cost: 100,
                        formatted_cost: '$100.00',
                        rank: 1,
                        recommended: true,
                        confidence: 0.5,
                        score: 50,
                        cost_range: { formatted: '$80 - $120/month' }
                    },
                    {
                        provider: 'GCP',
                        monthly_cost: 110,
                        formatted_cost: '$110.00',
                        rank: 2,
                        recommended: false,
                        confidence: 0.5,
                        score: 45,
                        cost_range: { formatted: '$90 - $130/month' }
                    },
                    {
                        provider: 'AZURE',
                        monthly_cost: 105,
                        formatted_cost: '$105.00',
                        rank: 3,
                        recommended: false,
                        confidence: 0.5,
                        score: 48,
                        cost_range: { formatted: '$85 - $125/month' }
                    }
                ],
                provider_details: {
                    AWS: {
                        provider: 'AWS',
                        total_monthly_cost: 100,
                        formatted_cost: '$100.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$80 - $120/month' }
                    },
                    GCP: {
                        provider: 'GCP',
                        total_monthly_cost: 110,
                        formatted_cost: '$110.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$90 - $130/month' }
                    },
                    AZURE: {
                        provider: 'AZURE',
                        total_monthly_cost: 105,
                        formatted_cost: '$105.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$85 - $125/month' }
                    }
                },
                recommended_provider: 'AWS',
                recommended: {
                    provider: 'AWS',
                    monthly_cost: 100,
                    formatted_cost: '$100.00',
                    service_count: 1,
                    score: 50,
                    cost_range: {
                        formatted: '$80 - $120/month'
                    }
                },
                confidence: 0.5,
                confidence_percentage: 50,
                confidence_explanation: ['Fallback calculation due to processing error'],
                ai_explanation: {
                    confidence_score: 0.5,
                    rationale: 'Fallback cost estimate provided due to processing error.'
                },
                summary: {
                    cheapest: 'AWS',
                    most_performant: 'GCP',
                    best_value: 'AWS',
                    confidence: 0.5
                },
                assumption_source: 'fallback',
                cost_sensitivity: {
                    level: 'medium',
                    label: 'Standard sensitivity',
                    factor: 'overall usage'
                },
                selected_services: {},
                missing_components: [],
                future_cost_warning: null,
                category_breakdown: [
                    { category: 'Infrastructure', total: 100, service_count: 1 }
                ],
                cost_profiles: {
                    COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
                    HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
                },
                recommended_cost_range: {
                    formatted: '$80 - $120/month'
                },
                scenarios: {
                    low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
                    expected: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
                    high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
                },
                cost_range: { formatted: '$80 - $160/month' },
                services: [],
                drivers: [],
                used_real_pricing: false,
                // Full provider details
                providers: {
                    AWS: {
                        provider: 'AWS',
                        total_monthly_cost: 100,
                        formatted_cost: '$100.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$80 - $120/month' }
                    },
                    GCP: {
                        provider: 'GCP',
                        total_monthly_cost: 110,
                        formatted_cost: '$110.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$90 - $130/month' }
                    },
                    AZURE: {
                        provider: 'AZURE',
                        total_monthly_cost: 105,
                        formatted_cost: '$105.00/month',
                        service_count: 1,
                        is_mock: true,
                        confidence: 0.5,
                        cost_range: { formatted: '$85 - $125/month' }
                    }
                },
                summary: { confidence: 0.5 },
                cost_profiles: {
                    COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
                    HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
                },
                missing_components: [],
                future_cost_warning: null,
                explanation: {
                    outcome_narrative: "Cost analysis completed using pattern-based fallback.",
                    confidence_score: 0.5,
                    critical_cost_drivers: [],
                    architectural_fit: "Standard pattern."
                },
                recommendation_facts: [],
                sizing: {}
            }
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
        const architectureDiagramService = require('../services/core/architectureDiagramService');
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

        // 🔒 INVARIANT CHECK: Step 3 must complete before Step 5
        if (!infraSpec?.sizing) {
            return res.status(400).json({
                error: 'Step-to-Step Invariant Violation',
                message: 'Step 5 requires Step 3 to complete first. infraSpec.sizing must exist (locked from Step 3).',
                step_required: 'Step 3 (Cost Analysis)',
                current_step: 'Step 5 (Terraform Generation)'
            });
        }

        // 🔒 INVARIANT CHECK: Step 2 region resolution must complete
        if (!infraSpec?.region?.resolved_region && !requirements?.region?.primary_region) {
            return res.status(400).json({
                error: 'Step-to-Step Invariant Violation',
                message: 'Step 5 requires Step 2 region resolution. infraSpec.region.resolved_region must exist.',
                step_required: 'Step 2 (Infrastructure Specification)',
                current_step: 'Step 5 (Terraform Generation)'
            });
        }

        console.log(`[INVARIANT CHECK] ✓ Step 3 completed: sizing.tier=${infraSpec.sizing.tier}`);
        console.log(`[INVARIANT CHECK] ✓ Step 2 region resolved: ${infraSpec.region?.resolved_region || requirements.region?.primary_region}`);

        console.log(`[TERRAFORM] InfraSpec:`, JSON.stringify(infraSpec, null, 2));
        console.log(`[TERRAFORM] InfraSpec pattern:`, infraSpec?.architecture_pattern || infraSpec?.canonical_architecture?.pattern);
        console.log(`[TERRAFORM] Services:`, infraSpec?.service_classes?.required_services?.map(s => s.canonical_type || s.service_class || s.name));

        // 🔥 TERRAFORM-SAFE MODE: Validate that deployable services have modules available for the selected provider
        if (infraSpec.canonical_architecture?.deployable_services && Array.isArray(infraSpec.canonical_architecture.deployable_services)) {
            const terraformModules = require('../services/terraform/terraformModules');
            const terraformServiceLocal = require('../services/infrastructure/terraformService');
            const providerLower = provider.toLowerCase();

            // Check if all deployable services have modules for the selected provider
            const missingModules = [];
            const availableServices = [];

            infraSpec.canonical_architecture.deployable_services.forEach(service => {
                // 🔥 CRITICAL FIX: Normalize service to string first (services can be objects or strings)
                const serviceName = typeof service === 'string' ? service :
                    (service?.service_class || service?.name || service?.canonical_type || 'unknown');

                // Normalize service name for module lookup
                const moduleFolderName = terraformServiceLocal.getModuleFolderName(serviceName);
                const lookupName = moduleFolderName === 'relational_db' ? 'relational_database' :
                    moduleFolderName === 'auth' ? 'identity_auth' :
                        moduleFolderName === 'ml_inference' ? 'ml_inference_service' :
                            moduleFolderName === 'websocket' ? 'websocket_gateway' :
                                moduleFolderName === 'serverless_compute' ? 'serverless_compute' :
                                    moduleFolderName === 'analytical_db' ? 'analytical_database' :
                                        moduleFolderName === 'push_notification' ? 'push_notification_service' :
                                            moduleFolderName;

                const module = terraformModules.getModule(lookupName, providerLower);
                if (module) {
                    // 🔥 FIX: Push the original service (string or objectified form)
                    availableServices.push(serviceName);
                } else {
                    missingModules.push({
                        service: serviceName,
                        normalized: lookupName,
                        provider: providerLower,
                        reason: 'MODULE_NOT_IMPLEMENTED'
                    });
                }
            });

            if (missingModules.length > 0) {
                console.warn(`[TERRAFORM-SAFE] Missing modules for services: ${missingModules.map(m => m.service).join(', ')}`);
                console.warn(`[TERRAFORM-SAFE] Proceeding with available services only: ${availableServices.join(', ')}`);

                // Update the canonical architecture to only include services with modules
                infraSpec.canonical_architecture.deployable_services = availableServices;
                console.log(`[TERRAFORM-SAFE] Filtered deployable services from ${availableServices.length + missingModules.length} to ${availableServices.length}`);
            }
        }

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

        // Generate modular Terraform project (V2) - NEW GENERATOR
        const terraformGenerator = require('../services/infrastructure/terraformGeneratorV2');

        try {
            console.log('[TERRAFORM] Calling terraformGenerator.generateTerraform...');

            const result = await terraformGenerator.generateTerraform(
                infraSpec.canonical_architecture,
                provider,
                infraSpec.region?.resolved_region || 'ap-south-1',
                project_name || 'cloudiverse-project'
            );

            console.log('[TERRAFORM] Project generated successfully');
            console.log(`[TERRAFORM] Files generated: ${Object.keys(result.files).length}`);

            res.json({
                success: true,
                terraform: {
                    project: result.files, // Files for frontend display
                    provider,
                    profile,
                    structure: 'modular' // V2 indicator
                },
                services: infraSpec.canonical_architecture.deployable_services,
                terraform_valid: true,
                downloadUrl: `/downloads/${result.zipPath}`, // Direct download link
                message: 'Terraform generated successfully (modular structure)'
            });
        } catch (terraformError) {
            console.error('[TERRAFORM GENERATION ERROR]:', terraformError);
            res.status(500).json({
                error: 'Failed to generate Terraform',
                message: terraformError.message,
                details: terraformError.stack
            });
        }
    } catch (error) {
        console.error('[TERRAFORM] Generation Error:', error);
        res.status(500).json({
            error: 'Failed to generate Terraform',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════
// ARCHITECTURE DISPLAY ENDPOINT
// Returns formatted service display for frontend visualization
// ═══════════════════════════════════════════════════════════════════
router.post('/architecture-display', async (req, res) => {
    try {
        const { infra_spec, pattern_resolution, canonical_architecture, sizing } = req.body;

        console.log('[ARCHITECTURE DISPLAY] Generating display data...');

        // Get services from canonical architecture or infra_spec
        let canonicalServices = [];
        if (canonical_architecture?.deployable_services) {
            canonicalServices = canonical_architecture.deployable_services;
        } else if (canonical_architecture?.services_contract?.services) {
            canonicalServices = canonical_architecture.services_contract.services;
        } else if (infra_spec?.services) {
            canonicalServices = infra_spec.services;
        }

        // Generate display-ready services
        const displayServices = generateServiceDisplay(canonicalServices);
        const groupedServices = groupServicesByCategory(displayServices);

        // Build response
        const displayData = {
            architecture_overview: infra_spec?.project_summary ||
                `Production-ready ${pattern_resolution?.selected_pattern?.replace(/_/g, ' ') || 'cloud'} architecture`,

            pattern: {
                name: pattern_resolution?.selected_pattern || 'HYBRID_PLATFORM',
                description: pattern_resolution?.description || 'Multi-capability cloud platform',
                score: pattern_resolution?.score || 0,
                alternatives: pattern_resolution?.alternatives || []
            },

            included_services: displayServices,
            grouped_services: groupedServices,

            service_counts: {
                total: displayServices.length,
                by_category: Object.fromEntries(
                    Object.entries(groupedServices).map(([k, v]) => [k, v.length])
                )
            },

            traffic_tier: sizing?.tier || 'Medium',

            // Metadata for frontend
            next_step: 'usage_estimation'
        };

        console.log(`[ARCHITECTURE DISPLAY] Generated: ${displayServices.length} services in ${Object.keys(groupedServices).length} categories`);

        res.json(displayData);
    } catch (error) {
        console.error('[ARCHITECTURE DISPLAY] Error:', error);
        res.status(500).json({ error: 'Failed to generate architecture display', message: error.message });
    }
});

/**
 * NEW: Export Generated Terraform as Zip
 * GET /api/workflow/export-terraform
 */
router.get('/export-terraform', async (req, res) => {
    console.log('[API] Request to export Terraform zip');
    try {
        const targetProvider = req.query.provider ? req.query.provider.toLowerCase() : null;
        const workspaceId = req.query.workspaceId;
        console.log(`[EXPORT] Target provider: ${targetProvider || 'ALL'}, Workspace: ${workspaceId || 'N/A'}`);

        let exportDir = null;

        // PATH A: High-Fidelity Export (using Workspace Data)
        if (workspaceId && targetProvider) {
            try {
                const wsRes = await pool.query("SELECT state_json, name FROM workspaces WHERE id = $1", [workspaceId]);
                if (wsRes.rows.length > 0) {
                    const infraSpec = wsRes.rows[0].state_json?.infraSpec;
                    const projectName = wsRes.rows[0].state_json?.infraSpec?.project_name || wsRes.rows[0].name || 'cloudiverse-project';

                    if (infraSpec) {
                        console.log('[EXPORT] Generating fresh full-project export...');
                        // Generate fresh full project
                        exportDir = await infracostService.generateFullProjectExport(infraSpec, targetProvider, projectName);
                    }
                }
            } catch (dbErr) {
                console.warn(`[EXPORT] Failed to fetch workspace ${workspaceId}, falling back to temp dir: ${dbErr.message}`);
            }
        }

        // PATH B: Fallback to existing temp dir (Infracost artifacts)
        let dirs = infracostService.getTerraformDirs();

        // If we generated a fresh export, use that as the source for the target provider
        if (exportDir) {
            dirs = { ...dirs, [targetProvider]: exportDir };
        }

        // Check availability
        const available = {
            aws: fs.existsSync(dirs.aws),
            gcp: fs.existsSync(dirs.gcp),
            azure: fs.existsSync(dirs.azure)
        };

        // Determine what to include
        const includeAws = available.aws && (!targetProvider || targetProvider === 'aws');
        const includeGcp = available.gcp && (!targetProvider || targetProvider === 'gcp');
        const includeAzure = available.azure && (!targetProvider || targetProvider === 'azure');

        if (!includeAws && !includeGcp && !includeAzure) {
            return res.status(404).json({
                error: targetProvider
                    ? `No Terraform code found for ${targetProvider}. Please generate it first.`
                    : "No Terraform code generated yet."
            });
        }

        res.attachment(`${(targetProvider || 'terraform')}-infra.zip`);
        const archive = archiver('zip', { zlib: { level: 9 } });

        archive.on('error', function (err) {
            console.error('[ZIP ERROR]', err);
            res.status(500).send({ error: err.message });
        });

        // Pipe to response
        archive.pipe(res);

        // Add AWS
        if (includeAws) {
            archive.directory(dirs.aws, 'aws');
        }

        // Add GCP
        if (includeGcp) {
            archive.directory(dirs.gcp, 'gcp');
        }

        // Add Azure
        if (includeAzure) {
            archive.directory(dirs.azure, 'azure');
        }

        // Add README directly
        const readmeContent = `# Cloudiverse Deployment Guide

This zip file contains the generated Terraform configuration for your architecture.

## 📂 Structure
- \`aws/\`: Terraform configuration for Amazon Web Services
- \`gcp/\`: Terraform configuration for Google Cloud Platform
- \`azure/\`: Terraform configuration for Microsoft Azure
- \`canonical_architecture.json\`: Machine-readable architecture definition

## 🚀 How to Deploy

### Prerequisites
1.  **Terraform CLI**: [Install Terraform](https://developer.hashicorp.com/terraform/downloads)
2.  **Cloud CLI**: Install and authenticate with your chosen provider:
    - **AWS**: [Install AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) -> Run \`aws configure\`
    - **GCP**: [Install gcloud CLI](https://cloud.google.com/sdk/docs/install) -> Run \`gcloud auth application-default login\`
    - **Azure**: [Install Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli) -> Run \`az login\`

### Deploying to AWS
1.  Navigate to the AWS directory: \`cd aws\`
2.  Initialize Terraform: \`terraform init\`
3.  Preview changes: \`terraform plan\`
4.  Apply infrastructure: \`terraform apply\`

### Deploying to GCP
1.  Navigate to the GCP directory: \`cd gcp\`
2.  Initialize: \`terraform init\`
3.  Apply: \`terraform apply\`

### Deploying to Azure
1.  Navigate to the Azure directory: \`cd azure\`
2.  Initialize: \`terraform init\`
3.  Apply: \`terraform apply\`

## ⚠️ Note on State Management
This configuration uses **local state** (\`terraform.tfstate\`). For team collaboration, use remote state (S3/GCS/Azure Storage).
`;

        // Add canonical_architecture.json
        const canonicalPath = path.join(path.dirname(dirs.aws), 'canonical_architecture.json');
        if (fs.existsSync(canonicalPath)) {
            archive.file(canonicalPath, { name: 'canonical_architecture.json' });
        }

        archive.append(readmeContent, { name: 'README.md' });

        archive.finalize();

    } catch (err) {
        console.error("Export error:", err);
        res.status(500).json({ error: "Failed to export Terraform code" });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// AI SERVICE SUGGESTIONS ENDPOINT
// Suggests complementary services based on user description and context
// ═══════════════════════════════════════════════════════════════════════════
router.post('/suggest-services', authMiddleware, async (req, res) => {
    try {
        const { user_description, domains = [], selected_services = [] } = req.body;

        if (!user_description || user_description.trim().length < 10) {
            return res.status(400).json({
                error: 'Please provide a meaningful project description (at least 10 characters)'
            });
        }

        // Load available services from catalog
        const servicesCatalog = require('../catalog/new_services.json');
        const availableServiceIds = servicesCatalog.services
            .filter(s => s.terraform_supported === true)
            .map(s => s.service_id);

        // Build prompt for AI
        const prompt = `You are a cloud architect assistant. Analyze the following project and suggest additional cloud services.

PROJECT DESCRIPTION: ${user_description}

BUSINESS DOMAINS: ${domains.length > 0 ? domains.join(', ') : 'Not specified'}

ALREADY SELECTED SERVICES: ${selected_services.length > 0 ? selected_services.join(', ') : 'None yet'}

AVAILABLE SERVICES: ${availableServiceIds.join(', ')}

Based on the project description (PRIMARY SOURCE) and context, suggest 3-5 additional services that would complement this architecture. Focus on:
1. Missing critical infrastructure (if needed)
2. Security best practices
3. Observability requirements
4. Scalability considerations

IMPORTANT: Only suggest services from the AVAILABLE SERVICES list. Do NOT invent service names.

Output ONLY valid JSON in this exact format:
{
  "suggestions": [
    { "service_id": "servicename", "reason": "Brief reason why this is useful" }
  ]
}`;

        const aiResponse = await aiService.getCompletion({
            systemPrompt: 'You are a cloud architecture expert. Always respond with valid JSON only.',
            userMessage: prompt,
            temperature: 0.3,
            maxTokens: 500
        });

        // Parse AI response
        let suggestions = [];
        try {
            const parsed = JSON.parse(aiResponse.content || aiResponse);
            suggestions = parsed.suggestions || [];

            // Filter to only valid services that aren't already selected
            const selectedSet = new Set(selected_services.map(s => s.toLowerCase()));
            const availableSet = new Set(availableServiceIds);

            suggestions = suggestions.filter(s =>
                availableSet.has(s.service_id) && !selectedSet.has(s.service_id)
            );
        } catch (parseError) {
            console.error('[SUGGEST-SERVICES] Failed to parse AI response:', parseError);
            // Fallback: Return common recommendations based on domains
            suggestions = generateFallbackSuggestions(domains, selected_services);
        }

        res.json({
            success: true,
            suggestions: suggestions.slice(0, 5), // Limit to 5
            source: suggestions.length > 0 ? 'ai' : 'fallback'
        });

    } catch (error) {
        console.error('[SUGGEST-SERVICES] Error:', error);
        res.status(500).json({
            error: 'Failed to generate suggestions',
            suggestions: []
        });
    }
});

/**
 * Fallback suggestions when AI fails
 */
function generateFallbackSuggestions(domains, selectedServices) {
    const selectedSet = new Set(selectedServices.map(s => s.toLowerCase()));
    const suggestions = [];

    // Common recommendations based on domains
    const domainSuggestions = {
        'fintech': ['paymentgateway', 'secretsmanagement', 'waf', 'auditlogging'],
        'ecommerce': ['cdn', 'cache', 'searchengine', 'objectstorage'],
        'healthcare': ['secretsmanagement', 'auditlogging', 'keymanagement', 'vpcnetworking'],
        'saas': ['identityauth', 'monitoring', 'logging', 'loadbalancer'],
        'iot': ['iotcore', 'messagequeue', 'timeseriesdatabase', 'streamprocessor'],
        'analytics': ['datawarehouse', 'etlorchestration', 'bidashboard', 'datalake'],
        'machine_learning': ['mltraining', 'mlinference', 'vectordatabase', 'featurestore']
    };

    // Universal recommendations
    const universalRecs = [
        { service_id: 'logging', reason: 'Centralized logging is essential for debugging and compliance' },
        { service_id: 'monitoring', reason: 'Monitor application health and performance' },
        { service_id: 'secretsmanagement', reason: 'Secure credential management for API keys and secrets' }
    ];

    // Add domain-specific suggestions
    for (const domain of domains) {
        const domainKey = domain.toLowerCase().replace(/[^a-z]/g, '_');
        const domainRecs = domainSuggestions[domainKey] || [];
        for (const svc of domainRecs) {
            if (!selectedSet.has(svc)) {
                suggestions.push({ service_id: svc, reason: `Recommended for ${domain} applications` });
            }
        }
    }

    // Add universal recommendations
    for (const rec of universalRecs) {
        if (!selectedSet.has(rec.service_id) && !suggestions.some(s => s.service_id === rec.service_id)) {
            suggestions.push(rec);
        }
    }

    return suggestions.slice(0, 5);
}

module.exports = router;
