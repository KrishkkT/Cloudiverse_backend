/**
 * INFRASTRUCTURE TEMPLATES SERVICE
 * Pre-built templates for common infrastructure patterns
 * 
 * USE CASES:
 * 1. Quick Start: Users can start from proven patterns
 * 2. Best Practices: Templates encode architectural best practices
 * 3. Learning: New users can explore real-world examples
 * 4. Consistency: Teams can share standardized patterns
 */

const pool = require('../../config/db');

// Pre-defined template categories
const CATEGORIES = {
    WEB_APP: 'web_app',
    API_SERVICE: 'api_service',
    DATA_PIPELINE: 'data_pipeline',
    MICROSERVICES: 'microservices',
    SERVERLESS: 'serverless',
    ECOMMERCE: 'ecommerce',
    SAAS: 'saas',
    MOBILE_BACKEND: 'mobile_backend'
};

// Built-in templates (loaded on startup)
const BUILT_IN_TEMPLATES = [
    {
        name: 'Simple Web Application',
        description: 'A straightforward three-tier web app with database, cache, and load balancer',
        category: CATEGORIES.WEB_APP,
        template_json: {
            description: 'A simple web application with user authentication and data storage',
            intent_hints: {
                workload_type: 'web_application',
                user_facing: true,
                statefulness: 'stateful'
            },
            suggested_services: [
                'computecontainer',
                'relationaldatabase',
                'cache',
                'loadbalancer',
                'objectstorage',
                'identityauth'
            ],
            recommended_cost_profile: 'COST_EFFECTIVE',
            estimated_tier: 'MEDIUM'
        },
        is_public: true
    },
    {
        name: 'RESTful API Service',
        description: 'Scalable API backend with authentication, caching, and monitoring',
        category: CATEGORIES.API_SERVICE,
        template_json: {
            description: 'A REST API service handling CRUD operations at scale',
            intent_hints: {
                workload_type: 'api_service',
                user_facing: true,
                statefulness: 'stateless'
            },
            suggested_services: [
                'computecontainer',
                'relationaldatabase',
                'cache',
                'apigateway',
                'monitoring',
                'logging'
            ],
            recommended_cost_profile: 'COST_EFFECTIVE',
            estimated_tier: 'MEDIUM'
        },
        is_public: true
    },
    {
        name: 'Serverless Function App',
        description: 'Event-driven serverless architecture for variable workloads',
        category: CATEGORIES.SERVERLESS,
        template_json: {
            description: 'A serverless application triggered by events or API calls',
            intent_hints: {
                workload_type: 'serverless',
                user_facing: true,
                statefulness: 'stateless'
            },
            suggested_services: [
                'computeserverless',
                'nosqldatabase',
                'apigateway',
                'messagequeue',
                'objectstorage'
            ],
            recommended_cost_profile: 'COST_EFFECTIVE',
            estimated_tier: 'SMALL'
        },
        is_public: true
    },
    {
        name: 'E-commerce Platform',
        description: 'Full-featured online store with payments, search, and CDN',
        category: CATEGORIES.ECOMMERCE,
        template_json: {
            description: 'An e-commerce platform with product catalog, cart, and checkout',
            intent_hints: {
                workload_type: 'web_application',
                user_facing: true,
                statefulness: 'stateful',
                payments: true
            },
            suggested_services: [
                'computecontainer',
                'relationaldatabase',
                'cache',
                'searchengine',
                'cdn',
                'objectstorage',
                'loadbalancer',
                'identityauth',
                'messagequeue'
            ],
            recommended_cost_profile: 'HIGH_PERFORMANCE',
            estimated_tier: 'LARGE'
        },
        is_public: true
    },
    {
        name: 'Data Processing Pipeline',
        description: 'ETL pipeline for batch data processing and analytics',
        category: CATEGORIES.DATA_PIPELINE,
        template_json: {
            description: 'A data pipeline for ingesting, transforming, and storing large datasets',
            intent_hints: {
                workload_type: 'batch_processing',
                user_facing: false,
                statefulness: 'stateless'
            },
            suggested_services: [
                'computeserverless',
                'nosqldatabase',
                'objectstorage',
                'messagequeue',
                'eventbus',
                'monitoring'
            ],
            recommended_cost_profile: 'COST_EFFECTIVE',
            estimated_tier: 'MEDIUM'
        },
        is_public: true
    },
    {
        name: 'SaaS Multi-tenant App',
        description: 'Software-as-a-Service application with tenant isolation',
        category: CATEGORIES.SAAS,
        template_json: {
            description: 'A SaaS platform serving multiple organizations with data isolation',
            intent_hints: {
                workload_type: 'web_application',
                user_facing: true,
                statefulness: 'stateful',
                multi_user_roles: true
            },
            suggested_services: [
                'computecontainer',
                'relationaldatabase',
                'cache',
                'loadbalancer',
                'apigateway',
                'identityauth',
                'secretsmanagement',
                'monitoring',
                'logging'
            ],
            recommended_cost_profile: 'HIGH_PERFORMANCE',
            estimated_tier: 'LARGE'
        },
        is_public: true
    },
    {
        name: 'Mobile App Backend',
        description: 'Backend API optimized for mobile applications',
        category: CATEGORIES.MOBILE_BACKEND,
        template_json: {
            description: 'A mobile app backend with push notifications and offline sync',
            intent_hints: {
                workload_type: 'api_service',
                user_facing: true,
                statefulness: 'stateful'
            },
            suggested_services: [
                'computeserverless',
                'nosqldatabase',
                'apigateway',
                'identityauth',
                'objectstorage',
                'messagequeue'
            ],
            recommended_cost_profile: 'COST_EFFECTIVE',
            estimated_tier: 'MEDIUM'
        },
        is_public: true
    },
    {
        name: 'Microservices Architecture',
        description: 'Distributed microservices with service mesh and observability',
        category: CATEGORIES.MICROSERVICES,
        template_json: {
            description: 'A microservices architecture with multiple independent services',
            intent_hints: {
                workload_type: 'microservices',
                user_facing: true,
                statefulness: 'stateful'
            },
            suggested_services: [
                'computecontainer',
                'relationaldatabase',
                'nosqldatabase',
                'cache',
                'loadbalancer',
                'apigateway',
                'messagequeue',
                'eventbus',
                'monitoring',
                'logging',
                'secretsmanagement'
            ],
            recommended_cost_profile: 'HIGH_PERFORMANCE',
            estimated_tier: 'LARGE'
        },
        is_public: true
    }
];

/**
 * Initialize built-in templates in database
 */
async function initializeBuiltInTemplates() {
    try {
        for (const template of BUILT_IN_TEMPLATES) {
            // Check if template exists
            const existing = await pool.query(
                'SELECT id FROM infrastructure_templates WHERE name = $1',
                [template.name]
            );

            if (existing.rows.length === 0) {
                await pool.query(`
                    INSERT INTO infrastructure_templates 
                    (name, description, category, template_json, is_public, created_by)
                    VALUES ($1, $2, $3, $4, $5, 'system')
                `, [
                    template.name,
                    template.description,
                    template.category,
                    JSON.stringify(template.template_json),
                    template.is_public
                ]);
                console.log(`[TEMPLATES] Created: ${template.name}`);
            }
        }
        console.log('[TEMPLATES] Built-in templates initialized');
    } catch (error) {
        console.error('[TEMPLATES ERROR]', error.message);
    }
}

/**
 * Get all public templates
 * @param {string} category - Optional category filter
 */
async function getPublicTemplates(category = null) {
    let query = `
        SELECT id, name, description, category, template_json, usage_count, created_at
        FROM infrastructure_templates
        WHERE is_public = TRUE
    `;
    const params = [];

    if (category) {
        query += ` AND category = $1`;
        params.push(category);
    }

    query += ` ORDER BY usage_count DESC, name ASC`;

    const result = await pool.query(query, params);
    return result.rows;
}

/**
 * Get template by ID
 * @param {number} templateId - Template ID
 */
async function getTemplateById(templateId) {
    const result = await pool.query(`
        SELECT * FROM infrastructure_templates WHERE id = $1
    `, [templateId]);

    return result.rows[0] || null;
}

/**
 * Use a template (increments usage count)
 * @param {number} templateId - Template ID
 */
async function useTemplate(templateId) {
    const template = await getTemplateById(templateId);
    if (!template) return null;

    // Increment usage count
    await pool.query(`
        UPDATE infrastructure_templates 
        SET usage_count = usage_count + 1 
        WHERE id = $1
    `, [templateId]);

    return template;
}

/**
 * Create a custom template from a workspace
 * @param {string} userId - User creating the template
 * @param {object} templateData - Template details
 */
async function createTemplate(userId, templateData) {
    const { name, description, category, template_json, is_public = false } = templateData;

    const result = await pool.query(`
        INSERT INTO infrastructure_templates 
        (name, description, category, template_json, is_public, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name
    `, [name, description, category, JSON.stringify(template_json), is_public, userId]);

    return result.rows[0];
}

/**
 * Get templates created by a user
 * @param {string} userId - User ID
 */
async function getUserTemplates(userId) {
    const result = await pool.query(`
        SELECT id, name, description, category, is_public, usage_count, created_at
        FROM infrastructure_templates
        WHERE created_by = $1
        ORDER BY created_at DESC
    `, [userId]);

    return result.rows;
}

/**
 * Get template categories with counts
 */
async function getCategoryCounts() {
    const result = await pool.query(`
        SELECT category, COUNT(*) as count
        FROM infrastructure_templates
        WHERE is_public = TRUE
        GROUP BY category
        ORDER BY count DESC
    `);

    return result.rows;
}

module.exports = {
    CATEGORIES,
    BUILT_IN_TEMPLATES,
    initializeBuiltInTemplates,
    getPublicTemplates,
    getTemplateById,
    useTemplate,
    createTemplate,
    getUserTemplates,
    getCategoryCounts
};
