/**
 * axes.js (axesToCapabilities)
 * Maps Step-1 axes (value, confidence) → normalized capabilities for pattern/service resolution.
 *
 * Output values:
 * - 'required' | 'none' | 'unknown'
 * Plus tier hints (scale_tier, latency_tier, availability_tier)
 */
'use strict';

/**
 * Optional: if your Step-1 also provides the selected domain id (from domains.json),
 * these hints ensure the infra capabilities align even when some axes are missing/unknown.
 */
const DOMAIN_TO_CAPABILITY_HINTS = {
    static_content: {
        static_content: 'required',
        document_storage: 'required',
        content_delivery: 'required'
    },

    saas_web_app: {
        api_backend: 'required',
        identity_access: 'required',
        data_persistence: 'required'
    },

    ecommerce_marketplace: {
        api_backend: 'required',
        identity_access: 'required',
        data_persistence: 'required',
        payments: 'required',
        search: 'required',
        document_storage: 'required',
        notifications: 'required'
    },

    api_backend: {
        api_backend: 'required'
    },

    media_streaming: {
        api_backend: 'required',
        document_storage: 'required',
        content_delivery: 'required',
        caching: 'required'
    },

    realtime_collaboration: {
        api_backend: 'required',
        realtime: 'required',
        messaging: 'required',
        caching: 'required'
    },

    mobile_first_platforms: {
        api_backend: 'required',
        identity_access: 'required',
        notifications: 'required'
    },

    data_analytics_platforms: {
        domain_analytics: 'required',
        scheduled_jobs: 'required',
        eventing: 'required'
    },

    ai_ml_products: {
        domain_ml_heavy: 'required',
        api_backend: 'required',
        caching: 'required'
    },

    iot_device_platforms: {
        domain_iot: 'required',
        eventing: 'required',
        messaging: 'required'
    },

    enterprise_internal_systems: {
        api_backend: 'required',
        identity_access: 'required',
        data_persistence: 'required',
        audit_logging: 'required',
        private_networking: 'required'
    },

    fintech_regulated_financial: {
        api_backend: 'required',
        identity_access: 'required',
        data_persistence: 'required',
        audit_logging: 'required',
        key_management: 'required',
        high_availability: 'required'
    },

    healthcare_life_sciences: {
        api_backend: 'required',
        identity_access: 'required',
        audit_logging: 'required',
        key_management: 'required',
        hipaa_compliant: 'required'
    },

    education_learning_platforms: {
        api_backend: 'required',
        identity_access: 'required',
        document_storage: 'required',
        scheduled_jobs: 'required'
    },

    government_public_sector: {
        api_backend: 'required',
        identity_access: 'required',
        audit_logging: 'required',
        key_management: 'required'
        // high_availability removed to prevent forcing complex patterns unnecessarily
    },

    devtools_developer_platforms: {
        api_backend: 'required',
        identity_access: 'required',
        devops_automation: 'required',
        audit_logging: 'required'
    },

    gaming_platforms: {
        api_backend: 'required',
        realtime: 'required',
        caching: 'required',
        messaging: 'required'
    },

    logistics_supply_chain: {
        api_backend: 'required',
        scheduled_jobs: 'required',
        eventing: 'required',
        notifications: 'required'
    },

    search_knowledge_systems: {
        search: 'required',
        document_storage: 'required',
        scheduled_jobs: 'required',
        caching: 'required'
    },

    communication_infrastructure_platforms: {
        api_backend: 'required',
        notifications: 'required',
        messaging: 'required',
        eventing: 'required',
        observability: 'required',
        high_availability: 'required'
    }
};

const STRICT_CONTRACTS = {
    government_public_sector: {
        required_services: ['audit_logging', 'key_management', 'waf', 'logging', 'monitoring'],
        min_security_level: 'high'
    },
    fintech_regulated_financial: {
        required_services: ['audit_logging', 'key_management', 'waf', 'logging', 'monitoring'],
        min_security_level: 'high'
    },
    healthcare_life_sciences: {
        required_services: ['audit_logging', 'identityauth', 'logging', 'monitoring', 'objectstorage'],
        min_security_level: 'high'
    },
    ecommerce_marketplace: {
        required_services: ['search_engine', 'cdn', 'loadbalancer'],
        min_security_level: 'medium'
    }
};

function mapAxesToCapabilities(axes) {
    if (!axes || typeof axes !== 'object') {
        console.warn('[axesToCapabilities] No axes provided, returning empty capabilities');
        return {};
    }

    const capabilities = {
        // Data & storage
        data_persistence: resolveDataPersistence(axes),
        document_storage: resolveCapability(axes.file_storage),
        static_content: resolveCapability(axes.static_content),

        // Compute & API
        api_backend: resolveCapability(axes.api_backend),
        realtime: resolveCapability(axes.realtime_updates),
        scheduled_jobs: resolveCapability(axes.scheduled_jobs),

        // Identity & tenancy
        identity_access: resolveCapability(axes.user_authentication),
        multi_user_roles: resolveCapability(axes.multi_tenancy),

        // Search & content delivery
        search: resolveCapability(axes.search),
        content_delivery: resolveCapability(axes.cdn_enabled || axes.static_content),

        // Caching / perf
        caching: resolveCaching(axes),

        // Integrations / billing
        payments: resolveCapability(axes.payments),
        billing_subscription: resolveCapability(axes.billing_subscription),
        usage_tracking: resolveCapability(axes.usage_tracking),
        invoicing: resolveCapability(axes.invoicing),
        third_party_integrations: resolveCapability(axes.third_party_integrations),

        // Events & messaging
        eventing: resolveCapability(axes.eventing || axes.event_bus),
        messaging: resolveCapability(axes.messaging_queue),

        // Notifications (facet)
        notifications: resolveNotifications(axes),

        // Security/compliance signals
        sensitive_data: resolveSensitivity(axes.data_sensitivity),
        audit_logging: resolveCapability(axes.audit_logging_required || axes.audit_logging),
        private_networking: resolveCapability(axes.private_networking || axes.zero_trust_access),
        key_management: resolveCapability(axes.kms_required || axes.key_management),
        siem: resolveCapability(axes.siem_enabled || axes.siem),
        gdpr_compliant: resolveCompliance(axes, 'gdpr'),
        hipaa_compliant: resolveCompliance(axes, 'hipaa'),
        pci_compliant: resolveCompliance(axes, 'pci_dss'),

        // Availability/DR
        high_availability: resolveHighAvailability(axes),
        disaster_recovery: resolveCapability(axes.disaster_recovery_required),
        multi_region: resolveCapability(axes.multi_region_required),

        // Domain flags (kept for service mapping convenience)
        domain_iot: resolveCapability(axes.domain_iot),
        domain_ml_heavy: resolveCapability(axes.domain_ml_heavy),
        domain_analytics: resolveCapability(axes.domain_analytics),
        domain_fintech: resolveCapability(axes.domain_fintech),
        domain_healthcare: resolveCapability(axes.domain_healthcare),

        // Ops signals
        observability: resolveObservability(axes.observability_level || axes.observability),
        devops_automation: resolveCapability(axes.cicd_required || axes.devops_automation),

        // Tiers / hints
        scale_tier: mapMauToTier(getAxisValue(axes.estimated_mau)),
        latency_tier: getAxisValue(axes.performance_sensitivity) || 'medium',
        availability_tier: String(getAxisValue(axes.availability_target) || '99.5')
    };

    // Apply domain hints if domain id is available
    const domainId =
        String(getAxisValue(axes.domain_id || axes.domain || axes.domain_key || axes.strategy_id || axes.selected_domain) || '');

    // Attach Strict Contract if exists
    if (STRICT_CONTRACTS[domainId]) {
        capabilities._contract = STRICT_CONTRACTS[domainId];
    }

    applyDomainHints(capabilities, domainId);

    // Composite refinements
    const perf = normalizeAxis(axes.performance_sensitivity);
    if (perf.confidence >= 0.85 && String(perf.value) === 'high') {
        capabilities.high_performance = 'required';
    }

    // PCI: fintech + payments (when domain flags exist)
    if (getAxisValue(axes.domain_fintech) === true && getAxisValue(axes.payments) === true) {
        capabilities.pci_compliant = 'required';
    }

    // HIPAA: healthcare + sensitive/PII (when domain flags exist)
    const ds = String(getAxisValue(axes.data_sensitivity) || '').toLowerCase();
    if (getAxisValue(axes.domain_healthcare) === true && (ds === 'high' || ds === 'pii')) {
        capabilities.hipaa_compliant = 'required';
    }

    return capabilities;
}

function applyDomainHints(capabilities, domainId) {
    if (!domainId) return;

    const hints = DOMAIN_TO_CAPABILITY_HINTS[domainId];
    if (!hints) return;

    for (const [capabilityKey, desired] of Object.entries(hints)) {
        if (desired !== 'required') continue;

        // Never override explicit "none"
        if (capabilities[capabilityKey] === 'none') continue;

        // Upgrade unknown → required
        if (capabilities[capabilityKey] !== 'required') {
            capabilities[capabilityKey] = 'required';
        }
    }

    // Also set legacy domain flags from domain id (so existing service mappings still work)
    if (domainId === 'iot_device_platforms') capabilities.domain_iot = 'required';
    if (domainId === 'ai_ml_products') capabilities.domain_ml_heavy = 'required';
    if (domainId === 'data_analytics_platforms') capabilities.domain_analytics = 'required';
    if (domainId === 'fintech_regulated_financial') capabilities.domain_fintech = 'required';
    if (domainId === 'healthcare_life_sciences') capabilities.domain_healthcare = 'required';
}

/**
 * Normalize incoming axis value shapes.
 * Accepts:
 * - { value, confidence }
 * - booleans, strings, numbers
 */
function normalizeAxis(axis) {
    if (axis == null) return { value: null, confidence: 0 };
    if (typeof axis === 'object' && ('value' in axis || 'confidence' in axis)) {
        return {
            value: axis.value,
            confidence: typeof axis.confidence === 'number' ? axis.confidence : 0
        };
    }
    return { value: axis, confidence: 1 };
}

function getAxisValue(axis) {
    return normalizeAxis(axis).value;
}

/**
 * Resolve a single axis → 'required' | 'none' | 'unknown'
 * Supports boolean and simple enums.
 */
function resolveCapability(axis) {
    const a = normalizeAxis(axis);

    // Explicit missing/unknown
    if (a.value === null || a.value === undefined || a.value === '' || a.value === 'unknown') return 'unknown';

    // Low confidence object
    if (typeof axis === 'object' && a.confidence < 0.6) return 'unknown';

    // Boolean
    if (a.value === true) return 'required';
    if (a.value === false) return 'none';

    // Enum-like values
    const v = String(a.value).toLowerCase();
    if (['required', 'regulated', 'strong', 'enabled', 'true'].includes(v)) return 'required';
    if (['none', 'no', 'false', 'disabled'].includes(v)) return 'none';

    return 'unknown';
}

function resolveObservability(axis) {
    const a = normalizeAxis(axis);

    if (a.value == null || a.value === '' || a.value === 'unknown') return 'unknown';
    if (typeof axis === 'object' && a.confidence < 0.6) return 'unknown';

    const v = String(a.value).toLowerCase();
    if (['basic', 'standard', 'high', 'required'].includes(v)) return 'required';
    if (['none', 'off', 'disabled'].includes(v)) return 'none';

    // boolean fallback
    if (a.value === true) return 'required';
    if (a.value === false) return 'none';

    return 'unknown';
}

function resolveSensitivity(axis) {
    const a = normalizeAxis(axis);
    if (a.value == null || a.value === '' || a.value === 'unknown') return 'unknown';
    if (typeof axis === 'object' && a.confidence < 0.6) return 'unknown';

    const v = String(a.value).toLowerCase();
    if (['high', 'pii', 'phi', 'regulated'].includes(v)) return 'required';
    if (['medium'].includes(v)) return 'required';
    if (['low', 'none'].includes(v)) return 'none';

    // boolean fallback
    if (a.value === true) return 'required';
    if (a.value === false) return 'none';

    return 'unknown';
}

function resolveDataPersistence(axes) {
    // Prefer explicit primary_data_model if present (common in many domains)
    const model = String(getAxisValue(axes.primary_data_model) || '').toLowerCase();
    if (['relational', 'document', 'key_value', 'graph'].includes(model)) return 'required';
    if (model === 'none') return 'none';

    // Fallback to legacy/alternate axis
    return resolveCapability(axes.stateful);
}

function resolveCaching(axes) {
    const v = getAxisValue(axes.cache_layer);
    if (v === true) return 'required';
    if (v === false) return 'none';
    if (v == null || v === '' || v === 'unknown') return 'unknown';

    // Any non-empty string implies caching is desired (e.g., 'redis', 'memcache')
    if (typeof v === 'string') return 'required';
    return 'unknown';
}

function resolveNotifications(axes) {
    const email = getAxisValue(axes.email_notifications);
    const sms = getAxisValue(axes.sms_notifications);
    const push = getAxisValue(axes.push_notifications);

    if (email === true || sms === true || push === true) return 'required';
    if (email === false && sms === false && push === false) return 'none';
    return 'unknown';
}

function resolveCompliance(axes, key) {
    const rc = getAxisValue(axes.regulatory_compliance);
    const list = Array.isArray(rc) ? rc : (typeof rc === 'string' ? [rc] : []);
    const normalized = list.map(x => String(x).toLowerCase());

    if (normalized.includes(String(key).toLowerCase())) return 'required';
    if (normalized.includes('none')) return 'none';
    return 'unknown';
}

function resolveHighAvailability(axes) {
    const availabilityValue = parseFloat(String(getAxisValue(axes.availability_target) || '99.5'));
    if (!Number.isNaN(availabilityValue) && availabilityValue >= 99.99) return 'required';
    if (getAxisValue(axes.multi_region_required) === true) return 'required';
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
    return tiers[String(mau || '').toLowerCase()] || 'MEDIUM';
}

/**
 * Summary helper for logs/debug.
 */
function getCapabilitiesSummary(capabilities) {
    const required = Object.entries(capabilities || {}).filter(([, v]) => v === 'required').map(([k]) => k);
    const none = Object.entries(capabilities || {}).filter(([, v]) => v === 'none').map(([k]) => k);
    const unknown = Object.entries(capabilities || {}).filter(([, v]) => v === 'unknown').map(([k]) => k);

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
