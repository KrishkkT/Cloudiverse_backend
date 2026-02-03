/**
 * Truth Gate - Pattern Resolution Pipeline 2.0
 * 
 * "Domains describe context. Axes describe reality. Contracts enforce truth."
 * 
 * Responsibilities:
 * 1. Define Canonical Axes (The Reality)
 * 2. Enforce Hard Invariants (The Contract)
 * 3. execute Deterministic Routing (The Pure Function)
 */

const { patterns: PATTERNS } = require('../../config/canonicalPatterns.json');

// ═══════════════════════════════════════════════════════════════════════════
// 1. CANONICAL AXES DEFINITION
// ═══════════════════════════════════════════════════════════════════════════
// Pure attributes extracted from user intent. Domains (Healthcare, Fintech)
// map TO these axes, they do not replace them.

const AXIS_DEFAULTS = {
    static_content: false,
    api_backend: false,
    stateful: false,
    realtime: false,
    payments: false,
    authentication: false,
    ml: false,
    mobile: false,
    event_driven: false,
    primary_data_model: 'none', // none | relational | document | kv | graph
    traffic_tier: 'standard',
    compute_preference: 'none', // none | serverless | container
    exclusions: [] // List of forbidden capabilities/services
};

class TruthGate {

    /**
     * EXTRACT CANONICAL AXES
     * stricter version of extractRequirements, strictly boolean/enum
     */
    static normalizeAxes(requirements) {
        // Map legacy requirements object to optional strict axes
        // In fully refactored system, this would happen at ingestion.
        // For now, we adapt the existing requirements object.

        const workloadTypes = requirements.workload_types || [];
        const workloadString = JSON.stringify(workloadTypes).toLowerCase();

        return {
            static_content: workloadString.includes('static'),
            api_backend: workloadString.includes('api') || workloadString.includes('web') || workloadString.includes('backend') || workloadString.includes('mobile'),
            stateful: !!requirements.stateful,
            realtime: !!requirements.realtime,
            payments: !!requirements.payments,
            authentication: !!requirements.authentication,
            ml: !!requirements.ml,
            mobile: workloadString.includes('mobile'),
            event_driven: requirements.data_stores?.includes('messagequeue') || workloadString.includes('event'),
            primary_data_model: requirements.data_stores?.includes('relationaldatabase') ? 'relational' :
                requirements.data_stores?.includes('nosqldatabase') ? 'document' : 'none',
            traffic_tier: requirements.traffic_tier || 'standard',
            compute_preference: requirements.compute_preference || 'none',
            exclusions: requirements.terminal_exclusions || [],
            // NEW: Include domain for specialized pattern routing
            domain: requirements.domain || 'generic'
        };
    }

    /**
     * DETERMINISTIC ROUTING (The Pure Function)
     * Maps Axes -> Exactly 1 Pattern OR Error
     * NO FALLBACKS ALLOWED.
     */
    static resolvePattern(axes) {
        // 1. INVALID INTENTS (Contradictions)
        if (axes.static_content && axes.api_backend === false && axes.stateful) {
            return { error: "INVALID_INTENT: Static site cannot be stateful without a backend." };
        }
        if (axes.static_content && axes.realtime) {
            // Technically possible via 3rd party, but architecturally conflicting for core pattern
            return { error: "INVALID_INTENT: Pure static site cannot host realtime socket servers." };
        }

        // 2. PATTERN GATES (Specific to Generic)

        // ML Platforms
        if (axes.ml) {
            if (axes.realtime || axes.stateful) return 'HYBRID_PLATFORM';
            return 'ML_INFERENCE_PLATFORM';
        }

        // Realtime Platforms
        if (axes.realtime) {
            if (axes.payments || axes.event_driven) return 'HYBRID_PLATFORM';
            return 'REALTIME_PLATFORM';
        }

        // ════════════════════════════════════════════════════════════════
        // DOMAIN-SPECIFIC PATTERNS (Check domain first for specialized routing)
        // ════════════════════════════════════════════════════════════════

        // Ecommerce domain → ECOMMERCE (always, regardless of other flags)
        if (axes.domain === 'ecommerce') {
            console.log('[TRUTHGATE] Domain is ecommerce → ECOMMERCE');
            return 'ECOMMERCE';
        }

        // Fintech domain → FINTECH_PAYMENT_PLATFORM (explicit fintech only)
        if (axes.domain === 'fintech' || axes.domain === 'finance') {
            console.log('[TRUTHGATE] Domain is fintech → FINTECH_PAYMENT_PLATFORM');
            return 'FINTECH_PAYMENT_PLATFORM';
        }

        // Healthcare domain → STATEFUL_WEB_PLATFORM (for compliance)
        if (axes.domain === 'healthcare' || axes.domain === 'health') {
            console.log('[TRUTHGATE] Domain is healthcare → STATEFUL_WEB_PLATFORM');
            return 'STATEFUL_WEB_PLATFORM';
        }

        // ════════════════════════════════════════════════════════════════
        // GENERIC PATTERNS (Fallback when domain is generic/unknown)
        // ════════════════════════════════════════════════════════════════

        // Fintech-like: high-traffic payments with relational DB and auth
        if (axes.payments && axes.primary_data_model === 'relational' && axes.traffic_tier === 'high') {
            return 'FINTECH_PAYMENT_PLATFORM';
        }

        // Ecommerce-like: payments with relational DB (generic)
        if (axes.payments && axes.primary_data_model === 'relational') {
            return 'ECOMMERCE';
        }

        // Mobile Backends
        if (axes.mobile) {
            if (axes.stateful) return 'MOBILE_BACKEND_PLATFORM';
            return 'SERVERLESS_API'; // Mobile backends are often just APIs
        }

        // Payments (Basic/Generic)
        if (axes.payments) {
            if (axes.traffic_tier === 'high' || axes.compute_preference === 'container') {
                return 'STATEFUL_WEB_PLATFORM';
            }
            return 'SERVERLESS_WEB_APP';
        }

        // Web Applications
        if (axes.api_backend) {
            // Container Preference wins
            if (axes.compute_preference === 'container') {
                return 'CONTAINERIZED_WEB_APP';
            }

            // Stateful Web
            if (axes.stateful) {
                // Relational DB often implies specialized or classic three-tier
                if (axes.primary_data_model === 'relational') {
                    return 'STATEFUL_WEB_PLATFORM';
                }
                return 'SERVERLESS_WEB_APP';
            }

            // Stateless API
            return 'SERVERLESS_API';
        }

        // Static Sites (The "No Backend" Case)
        if (axes.static_content) {
            // User Request: If "authentication" is for admin-only access to a static site, prefer STATICSITEWITHAUTH
            // rather than attaching a full backend by default.
            if (axes.authentication && !axes.api_backend) return 'STATIC_SITE_WITH_AUTH';
            if (axes.authentication && axes.api_backend) return 'SERVERLESS_WEB_APP'; // Or other backend patterns
            return 'STATIC_SITE';
        }

        // Unreachable State (Validation)
        return { error: "NEEDS_CLARIFICATION: Use Case unclear (No static content or backend detected)." };
    }

    /**
     * INVARIANT ENFORCEMENT (The Contract)
     * Validates services against axes.
     * Returns: Array of valid services (strips illegals)
     */
    static enforceServiceInvariants(services, axes) {
        const cleaned = new Set(services);

        // Rule 1: Static Content Invariants (Removed compute restriction to allow Nginx containers)
        if (axes.static_content && !axes.api_backend) {
            // apigateway usually not needed for pure static
            cleaned.delete('apigateway');
        }

        // Rule 2: Exclusions
        if (axes.exclusions.includes('database')) {
            cleaned.delete('relationaldatabase');
            cleaned.delete('nosqldatabase');
        }
        if (axes.exclusions.includes('compute')) {
            cleaned.delete('computeserverless');
            cleaned.delete('computecontainer');
        }

        // Rule 3: Stateless => No Persistance Services (unless external/storage)
        if (!axes.stateful && !axes.static_content) {
            cleaned.delete('relationaldatabase');
            // objectstorage might be allowed for assets
        }

        return Array.from(cleaned);
    }
}

module.exports = TruthGate;
