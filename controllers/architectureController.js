const patternResolver = require('../services/core/patternResolver');

class ArchitectureController {

    /**
     * Validate if a service removal is legal
     * POST /api/architecture/validate-removal
     * Body: { service_id: string, current_infra: object }
     */
    async validateRemoval(req, res) {
        try {
            const { service_id, current_infra } = req.body;

            if (!service_id || !current_infra) {
                return res.status(400).json({ error: 'Missing service_id or current_infra' });
            }

            const result = patternResolver.validateServiceRemoval(service_id, current_infra);

            return res.json(result);

        } catch (error) {
            console.error('[ArchController] Error validating removal:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * Reconcile architecture after a change (Add/Remove)
     * POST /api/architecture/reconcile
     * Body: { current_infra: object, capabilities: object }
     */
    async reconcile(req, res) {
        try {
            const { current_infra, action } = req.body;

            if (!current_infra || !action) {
                return res.status(400).json({ error: 'Missing current_infra or action' });
            }

            // 1. If Remove, run validation first (optional safety net)
            if (action.type === 'REMOVE_SERVICE') {
                const validation = patternResolver.validateServiceRemoval(action.serviceId, current_infra);
                if (!validation.valid) {
                    return res.status(409).json({ error: validation.error });
                }
            }

            // 2. Run Reconciliation Engine
            const reconciled = patternResolver.reconcileArchitecture(current_infra, action);

            return res.json(reconciled);

        } catch (error) {
            console.error('[ArchController] Error reconciling:', error);
            return res.status(500).json({ error: 'Internal server error' });
        }
    }

    /**
     * AI-Driven Validation of Completeness
     */
    async validateCompleteness(req, res) {
        try {
            const { description, current_services, catalog } = req.body;
            if (!description || !current_services) {
                return res.status(400).json({ error: 'Missing description or current_services' });
            }

            const validation = await aiService.validateServiceCompleteness(description, current_services, catalog || {});
            return res.json(validation);

        } catch (error) {
            console.error('[ArchController] Validation error:', error);
            // Fallback to empty suggestions on AI failure
            return res.json({ suggestions: [] });
        }
    }
}

module.exports = new ArchitectureController();
