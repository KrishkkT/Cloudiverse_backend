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

const STEP_1_SYSTEM_PROMPT = `
STEP 1 — SYSTEM PROMPT 
This is the only system prompt used for Step 1.
You are an intent-analysis AI inside a deterministic backend system.

STRICT ROLE BOUNDARIES:
1. You do NOT design infrastructure.
2. You do NOT suggest cloud providers, services, architectures, or technologies.
3. You do NOT ask questions or suggest user questions.
4. You do NOT apply defaults or make decisions.
5. You do NOT modify or override user intent.

Your job is ONLY to:
- Analyze the user's description
- Extract semantic intent
- Identify features
- Identify risks
- Identify which decision axes are missing

You MUST output STRICT JSON only.
You MUST follow the schema exactly.
You MUST explicitly list uncertainty.
You MUST avoid guessing values.

If something is unclear, mark it as missing.
Do not invent values.

Think like a requirements analyst, not an architect.
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
        The AI must always return exactly these 7 sections. The structure never changes.

        {
          "intent_classification": {
            "primary_domain": "string (e.g. law_firm_management, ecommerce, portfolio, landing_page)",
            "workload_type": "string (e.g. web_application, batch_processing, static_website)",
            "user_facing": boolean
          },
          "feature_signals": {
            "payments": boolean,
            "real_time": boolean,
            "static_content": boolean,
            "case_management": boolean,
            "document_storage": boolean,
            "multi_user_roles": boolean,
            "other_feature_key": "boolean (dynamic)"
          },
          "semantic_signals": {
            "statefulness": "string (stateful/stateless)",
            "latency_sensitivity": "string (low/medium/high)",
            "read_write_ratio": "string (read_heavy/write_heavy/balanced)"
          },
          "explicit_exclusions": [
            "CRITICAL: List ANY services the user explicitly said NOT to include.",
            "Look for phrases like: 'no database', 'don't need X', 'without cache', 'skip the API', 'no auth needed'",
            "Valid values: database, cache, api, auth, compute, storage, cdn, search, queue, monitoring",
            "Example: ['database', 'cache'] if user said 'no database needed' or 'without caching'"
          ],
          "risk_domains": [
            "string (e.g. security, compliance, availability)"
          ],
          "missing_decision_axes": [
            "list of missing axes from: [scale, availability, data_sensitivity, regulatory_exposure, business_criticality, latency_sensitivity, statefulness, data_durability, cost_sensitivity, observability_level]"
          ],
          "confidence": number (0-1)
        }
        
        🔹 EXCLUSION DETECTION (CRITICAL)
        If the user says ANY of these, add to explicit_exclusions:
        - "no database" / "don't need a database" / "without database" → add "database"
        - "no caching" / "don't need cache" / "skip cache" → add "cache"
        - "no API" / "static only" / "no backend" → add "api"
        - "no auth" / "public only" / "no login" → add "auth"
        - "simple" / "minimal" / "basic" → be conservative, DO NOT assume services
        
        ❌ AI MUST NOT RETURN: questions, options, defaults, compliance frameworks, infra details.
        `;

    const messages = [
      { role: "system", content: MASTER_SYSTEM_PROMPT },
      ...conversationHistory, // Include history if needed for context
      { role: "user", content: stepPrompt }
    ];

    const completion = await groq.chat.completions.create({
      messages: messages,
      model: "llama-3.3-70b-versatile",
      temperature: 0.1, // Low temp for analytical precision
      response_format: { type: "json_object" }
    });

    let result;
    try {
      result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (parseErr) {
      console.error("AI JSON Parse Error:", parseErr);
      // Fallback or retry logic could go here. For now, return a safe minimal object to avoid 500.
      // But if we return empty, the workflow might fail later. 
      // Better to throw a specific error or return a "Retry" signal.
      // Let's attempt to repair or just return the raw intent-like structure if possible.
      // Actually, preventing the crash is step 1.
      result = {
        intent_classification: { primary_domain: "unknown", workload_type: "general", user_facing: true },
        feature_signals: {},
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
      feature_signals: {},
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
const COST_EXPLANATION_PROMPT = `You are a cloud infrastructure cost advisor.
Your role is ONLY to explain decisions that have already been made by the backend system.

You NEVER:
- Pick services
- Size infrastructure
- Change costs
- Rank clouds

You ONLY explain:
- Why the recommended cloud is suitable
- Tradeoffs between providers
- Cost optimization tips

CRITICAL: Never mention specific dollar amounts. Explain reasoning based on workload characteristics.
Be concise, helpful, and focus on value to the user.`;

const explainCostRecommendation = async (rankings, costProfile, infraSpec, missingComponents = []) => {
  try {
    // Extract workload characteristics for better explanation
    const workloadType = infraSpec.components?.compute?.execution_model || 'containerized';
    const dbType = infraSpec.components?.data?.database_type || 'relational';
    const statefulness = infraSpec.semantic_signals?.statefulness || 'stateful';
    const readWriteRatio = infraSpec.semantic_signals?.read_write_ratio || 'balanced';
    const serviceCount = infraSpec.modules?.length || 0;

    const prompt = `Explain this cloud recommendation for a ${costProfile.replace('_', ' ').toLowerCase()} deployment.

RANKINGS (backend-decided, do not change or mention specific costs):
1st: ${rankings[0]?.provider} (score: ${rankings[0]?.score})
2nd: ${rankings[1]?.provider} (score: ${rankings[1]?.score})
3rd: ${rankings[2]?.provider} (score: ${rankings[2]?.score})

WORKLOAD CHARACTERISTICS:
- Compute: ${workloadType}
- Database: ${dbType}
- Statefulness: ${statefulness}
- Read/Write: ${readWriteRatio}
- Scale: ${rankings[0]?.cost_range?.confidence || 'medium'} confidence
- Services: ${serviceCount} cloud services

${missingComponents.length > 0 ? `MISSING COMPONENTS (potential future additions):
${missingComponents.map(m => `- ${m.name}: ${m.warning}`).join('\n')}` : ''}

Provide JSON with:
{
  "recommendation_reason": "2-3 sentences explaining WHY #1 provider is best for THIS workload type. Mention specific characteristics like 'read-heavy workload' or 'containerized architecture'. Never mention dollar amounts.",
  "tradeoffs": "Brief comparison of top 2 providers based on their strengths for this workload type.",
  "cost_optimization_tips": ["tip1", "tip2", "tip3"],
  "future_considerations": "One sentence about what might change costs if missing components are added later"
}`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: "system", content: COST_EXPLANATION_PROMPT },
        { role: "user", content: prompt }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.3,
      max_tokens: 600,
      response_format: { type: "json_object" }
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    return result;

  } catch (error) {
    console.error("AI Cost Explanation Error:", error.message);
    // Return safe fallback
    const recommended = rankings[0]?.provider || 'AWS';
    const workloadDesc = infraSpec.components?.compute?.execution_model === 'serverless'
      ? 'serverless workload'
      : 'containerized application';

    return {
      recommendation_reason: `${recommended} is recommended because its managed ${workloadDesc.includes('serverless') ? 'function' : 'container'} and database services provide the best balance of operational overhead and reliability for a ${infraSpec.semantic_signals?.read_write_ratio || 'balanced'} workload.`,
      tradeoffs: `${recommended} offers mature tooling and wide ecosystem support, while ${rankings[1]?.provider} provides competitive alternatives with different pricing models.`,
      cost_optimization_tips: [
        "Start with the recommended tier and scale based on actual usage",
        "Use reserved capacity for predictable baseline workloads",
        "Enable auto-scaling to handle traffic spikes efficiently"
      ],
      future_considerations: "Adding async processing, search, or caching later may increase monthly costs."
    };
  }
};

module.exports = { normalizeIntent, generateConstrainedProposal, scoreInfraSpec, explainCostRecommendation };

