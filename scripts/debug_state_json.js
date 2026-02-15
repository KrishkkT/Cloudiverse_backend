const pool = require('../config/db');

async function debugState() {
    const WORKSPACE_ID = 477;
    try {
        const res = await pool.query('SELECT state_json FROM workspaces WHERE id = $1', [WORKSPACE_ID]);
        if (res.rows.length === 0) {
            console.log('Workspace not found');
            return;
        }
        const state = res.rows[0].state_json;
        console.log('State Keys:', Object.keys(state));

        if (state.infra_outputs) {
            console.log('Has infra_outputs:', true);
            if (state.infra_outputs.deployment_target) {
                console.log('deployment_target:', JSON.stringify(state.infra_outputs.deployment_target, null, 2));
            } else {
                console.log('infra_outputs has no deployment_target');
            }
        } else {
            console.log('No infra_outputs in state_json');
        }

    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

debugState();
