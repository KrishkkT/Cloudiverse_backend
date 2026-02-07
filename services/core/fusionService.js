/**
 * Fusion Service (V2)
 * Deterministic Pre-Intent Layer
 * 
 * Responsibilities:
 * 1. Normalize Inputs
 * 2. Deterministic Traffic Mapping
 * 3. Rule-Based Capability Extraction
 * 4. Apply Default Assumptions
 */

const domainsConfig = require('../../config/v2/domains.json');
const capabilitiesConfig = require('../../config/v2/capabilities.json');
const defaultsConfig = require('../../config/v2/defaults.json');

class FusionService {

    /**
     * Fuse raw user input into a structured Pre-Intent Context
     * @param {object} input - { description, domains, toggles, exclusions }
     * @returns {object} PreIntentContext
     */
    fuse(input) {
        const description = input.description || "";
        const domains = input.domains || [];
        const toggles = input.toggles || { traffic: "medium", scaling: "auto" };
        const exclusions = input.exclusions || {};

        // 0. Deterministic Exclusion Detection (Text-Based)
        // Override payload exclusions if text pattern matches "no database"
        const normDesc = (description || "").toLowerCase();
        const noDbPatterns = ["no database", "without database", "no db", "stateless", "no persistence", "no storage"];

        if (noDbPatterns.some(p => normDesc.includes(p))) {
            console.log("[FUSION] Detected explicit 'No Database' constraint in text.");
            exclusions.database = true;
        }

        // 1. Deterministic Traffic Mapping
        const trafficTier = (toggles.traffic || "medium").toLowerCase();
        // Fallback to medium if invalid tier
        const trafficModel = capabilitiesConfig.traffic_scenarios[trafficTier] || capabilitiesConfig.traffic_scenarios["medium"];

        // 2. Rule-Based Capability Extraction
        const detectedCapabilities = new Set();

        // Source A: Keyword Extraction (Improved with negative lookahead logic)
        for (const [cap, keywords] of Object.entries(capabilitiesConfig.keywords)) {
            const hasPositiveMatch = keywords.some(k => {
                // Use regex word boundaries to prevent substring matches (e.g. "delivery" matching "live")
                const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i');
                const match = normDesc.match(regex);

                if (!match) return false;

                const index = match.index;

                // Check if preceded by "no " or "without "
                // Look back a reasonable amount (e.g. 15 chars) to catch "no user authentication"
                const prefix = normDesc.substring(Math.max(0, index - 15), index);

                // Stricter negative check: must match "no <word> <keyword>" or "no <keyword>"
                if (/\b(no|without|do not need|don't need)\s+(\w+\s+)?$/.test(prefix)) {
                    console.log(`[FUSION] Skipping capability ${cap} due to negative prefix for keyword ${k}`);
                    return false;
                }
                return true;
            });

            if (hasPositiveMatch) {
                detectedCapabilities.add(cap);
            }
        }

        // 0.5 Explicit Exclusion Detection (Auth)
        const noAuthPatterns = ["no auth", "no authentication", "without auth", "no login", "public only", "no users"];
        if (noDbPatterns.some(p => normDesc.includes(p))) { // Ensure DB exclusion persists
            exclusions.database = true;
        }

        if (noAuthPatterns.some(p => normDesc.includes(p))) {
            console.log("[FUSION] Detected explicit 'No Authentication' constraint in text.");
            exclusions.auth = true;
            exclusions.authentication = true; // Handle both keys

            // 🔥 CRITICAL: Remove any falsely detected capabilities if explicit exclusion exists
            detectedCapabilities.delete('authentication');
            detectedCapabilities.delete('auth');
            detectedCapabilities.delete('identity_access');
        }

        // Source B: Domain Hints
        domains.forEach(d => {
            const domainKey = d.toLowerCase();
            const config = domainsConfig[domainKey];
            if (config && config.capability_hints) {
                config.capability_hints.forEach(h => detectedCapabilities.add(h));
            }
        });

        // 3. Workload Guess (Simple Heuristic)
        let workloadGuess = "web_app"; // Default
        if (normDesc.includes("batch") || normDesc.includes("worker") || domains.includes("analytics")) {
            workloadGuess = "worker";
        } else if (normDesc.includes("iot") || domains.includes("iot")) {
            workloadGuess = "iot";
        } else if (normDesc.includes("static") || normDesc.includes("portfolio") || normDesc.includes("resume") ||
            normDesc.includes("landing page") || normDesc.includes("blog") ||
            (normDesc.includes("no api") && normDesc.includes("no backend"))) {
            workloadGuess = "static_site";
        }

        // 4. Assumptions
        const assumptions = [];
        // Core defaults
        for (const [key, val] of Object.entries(defaultsConfig.core)) {
            assumptions.push({ key, value: val, reason: "Platform default" });
        }
        // Domain Policy Bias
        domains.forEach(d => {
            const domainKey = d.toLowerCase();
            const config = domainsConfig[domainKey];
            if (config && config.policy_bias) {
                for (const [pkey, pval] of Object.entries(config.policy_bias)) {
                    // Bias overrides default or adds new
                    const existing = assumptions.find(a => a.key === pkey);
                    if (existing) {
                        existing.value = pval;
                        existing.reason = `Domain policy: ${d}`;
                    } else {
                        assumptions.push({ key: pkey, value: pval, reason: `Domain policy: ${d}` });
                    }
                }
            }
        });

        return {
            schema_version: "preintent.v2",
            raw_description: description,
            domain_tags: domains,
            toggles: toggles,
            exclusions: exclusions,
            derived: {
                traffic_model: trafficModel,
                scaling_mode: toggles.scaling === "manual" ? "manual" : "horizontal", // default to horizontal
                workload_guess: workloadGuess
            },
            detected: {
                capability_hints: Array.from(detectedCapabilities),
                constraint_hints: [] // Reserved for future use
            },
            assumptions: assumptions
        };
    }
}

module.exports = new FusionService();
