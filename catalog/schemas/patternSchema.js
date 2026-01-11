/**
 * schemas/patternSchema.js
 * Validates patterns against the service catalog.
 */

'use strict';

const VALID_COST_ENGINES = ['formula', 'hybrid', 'infracost'];

function validatePattern(patternId, pattern, servicesRegistry) {
    const errors = [];

    if (!patternId) errors.push('Missing patternId');
    if (!pattern || typeof pattern !== 'object') return ['Pattern must be an object'];

    if (!pattern.name) errors.push('Missing pattern.name');
    if (!pattern.description) errors.push('Missing pattern.description');
    if (!VALID_COST_ENGINES.includes(pattern.cost_engine)) {
        errors.push(`Invalid cost_engine '${pattern.cost_engine}'. Must be one of: ${VALID_COST_ENGINES.join(', ')}`);
    }

    const checkList = (arr, label) => {
        if (!Array.isArray(arr)) return;
        for (const svc of arr) {
            if (!servicesRegistry[svc]) errors.push(`Unknown service '${svc}' referenced in ${label}`);
        }
    };

    checkList(pattern.required_services, 'required_services');
    checkList(pattern.recommended_services, 'recommended_services');
    checkList(pattern.allowed_services, 'allowed_services');
    checkList(pattern.forbidden_services, 'forbidden_services');

    // Overlap check
    if (Array.isArray(pattern.allowed_services) && Array.isArray(pattern.forbidden_services)) {
        const overlap = pattern.allowed_services.filter(s => pattern.forbidden_services.includes(s));
        if (overlap.length) errors.push(`Service(s) in both allowed and forbidden: ${overlap.join(', ')}`);
    }

    // Edges basic check
    if (pattern.edges && !Array.isArray(pattern.edges)) errors.push('pattern.edges must be an array');
    if (Array.isArray(pattern.edges)) {
        for (const e of pattern.edges) {
            if (!e.from || !e.to) errors.push('Each edge must have {from,to}');
        }
    }

    return errors;
}

module.exports = {
    validatePattern,
    VALID_COST_ENGINES
};
