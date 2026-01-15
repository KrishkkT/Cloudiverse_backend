const Groq = require('groq-sdk');
require('dotenv').config();

console.log("Checking Groq API Key:", process.env.GROQ_API_KEY ? "Present" : "Missing");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// 🔒 MASTER SYSTEM PROMPT (PASTE AS-IS)
// REQUIRED FOR ALL AI INTERACTIONS
// 🔒 MASTER SYSTEM PROMPT (Keep for other steps if needed)
const MASTER_SYSTEM_PROMPT = `
You are an AI sub-component inside a deterministic infrastructure planning system.
... (legacy master prompt content kept for safety if used elsewhere) ...
`;

// ═══════════════════════════════════════════════════════════════════
// STEP 1 — NEW COMPREHENSIVE INTENT EXTRACTION SYSTEM
// Based on Step1.txt specification - 50+ axes with confidence scoring
// ═══════════════════════════════════════════════════════════════════

const STEP_1_SYSTEM_PROMPT = `
You are an expert multi-cloud solution architect working for a product called "Cloudiverse Architect".

Your task is to analyze a single free-form project description from a user and produce a structured "intent" object.

This intent object will be used in an automated pipeline to:
- select canonical architecture patterns,
- design cloud architectures on AWS, Azure, or GCP,
- estimate costs,
- and generate Terraform.

You MUST:
1) Classify the project into one or more categories.
2) Estimate values for a predefined set of decision axes (functional and non-functional).
3) Estimate the complexity of the project.
4) Identify which decision axes are still unclear and should be clarified with follow-up questions.

IMPORTANT PRINCIPLES:
- You are allowed to infer reasonable defaults when the description strongly suggests them, but you must always track CONFIDENCE.
- If something is not clearly specified, set its value to null and use low confidence.
- Do NOT invent very specific numeric values; use the defined enums.- When in doubt between safety and convenience, prefer SAFETY: do not assume low data sensitivity or no compliance unless it is clearly implied.
- Do NOT assume 'ecommerce' unless explicitly stated (e.g. 'shop', 'store', 'sell'). For generic APIs, use 'api_backend' or 'saas'.
- If user mentions 'app_compute', 'containers', or 'cluster', prefer 'managed_services_pref' or 'kubernetes_pref' for ops_model.

-----------------
DECISION AXES & CATEGORIES
-----------------

A. Project & domain axes
- primary_domain: enum (api_backend, web_application, infrastructure, devtools, saas, ecommerce, fintech, healthcare, gaming, portfolio, other)
- project_categories: array of strings

B. Functional capability axes (boolean)
- static_content, api_backend, user_authentication, multi_tenancy
- file_storage, realtime_updates, messaging_queue, scheduled_jobs
- payments, search, admin_dashboard, mobile_clients, third_party_integrations

C. Scale & usage axes (enum)
- estimated_mau: very_low, low, medium, high, very_high
- peak_rps: very_low, low, medium, high, very_high
- traffic_pattern: steady, spiky, seasonal
- performance_sensitivity: low, medium, high
- burstiness: low, medium, high

D. Data & storage axes
- stateful: boolean
- primary_data_model: none, relational, document, key_value, time_series, graph, mixed
- data_volume: tiny, small, medium, large, huge
- data_growth_rate: slow, moderate, fast
- data_sensitivity: low, medium, high
- data_residency_required: boolean
- backup_retention_days: 7, 30, 90, 365

E. Security & compliance axes
- authentication_strength: basic, standard, strong_mfa
- authorization_complexity: simple_roles, role_based, fine_grained
- regulatory_compliance: array (GDPR, HIPAA, PCI_DSS, SOC2, ISO27001)
- security_posture: basic, hardened, zero_trust_like

F. Availability, reliability & DR axes
- availability_target: 99.0, 99.5, 99.9, 99.99
- recovery_time_objective: hours, 1_hour, 30_minutes, 5_minutes
- recovery_point_objective: 24_hours, 4_hours, 1_hour, 5_minutes
- multi_region_required: boolean

G. Observability & operations axes
- observability_level: basic, standard, advanced
- deployment_frequency: monthly, weekly, daily, multiple_times_per_day
- change_risk_tolerance: low, medium, high
- ops_team_maturity: none, junior, experienced, dedicated_sre

H. Cloud, region & cost axes
- allowed_providers: array (aws, azure, gcp)
- primary_region_hint: string or null
- provider_lock_in_sensitivity: low, medium, high
- ops_model: serverless_pref, managed_services_pref, kubernetes_pref, no_preference
- managed_db_preference: prefer_managed, self_managed_ok, no_db
- kubernetes_required: boolean
- cost_sensitivity: low, medium, high
- project_lifetime: poc, short_term, long_term

I. Domain-specific flags (boolean)
- domain_fintech, domain_healthcare, domain_iot, domain_gaming, domain_ml_heavy, domain_internal_it

J. UX / channels (boolean)
- web_ui, mobile_apps, public_api

-----------------
COMPLEXITY ESTIMATION
-----------------

Set complexity = "SIMPLE" or "COMPLEX"

Rules of thumb:
- SIMPLE: static websites, small marketing sites, simple CRUD apps, low scale, low data sensitivity, no strong compliance, no heavy data pipelines.
- COMPLEX: fintech, healthcare, high scale, multi-region, strong compliance, advanced data pipelines, ML systems, streaming systems, or many interacting components.

-----------------
RANKING AXES FOR QUESTIONS
-----------------

Your role is to:
1) Identify which axes are most important to clarify.
2) Rank them by priority.

Priority should consider:
- Impact on architecture and risk (highest for: data_sensitivity, regulatory_compliance, availability_target, stateful, allowed_providers, primary_region_hint).
- How uncertain you are (low confidence or null -> higher need to ask).

You must return a "ranked_axes_for_questions" array.
Each item:
- axis_key: the axis name (e.g. "data_sensitivity").
- priority: number between 0 and 1 (higher = more important to clarify).

Selection rules:
- If complexity == "SIMPLE": keep at most 3 axes in this list.
- If complexity == "COMPLEX": keep at most 6 axes in this list.
- It is OK to keep fewer if everything is already clear (high confidence).

-----------------
OUTPUT FORMAT
-----------------

You MUST output a single JSON object with EXACTLY this structure:

{
  "intent_classification": {
    "primary_domain": "<string or null>",
    "project_categories": ["<category1>", "..."],
    "workload_type": "<string or null>",
    "user_facing": <true|false|null>
  },
  "complexity": "SIMPLE" | "COMPLEX",
  "axes": {
    "<axis_name>": {
      "value": <axis_value_or_null>,
      "confidence": <number_0_to_1>
    }
  },
  "ranked_axes_for_questions": [
    {
      "axis_key": "<axis_name>",
      "priority": <number_0_to_1>
    }
  ]
}

Do not include any text outside this JSON.
Do not explain your reasoning in natural language.
`;

/**
 * STEP 1 — INTENT NORMALIZATION & CONFIRMATION (NEW VERSION)
 * Goal: Extract comprehensive intent with 50+ axes and confidence scores.
 * Returns structured intent object ready for adaptive questioning.
 */
const normalizeIntent = async (userInput, conversationHistory = [], optionalHints = {}) => {
  console.log("--- STEP 1: Intent Normalization (NEW 50+ AXES) ---");
  try {
    const stepPrompt = `
User project description:
"${userInput}"

Additional hints (optional):
${JSON.stringify(optionalHints, null, 2)}

Analyze this description and produce the structured intent object as specified.
Remember:
- Track confidence for EVERY axis
- Set complexity based on the rules
- Rank axes by priority for follow-up questions
- Output ONLY valid JSON
`;

    const messages = [
      { role: "system", content: STEP_1_SYSTEM_PROMPT },
      ...conversationHistory,
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: process.env.AI_MODEL || "llama-3.1-8b-instant",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    let result;
    try {
      result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (parseErr) {
      console.error("AI JSON Parse Error:", parseErr);
      result = getDefaultIntentResult();
    }

    // Validate and normalize the result
    result = normalizeAIResult(result);

    console.log("AI Step 1 Output:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error("Intent Norm Error:", error.message);
    return getDefaultIntentResult();
  }
};

/**
 * Get default intent result for error fallback
 */
function getDefaultIntentResult() {
  return {
    intent_classification: {
      primary_domain: "unknown",
      project_categories: ["general"],
      workload_type: "web_application",
      user_facing: true
    },
    complexity: "SIMPLE",
    axes: {
      static_content: { value: null, confidence: 0.3 },
      api_backend: { value: null, confidence: 0.3 },
      user_authentication: { value: null, confidence: 0.3 },
      stateful: { value: null, confidence: 0.3 },
      data_sensitivity: { value: null, confidence: 0.3 },
      estimated_mau: { value: "low", confidence: 0.3 },
      availability_target: { value: "99.5", confidence: 0.3 },
      allowed_providers: { value: [], confidence: 0.1 }
    },
    ranked_axes_for_questions: [
      { axis_key: "data_sensitivity", priority: 0.9 },
      { axis_key: "availability_target", priority: 0.8 },
      { axis_key: "allowed_providers", priority: 0.7 }
    ]
  };
}

/**
 * Normalize and validate AI result to ensure all required fields exist
 */
function normalizeAIResult(result) {
  // Ensure intent_classification exists
  if (!result.intent_classification) {
    result.intent_classification = {
      primary_domain: "unknown",
      project_categories: [],
      workload_type: "web_application",
      user_facing: true
    };
  }

  // Ensure complexity exists and is valid
  if (!result.complexity || !["SIMPLE", "COMPLEX"].includes(result.complexity)) {
    result.complexity = "SIMPLE";
  }

  // Ensure axes object exists
  if (!result.axes || typeof result.axes !== 'object') {
    result.axes = {};
  }

  // Ensure ranked_axes_for_questions exists and is an array
  if (!Array.isArray(result.ranked_axes_for_questions)) {
    result.ranked_axes_for_questions = [];
  }

  // Limit ranked axes based on complexity
  const maxQuestions = result.complexity === "COMPLEX" ? 6 : 3;
  result.ranked_axes_for_questions = result.ranked_axes_for_questions.slice(0, maxQuestions);

  return result;
}


// STEP 2 SYSTEM PROMPT (from Step2.txt)
const STEP_2_SYSTEM_PROMPT = `
STEP 2 — SYSTEM PROMPT 
You are an infrastructure analysis AI inside a deterministic backend system.

STRICT ROLE BOUNDARIES:
1. You do NOT choose cloud providers.
2. You do NOT choose instance sizes.
3. You do NOT write Terraform or IaC.
4. You do NOT enforce security, availability, or compliance.
5. You do NOT modify the intent object.

Your job is ONLY to:
- Analyze the locked intent object
- Propose logical architecture patterns
- Describe component roles
- Highlight risks and tradeoffs
- Provide review scores and explanations

You MUST:
- Output STRICT JSON only
- Follow the schema exactly
- Avoid cloud-specific terms (no EC2, GKE, RDS, etc.)
- Avoid defaults
- Avoid guessing numbers

Think like a senior architect doing a design review.
`;

// 🔥 FINAL SYSTEM PROMPT (STEP 2 → STEP 5 SAFE)
// Use this verbatim (or extremely close).
const TERRAFORM_SAFE_PROMPT = `
You are an infrastructure planning engine for Cloudiverse.

Your job is to produce a Terraform-safe infrastructure plan that MUST
successfully generate Terraform code for the selected cloud provider.

STRICT RULES (NON-NEGOTIABLE):

1. Only select services from the Canonical Service Registry.
2. NEVER include logical-only services in deployable_services.
   Logical-only services include but are not limited to:
   - event_bus
   - waf
   - payment_gateway
   - artifact_registry

3. A service may be included in deployable_services ONLY IF:
   - terraform_supported === true
   - a module exists OR a minimal fallback module is allowed

4. If a project type normally requires a service that is NOT fully implemented
   for the selected provider, you MUST:
   - downgrade the architecture to a Terraform-safe alternative, OR
   - replace it with a simpler deployable service, OR
   - exclude it with a clear reason

5. Terraform generation MUST NEVER fail due to missing modules.
   If full fidelity is not possible, prioritize:
   - deployability over completeness
   - minimal viable infrastructure over ideal architecture

6. Always prefer these Terraform-safe core services when possible:
   - networking
   - app_compute OR serverless_compute
   - relational_database
   - object_storage
   - load_balancer
   - cdn
   - logging
   - monitoring
   - message_queue
   - identity_auth

7. If the user input is vague, incomplete, or extreme, you MUST:
   - select a safe baseline pattern
   - include only universally supported services
   - avoid advanced or niche services

8. The final output MUST include:
   - canonical_architecture.deployable_services (Terraform-safe only)
   - a clear list of excluded_services with reasons
   - sizing that matches deployable services

FAILURE CONDITIONS:
- Do NOT output services that cannot be deployed with Terraform.
- Do NOT output provider-incompatible services.
- Do NOT assume future module availability.

SUCCESS CONDITION:
Terraform code must be generated successfully for the selected provider
with no missing modules.
`;

/**
 * STEP 2 — INFRA SPEC GENERATION
 * Goal: Generate a provider-agnostic, safe, deterministic InfraSpec logic pattern.
 * AI analyzes and proposes, Backend constructs the final InfraSpec.
 */
const generateConstrainedProposal = async (intentObject) => {
  console.log("--- STEP 2: Architecture Analysis (AI) ---");
  try {
    const stepPrompt = `
Analyze the following locked Intent Object and provide architecture recommendations.

🔹 LOCKED INTENT OBJECT
${JSON.stringify(intentObject, null, 2)}

🔹 REQUIRED OUTPUT SCHEMA (JSON)
{
  "architecture_pattern": "string (e.g. stateful_multi_user_platform, three_tier_web, event_driven)",
  
  "component_roles": {
    "networking": {
      "isolation_required": boolean
    },
    "compute": {
      "execution_model": "string (e.g. orchestrated_runtime, serverless, monolith)",
      "stateful": boolean,
      "scaling_driver": "string (e.g. request_latency, cpu_utilization, queue_depth)"
    },
    "data": {
      "database_type": "string (e.g. relational, document, key_value)",
      "consistency": "string (e.g. strong, eventual)",
      "write_intensity": "string (e.g. low, medium, high)"
    },
    "cache": {
      "recommended": boolean,
      "purpose": "string (e.g. read_acceleration, session_storage)"
    },
    "observability": {
      "importance": "string (e.g. low, medium, high)"
    }
  },
  
  "risk_review": {
    "security": ["array of security risk notes"],
    "availability": ["array of availability risk notes"],
    "cost": ["array of cost risk notes"]
  },
  
  "review_scores": {
    "architecture_soundness": number (0-100),
    "security_posture": number (0-100),
    "operational_readiness": number (0-100)
  },
  
  "explanations": {
    "key_decision_1": "reason",
    "key_decision_2": "reason",
    "key_decision_3": "reason",
    "key_decision_4": "reason"
  },

  "project_name": "string (Creative, Professional Name for the system)",
  "project_summary": "string (Short, 1-sentence value prop)"
}

❌ AI MUST NOT RETURN: cloud services, instance sizes, regions, CIDRs, enforcement decisions, user questions
CRITICAL: The "explanations" object must contain EXACTLY 4 key-value pairs representing the most important architectural notes (e.g. Region, Security Mode, Scaling Pattern, Data Strategy). Keys must be short titles.
`;

    const messages = [
      { role: "system", content: STEP_2_SYSTEM_PROMPT },
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: process.env.AI_MODEL || "llama-3.1-8b-instant",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    console.log("AI Step 2 Output:", JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("AI Proposal Error:", error.message);
    // Return safe fallback instead of throwing
    return {
      architecture_pattern: "generic_web_application",
      component_roles: {
        networking: { isolation_required: true },
        compute: { execution_model: "orchestrated_runtime", stateful: false, scaling_driver: "cpu_utilization" },
        data: { database_type: "relational", consistency: "strong", write_intensity: "medium" },
        cache: { recommended: true, purpose: "read_acceleration" },
        observability: { importance: "medium" }
      },
      risk_review: { security: [], availability: [], cost: [] },
      review_scores: { architecture_soundness: 75, security_posture: 75, operational_readiness: 75 },
      explanations: { fallback: "AI analysis failed, using safe defaults" },
      project_name: "CloudApp",
      project_summary: "Cloud-native application"
    };
  }
};

// STEP 2 SCORING SYSTEM PROMPT (from Step2.txt)
const SCORING_SYSTEM_PROMPT = `
You are an infrastructure review and scoring assistant inside a deterministic backend system.

CRITICAL ROLE LIMITS (NON-NEGOTIABLE):

1. You do NOT compute the final overall score.
2. You do NOT enforce rules or policies.
3. You do NOT change the InfraSpec.
4. You do NOT optimize for a perfect score.
5. You do NOT compare this project to other projects.

Your role is strictly to:
- Evaluate the provided InfraSpec against the confirmed Intent Object
- Assign category-level assessment scores
- Identify strengths, weaknesses, and risks
- Explain WHY the architecture is suitable or risky
- Provide neutral, engineering-grade feedback

The backend will compute the final Overall Score.
Your scores are inputs, not authority.

SCORING PHILOSOPHY:
Scores represent alignment and readiness, not perfection.
- 100 does NOT mean flawless
- 80-90 means production-ready with reasonable tradeoffs
- Lower scores indicate missing guarantees or elevated risk

You must score conservatively.
Do NOT inflate scores.
Do NOT reward unnecessary complexity.

OUTPUT STRICT JSON ONLY. NO prose. NO markdown.
`;

/**
 * STEP 2 — AI SCORING (SEPARATE FROM ARCHITECTURE ANALYSIS)
 * AI provides category scores, backend computes final overall score
 * @param intentObject - The locked intent from Step 1
 * @param infraSpec - The constructed InfraSpec
 * @param provenance - Intent provenance (which axes were user-provided vs defaulted)
 */
const scoreInfraSpec = async (intentObject, infraSpec, provenance = {}) => {
  console.log("--- STEP 2: AI Scoring & Review ---");
  try {
    const scoringPrompt = `
Evaluate the following InfraSpec against the Intent Object.

🔹 LOCKED INTENT OBJECT
${JSON.stringify(intentObject, null, 2)}

🔹 INTENT PROVENANCE (CRITICAL)
User-provided decision axes: ${JSON.stringify(provenance.user_provided_axes || [], null, 2)}
Defaulted decision axes: ${JSON.stringify(provenance.defaulted_axes || [], null, 2)}

🔹 INFRASPEC TO EVALUATE
${JSON.stringify(infraSpec, null, 2)}

🔹 REQUIRED OUTPUT SCHEMA (JSON)
{
  "category_scores": {
    "architecture_soundness": number (0-100),
    "security_posture": number (0-100),
    "reliability": number (0-100),
    "operational_readiness": number (0-100)
  },

  "risk_alignment": {
    "critical_risks": [],
    "moderate_risks": [],
    "low_risks": []
  },

  "strengths": [
    "short factual engineering statements"
  ],

  "weaknesses": [
    "short factual engineering statements"
  ],

  "confidence_statement": "One neutral sentence describing readiness and tradeoffs"
}

SCORING RULES:
- ARCHITECTURE_SOUNDNESS: Structural correctness, penalize missing components
- SECURITY_POSTURE: Alignment with data sensitivity, penalize public exposure
- RELIABILITY: Availability guarantees, penalize lack of redundancy
- OPERATIONAL_READINESS: Observability, scaling, maintainability

CRITICAL RULE:
- Decision axes marked as "defaulted" are NOT missing and must NOT be reported as gaps.
- Only axes that are truly unresolved should be flagged as issues.

Never invent missing infrastructure. Never output an overall score.
`;

    const messages = [
      { role: "system", content: SCORING_SYSTEM_PROMPT },
      { role: "user", content: scoringPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: process.env.AI_MODEL || "llama-3.1-8b-instant",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    console.log("AI Scoring Output:", JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    console.error("AI Scoring Error:", error.message);
    // Return safe fallback
    return {
      category_scores: {
        architecture_soundness: 75,
        security_posture: 75,
        reliability: 75,
        operational_readiness: 75
      },
      risk_alignment: { critical_risks: [], moderate_risks: [], low_risks: [] },
      strengths: ["Architecture follows standard patterns"],
      weaknesses: ["Scoring AI unavailable, using default assessment"],
      confidence_statement: "Default assessment due to AI unavailability."
    };
  }
};

/**
 * STEP 3 — AI Cost Recommendation Explanation
 * AI explains rankings, service choices, and tradeoffs
 * AI NEVER: picks services, sizes infra, changes cost, ranks clouds
 */
const EXPLANATION_AGENT_PROMPT = `ACT AS: explanation_agent.
GOAL: Explain cost & architecture outcomes to a technical user.
INPUT: Architecture desc, Cost Profile, Usage Profile, Cost Drivers.

RULES:
1. EXPLAIN THE "WHY": Link cost to usage (e.g. "High cost due to 50k users").
2. EXPLAIN THE "WHAT": Why this architecture? (e.g. "EKS chosen for high performance").
3. DO NOT hallucinate new numbers. Use provided data.
4. BE CONCISE. 2-3 sentences max per section.

OUTPUT JSON:
{
  "outcome_narrative": "Main explanation of why this solution was chosen and why it costs this much.",
  "confidence_score": 0.0-1.0, // How confident are you in this explanation relative to the inputs?
  "confidence_reason": "Why this score? (e.g. 'Usage data is vague' or 'High fidelity input')",
  "critical_cost_drivers": ["List top 2 factors driving cost, e.g. 'High data egress', 'Premium database tier'"],
  "architectural_fit": "Why this architecture suits the workload type."
}`;

/**
 * STEP 4 — AI Explanation Agent
 * Explains the "Why" behind the cost and architecture.
 */
const explainOutcomes = async (rankings, costProfile, infraSpec, usageProfile, costContext = {}) => {
  try {
    const topProvider = rankings[0];
    const topCost = topProvider.monthly_cost;

    // Construct prompt context
    const context = `
    PROFILE: ${costProfile}
    PROVIDER: ${topProvider.provider} ($${topCost}/mo)
    
    USAGE PROFILE:
    - Monthly Users: ${usageProfile?.monthly_users?.min || 'Unknown'} - ${usageProfile?.monthly_users?.max || 'Unknown'}
    - Storage: ${usageProfile?.data_storage_gb?.min || 'Unknown'} GB
    
    ARCH SIGNALS:
    - Type: ${infraSpec.architecture_pattern}
    - Scale Tier: ${infraSpec.assumptions?.traffic_tier}
    - Statefulness: ${infraSpec.semantic_signals?.statefulness}
    
    DOMINANT DRIVERS (from stats):
    ${costContext.dominant_drivers?.map(d => `- ${d.category}: $${d.cost}`).join('\n') || 'None'}
    
    MISSING_COMPONENTS:
    ${costContext.missing_components?.map(m => m.name).join(', ')}
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: EXPLANATION_AGENT_PROMPT },
        { role: "user", content: context }
      ],
      model: "llama-3.1-8b-instant", // Fast model for explanation
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return result;

  } catch (error) {
    console.error("AI Explanation Error:", error.message);
    return {
      outcome_narrative: "Based on your requirements, we recommended a balanced architecture. Usage patterns suggest moderate scale, driving the estimated costs.",
      confidence_score: 0.8,
      confidence_reason: "Standard fallback explanation due to AI service disruption.",
      critical_cost_drivers: ["Base Infrastructure"],
      architectural_fit: "Standard pattern matching your request."
    };
  }
};

/**
 * STEP 2.5 — USAGE INFERENCE (Layer A)
 * Goal: Predict realistic usage ranges based on description and architecture
 * AI returns probability distributions (min, max, confidence), NOT costs.
 */
const predictUsage = async (intentObject, infraSpec) => {
  console.log("--- STEP 2.5: Usage Inference (AI) ---");
  try {
    const stepPrompt = `
ACT AS: usage_profiler_agent.
GOAL: Infer realistic usage usage ranges (min/max) based on project context.
DO NOT output single numbers. Output ranges.

CONTEXT:
Project Desc: "${intentObject.original_input}"
Workload Type: ${intentObject.intent_classification?.workload_type}
Scale Hint: ${infraSpec.assumptions?.traffic_tier}
Features: ${Object.keys(intentObject.feature_signals || {}).join(', ')}

REQUIRED OUTPUT JSON:
{
  "usage_profile": {
    "monthly_users": { "min": number, "max": number },
    "requests_per_user": { "min": number, "max": number, "desc": "daily requests per user" },
    "peak_concurrency": { "min": number, "max": number, "desc": "simultaneous users" },
    "data_transfer_gb": { "min": number, "max": number, "desc": "monthly egress" },
    "data_storage_gb": { "min": number, "max": number, "desc": "total assets (database storage must be 0 if excluded)" }
  },
  "confidence": number, // 0.1 to 1.0
  "reasoning": {
    "data_transfer_gb": "brief reason",
    "requests_per_user": "brief reason",
    "general": "overall logic"
  }
}

CRITICAL RULES:
1. DO NOT assume features that are NOT explicitly enabled (e.g. if payments=false, do not factor payment-related requests).
2. If database is in explicit_exclusions, storage MUST reflect only static assets.
3. Align usage strictly with the PROVIDED Workload Type and Features.
`;

    const messages = [
      { role: "system", content: "You are a cloud capacity planner. Output JSON only." },
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    console.log("AI Usage Prediction:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error("Usage Prediction Error:", error.message);
    // 🔥 FIX 3: Realistic SMB defaults with confidence scores
    return {
      usage_profile: {
        monthly_users: { min: 1000, max: 5000, confidence: 0.4 },
        requests_per_user: { min: 10, max: 50, confidence: 0.5 },
        peak_concurrency: { min: 50, max: 200, confidence: 0.4 },
        data_transfer_gb: { min: 10, max: 50, confidence: 0.5 },
        data_storage_gb: { min: 5, max: 20, confidence: 0.6 }
      },
      confidence: 0.4,
      reasoning: {
        monthly_users: "SMB default: 1k-5k monthly active users",
        requests_per_user: "Standard web app: 10-50 daily requests per user",
        data_transfer_gb: "SMB data egress: 10-50GB/month",
        data_storage_gb: "Standard storage: 5-20GB for small apps",
        general: "Fallback estimation using conservative SMB assumptions"
      }
    };
  }
};

/**
 * STEP 3.5 — PROVIDER REASONING (Dynamic "Why X?")
 * Goal: Generate specific Pros/Cons/BestFor reasoning based on project context
 */
const generateProviderReasoning = async (intent, infraSpec, costAnalysis) => {
  console.log("--- STEP 3.5: Provider Reasoning (AI) ---");
  try {
    const context = `
    PROJECT: "${intent.original_input}"
    WORKLOAD: ${intent.intent_classification?.workload_type}
    FEATURES: ${Object.keys(intent.feature_signals || {}).join(', ')}
    
    COSTS:
    - AWS: $${costAnalysis.provider_details?.AWS?.total_monthly_cost?.toFixed(2) || 'N/A'}
    - GCP: $${costAnalysis.provider_details?.GCP?.total_monthly_cost?.toFixed(2) || 'N/A'}
    - AZURE: $${costAnalysis.provider_details?.AZURE?.total_monthly_cost?.toFixed(2) || 'N/A'}
    
    SERVICES: ${infraSpec.canonical_architecture?.deployable_services?.join(', ') || 'Standard Web Stack'}
    `;

    const prompt = `
    ACT AS: Cloud Architect.
    GOAL: Generate specific reasoning for choosing AWS, GCP, or Azure for this SPECIFIC project.
    
    INPUT:
    ${context}
    
    RULES:
    1. Be specific to the project (e.g. if it's a data app, mention BigQuery for GCP).
    2. Mention cost differences if significant (>10%).
    3. Keep bullet points short (max 10 words).
    4. "best_for" should be 1-2 words (e.g. "Data Analytics", "Startup Scaling").
    
    OUTPUT JSON:
    {
      "AWS": { "pros": ["..."], "cons": ["..."], "best_for": ["..."], "not_ideal_for": ["..."] },
      "GCP": { "pros": ["..."], "cons": ["..."], "best_for": ["..."], "not_ideal_for": ["..."] },
      "AZURE": { "pros": ["..."], "cons": ["..."], "best_for": ["..."], "not_ideal_for": ["..."] }
    }
    `;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: "You are a cloud architect. Output JSON only." },
        { role: "user", content: prompt }
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    console.log("AI Provider Reasoning:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error("Provider Reasoning Error:", error.message);
    return null; // Return null to fall back to hardcoded defaults
  }
};

module.exports = { normalizeIntent, generateConstrainedProposal, scoreInfraSpec, explainOutcomes, predictUsage, generateProviderReasoning };

