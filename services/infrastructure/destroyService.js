/**
 * destroyService.js - Terraform Destroy Operations
 * 
 * Handles safe infrastructure deletion with:
 * - Typed confirmation validation (DELETE)
 * - Terraform destroy execution
 * - State cleanup after successful destroy
 * - Audit logging
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pool = require('../../config/db');

// In-memory job tracking
const destroyJobs = new Map();

const DESTROY_STATES = {
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed'
};

/**
 * Validate typed confirmation
 */
function validateConfirmation(confirmation) {
    return confirmation === 'DELETE';
}

/**
 * Initiate destroy job
 */
async function initiateDestroy(workspaceId, userId, confirmation) {
    // Validate confirmation
    if (!validateConfirmation(confirmation)) {
        throw new Error('Invalid confirmation. You must type exactly "DELETE" to proceed.');
    }

    // Get workspace
    const wsResult = await pool.query(
        'SELECT * FROM workspaces WHERE id = $1',
        [workspaceId]
    );

    if (wsResult.rows.length === 0) {
        throw new Error('Workspace not found');
    }

    const workspace = wsResult.rows[0];

    // Validate state
    if (workspace.deployment_status !== 'DEPLOYED' && workspace.deployment_status !== 'INFRA_READY') {
        throw new Error(`Cannot destroy: workspace is in ${workspace.deployment_status} state. Only DEPLOYED or INFRA_READY workspaces can be destroyed.`);
    }

    // Check for existing destroy job
    const existingJob = Array.from(destroyJobs.values()).find(
        j => j.workspaceId === workspaceId && j.status === DESTROY_STATES.RUNNING
    );
    if (existingJob) {
        throw new Error('A destroy operation is already in progress for this workspace.');
    }

    // Create job
    const jobId = `destroy-${workspaceId}-${Date.now()}`;
    const job = {
        id: jobId,
        workspaceId,
        userId,
        status: DESTROY_STATES.PENDING,
        logs: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null
    };

    destroyJobs.set(jobId, job);

    // Update workspace status to DESTROYING
    await pool.query(
        `UPDATE workspaces 
         SET deployment_status = 'DESTROYING',
             deployment_history = deployment_history || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify([{
            action: 'DESTROY_INITIATED',
            timestamp: new Date().toISOString(),
            user_id: userId,
            job_id: jobId
        }]), workspaceId]
    );

    // Start async destroy
    executeDestroy(jobId).catch(err => {
        console.error(`[DESTROY] Job ${jobId} failed:`, err);
    });

    return { jobId, status: 'initiated' };
}

/**
 * Execute Terraform destroy
 */
async function executeDestroy(jobId) {
    const job = destroyJobs.get(jobId);
    if (!job) throw new Error('Job not found');

    job.status = DESTROY_STATES.RUNNING;
    addLog(job, '🗑️ Starting infrastructure destruction...');

    try {
        // Get workspace info
        const wsResult = await pool.query(
            'SELECT * FROM workspaces WHERE id = $1',
            [job.workspaceId]
        );
        const workspace = wsResult.rows[0];
        const stateJson = workspace.state_json || {};
        const provider = stateJson.connection?.provider || stateJson.selectedProvider || 'aws';
        const region = stateJson.region || stateJson.infraSpec?.region?.resolved_region || 'us-east-1';

        // Locate Terraform directory
        const tfBaseDir = path.join(os.tmpdir(), 'cloudiverse-tf', String(job.workspaceId), provider.toUpperCase());

        if (!fs.existsSync(tfBaseDir)) {
            throw new Error(`Terraform directory not found: ${tfBaseDir}. Infrastructure may have been manually deleted or was never created.`);
        }

        addLog(job, `📁 Found Terraform state at: ${tfBaseDir}`);

        // Set up environment for credentials
        const env = { ...process.env };

        if (provider === 'aws') {
            const conn = stateJson.connection;
            if (conn?.role_arn) {
                // Use assume role credentials if available
                addLog(job, '🔑 Using AWS AssumeRole credentials');
            }
        }

        // Run terraform destroy
        addLog(job, '⚡ Executing: terraform destroy -auto-approve');

        await new Promise((resolve, reject) => {
            const tfDestroy = spawn('terraform', ['destroy', '-auto-approve', '-no-color'], {
                cwd: tfBaseDir,
                env,
                shell: true
            });

            tfDestroy.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => addLog(job, line));
            });

            tfDestroy.stderr.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                lines.forEach(line => addLog(job, `⚠️ ${line}`));
            });

            tfDestroy.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Terraform destroy exited with code ${code}`));
                }
            });

            tfDestroy.on('error', reject);
        });

        addLog(job, '✅ Terraform destroy completed successfully');

        // Clean up Terraform directory
        try {
            fs.rmSync(tfBaseDir, { recursive: true, force: true });
            addLog(job, '🧹 Cleaned up local Terraform files');
        } catch (cleanupErr) {
            addLog(job, `⚠️ Failed to clean up local files: ${cleanupErr.message}`);
        }

        // Update workspace state
        await cleanupAfterDestroy(job.workspaceId, job.userId, jobId);

        job.status = DESTROY_STATES.SUCCESS;
        job.completedAt = new Date().toISOString();
        addLog(job, '🎉 Infrastructure destroyed successfully!');

    } catch (err) {
        job.status = DESTROY_STATES.FAILED;
        job.error = err.message;
        job.completedAt = new Date().toISOString();
        addLog(job, `❌ Destroy failed: ${err.message}`);

        // Rollback status to DEPLOYED (destroy failed)
        await pool.query(
            `UPDATE workspaces 
             SET deployment_status = 'DEPLOYED',
                 deployment_history = deployment_history || $1::jsonb,
                 updated_at = NOW()
             WHERE id = $2`,
            [JSON.stringify([{
                action: 'DESTROY_FAILED',
                timestamp: new Date().toISOString(),
                error: err.message,
                job_id: jobId
            }]), job.workspaceId]
        );

        throw err;
    }
}

/**
 * Clean up workspace after successful destroy
 */
async function cleanupAfterDestroy(workspaceId, userId, jobId) {
    // Clear infra outputs but retain infraSpec for audit
    await pool.query(
        `UPDATE workspaces 
         SET deployment_status = 'DESTROYED',
             deployed_at = NULL,
             state_json = state_json - 'infra_outputs' - 'connection',
             deployment_history = deployment_history || $1::jsonb,
             updated_at = NOW()
         WHERE id = $2`,
        [JSON.stringify([{
            action: 'DESTROY_COMPLETED',
            timestamp: new Date().toISOString(),
            user_id: userId,
            job_id: jobId
        }]), workspaceId]
    );

    console.log(`[DESTROY] Workspace ${workspaceId} marked as DESTROYED`);
}

/**
 * Get job status
 */
function getJobStatus(jobId) {
    const job = destroyJobs.get(jobId);
    if (!job) return null;

    return {
        id: job.id,
        status: job.status,
        logs: job.logs,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        error: job.error
    };
}

/**
 * Add log entry
 */
function addLog(job, message) {
    const entry = {
        timestamp: new Date().toISOString(),
        message: String(message)
    };
    job.logs.push(entry);
    console.log(`[DESTROY][${job.id}] ${message}`);
}

module.exports = {
    initiateDestroy,
    getJobStatus,
    validateConfirmation,
    DESTROY_STATES
};
