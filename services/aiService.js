const Groq = require('groq-sdk');
require('dotenv').config();

console.log("Checking Groq API Key:", process.env.GROQ_API_KEY ? "Present" : "Missing");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

/**
 * Layer 0: Intent Normalizer (AI Helper)
 * Converts natural language into structured tags for the Deterministic Engine.
 */
const normalizeIntent = async (userDescription, previousContext = []) => {
    console.log("--- Normalizing Intent ---");
    try {
        const systemPrompt = `
        You are the "Architectural Discovery Engine" for Cloudiverse.
        
        ## OBJECTIVE
        Analyze the user's project description acting as a **Lead Solutions Architect**.
        Your goal is to uncover HIDDEN requirements. If the user is vague, you must corner them with a specific, high-impact question.

        ## STRATEGY: THE "GAP ANALYSIS"
        1. **Analyze Domain**: Identify the exact business logic (e.g., "Uber clone", "Crypto Exchange", "Personal Blog").
        2. **Identify Missing Pillars**:
           - If "E-commerce": Did they mention payment compliance (PCI)? Traffic spikes?
           - If "Video": Did they mention transcoding? CDN?
           - If "Data": Did they mention retention? Analytics?
        
        3. **Formulate the Question**:
           - **IF AMBIGUOUS**: Ask the ONE most critical technical question that defines the architecture costs/complexity.
           - *Bad Request*: "What is your traffic?" (Too generic)
           - *Good Request*: "For this video platform, do you need real-time HLS transcoding for live streams, or just static storage for uploads?"

        ## OUTPUT FORMAT (JSON ONLY)
        {
            "intent_tags": ["specific_domain", "technical_requirement", "constraints"],
            "estimated_users": "string",
            "is_ambiguous": boolean,
            "clarifying_question": "Domain-specific, technical question.",
            "suggested_options": ["Option A (Technical)", "Option B (Simple)"]
        }
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            ...previousContext,
            { role: "user", content: userDescription }
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.2, // Lower temp for surgical precision
            response_format: { type: "json_object" }
        });

        return JSON.parse(completion.choices[0]?.message?.content || "{}");

    } catch (error) {
        console.error("Intent Norm Error:", error.message);
        throw error;
    }
};

/**
 * Layer 4: AI Proposal Intake (Constrained)
 * AI is strictly allowed to fill parameters for existing Skeleton or suggest "Utility" modules only.
 */
const generateConstrainedProposal = async (skeleton, complianceLevel, context) => {
    console.log("--- L4: AI Constrained Proposal ---");
    try {
        const systemPrompt = `
        You are the "Configuration Engine" for Cloudiverse.
        
        ## YOUR JOB
        You are given a strict **Architectural Skeleton** (JSON).
        You must FILL IN the details for these modules.
        
        ## RULES (VIOLATIONS = FAILURE)
        1. **NO BLOAT**: strict adherence to "You Ain't Gonna Need It" (YAGNI). Do NOT add modules unless absolutely critical for functionality.
        2. **CLOUD AGNOSTIC**: Use industry terms (e.g., "Virtual Machine", "Object Storage"), NEVER "EC2" or "S3".
        3. **EXACT SIZING**: Derive sizing (vCPU, RAM) from the user's implied traffic.
           - "Student Project" -> "Shared vCPU, 512MB RAM"
           - "High Frequency Trading" -> "Dedicated Compute, High Clock Speed"
        
        ## INPUT SKELETON
        ${JSON.stringify(skeleton, null, 2)}

        ## OUTPUT FORMAT (JSON ONLY)
        {
            "project_name": "Creative Tech Name",
            "project_summary": "Technical summary of the stack.",
            "modules": [
                {
                    "category": "Matches Skeleton",
                    "type": "Matches Skeleton",
                    "service_name": "Professional Name (e.g., 'Core API Service')",
                    "specs": { "key": "value" },
                    "reason": "Why this specific size/config is needed for THIS user."
                }
            ]
        }
        `;

        const messages = [
            { role: "system", content: systemPrompt },
            ...context
        ];

        const completion = await groq.chat.completions.create({
            messages: messages,
            model: "llama-3.3-70b-versatile",
            temperature: 0.1, // Very low temp for strict adherence
            response_format: { type: "json_object" }
        });

        return JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (error) {
        console.error("AI Proposal Error:", error.message);
        throw error;
    }
};

module.exports = { normalizeIntent, generateConstrainedProposal };
