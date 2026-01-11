/**
 * schemas/serviceSchema.js
 * Validates each service entry in the catalog.
 */

'use strict';

const VALID_CATEGORIES = [
    'compute', 'storage', 'database', 'network', 'security',
    'observability', 'iot', 'ml', 'analytics', 'integration', 'devops', 'games', 'messaging'
];

const VALID_DOMAINS = [
    'core', 'iot', 'ml', 'analytics', 'gaming', 'fintech', 'healthcare', 'retail', 'media',
    'security', 'networking', 'devops', 'observability', 'messaging'
];

const VALID_PRICING_ENGINES = ['formula', 'infracost', 'hybrid', 'free'];

function validateService(serviceId, service) {
    const errors = [];

    if (!serviceId) errors.push('Missing serviceId');
    if (!service || typeof service !== 'object') return ['Service must be an object'];

    // 1) Required metadata
    if (!service.name) errors.push('Missing name');
    if (!service.category || !VALID_CATEGORIES.includes(service.category)) {
        errors.push(`Invalid category '${service.category}'. Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    }
    if (!service.domain || !VALID_DOMAINS.includes(service.domain)) {
        errors.push(`Invalid domain '${service.domain}'. Must be one of: ${VALID_DOMAINS.join(', ')}`);
    }

    // 2) Terraform contract
    if (!service.terraform || typeof service.terraform !== 'object') {
        errors.push('Missing terraform config object');
    } else {
        if (!service.terraform.moduleId) errors.push('Missing terraform.moduleId');
    }

    // 3) Provider mappings (at least one)
    if (!service.mappings || typeof service.mappings !== 'object' || Object.keys(service.mappings).length === 0) {
        errors.push('Service must have at least one provider mapping (aws, gcp, azure)');
    }

    // 4) Pricing contract
    if (!service.pricing || typeof service.pricing !== 'object') {
        errors.push('Missing pricing config object');
    } else {
        if (!VALID_PRICING_ENGINES.includes(service.pricing.engine)) {
            errors.push(`Invalid pricing.engine '${service.pricing.engine}'. Must be one of: ${VALID_PRICING_ENGINES.join(', ')}`);
        }
        if (service.pricing.engine === 'infracost' && !service.pricing.infracost?.resourceType) {
            errors.push('pricing.engine=infracost but missing pricing.infracost.resourceType');
        }
    }

    return errors;
}

module.exports = {
    validateService,
    VALID_CATEGORIES,
    VALID_DOMAINS,
    VALID_PRICING_ENGINES
};
