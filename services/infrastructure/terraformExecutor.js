const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const credentialProvider = require('./credentialProvider');
const { google } = require('googleapis');
const pool = require('../../config/db');

// Configuration
const ENABLE_REAL_TERRAFORM = process.env.ENABLE_REAL_TERRAFORM === 'true';
const TERRAFORM_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const TERRAFORM_WORK_DIR = path.join(os.tmpdir(), 'cloudiverse-tf');

// Resolve Terraform binary path:
// 1. TERRAFORM_BIN env var (explicit override)
// 2. Render build script install location
// 3. System PATH (local dev / standard install)
const TERRAFORM_BIN = (() => {
    if (process.env.TERRAFORM_BIN) return process.env.TERRAFORM_BIN;
    const renderPath = path.join(__dirname, '../../terraform_bin');
    try {
        const fsSync = require('fs');
        if (fsSync.existsSync(renderPath)) return renderPath;
    } catch (e) { /* ignore */ }
    return 'terraform'; // fallback to system PATH
})();
console.log(`[TERRAFORM] Binary path resolved: ${TERRAFORM_BIN}`);

const isAzure = (p) => ['azure', 'azurerm'].includes(String(p).toLowerCase());

// In-memory job store (resets on server restart)
const jobs = new Map();

class TerraformExecutor {

    // ─── JOB MANAGEMENT ───────────────────────────────────────────────────────────

    createJob(type, workspaceId, metadata = {}) {
        const jobId = uuidv4();
        const job = {
            id: jobId,
            type, // 'terraform' | 'app'
            workspaceId,
            status: 'init', // init, running, completed, failed
            stage: 'init',
            logs: [],
            startTime: new Date(),
            metadata
        };
        jobs.set(jobId, job);
        return job;
    }

    getJob(jobId) {
        return jobs.get(jobId);
    }

    getActiveJobs(workspaceId) {
        const activeJobs = [];
        for (const job of jobs.values()) {
            // Check if job belongs to workspace and is in a non-terminal state
            if (job.workspaceId === workspaceId && ['init', 'running', 'queued'].includes(job.status)) {
                activeJobs.push(job);
            }
        }
        return activeJobs;
    }

    addLog(jobId, message, type = 'INFO') {
        const job = jobs.get(jobId);
        if (job) {
            job.logs.push({
                timestamp: new Date(),
                message,
                type
            });
        }
    }

    /**
     * Helper to check GCP Billing status for a given project and auth client.
     * @param {string} projectId - The GCP project ID.
     * @param {object} authClient - The authenticated Google API client.
     * @returns {Promise<object>} Billing info data.
     * @throws {Error} If there's an error checking billing.
     */
    async _getGcpBillingInfo(projectId, authClient) {
        const cloudbilling = google.cloudbilling({ version: 'v1', auth: authClient });
        try {
            const res = await cloudbilling.projects.getBillingInfo({
                name: `projects/${projectId}`
            });
            return res.data;
        } catch (error) {
            // Log the error for debugging, but re-throw to be handled by the caller
            console.error(`Error checking billing for ${projectId}:`, error.message);
            throw error;
        }
    }

    /**
     * Check GCP Billing Status
     */
    async checkGcpBilling(jobId, envVars) {
        const projectId = envVars.GOOGLE_PROJECT || envVars.GCLOUD_PROJECT;
        if (!projectId) {
            this.addLog(jobId, 'Skipping Billing Check: No GCP Project ID found.', 'WARN');
            return;
        }

        try {
            this.addLog(jobId, `Verifying GCP Billing for project: ${projectId}...`, 'CMD');

            let authClient;

            // Mode 1: Credentials File
            if (envVars.GOOGLE_APPLICATION_CREDENTIALS) {
                const auth = new google.auth.GoogleAuth({
                    keyFile: envVars.GOOGLE_APPLICATION_CREDENTIALS,
                    scopes: ['https://www.googleapis.com/auth/cloud-platform']
                });
                authClient = await auth.getClient();
            }
            // Mode 2: Access Token
            else if (envVars.GOOGLE_OAUTH_ACCESS_TOKEN) {
                const oauth2Client = new google.auth.OAuth2();
                oauth2Client.setCredentials({ access_token: envVars.GOOGLE_OAUTH_ACCESS_TOKEN });
                authClient = oauth2Client;
            } else {
                throw new Error("No GCP credentials available for billing check");
            }

            const cloudbilling = google.cloudbilling({ version: 'v1', auth: authClient });
            const res = await cloudbilling.projects.getBillingInfo({
                name: `projects/${projectId}`
            });

            if (!res.data.billingEnabled) {
                throw new Error(`Billing is NOT enabled for project '${projectId}'. Please enable it in the Google Cloud Console: https://console.cloud.google.com/billing`);
            }

            this.addLog(jobId, `Billing check passed: Account '${res.data.billingAccountName || "Linked"}'`, 'SUCCESS');

        } catch (error) {
            throw new Error(`Billing Verification Failed: ${error.message}`);
        }
    }

    // ─── SIMULATION LOGIC (MOCK) ──────────────────────────────────────────────────

    // Provider-specific Terraform resource mapping
    getResourceName(provider, canonicalType) {
        const mappings = {
            aws: {
                computecontainer: 'aws_ecs_service.app',
                relationaldatabase: 'aws_db_instance.postgres',
                objectstorage: 'aws_s3_bucket.assets',
                cache: 'aws_elasticache_cluster.cache',
                logging: 'aws_cloudwatch_log_group.logs',
                monitoring: 'aws_cloudwatch_metric_alarm.alerts',
                identityauth: 'aws_cognito_user_pool.auth',
                cdn: 'aws_cloudfront_distribution.cdn',
                loadbalancer: 'aws_lb.main',
                secretsmanagement: 'aws_secretsmanager_secret.secrets',
                dns: 'aws_route53_record.main'
            },
            gcp: {
                computecontainer: 'google_cloud_run_service.app',
                relationaldatabase: 'google_sql_database_instance.postgres',
                objectstorage: 'google_storage_bucket.assets',
                cache: 'google_redis_instance.cache',
                logging: 'google_logging_project_sink.logs',
                monitoring: 'google_monitoring_alert_policy.alerts',
                identityauth: 'google_identity_platform_config.auth',
                cdn: 'google_compute_backend_bucket.cdn',
                loadbalancer: 'google_compute_url_map.main',
                secretsmanagement: 'google_secret_manager_secret.secrets',
                dns: 'google_dns_record_set.main'
            },
            azure: {
                computecontainer: 'azurerm_container_app.app',
                relationaldatabase: 'azurerm_postgresql_flexible_server.postgres',
                objectstorage: 'azurerm_storage_account.assets',
                cache: 'azurerm_redis_cache.cache',
                logging: 'azurerm_log_analytics_workspace.logs',
                monitoring: 'azurerm_monitor_metric_alert.alerts',
                identityauth: 'azurerm_user_assigned_identity.auth',
                cdn: 'azurerm_cdn_endpoint.cdn',
                loadbalancer: 'azurerm_lb.main',
                secretsmanagement: 'azurerm_key_vault_secret.secrets',
                dns: 'azurerm_dns_a_record.main'
            }
        };

        const prov = String(provider).toLowerCase();
        const key = String(canonicalType).toLowerCase();

        if (isAzure(prov)) return mappings.azure[key] || `azure_${key}.main`;
        if (prov === 'aws') return mappings.aws[key] || `aws_${key}.main`;
        if (prov === 'gcp') return mappings.gcp[key] || `gcp_${key}.main`;

        return `${prov}_${key}.main`;
    }

    async startTerraformSimulation(jobId, provider, services = []) {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';

        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        try {
            // Stage 1: Init
            job.stage = 'init';
            this.addLog(jobId, `Initializing Terraform backend for ${provider?.toUpperCase() || 'CLOUD'}...`, 'CMD');
            await delay(1500);
            this.addLog(jobId, 'Terraform has been successfully initialized!', 'SYSTEM');
            this.addLog(jobId, `Installing ${provider?.toUpperCase()} provider plugins...`, 'INFO');
            await delay(1500);

            // Stage 2: Plan
            job.stage = 'plan';
            this.addLog(jobId, 'Generating execution plan...', 'CMD');
            await delay(2000);
            const resourceCount = services.length || 6;
            this.addLog(jobId, `Plan: ${resourceCount} to add, 0 to change, 0 to destroy.`, 'INFO');
            this.addLog(jobId, 'Validation successful.', 'SYSTEM');
            await delay(1000);

            // Stage 3: Apply - use actual services
            job.stage = 'apply';
            this.addLog(jobId, 'Applying infrastructure changes...', 'CMD');

            if (services.length > 0) {
                // Iterate through actual services
                for (let i = 0; i < services.length; i++) {
                    const svc = services[i];
                    const resourceName = this.getResourceName(provider, svc.canonical_type);

                    this.addLog(jobId, `${resourceName}: Creating...`, 'INFO');
                    await delay(800 + Math.random() * 400);

                    // Simulate longer creation for some resource types
                    if (['relationaldatabase', 'cache', 'identityauth'].includes(svc.canonical_type)) {
                        this.addLog(jobId, `${resourceName}: Still creating... [10s elapsed]`, 'INFO');
                        await delay(1000);
                    }

                    this.addLog(jobId, `${resourceName}: Creation complete [id=${svc.canonical_type}-${i}abcdef]`, 'INFO');
                }
            } else {
                // Fallback for empty services
                this.addLog(jobId, 'No deployable services found. Skipping resource creation.', 'WARN');
            }

            await delay(500);
            this.addLog(jobId, `Apply complete! Resources: ${services.length} added, 0 changed, 0 destroyed.`, 'SUCCESS');

            // Complete
            job.status = 'completed';
            job.stage = 'finished';

        } catch (err) {
            job.status = 'failed';
            this.addLog(jobId, `Error: ${err.message}`, 'ERROR');
        }
    }

    async startAppDeploySimulation(jobId, sourceType, target, branch = 'main') {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';
        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        try {
            // Stage 1: Build/Pull
            job.stage = 'build';
            this.addLog(jobId, `Starting deployment from ${sourceType}...`, 'CMD');

            if (sourceType === 'github') {
                this.addLog(jobId, `Cloning repository ${target} (branch: ${branch})...`, 'INFO');
                await delay(1500);
                this.addLog(jobId, 'Repository cloned successfully.', 'SYSTEM');
                this.addLog(jobId, 'Detecting buildpack... Node.js detected.', 'INFO');
                await delay(1000);
                this.addLog(jobId, 'Running npm install...', 'CMD');
                await delay(2000);
            } else {
                this.addLog(jobId, `Pulling Docker image ${target}...`, 'CMD');
                await delay(2000);
                this.addLog(jobId, 'Image pull complete. Digest: sha256:8b0a...', 'INFO');
            }

            // Stage 2: Deploy
            job.stage = 'deploy';
            this.addLog(jobId, 'Stopping existing containers...', 'INFO');
            await delay(1000);
            this.addLog(jobId, 'Starting new instance...', 'CMD');
            await delay(2000);

            // Stage 3: Health Check
            job.stage = 'verify';
            this.addLog(jobId, 'Running health checks...', 'INFO');
            await delay(1000);
            this.addLog(jobId, 'Health check passed: HTTP 200 OK.', 'SUCCESS');

            // Complete
            job.status = 'completed';

        } catch (err) {
            job.status = 'failed';
            this.addLog(jobId, `Deployment Failed: ${err.message}`, 'ERROR');
        }
    }

    // ─── REAL TERRAFORM EXECUTION ───────────────────────────────────────────────────

    /**
     * Check if real Terraform execution is enabled
     */
    isRealExecutionEnabled() {
        return ENABLE_REAL_TERRAFORM;
    }

    /**
     * Run a single Terraform command with log streaming
     * @returns {Promise<{success: boolean, exitCode: number}>}
     */
    async runTerraformCommand(jobId, command, args, workDir, envVars) {
        return new Promise((resolve) => {
            const job = jobs.get(jobId);
            if (!job) return resolve({ success: false, exitCode: -1 });

            const fullCommand = `terraform ${command}`;
            this.addLog(jobId, `$ ${fullCommand} ${args.join(' ')}`, 'CMD');

            // 🚫 HARD GUARD: DEFENSIVE REGION CHECK
            if (envVars.AWS_DEFAULT_REGION && !/^([a-z]{2}-[a-z]+-\d)$/.test(envVars.AWS_DEFAULT_REGION)) {
                const err = `Invalid AWS region format detected: "${envVars.AWS_DEFAULT_REGION}". Execution blocked to prevent DNS failure.`;
                this.addLog(jobId, `CRITICAL: ${err}`, 'ERROR');
                return resolve({ success: false, exitCode: 1 });
            }

            const proc = spawn(TERRAFORM_BIN, [command, ...args], {
                cwd: workDir,
                env: {
                    ...process.env,
                    ...envVars,
                    // 🔥 NUCLEAR FIX: Force Terraform/Go SDK to ignore local ~/.aws/config
                    AWS_SDK_LOAD_CONFIG: "0",
                    AWS_STS_REGIONAL_ENDPOINTS: "regional"
                },
                shell: true
            });

            let killed = false;

            // Timeout handler
            const timeout = setTimeout(() => {
                killed = true;
                proc.kill('SIGTERM');
                this.addLog(jobId, `ERROR: Command timed out after ${TERRAFORM_TIMEOUT_MS / 60000} minutes`, 'ERROR');
            }, TERRAFORM_TIMEOUT_MS);

            // Stream stdout
            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const sanitized = credentialProvider.sanitizeLog(line, envVars);
                    this.addLog(jobId, sanitized, 'INFO');
                }
            });

            // Stream stderr
            proc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n').filter(l => l.trim());
                for (const line of lines) {
                    const sanitized = credentialProvider.sanitizeLog(line, envVars);
                    // Terraform often puts info in stderr, categorize accordingly
                    const type = line.includes('Error') ? 'ERROR' : 'WARN';
                    this.addLog(jobId, sanitized, type);
                }
            });

            // Completion
            proc.on('close', (code) => {
                clearTimeout(timeout);
                if (killed) {
                    resolve({ success: false, exitCode: -1 });
                } else {
                    resolve({ success: code === 0, exitCode: code });
                }
            });

            proc.on('error', (err) => {
                clearTimeout(timeout);
                this.addLog(jobId, `Process error: ${err.message}`, 'ERROR');
                resolve({ success: false, exitCode: -1 });
            });
        });
    }

    /**
     * Execute real Terraform init/plan/apply sequence
     * @param {string} jobId - Job ID
     * @param {string} provider - aws | gcp | azure  
     * @param {string} workspaceId - Workspace ID
     * @param {object} terraformFiles - Object with filename -> content
     * @param {object} connectionData - state_json.connection
     */
    async startRealTerraformExecution(jobId, provider, workspaceId, terraformFiles, connectionData) {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';
        job.stage = 'setup';

        const workDir = path.join(TERRAFORM_WORK_DIR, String(workspaceId), provider);
        let credentialFiles = [];

        try {
            // ─── STAGE 1: SETUP WORKSPACE ───────────────────────────────────────────
            this.addLog(jobId, `Creating workspace directory: ${workDir}`, 'SYSTEM');
            await fs.mkdir(workDir, { recursive: true });

            // Write Terraform files
            this.addLog(jobId, 'Writing Terraform configuration files...', 'INFO');
            const fileCount = Object.keys(terraformFiles).length;

            for (const [filename, content] of Object.entries(terraformFiles)) {
                const filePath = path.join(workDir, filename);

                // Create subdirectories if needed (for modular structure)
                const fileDir = path.dirname(filePath);
                if (fileDir !== workDir) {
                    await fs.mkdir(fileDir, { recursive: true });
                }

                await fs.writeFile(filePath, content);
            }
            this.addLog(jobId, `Wrote ${fileCount} configuration files`, 'SUCCESS');

            // ─── STAGE 2: GET CREDENTIALS ───────────────────────────────────────────
            job.stage = 'credentials';
            this.addLog(jobId, `Obtaining ${provider.toUpperCase()} credentials...`, 'INFO');

            const { envVars, credentialFiles: credFiles } = await credentialProvider.getCredentials(
                provider,
                connectionData,
                workDir
            );
            credentialFiles = credFiles;

            // INJECT TF_VAR MAPPING FOR AZURE
            if (isAzure(provider)) {
                // Naming convention: rg-cldv-ws-<workspace_id>
                const rgName = `rg-cldv-ws-${workspaceId}`;
                envVars.TF_VAR_resource_group_name = rgName;

                // Map ARM credentials to user variables for the provider block (Standardized per refined plan)
                if (envVars.ARM_SUBSCRIPTION_ID) envVars.TF_VAR_user_subscription_id = envVars.ARM_SUBSCRIPTION_ID;
                if (envVars.ARM_TENANT_ID) envVars.TF_VAR_user_tenant_id = envVars.ARM_TENANT_ID;
                if (envVars.ARM_CLIENT_ID) envVars.TF_VAR_user_client_id = envVars.ARM_CLIENT_ID;
                if (envVars.ARM_CLIENT_SECRET) envVars.TF_VAR_user_client_secret = envVars.ARM_CLIENT_SECRET;
                if (envVars.ARM_ACCESS_TOKEN) envVars.TF_VAR_user_access_token = envVars.ARM_ACCESS_TOKEN;

                this.addLog(jobId, `Injected Azure Resource Group: ${rgName} and mapped user credentials`, 'INFO');
            }

            this.addLog(jobId, 'Credentials obtained successfully', 'SUCCESS');

            // ─── STAGE 2.5: PRE-FLIGHT CHECKS ───────────────────────────────────────
            if (provider.toLowerCase() === 'gcp') {
                await this.checkGcpBilling(jobId, envVars);
            }

            // ─── STAGE 3: TERRAFORM INIT ────────────────────────────────────────────
            // ─── STAGE 3: TERRAFORM INIT ────────────────────────────────────────────
            job.stage = 'init';

            // 🔥 CLEANUP: Remove .terraform folder and lock to allow fresh init,
            // but PRESERVE terraform.tfstate so re-deploys don't orphan resources
            const terraformDir = path.join(workDir, '.terraform');
            const terraformLock = path.join(workDir, '.terraform.lock.hcl');

            try {
                await fs.rm(terraformDir, { recursive: true, force: true });
                await fs.rm(terraformLock, { force: true });
                this.addLog(jobId, 'Cleaned Terraform cache (state preserved for idempotent re-deploy)', 'INFO');
            } catch (e) {
                // ignore
            }

            this.addLog(jobId, `Initializing Terraform for ${provider.toUpperCase()}...`, 'CMD');

            const initArgs = ['-input=false', '-no-color'];

            // 🔥 AZURE BACKEND CONFIGURATION
            if (isAzure(provider)) {
                // Config removed to allow local state (fix for missing storage account)
                this.addLog(jobId, `Using Local Backend for Azure (State stored in workspace dir)`, 'INFO');
            }

            const initResult = await this.runTerraformCommand(
                jobId,
                'init',
                initArgs,
                workDir,
                envVars
            );

            if (!initResult.success) {
                throw new Error(`Terraform init failed with exit code ${initResult.exitCode}`);
            }
            this.addLog(jobId, 'Terraform initialized successfully!', 'SUCCESS');

            // ─── STAGE 4: TERRAFORM PLAN ────────────────────────────────────────────
            job.stage = 'plan';
            this.addLog(jobId, 'Generating execution plan...', 'CMD');

            const planResult = await this.runTerraformCommand(
                jobId,
                'plan',
                ['-input=false', '-no-color', '-out=tfplan'],
                workDir,
                envVars
            );

            if (!planResult.success) {
                throw new Error(`Terraform plan failed with exit code ${planResult.exitCode}`);
            }
            this.addLog(jobId, 'Plan generated successfully!', 'SUCCESS');

            // ─── STAGE 5: TERRAFORM APPLY ───────────────────────────────────────────
            job.stage = 'apply';
            this.addLog(jobId, 'Applying infrastructure changes...', 'CMD');

            const applyResult = await this.runTerraformCommand(
                jobId,
                'apply',
                ['-input=false', '-no-color', '-auto-approve', 'tfplan'],
                workDir,
                envVars
            );

            if (!applyResult.success) {
                throw new Error(`Terraform apply failed with exit code ${applyResult.exitCode}`);
            }

            this.addLog(jobId, 'Apply complete! Infrastructure deployed successfully.', 'SUCCESS');

            // ─── STAGE 6: GET OUTPUTS ───────────────────────────────────────────────
            job.stage = 'outputs';
            this.addLog(jobId, 'Capturing infrastructure outputs...', 'CMD');

            const outputData = await new Promise((resolve, reject) => {
                const proc = spawn(TERRAFORM_BIN, ['output', '-json'], {
                    cwd: workDir,
                    shell: true,
                    env: { ...process.env, ...envVars }
                });
                let stdout = '';
                proc.stdout.on('data', d => stdout += d.toString());
                proc.on('close', code => {
                    if (code === 0) resolve(stdout);
                    else reject(new Error(`Terraform output failed with code ${code}`));
                });
            });

            let cleanOutputs = {};
            try {
                const parsedOutputs = JSON.parse(outputData);
                // Flatten: { key: { value: ... } } -> { key: ... }
                Object.keys(parsedOutputs).forEach(k => {
                    cleanOutputs[k] = parsedOutputs[k].value;
                });
            } catch (e) {
                this.addLog(jobId, 'Warning: Failed to parse Terraform outputs', 'WARN');
            }

            this.addLog(jobId, `Outputs captured: ${Object.keys(cleanOutputs).join(', ')}`, 'INFO');

            // ─── STAGE 7: PERSIST STATE ─────────────────────────────────────────────
            try {
                console.log(`[TF PERSIST DEBUG] Saving infra_outputs to workspace ${workspaceId}:`, JSON.stringify(cleanOutputs, null, 2));
                const updateResult = await pool.query(
                    `UPDATE workspaces 
                     SET state_json = jsonb_set(
                        COALESCE(state_json, '{}'), 
                        '{infra_outputs}', 
                        $1
                     ),
                     deployment_status = CASE 
                        WHEN deployment_status = 'DRAFT' THEN 'INFRA_READY'
                        ELSE deployment_status 
                     END,
                     deployment_history = COALESCE(deployment_history, '[]'::jsonb) || $3::jsonb
                     WHERE id = $2
                     RETURNING id, state_json->'infra_outputs' as saved_outputs, deployment_status`,
                    [
                        JSON.stringify(cleanOutputs),
                        workspaceId,
                        JSON.stringify([{
                            action: 'TERRAFORM_APPLY_SUCCESS',
                            timestamp: new Date().toISOString(),
                            job_id: jobId,
                            outputs_keys: Object.keys(cleanOutputs)
                        }])
                    ]
                );
                if (updateResult.rowCount === 0) {
                    console.error(`[TF PERSIST DEBUG] WARNING: No rows updated! workspaceId=${workspaceId} not found.`);
                } else {
                    console.log(`[TF PERSIST DEBUG] Successfully updated workspace ${updateResult.rows[0].id}, status=${updateResult.rows[0].deployment_status}, saved_outputs keys:`, Object.keys(updateResult.rows[0].saved_outputs || {}));
                }
                this.addLog(jobId, 'Infrastructure state persisted to database.', 'SUCCESS');
            } catch (dbErr) {
                console.error("DB Persist Error:", dbErr);
                this.addLog(jobId, `Failed to persist state: ${dbErr.message}`, 'ERROR');
            }

            // ─── COMPLETE ───────────────────────────────────────────────────────────
            job.status = 'completed';
            job.stage = 'finished';
            job.metadata.workDir = workDir; // Store for potential destroy later

        } catch (err) {
            job.status = 'failed';
            this.addLog(jobId, `ERROR: ${err.message}`, 'ERROR');
        } finally {
            // Cleanup credential files (but keep TF files for potential destroy)
            await credentialProvider.cleanup(credentialFiles);
        }
    }

    /**
     * Start Terraform Destroy (called from API endpoint)
     * @param {string} jobId - Job ID
     * @param {string} provider - aws | gcp | azure
     * @param {string} workspaceId - Workspace ID
     * @param {object} connectionData - Cloud connection data
     * @param {string} region - Region
     */
    async startTerraformDestroy(jobId, provider, workspaceId, connectionData, region) {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';
        job.stage = 'setup';

        const workDir = path.join(TERRAFORM_WORK_DIR, String(workspaceId), provider);
        let credentialFiles = [];

        try {
            // Check if workspace directory exists
            try {
                await fs.access(workDir);
            } catch {
                throw new Error('Terraform workspace not found. Infrastructure may have already been destroyed.');
            }

            this.addLog(jobId, `Starting infrastructure destruction for workspace ${workspaceId}`, 'SYSTEM');

            // Get credentials
            job.stage = 'credentials';
            this.addLog(jobId, `Obtaining ${provider.toUpperCase()} credentials...`, 'INFO');

            const { envVars, credentialFiles: credFiles } = await credentialProvider.getCredentials(
                provider,
                connectionData,
                workDir
            );
            credentialFiles = credFiles;
            this.addLog(jobId, 'Credentials obtained successfully', 'SUCCESS');

            // Run terraform destroy
            job.stage = 'destroy';
            this.addLog(jobId, '⚠️ Destroying all infrastructure resources...', 'CMD');
            this.addLog(jobId, 'This may take 10-20 minutes for some resources (e.g., CloudFront)', 'INFO');

            const destroyResult = await this.runTerraformCommand(
                jobId,
                'destroy',
                ['-input=false', '-no-color', '-auto-approve'],
                workDir,
                envVars
            );

            if (!destroyResult.success) {
                throw new Error(`Terraform destroy failed with exit code ${destroyResult.exitCode}`);
            }

            this.addLog(jobId, '✅ Infrastructure destroyed successfully!', 'SUCCESS');
            job.status = 'completed';
            job.stage = 'finished';

            // ─── RESET STATE IN DB ───────────────────────────────────────────────
            try {
                await pool.query(
                    `UPDATE workspaces 
                     SET state_json = state_json - 'infra_outputs',
                         deployment_status = 'DESTROYED',
                         deployment_history = COALESCE(deployment_history, '[]'::jsonb) || $2::jsonb
                     WHERE id = $1`,
                    [
                        workspaceId,
                        JSON.stringify([{
                            action: 'TERRAFORM_DESTROY_SUCCESS',
                            timestamp: new Date().toISOString(),
                            job_id: jobId
                        }])
                    ]
                );
                this.addLog(jobId, 'Infrastructure state cleared from database.', 'SUCCESS');
            } catch (dbErr) {
                console.error("DB State Reset Error:", dbErr);
                this.addLog(jobId, `Warning: Failed to clear state from DB: ${dbErr.message}`, 'WARN');
            }

            // Cleanup workspace directory after successful destroy
            await this.cleanupWorkspace(workDir);

        } catch (err) {
            job.status = 'failed';
            this.addLog(jobId, `ERROR: ${err.message}`, 'ERROR');
        } finally {
            await credentialProvider.cleanup(credentialFiles);
        }
    }

    /**
     * Simulation mode for destroy (development/testing)
     */
    startDestroySimulation(jobId, provider) {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';

        const stages = [
            { message: 'Initializing destroy operation...', delay: 500 },
            { message: 'Reading Terraform state...', delay: 1000 },
            { message: 'Planning destruction...', delay: 1500 },
            { message: 'Destroying aws_cloudfront_distribution.main...', delay: 3000 },
            { message: 'Destroying aws_s3_bucket.main...', delay: 1500 },
            { message: 'Destroying aws_db_instance.default...', delay: 2000 },
            { message: 'Destroying aws_db_subnet_group.default...', delay: 500 },
            { message: 'Destroying aws_subnet.private...', delay: 500 },
            { message: 'Destroying aws_subnet.public...', delay: 500 },
            { message: 'Destroying aws_vpc.main...', delay: 500 },
            { message: '✅ Destroy complete! 10 resources destroyed.', delay: 500 }
        ];

        let delay = 0;
        stages.forEach(stage => {
            delay += stage.delay;
            setTimeout(() => {
                this.addLog(jobId, stage.message, 'INFO');
            }, delay);
        });

        setTimeout(() => {
            job.status = 'completed';
        }, delay + 500);
    }

    /**
     * Destroy infrastructure for a workspace
     */
    async destroyInfrastructure(jobId, workDir, envVars) {
        const job = jobs.get(jobId);
        if (!job) return;

        job.status = 'running';
        job.stage = 'destroy';

        try {
            this.addLog(jobId, 'Destroying infrastructure...', 'CMD');

            const destroyResult = await this.runTerraformCommand(
                jobId,
                'destroy',
                ['-input=false', '-no-color', '-auto-approve'],
                workDir,
                envVars
            );

            if (!destroyResult.success) {
                throw new Error(`Terraform destroy failed`);
            }

            this.addLog(jobId, 'Infrastructure destroyed successfully.', 'SUCCESS');
            job.status = 'completed';

            // Cleanup workspace directory after destroy
            await this.cleanupWorkspace(workDir);

        } catch (err) {
            job.status = 'failed';
            this.addLog(jobId, `Destroy failed: ${err.message}`, 'ERROR');
        }
    }

    /**
     * Cleanup workspace directory
     */
    async cleanupWorkspace(workDir) {
        try {
            await fs.rm(workDir, { recursive: true, force: true });
            console.log(`[TF_EXECUTOR] Cleaned up workspace: ${workDir}`);
        } catch (err) {
            console.warn(`[TF_EXECUTOR] Cleanup warning: ${err.message}`);
        }
    }
}

module.exports = new TerraformExecutor();

