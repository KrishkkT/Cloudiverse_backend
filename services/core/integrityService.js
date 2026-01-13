/**
 * INTEGRITY SERVICE
 * Enforces business logic constraints, sanity checks, and data normalization.
 * Prevents logic corruption and ensures hard constraints are met.
 */

const PATTERN_MINIMUMS = {
    SERVERLESS_WEB_APP: [
        'objectstorage', // S3 (Static assets)
        'cdn',            // CloudFront
        'identityauth',  // Cognito
        'computeserverless' // Lambda/API Gateway
    ],
    STATIC_WEB_HOSTING: [
        'objectstorage',
        'cdn',
        'dns'
    ],
    CONTAINERIZED_WEB_APP: [
        'computecontainer',
        'loadbalancer',
        'block_storage' // block_storage is canonical? Needs check. Usually it's just attached to compute.
    ],
    MOBILE_BACKEND_API: [
        'computeserverless',
        'identityauth',
        'relationaldatabase' // improved from generic 'database'
    ],
    TRADITIONAL_VM_APP: [
        'computevm',
        'block_storage',
        'networking'
    ]
};

const FORBIDDEN_BY_PATTERN = {
    SERVERLESS_WEB_APP: ['computevm', 'computecontainer'], // Can't have VMs in serverless
    STATIC_WEB_HOSTING: ['computevm', 'computecontainer', 'relationaldatabase', 'nosqldatabase'],
    TRADITIONAL_VM_APP: ['computeserverless']
};

/**
 * FIX 1: Enforce minimum required services for a pattern
 * Ensures SERVERLESS_WEB_APP always has S3/CDN/Auth even if AI skipped them.
 */
function enforcePatternMinimums(pattern, infraSpec) {
    const required = PATTERN_MINIMUMS[pattern] || [];

    if (!infraSpec.services) infraSpec.services = [];

    // Check if we have required services
    const existingClasses = new Set(infraSpec.service_classes?.required_services?.map(s => s.service_class) || []);
    const added = [];

    required.forEach(reqClass => {
        if (!existingClasses.has(reqClass)) {
            // Add minimal placeholder
            if (!infraSpec.service_classes.required_services) infraSpec.service_classes.required_services = [];

            infraSpec.service_classes.required_services.push({
                service_class: reqClass,
                tier: 'standard',
                reason: 'Enforced by Pattern Integrity Guard'
            });
            existingClasses.add(reqClass);
            added.push(reqClass);
        }
    });

    if (added.length > 0) {
        console.log(`[INTEGRITY] Injected missing services for ${pattern}: ${added.join(', ')}`);
    }

    return infraSpec;
}

/**
 * FIX 2: Sanitize InfraSpec when pattern mismatches
 * Removes forbidden components if AI tried to drift patterns.
 */
function sanitizeInfraSpec(pattern, infraSpec) {
    const forbidden = FORBIDDEN_BY_PATTERN[pattern] || [];

    if (infraSpec.service_classes?.required_services) {
        infraSpec.service_classes.required_services = infraSpec.service_classes.required_services.filter(s => {
            if (forbidden.includes(s.service_class)) {
                console.log(`[INTEGRITY] Removed forbidden service ${s.service_class} for ${pattern}`);
                return false;
            }
            return true;
        });
    }
    return infraSpec;
}

/**
 * FIX 3: Override usage based on explicit exclusions
 * If user excludes DB, force storage usage to 0 to prevent cost calculation.
 */
function normalizeUsage(usageProfile, intent) {
    const exclusions = intent?.explicit_exclusions || intent?.exclude_services || [];

    if (exclusions.includes('database') || exclusions.includes('relational_database') || exclusions.includes('nosql_database')) {
        if (usageProfile.data_storage_gb) {
            usageProfile.data_storage_gb = { min: 0, max: 0, expected: 0 };
            console.log(`[INTEGRITY] Usage Override: Database excluded -> Storage set to 0GB`);
        }
    }
    return usageProfile;
}

/**
 * FIX 4 & 5: Normalize cost results and ensure safe recommendation
 */
function normalizeCostResult(result, costProfile) {
    if (!result) return { total: 0, formatted: '$0.00' };

    // If primitive number
    if (typeof result === 'number') {
        return {
            total_monthly_cost: result,
            formatted_cost: `$${result.toFixed(2)}`,
            breakdown: {},
            services: []
        };
    }

    return result;
}

function safeRecommendation(costAnalysis) {
    if (!costAnalysis.recommended_provider) {
        // Fallback logic
        const providers = ['AWS', 'GCP', 'AZURE'];
        // Find provider with lowest cost if data exists
        let best = 'AWS';
        let minCost = Infinity;

        if (costAnalysis.provider_details) {
            providers.forEach(p => {
                const cost = costAnalysis.provider_details[p]?.total_monthly_cost
                    || costAnalysis.provider_details[p]?.total || Infinity;

                if (cost < minCost) {
                    minCost = cost;
                    best = p;
                }
            });
        }

        if (minCost === Infinity) minCost = 0;

        costAnalysis.recommended_provider = best;
        costAnalysis.recommended = {
            provider: best,
            monthly_cost: minCost,
            formatted_cost: `$${minCost.toFixed(2)}`,
            reason: 'Fallback recommendation (incomplete cost data)'
        };
    }
    return costAnalysis;
}

module.exports = {
    enforcePatternMinimums,
    sanitizeInfraSpec,
    normalizeUsage,
    normalizeCostResult,
    safeRecommendation
};
