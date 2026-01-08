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
const STEP_1_SYSTEM_PROMPT = `
STEP 1 — INTENT EXTRACTION AGENT
You are an intent extraction engine for cloud infrastructure planning.

CORE PRINCIPLES:
1. EXPLICIT OVER INFERRED: Explicit user intent (e.g. "no database") always beats inference.
2. CONSERVATIVE INFERENCE: Do NOT assume capabilities unless explicitly stated.
3. THREE-STATE MODEL: Every capability is either TRUE (explicit), FALSE (explicitly excluded), or UNKNOWN (not mentioned).
4. NO INFRASTRUCTURE: Do not suggest cloud services or architectures.
5. CAPABILITIES NOT SERVICES: Output user intent as capabilities (data_persistence), NOT services (database, RDS, S3).

CAPABILITIES TO TRACK (provider-agnostic intent):
- data_persistence: User needs to store/retrieve data
- identity_access: User needs authentication/authorization
- content_delivery: User needs CDN/edge delivery
- payments: User needs payment processing
- eventing: User needs event-driven architecture
- messaging: User needs async messaging
- realtime: User needs real-time communication
- document_storage: User needs document/file management
- static_content: User serves static assets
- api_backend: User needs backend API
- case_management: Workflow/case tracking
- multi_user_roles: RBAC/multi-tenancy

RULES:
- If a capability is explicitly mentioned as present -> Add to explicit_capabilities.
- If a capability is explicitly mentioned as NOT needed (e.g. "no database", "don't need X") -> Add to explicit_exclusions.
- If a capability is NOT mentioned, mark it in inferred_capabilities with a low confidence or skip it.
- AI is allowed to say "unknown" (confidence < 0.3).
- NEVER output service names (EventBridge, RDS, S3, Lambda, etc.) - only capabilities.
`;

/**
 * STEP 1 — INTENT NORMALIZATION & CLARIFICATION
 * Goal: Understand what the user is building, surface risk-relevant ambiguity.
 */
const normalizeIntent = async (userInput, conversationHistory = [], optionalHints = {}) => {
  console.log("--- STEP 1: Intent Normalization ---");
  try {
    const stepPrompt = `
        Start Step 1: INTENT_ANALYSIS.
        
        🔹 INPUT CONTEXT
        User Input: "${userInput}"
        Optional Hints: ${JSON.stringify(optionalHints)}

        🔹 REQUIRED OUTPUT SCHEMA (JSON)
        {
          "intent_classification": {
            "primary_domain": "string (e.g. law_firm_management, ecommerce, portfolio, landing_page)",
            "workload_type": "string (e.g. web_application, batch_processing, static_website)",
            "user_facing": boolean
          },
          "explicit_capabilities": {
             "capability_name": true // Only for capabilities explicitly mentioned as present
          },
          "explicit_exclusions": [
             "List capabilities explicitly mentioned as NOT needed (data_persistence, payments, realtime, etc.)"
          ],
          "inferred_capabilities": {
             "capability_name": { 
                "value": boolean, 
                "confidence": number (0-1), 
                "reason": "Why this inference?" 
             }
          },
          "semantic_signals": {
            "statefulness": "string (stateful/stateless)",
            "latency_sensitivity": "string (low/medium/high)",
            "read_write_ratio": "string (read_heavy/write_heavy/balanced)"
          },
          "risk_domains": ["security", "compliance", "availability", etc.],
          "missing_decision_axes": [
            "list of missing axes from: [scale, availability, data_sensitivity, regulatory_exposure, business_criticality, latency_sensitivity, statefulness, data_durability, cost_sensitivity, observability_level]"
          ],
          "confidence": number (0-1)
        }
        
        🔹 EXCLUSION DETECTION (CRITICAL)
        Look for phrases like: "no database", "don't need X", "without cache", "skip the API", "no auth needed".
        Map these to capabilities: "no database" -> "data_persistence", "no auth" -> "identity_access"
        
        ❌ AI MUST NOT RETURN: questions, options, defaults, compliance frameworks, infra details, service names (RDS, S3, Lambda, EventBridge).
        `;

    const messages = [
      { role: "system", content: STEP_1_SYSTEM_PROMPT },
      ...conversationHistory,
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    let result;
    try {
      result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (parseErr) {
      console.error("AI JSON Parse Error:", parseErr);
      result = {
        intent_classification: { primary_domain: "unknown", workload_type: "general", user_facing: true },
        explicit_capabilities: {},
        explicit_exclusions: [],
        inferred_capabilities: {},
        semantic_signals: { statefulness: "mixed", latency_sensitivity: "medium", read_write_ratio: "balanced" },
        risk_domains: [],
        missing_decision_axes: ["processing_error"],
        confidence: 0
      };
    }

    console.log("AI Step 1 Output:", JSON.stringify(result, null, 2));
    return result;

  } catch (error) {
    console.error("Intent Norm Error:", error.message);
    // Don't throw 500, return a safe failure state
    return {
      intent_classification: { primary_domain: "error_fallback", workload_type: "general", user_facing: true },
      explicit_capabilities: {},
      explicit_exclusions: [],
      inferred_capabilities: {},
      semantic_signals: { statefulness: "mixed", latency_sensitivity: "medium", read_write_ratio: "balanced" },
      risk_domains: [],
      missing_decision_axes: [],
      confidence: 0
    };
  }
};
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
    "key_decision": "reason for decision"
  },
  
  "project_name": "string (Creative, Professional Name for the system)",
  "project_summary": "string (Short, 1-sentence value prop)"
}

❌ AI MUST NOT RETURN: cloud services, instance sizes, regions, CIDRs, enforcement decisions, user questions
`;

    const messages = [
      { role: "system", content: STEP_2_SYSTEM_PROMPT },
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
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
      model: "llama-3.3-70b-versatile",
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
    // Fallback safe defaults
    return {
      usage_profile: {
        monthly_users: { min: 1000, max: 10000, confidence: 0.5 },
        storage_gb: { min: 5, max: 20 },
        data_transfer_gb: { min: 10, max: 100 },
        requests_per_second: { min: 1, max: 10 }
      },
      rationale: {
        monthly_users: "Default fallback estimation",
        storage_gb: "Standard assumptions",
        data_transfer_gb: "Standard assumptions"
      }
    };
  }
};

module.exports = { normalizeIntent, generateConstrainedProposal, scoreInfraSpec, explainOutcomes, predictUsage };

