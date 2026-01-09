/**
 * axesToCapabilities.js
 * Maps 50+ axes from Step 1 intent to ~15 high-level capabilities for pattern matching
 * Based on Step2.txt specification
 */

/**
 * Map axes to capabilities for pattern resolution
 * @param {Object} axes - The axes object with {value, confidence} pairs
 * @returns {Object} - Capabilities object with 'required', 'none', or 'unknown' values
 */
function mapAxesToCapabilities(axes) {
    if (!axes || typeof axes !== 'object') {
        console.warn('[axesToCapabilities] No axes provided, returning empty capabilities');
        return {};
    }

    const capabilities = {
        // Data & Storage
        data_persistence: resolveCapability(axes.stateful),
        document_storage: resolveCapability(axes.file_storage),

        // Identity & Access
        identity_access: resolveCapability(axes.user_authentication),
        multi_user_roles: resolveCapability(axes.multi_tenancy),

        // Content Delivery
        static_content: resolveCapability(axes.static_content),
        content_delivery: resolveCapability(axes.static_content), // CDN needed for static content

        // Compute & API
        api_backend: resolveCapability(axes.api_backend),
        realtime: resolveCapability(axes.realtime_updates),

        // Mobile
        mobile_clients: resolveCapability(axes.mobile_apps),

        // Events & Scheduling
        eventing: resolveCapability(axes.messaging_queue),
        scheduled_jobs: resolveCapability(axes.scheduled_jobs),

        // Domain-specific signals
        domain_ml_heavy: resolveCapability(axes.domain_ml_heavy),
        domain_iot: resolveCapability(axes.domain_iot),
        domain_fintech: resolveCapability(axes.domain_fintech),
        domain_healthcare: resolveCapability(axes.domain_healthcare),

        // Third-party
        third_party_integrations: resolveCapability(axes.third_party_integrations),

        // Search
        search: resolveCapability(axes.search),

        // Payments
        payments: resolveCapability(axes.payments),

        // Scale hints (not 'required'/'none', but tier values)
        scale_tier: mapMauToTier(axes.estimated_mau?.value),
        latency_tier: axes.performance_sensitivity?.value || 'medium',
        availability_tier: axes.availability_target?.value || '99.5'
    };

    // ═══════════════════════════════════════════════════════════════════
    // DERIVED CAPABILITIES (composite signals)
    // ═══════════════════════════════════════════════════════════════════

    // High-performance: explicit performance_sensitivity OR low latency requirement
    if (axes.performance_sensitivity?.confidence >= 0.85 && axes.performance_sensitivity?.value === 'high') {
        capabilities.high_performance = 'required';
        console.log('[axesToCapabilities] High performance detected (explicit)');
    }

    // ML Heavy: confidence >= 0.9 = definitely required (skip questions)
    if (axes.domain_ml_heavy?.confidence >= 0.9 && axes.domain_ml_heavy?.value === true) {
        capabilities.domain_ml_heavy = 'required';
        console.log('[axesToCapabilities] ML Heavy detected (high confidence)');
    }

    // PCI-compliant: fintech + payments combo
    if (axes.domain_fintech?.value === true && axes.payments?.value === true) {
        capabilities.pci_compliant = 'required';
        console.log('[axesToCapabilities] PCI-compliant detected (fintech + payments)');
    }

    // High availability: 99.99%+ target OR multi-region required
    const availabilityValue = parseFloat(axes.availability_target?.value || '99.5');
    if (availabilityValue >= 99.99 || axes.multi_region_required?.value === true) {
        capabilities.high_availability = 'required';
        console.log('[axesToCapabilities] High availability detected');
    }

    // HIPAA-compliant: healthcare + sensitive data
    if (axes.domain_healthcare?.value === true &&
        (axes.data_sensitivity?.value === 'high' || axes.data_sensitivity?.value === 'pii')) {
        capabilities.hipaa_compliant = 'required';
        console.log('[axesToCapabilities] HIPAA-compliant detected (healthcare + sensitive)');
    }

    // IoT: high confidence domain_iot
    if (axes.domain_iot?.confidence >= 0.85 && axes.domain_iot?.value === true) {
        capabilities.domain_iot = 'required';
        console.log('[axesToCapabilities] IoT detected (high confidence)');
    }

    return capabilities;
}



/**
 * Resolve a single axis to a capability value
 * @param {Object} axis - The axis object with {value, confidence}
 * @returns {string} - 'required', 'none', or 'unknown'
 */
function resolveCapability(axis) {
    if (!axis) return 'unknown';

    // If confidence is high enough, use the value
    if (axis.confidence >= 0.6) {
        if (axis.value === true) return 'required';
        if (axis.value === false) return 'none';
    }

    return 'unknown';
}

/**
 * Map MAU (Monthly Active Users) enum to scale tier
 * @param {string} mau - The estimated_mau value
 * @returns {string} - Scale tier (TINY, SMALL, MEDIUM, LARGE, XL)
 */
function mapMauToTier(mau) {
    const tiers = {
        'very_low': 'TINY',
        'low': 'SMALL',
        'medium': 'MEDIUM',
        'high': 'LARGE',
        'very_high': 'XL'
    };
    return tiers[mau] || 'MEDIUM';
}

/**
 * Get a summary of resolved capabilities for logging
 * @param {Object} capabilities - The resolved capabilities
 * @returns {Object} - Summary with counts
 */
function getCapabilitiesSummary(capabilities) {
    const required = Object.entries(capabilities)
        .filter(([k, v]) => v === 'required')
        .map(([k]) => k);
    const none = Object.entries(capabilities)
        .filter(([k, v]) => v === 'none')
        .map(([k]) => k);
    const unknown = Object.entries(capabilities)
        .filter(([k, v]) => v === 'unknown')
        .map(([k]) => k);

    return {
        required_count: required.length,
        required,
        none_count: none.length,
        none,
        unknown_count: unknown.length,
        unknown,
        scale_tier: capabilities.scale_tier,
        latency_tier: capabilities.latency_tier
    };
}

module.exports = {
    mapAxesToCapabilities,
    resolveCapability,
    mapMauToTier,
    getCapabilitiesSummary
};
