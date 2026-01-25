/**
 * axes.js (axesToCapabilities)
 * Maps Step-1 axes (value, confidence) → normalized capabilities for pattern/service resolution.
 *
 * Output values:
 * - 'required' | 'none' | 'unknown'
 * Plus tier hints (scale_tier, latency_tier, availability_tier)
 */

'use strict';

function mapAxesToCapabilities(axes) {
    if (!axes || typeof axes !== 'object') {
        console.warn('[axesToCapabilities] No axes provided, returning empty capabilities');
        return {};
    }

    const capabilities = {
        // Data & storage
        data_persistence: resolveCapability(axes.stateful),
        file_storage: resolveCapability(axes.file_storage),  // 🔥 FIXED: matches SERVICE_REGISTRY
        static_content: resolveCapability(axes.static_content),

        // Compute & API
        api_backend: resolveCapability(axes.api_backend),
        api_management: resolveCapability(axes.public_api), // 🔥 ADDED: Public APIs need Gateway
        realtime: resolveCapability(axes.realtime_updates),
        scheduled_jobs: resolveCapability(axes.scheduled_jobs),

        // Identity & tenancy
        identity_access: resolveCapability(axes.user_authentication),
        multi_user_roles: resolveCapability(axes.multi_tenancy),

        // Search & content
        search: resolveCapability(axes.search),

        // Integrations
        payments: resolveCapability(axes.payments),
        third_party_integrations: resolveCapability(axes.third_party_integrations),

        // Client types (Triggers API Gateway)
        mobile_clients: resolveCapability(axes.mobile_clients), // 🔥 ADDED

        // Events & messaging
        eventing: resolveCapability(axes.eventing || axes.event_bus || axes.messaging_queue),
        messaging: resolveCapability(axes.messaging_queue),

        // Domain flags
        domain_iot: resolveCapability(axes.domain_iot),
        domain_ml_heavy: resolveCapability(axes.domain_ml_heavy),
        domain_analytics: resolveCapability(axes.domain_analytics),
        domain_fintech: resolveCapability(axes.domain_fintech),
        domain_healthcare: resolveCapability(axes.domain_healthcare),

        // Security/compliance signals
        sensitive_data: resolveCapability(axes.data_sensitivity),
        public_exposure: resolveCapability(axes.public_exposure),
        private_networking: resolveCapability(axes.private_networking),
        audit_logging: resolveCapability(axes.audit_logging),

        // Ops signals
        observability: resolveCapability(axes.observability),
        devops_automation: resolveCapability(axes.cicd_required || axes.devops_automation),

        // Tiers / hints
        scale_tier: mapMauToTier(axes.estimated_mau?.value),
        latency_tier: axes.performance_sensitivity?.value || 'medium',
        availability_tier: axes.availability_target?.value || '99.5'
    };

    // ── Derived/composite capabilities ──

    // High performance
    if (axes.performance_sensitivity?.confidence >= 0.85 && axes.performance_sensitivity?.value === 'high') {
        capabilities.high_performance = 'required';
    }

    // ML heavy (high confidence)
    if (axes.domain_ml_heavy?.confidence >= 0.9 && axes.domain_ml_heavy?.value === true) {
        capabilities.domain_ml_heavy = 'required';
    }

    // PCI: fintech + payments
    if (axes.domain_fintech?.value === true && axes.payments?.value === true) {
        capabilities.pci_compliant = 'required';
    }

    // High availability
    const availabilityValue = parseFloat(String(axes.availability_target?.value || '99.5'));
    if (availabilityValue >= 99.99 || axes.multi_region_required?.value === true) {
        capabilities.high_availability = 'required';
    }

    // HIPAA: healthcare + sensitive/PII
    if (
        axes.domain_healthcare?.value === true &&
        (axes.data_sensitivity?.value === 'high' || axes.data_sensitivity?.value === 'pii')
    ) {
        capabilities.hipaa_compliant = 'required';
    }

    // IoT: high confidence
    if (axes.domain_iot?.confidence >= 0.85 && axes.domain_iot?.value === true) {
        capabilities.domain_iot = 'required';
    }

    // Analytics domain: explicit
    if (axes.domain_analytics?.confidence >= 0.8 && axes.domain_analytics?.value === true) {
        capabilities.domain_analytics = 'required';
    }

    return capabilities;
}

/**
 * Resolve a single axis → 'required' | 'none' | 'unknown'
 * Supports boolean and simple enums.
 */
function resolveCapability(axis) {
    if (!axis) return 'unknown';

    // If the axis is already a plain boolean, accept it
    if (typeof axis === 'boolean') return axis ? 'required' : 'none';

    const confidence = typeof axis.confidence === 'number' ? axis.confidence : 0;

    // Low confidence
    if (confidence < 0.6) return 'unknown';

    // Boolean axis
    if (axis.value === true) return 'required';
    if (axis.value === false) return 'none';

    // Enum-like axis values that imply requirement
    const v = String(axis.value || '').toLowerCase();
    if (['high', 'pii', 'regulated', 'required'].includes(v)) return 'required';
    if (['none', 'low', 'false'].includes(v)) return 'none';

    return 'unknown';
}

/**
 * Map MAU enum → scale tier.
 */
function mapMauToTier(mau) {
    const tiers = {
        very_low: 'TINY',
        low: 'SMALL',
        medium: 'MEDIUM',
        high: 'LARGE',
        very_high: 'XL'
    };
    return tiers[mau] || 'MEDIUM';
}

/**
 * Summary helper for logs/debug.
 */
function getCapabilitiesSummary(capabilities) {
    const required = Object.entries(capabilities).filter(([, v]) => v === 'required').map(([k]) => k);
    const none = Object.entries(capabilities).filter(([, v]) => v === 'none').map(([k]) => k);
    const unknown = Object.entries(capabilities).filter(([, v]) => v === 'unknown').map(([k]) => k);

    return {
        required_count: required.length,
        required,
        none_count: none.length,
        none,
        unknown_count: unknown.length,
        unknown,
        scale_tier: capabilities.scale_tier,
        latency_tier: capabilities.latency_tier,
        availability_tier: capabilities.availability_tier
    };
}

module.exports = {
    mapAxesToCapabilities,
    resolveCapability,
    mapMauToTier,
    getCapabilitiesSummary
};
