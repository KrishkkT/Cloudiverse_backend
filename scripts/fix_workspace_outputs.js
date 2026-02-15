const pool = require('../config/db');

async function fix() {
    const WORKSPACE_ID = 477;
    console.log('Starting DB patch for workspace', WORKSPACE_ID);

    try {
        // Select state_json instead of infra_outputs
        const res = await pool.query('SELECT state_json FROM workspaces WHERE id = $1', [WORKSPACE_ID]);
        if (res.rows.length === 0) {
            console.log('Workspace not found');
            return;
        }

        let state = res.rows[0].state_json;

        if (!state || !state.infra_outputs) {
            console.log('No infra_outputs found inside state_json');
            return;
        }

        let outputs = state.infra_outputs;

        // Check key existence
        if (outputs.deployment_target) {
            // Handle both raw value and Terraform output structure (value key)
            // The debug log showed: "deployment_target": { "type": "STATIC_STORAGE", ... } directly? 
            // No, looking at debug log: "deployment_target": { "type": "STATIC_STORAGE", ... } 
            // Wait, terraform output usually has { value: { ... }, type: ... }
            // But the log output from debug_state_json.js shows the CLEAN object.
            // Let's handle both just in case, but prioritize the structure seen in logs.

            let target = outputs.deployment_target;
            if (target.value && target.value.type) {
                target = target.value; // It's wrapped in terraform output structure
            }

            const currentType = target.type;
            console.log('Current deployment_target.type:', currentType);

            if (currentType === 'STATIC_STORAGE') {
                // PATCH IT
                target.type = 'CONTAINER';

                // Ensure container block is present
                if (!target.container) {
                    console.log('WARNING: container block missing in deployment_target!');
                }

                // Update the state_json in DB
                await pool.query('UPDATE workspaces SET state_json = $1 WHERE id = $2', [state, WORKSPACE_ID]);
                console.log('SUCCESS: Updated state_json.infra_outputs.deployment_target.type to CONTAINER');
            } else {
                console.log('No update needed. Type is:', currentType);
            }
        } else {
            console.log('deployment_target structure missing:', JSON.stringify(outputs, null, 2));
        }

    } catch (e) {
        console.error('Error patching DB:', e);
    } finally {
        // force exit to ensure pool closes
        process.exit(0);
    }
}

fix();
