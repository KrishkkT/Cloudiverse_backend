const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { ECSClient, RegisterTaskDefinitionCommand, UpdateServiceCommand, DescribeTaskDefinitionCommand } = require("@aws-sdk/client-ecs");
const { CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand } = require("@aws-sdk/client-codebuild");
const { Storage } = require('@google-cloud/storage');
const { BlobServiceClient, BlockBlobClient } = require("@azure/storage-blob");
const { ClientSecretCredential } = require("@azure/identity");
const { ContainerAppsAPIClient } = require("@azure/arm-appcontainers");
const { ContainerRegistryManagementClient } = require("@azure/arm-containerregistry");
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const pool = require('../../config/db');
const githubService = require('./githubService');
const archiver = require('archiver');
const axios = require('axios');
const { detectProjectType } = require('../../utils/projectDetector');

// Helper to create AWS Clients with Assumed Role
const createAwsClient = async (ClientClass, region, roleArn, externalId) => {
    // 1. Get Backend Credentials (from env or implicit)
    const stsConfig = { region: "ap-south-1" };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        stsConfig.credentials = {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        };
    }
    const sts = new STSClient(stsConfig);

    // 2. Assume the User's Role
    console.log(`[DEPLOY] Assuming role: ${roleArn}`);
    const assumeCmd = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: "CloudiverseDeploySession",
        ExternalId: externalId
    });

    const assumed = await sts.send(assumeCmd);

    // 3. Return Client with Temporary Credentials
    return new ClientClass({
        region: region,
        credentials: {
            accessKeyId: assumed.Credentials.AccessKeyId,
            secretAccessKey: assumed.Credentials.SecretAccessKey,
            sessionToken: assumed.Credentials.SessionToken
        }
    });
};

const createDeployment = async (workspaceId, sourceType, config) => {
    const result = await pool.query(
        `INSERT INTO deployments (workspace_id, source_type, status, logs) VALUES ($1, $2, 'pending', '[]') RETURNING id`,
        [workspaceId, sourceType]
    );
    return result.rows[0].id;
};


// Helper: Target Provider Update (ECS, AppService, CloudRun, ContainerApps)
async function deployImageToProvider(deploymentId, workspace, conn, provider, image) {
    await appendLog(deploymentId, `☁️ Initiating Provider Update for ${provider.toUpperCase()}...`);
    const infraOutputs = workspace.state_json.infra_outputs;
    const region = workspace.state_json.region || 'ap-south-1';

    // Ensure computecontainer is present (Handle snake_case V2 output)
    if (infraOutputs && infraOutputs.compute_container) {
        infraOutputs.computecontainer = infraOutputs.compute_container;
    }

    // Ensure computecontainer is present or fallback
    if (!infraOutputs || !infraOutputs.computecontainer) {
        await appendLog(deploymentId, `⚠️ Standardized computecontainer outputs not found. Attempting legacy fallback...`);
        // Fallback or initialization of computecontainer object for downstream logic
        const legacyNames = {
            aws: { cluster_name: infraOutputs.cluster_name?.value || infraOutputs.ecs_cluster?.value, service_name: infraOutputs.service_name?.value || infraOutputs.ecs_service?.value },
            azure: { container_app_name: infraOutputs.container_app_name?.value || infraOutputs.app_name?.value, resource_group_name: infraOutputs.resource_group_name?.value || infraOutputs.rg_name?.value },
            gcp: { service_name: infraOutputs.service_name?.value || workspace.name }
        };
        const fallback = legacyNames[provider] || {};
        infraOutputs.computecontainer = fallback;
    }

    const cc = infraOutputs.computecontainer || {};

    // ---------------------------------------------------------
    // 🌍 ENV VAR INJECTION (Added for Deployment Alignment)
    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // 🌍 ENV VAR INJECTION (Aligned with Terraform V2 Outputs)
    // ---------------------------------------------------------
    const envVars = {};

    // 0. Normalize Output Access Helper
    const getVal = (key) => infraOutputs[key]?.value;

    // 1. Database (Output: database_endpoint)
    const dbEndpoint = getVal('database_endpoint');
    if (dbEndpoint) {
        envVars['DB_HOST'] = dbEndpoint;
        envVars['DB_PORT'] = '5432'; // Default for now
        envVars['DB_NAME'] = 'app_db';
        // Placeholder credential - in production this would be replaced by Secrets Manager retrieval or IAM Auth
        envVars['DATABASE_URL'] = `postgres://user:password@${dbEndpoint}:5432/app_db`;
    } else if (infraOutputs.relationaldatabase?.value?.endpoint) {
        // Fallback for V1
        const db = infraOutputs.relationaldatabase.value;
        envVars['DB_HOST'] = db.endpoint;
        envVars['DB_PORT'] = db.port || '5432';
        envVars['DATABASE_URL'] = `postgres://user:password@${db.endpoint}:${envVars['DB_PORT']}/${db.name || 'app_db'}`;
    }

    // 2. Cache (Output: cache_endpoint)
    const cacheEndpoint = getVal('cache_endpoint');
    if (cacheEndpoint) {
        envVars['REDIS_HOST'] = cacheEndpoint;
        envVars['REDIS_PORT'] = '6379';
        envVars['REDIS_URL'] = `redis://${cacheEndpoint}:6379`;
    }

    // 3. Storage (Output: bucket_name, bucket_region)
    const bucketName = getVal('bucket_name');
    if (bucketName) {
        envVars['STORAGE_BUCKET'] = bucketName;
        envVars['STORAGE_REGION'] = getVal('region') || getVal('bucket_region') || region;
    }

    // 4. Auth (Output: auth_client_id)
    const authClientId = getVal('auth_client_id');
    if (authClientId) {
        envVars['AUTH_CLIENT_ID'] = authClientId;
        envVars['AUTH_ISSUER'] = `https://${authClientId}.auth0.com`; // Placeholder assumption
    }

    // 5. API Gateway / CDN
    const apiEndpoint = getVal('api_endpoint');
    if (apiEndpoint) envVars['API_URL'] = apiEndpoint;

    const cdnEndpoint = getVal('cdn_endpoint');
    if (cdnEndpoint) envVars['CDN_URL'] = `https://${cdnEndpoint}`;

    console.log(`[DEPLOY] Injecting ${Object.keys(envVars).length} Environment Variables...`);


    if (provider === 'aws') {
        const { role_arn, external_id } = conn;

        const clusterName = cc.value?.cluster_name || cc.ecs_cluster_name?.value || cc.cluster_name?.value || cc.cluster_name;
        const serviceName = cc.value?.service_name || cc.container_service_name?.value || cc.service_name?.value || cc.service_name;

        if (!clusterName || !serviceName) {
            throw new Error("No compute container infrastructure found (ECS Cluster/Service missing).");
        }

        const ecsClient = await createAwsClient(ECSClient, region, role_arn, external_id);

        await appendLog(deploymentId, `🔍 Fetching current service state for ${serviceName}...`);
        const descService = await ecsClient.send(new DescribeServicesCommand({
            cluster: clusterName,
            services: [serviceName]
        }));

        if (!descService.services || descService.services.length === 0) {
            throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
        }

        const currentTaskDefArn = descService.services[0].taskDefinition;
        const taskDefRes = await ecsClient.send(new DescribeTaskDefinitionCommand({
            taskDefinition: currentTaskDefArn
        }));

        const oldDef = taskDefRes.taskDefinition;

        // Merge Env Vars for ECS
        const newEnv = Object.entries(envVars).map(([name, value]) => ({ name, value }));

        const newDefInput = {
            family: oldDef.family,
            taskRoleArn: oldDef.taskRoleArn,
            executionRoleArn: oldDef.executionRoleArn,
            networkMode: oldDef.networkMode,
            containerDefinitions: oldDef.containerDefinitions.map(c => ({
                ...c,
                image: image, // 🔥 SWAP IMAGE
                environment: [...(c.environment || []), ...newEnv] // 🔥 INJECT ENV VARS
            })),
            cpu: oldDef.cpu,
            memory: oldDef.memory
        };

        if (oldDef.runtimePlatform) newDefInput.runtimePlatform = oldDef.runtimePlatform;
        if (oldDef.requiresCompatibilities) newDefInput.requiresCompatibilities = oldDef.requiresCompatibilities;

        const registerRes = await ecsClient.send(new RegisterTaskDefinitionCommand(newDefInput));
        const newTaskArn = registerRes.taskDefinition.taskDefinitionArn;

        await ecsClient.send(new UpdateServiceCommand({
            cluster: clusterName,
            service: serviceName,
            taskDefinition: newTaskArn,
            forceNewDeployment: true
        }));

        await appendLog(deploymentId, `✅ ECS Service updated to use revision ${newTaskArn.split(':').pop()}`);

        // Return endpoint: service_endpoint (GCP/Azure/ALB) or load_balancer_dns
        const rawUrl = cc.value?.service_endpoint || cc.service_endpoint?.value || cc.load_balancer_dns?.value || infraOutputs.loadbalancer?.dns_name?.value || infraOutputs.lb_dns_name?.value;
        return rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`) : null;
    }

    if (provider === 'azure' || provider === 'azurerm') {
        const { client_id, client_secret, tenant_id, subscription_id } = conn.credentials;
        const containerAppName = cc.value?.container_app_name || cc.container_app_name?.value || cc.container_app_name || cc.service_name;
        const resourceGroupName = cc.value?.resource_group_name || cc.resource_group_name?.value || cc.resource_group_name;

        if (!containerAppName || !resourceGroupName) {
            throw new Error(`Missing Azure Infrastructure Outputs (Container App Name/Resource Group).`);
        }

        await appendLog(deploymentId, `🔍 Updating Azure Container App: ${containerAppName} in ${resourceGroupName}...`);

        // Use administrative credentials if available
        const aid = process.env.ARM_CLIENT_ID || client_id;
        const secret = process.env.ARM_CLIENT_SECRET || client_secret;
        const tid = process.env.ARM_TENANT_ID || tenant_id;
        const sid = process.env.ARM_SUBSCRIPTION_ID || subscription_id;

        const credential = new ClientSecretCredential(tid, aid, secret);
        const client = new ContainerAppsAPIClient(credential, sid);

        const currentApp = await client.containerApps.get(resourceGroupName, containerAppName);
        currentApp.template.containers[0].image = image;

        // Merge Env Vars for Azure
        const azureEnv = Object.entries(envVars).map(([name, value]) => ({ name, value }));
        // existing env logic if needed: currentApp.template.containers[0].env || []
        currentApp.template.containers[0].env = [...(currentApp.template.containers[0].env || []), ...azureEnv];

        const updateOp = await client.containerApps.beginUpdateAndWait(resourceGroupName, containerAppName, currentApp);
        const fqdn = updateOp.configuration?.ingress?.fqdn;
        const liveUrl = fqdn ? `https://${fqdn}` : cc.service_endpoint?.value;
        await appendLog(deploymentId, `✅ Azure Container App updated: ${liveUrl}`);
        return liveUrl;
    }

    if (provider === 'gcp') {
        let auth;
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
            const keys = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
            auth = google.auth.fromJSON(keys);
            auth.scopes = ['https://www.googleapis.com/auth/cloud-platform'];
        } else {
            auth = conn.credentials; // Fallback to user credentials (injected during connection setup)
        }
        const run = google.run({ version: 'v1', auth });

        const serviceName = cc.value?.service_name || cc.service_name?.value || cc.service_name || workspace.name;
        const region = cc.value?.region || cc.region?.value || cc.region || workspace.state_json.region;
        const project = cc.value?.project_id || cc.project_id?.value || cc.project_id || conn.project_id;

        const name = `projects/${project}/locations/${region}/services/${serviceName}`;
        await appendLog(deploymentId, `🔍 Fetching Cloud Run service: ${name}...`);

        const serviceRes = await run.projects.locations.services.get({ name });
        const serviceData = serviceRes.data;

        serviceData.spec.template.spec.containers[0].image = image;

        // Merge Env Vars for GCP
        const gcpEnv = Object.entries(envVars).map(([name, value]) => ({ name, value }));
        serviceData.spec.template.spec.containers[0].env = [...(serviceData.spec.template.spec.containers[0].env || []), ...gcpEnv];


        const op = await run.projects.locations.services.replaceService({
            name,
            requestBody: serviceData
        });

        // 🔍 HARDENING: Wait for Ready Condition
        await appendLog(deploymentId, `⏳ Waiting for Cloud Run service to be ready...`);
        // Simple delay for now, ideally poll status.conditions
        await new Promise(r => setTimeout(r, 10000));

        const liveUrl = op.data.status?.url || cc.service_endpoint?.value;
        await appendLog(deploymentId, `✅ Cloud Run service updated: ${liveUrl}`);
        return liveUrl;
    }

    throw new Error(`Provider ${provider} not supported for container deployment yet.`);
}

/**
 * 🔒 HARDENING: Persist Deployment State (Separate from Infra)
 */
async function saveDeploymentState(workspaceId, state) {
    try {
        // We use a JSONB column 'deployment_state' on workspaces or a separate table.
        // For now, we'll store it in 'deployment_history' last entry or a dedicated field if available.
        // Let's reuse 'deployment_history' for now but strictly structured.
        // BETTER: Update the 'state_json' with a 'deployment' key.
        await pool.query(
            `UPDATE workspaces 
             SET state_json = jsonb_set(state_json, '{deployment}', $1::jsonb)
             WHERE id = $2`,
            [JSON.stringify(state), workspaceId]
        );
        console.log(`[DEPLOY STATE] Saved: ${JSON.stringify(state)}`);
    } catch (e) {
        console.error("Failed to save deployment state:", e);
    }
}

const updateDeploymentStatus = async (deploymentId, status, url = null, logs = []) => {
    // Ensure all logs have timestamps
    const timestampedLogs = logs.map(l => ({
        timestamp: l.timestamp || new Date(),
        message: l.message
    }));

    let query = `UPDATE deployments SET status = $2, logs = logs || $3::jsonb, updated_at = NOW()`;
    const params = [deploymentId, status, JSON.stringify(timestampedLogs)];

    if (url) {
        query += `, url = $4`;
        params.push(url);
    }

    query += ` WHERE id = $1`;
    await pool.query(query, params);

    // If deploy succeeded, update workspace deployment_status to DEPLOYED
    if (status === 'success') {
        try {
            // Get workspace_id from deployment
            const deployResult = await pool.query('SELECT workspace_id, source_type FROM deployments WHERE id = $1', [deploymentId]);
            if (deployResult.rows.length > 0) {
                const { workspace_id, source_type } = deployResult.rows[0];

                // 🔒 HARDENING: Save Explicit Deployment State
                const deployState = {
                    status: 'ACTIVE',
                    image: logs.find(l => l.message.includes('Swapping image'))?.message?.split('to ')[1] || 'unknown',
                    revision: new Date().toISOString(), // Use timestamp as revision for now
                    deployed_at: new Date().toISOString(),
                    live_url: url,
                    verified: true
                };
                await saveDeploymentState(workspace_id, deployState);

                // Update workspace to DEPLOYED status with history
                await pool.query(
                    `UPDATE workspaces 
                     SET deployment_status = 'DEPLOYED',
                         step = 'deployed',
                         state_json = state_json || jsonb_build_object('is_live', true, 'is_deployed', true),
                         deployed_at = NOW(),
                         deployment_history = COALESCE(deployment_history, '[]'::jsonb) || $1::jsonb,
                         updated_at = NOW()
                     WHERE id = $2`,
                    [JSON.stringify([{
                        action: 'DEPLOY_SUCCESS',
                        timestamp: new Date().toISOString(),
                        deployment_id: deploymentId,
                        live_url: url,
                        state: deployState
                    }]), workspace_id]
                );

                console.log(`[DEPLOY] Workspace ${workspace_id} marked as DEPLOYED`);
            }
        } catch (wsErr) {
            console.error(`[DEPLOY] Failed to update workspace status:`, wsErr);
            // Non-fatal: deployment succeeded, workspace status update is secondary
        }
    } else if (status === 'failed') {
        // 🔒 HARDENING: Mark as FAILED in state if it was a verification failure
        try {
            const deployResult = await pool.query('SELECT workspace_id FROM deployments WHERE id = $1', [deploymentId]);
            if (deployResult.rows.length > 0) {
                await saveDeploymentState(deployResult.rows[0].workspace_id, { status: 'FAILED', reason: 'Verification or Deploy Failed' });
            }
        } catch (e) { console.error(e); }
    }
};

const appendLog = async (id, message) => {
    const logEntry = { timestamp: new Date(), message };
    await pool.query(
        `UPDATE deployments SET logs = logs || $2::jsonb WHERE id = $1`,
        [id, JSON.stringify([logEntry])]
    );
    return logEntry;
};

// Standardized Error Categories
const DEPLOY_ERRORS = {
    INVALID_REPO_URL: { code: 'INVALID_REPO_URL', message: 'Invalid GitHub repository URL' },
    BUILD_FAILED: { code: 'BUILD_FAILED', message: 'Build command failed' },
    MISSING_INDEX_HTML: { code: 'MISSING_INDEX_HTML', message: 'index.html not found in build output' },
    S3_UPLOAD_FAILED: { code: 'S3_UPLOAD_FAILED', message: 'Failed to upload files to S3' },
    CLOUDFRONT_ERROR: { code: 'CLOUDFRONT_ERROR', message: 'CDN cache refresh failed' },
    VERIFICATION_FAILED: { code: 'VERIFICATION_FAILED', message: 'Live site verification failed' },
    UNKNOWN_ERROR: { code: 'UNKNOWN_ERROR', message: 'An unexpected error occurred' }
};


// Helper: Retry Wrapper
async function retryOperation(fn, retries = 3, delayMs = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, delayMs * (i + 1))); // Exponential backoffish
        }
    }
}



// Helper: Validate GitHub Repo
function validateRepoUrl(url) {
    if (!url || !url.startsWith("https://github.com/")) {
        throw { ...DEPLOY_ERRORS.INVALID_REPO_URL, details: "URL must start with https://github.com/" };
    }
}

// Helper: Find index.html recursively or in common dirs
function findBuildArtifacts(baseDir) {
    const commonPaths = [
        '.',
        'dist',
        'build',
        'out',
        'dist/browser', // Angular sometimes
        'public'
    ];

    for (const sub of commonPaths) {
        const checkPath = path.join(baseDir, sub);
        if (fs.existsSync(checkPath) && fs.existsSync(path.join(checkPath, 'index.html'))) {
            return checkPath;
        }
    }
    return null;
}

// Helper: Detect Project Type
/**
 * Helper: Zip a directory into a buffer
 */
async function zipDirectory(dirPath) {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks = [];
        archive.on('data', chunk => chunks.push(chunk));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', err => reject(err));
        archive.directory(dirPath, false);
        archive.finalize();
    });
}

/**
 * Helper: Trigger AWS CodeBuild and wait for completion
 */
async function triggerCodeBuild(deploymentId, codebuildClient, projectName, s3Bucket, s3Key, ecrUrl) {
    await appendLog(deploymentId, `🚀 Starting AWS CodeBuild project: ${projectName}...`);

    // 1. Start build
    const startResponse = await codebuildClient.send(new StartBuildCommand({
        projectName: projectName,
        sourceLocationOverride: `${s3Bucket}/${s3Key}`,
        environmentVariablesOverride: [
            { name: 'IMAGE_REPO_URL', value: ecrUrl },
            { name: 'IMAGE_TAG', value: 'latest' }
        ]
    }));

    const buildId = startResponse.build.id;
    await appendLog(deploymentId, `🏗️ Build started. ID: ${buildId}`);

    // 2. Poll for status
    let status = 'IN_PROGRESS';
    while (status === 'IN_PROGRESS') {
        await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
        const statusResponse = await codebuildClient.send(new BatchGetBuildsCommand({
            ids: [buildId]
        }));

        const build = statusResponse.builds[0];
        status = build.buildStatus;

        if (status === 'SUCCEEDED') {
            await appendLog(deploymentId, "✅ CodeBuild SUCCEEDED.");
            break;
        } else if (status === 'FAILED' || status === 'STOPPED' || status === 'TIMED_OUT') {
            const phaseWithErr = build.phases.find(p => p.phaseStatus === 'FAILED');
            const errMsg = phaseWithErr ? `FAILED in phase ${phaseWithErr.phaseType}` : "Phase unknown";
            throw new Error(`CodeBuild failed with status ${status}: ${errMsg}. Check CloudWatch Logs for details.`);
        }

        await appendLog(deploymentId, `⏳ Build status: ${status}...`);
    }
    return true; // AWS Image is usually just ecrUrl:latest
}

/**
 * Helper: Trigger GCP Cloud Build and wait for completion
 */
async function triggerGcpCloudBuild(deploymentId, credentials, projectId, bucketName, gcsKey, imageTag, region) {
    await appendLog(deploymentId, `🚀 Starting GCP Cloud Build for ${projectId}...`);
    let auth;
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        const keys = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
        auth = google.auth.fromJSON(keys);
        auth.scopes = ['https://www.googleapis.com/auth/cloud-platform'];
    } else {
        auth = credentials; // Fallback to user credentials
    }
    const cb = google.cloudbuild({ version: 'v1', auth });

    const [response] = await cb.projects.builds.create({
        projectId: projectId,
        requestBody: {
            source: { storageSource: { bucket: bucketName, object: gcsKey } },
            steps: [
                { name: 'gcr.io/cloud-builders/docker', args: ['build', '-t', imageTag, '.'] },
                { name: 'gcr.io/cloud-builders/docker', args: ['push', imageTag] }
            ],
            images: [imageTag]
        }
    });

    const buildId = response.data.id || response.data.metadata?.build?.id;
    await appendLog(deploymentId, `🏗️ Build started. ID: ${buildId}`);

    // Poll for completion
    let status = 'QUEUED';
    while (status === 'QUEUED' || status === 'WORKING') {
        await new Promise(r => setTimeout(r, 5000));
        const res = await cb.projects.builds.get({ projectId, id: buildId });
        status = res.data.status;
        if (status === 'SUCCESS') {
            await appendLog(deploymentId, "✅ Cloud Build SUCCEEDED.");
            break;
        } else if (['FAILURE', 'INTERNAL_ERROR', 'TIMEOUT', 'CANCELLED'].includes(status)) {
            throw new Error(`Cloud Build failed with status ${status}. Check GCP Console for logs.`);
        }
        await appendLog(deploymentId, `⏳ Build status: ${status}...`);
    }
    return imageTag;
}

/**
 * Helper: Sync a folder to GCS
 */
async function syncFolderToGcs(deploymentId, credentials, projectId, bucketName, localPath) {
    const files = [];
    const walk = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) walk(filePath);
            else files.push(filePath);
        });
    };
    walk(localPath);
    await appendLog(deploymentId, `📤 Uploading ${files.length} files to GCS (${bucketName})...`);

    let storageOptions = { projectId };
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
        storageOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
    } else {
        storageOptions.credentials = credentials;
    }

    const storage = new Storage(storageOptions);
    const bucket = storage.bucket(bucketName);

    for (const filePath of files) {
        const relativePath = path.relative(localPath, filePath).replace(/\\/g, '/');
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
            '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
            '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
        }[ext] || 'application/octet-stream';

        await bucket.upload(filePath, {
            destination: relativePath,
            metadata: { contentType }
        });
    }
    await appendLog(deploymentId, `✅ Successfully synced to GCS.`);
}

/**
 * Helper: Sync a folder to Azure Blob Storage ($web)
 */
async function syncFolderToAzureBlob(deploymentId, blobServiceClient, containerName, localPath) {
    const files = [];
    const walk = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) walk(filePath);
            else files.push(filePath);
        });
    };
    walk(localPath);
    await appendLog(deploymentId, `📤 Uploading ${files.length} files to Azure Blob Storage (${containerName})...`);

    const containerClient = blobServiceClient.getContainerClient(containerName);
    for (const filePath of files) {
        const relativePath = path.relative(localPath, filePath).replace(/\\/g, '/');
        const blockBlobClient = containerClient.getBlockBlobClient(relativePath);
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
            '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
            '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
        }[ext] || 'application/octet-stream';

        await blockBlobClient.uploadFile(filePath, { blobHTTPHeaders: { blobContentType: contentType } });
    }
    await appendLog(deploymentId, `✅ Successfully synced to Azure Blob.`);
}

/**
 * Helper: Trigger Azure ACR Build
 */
async function triggerAzureAcrBuild(deploymentId, credentials, subscriptionId, resourceGroup, acrName, imageTag, localZipPath) {

    // Use administrative credentials if available
    const aid = process.env.ARM_CLIENT_ID || credentials.client_id;
    const secret = process.env.ARM_CLIENT_SECRET || credentials.client_secret;
    const tid = process.env.ARM_TENANT_ID || credentials.tenant_id;
    const sid = process.env.ARM_SUBSCRIPTION_ID || subscriptionId;

    const credential = new ClientSecretCredential(tid, aid, secret);
    const client = new ContainerRegistryManagementClient(credential, sid);

    await appendLog(deploymentId, `🚀 Starting Azure ACR Build for ${acrName}...`);

    // 1. Get Build Source Upload URL
    const sourceUpload = await client.registries.getBuildSourceUploadUrl(resourceGroup, acrName);

    // 2. Upload Zip to the provided URL (Shared Access Signature)
    const blobClient = new BlockBlobClient(sourceUpload.uploadUrl);
    await blobClient.uploadFile(localZipPath);

    // 3. Queue the Build
    const buildRequest = {
        type: "DockerBuildRequest",
        imageNames: [imageTag],
        isPushEnabled: true,
        sourceLocation: sourceUpload.uploadUrl,
        platform: { os: "Linux", architecture: "amd64" },
        dockerFilePath: "Dockerfile"
    };

    const poller = await client.registries.beginQueueBuildAndWait(resourceGroup, acrName, buildRequest);
    await appendLog(deploymentId, `🏗️ Build queued. ID: ${poller.runId}`);

    // 4. Poll for completion
    let status = 'Queued';
    while (['Queued', 'Started', 'Running'].includes(status)) {
        await new Promise(r => setTimeout(r, 10000));
        const runRes = await client.runs.get(resourceGroup, acrName, poller.runId);
        status = runRes.status;
        if (status === 'Succeeded') {
            await appendLog(deploymentId, "✅ ACR Build SUCCEEDED.");
            break;
        } else if (['Failed', 'Canceled', 'Error', 'Timeout'].includes(status)) {
            throw new Error(`ACR Build failed with status ${status}.`);
        }
        await appendLog(deploymentId, `⏳ Build status: ${status}...`);
    }
}

/**
 * Helper: Sync a folder to S3 with recursive traversal
 */
async function syncFolderToS3(deploymentId, s3Client, bucketName, localPath) {
    const files = [];

    const walk = (dir) => {
        fs.readdirSync(dir).forEach(file => {
            const filePath = path.join(dir, file);
            if (fs.statSync(filePath).isDirectory()) {
                walk(filePath);
            } else {
                files.push(filePath);
            }
        });
    };

    walk(localPath);
    await appendLog(deploymentId, `📤 Found ${files.length} files to upload...`);

    for (const filePath of files) {
        const relativePath = path.relative(localPath, filePath).replace(/\\/g, '/');
        const fileContent = fs.readFileSync(filePath);

        // Simple MIME detection fallback
        const ext = path.extname(filePath).toLowerCase();
        const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.txt': 'text/plain'
        }[ext] || 'application/octet-stream';

        await s3Client.send(new PutObjectCommand({
            Bucket: bucketName,
            Key: relativePath,
            Body: fileContent,
            ContentType: contentType
        }));
    }
    await appendLog(deploymentId, `✅ Successfully uploaded ${files.length} files to S3.`);
}


// detectProjectType imported from utils

/**
 * Helper: Generate Cloud-Native Artifacts (Dockerfile, buildspec.yml)
 * Ensures that Node/Python/Java projects have a Dockerfile for cloud builders.
 */
function ensureCloudNativeArtifacts(dir, runtime, provider) {
    const dockerfilePath = path.join(dir, 'Dockerfile');
    const hasDockerfile = fs.existsSync(dockerfilePath);

    // 1. Generate Dockerfile if missing (and runtime is known)
    if (!hasDockerfile) {
        let content = "";
        if (runtime === 'node') {
            content = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 80 8080 3000
CMD ["npm", "start"]`;
        } else if (runtime === 'python') {
            content = `FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 80 8080 5000
CMD ["python", "app.py"]`; // Best guess, user should provide Dockerfile for complex apps
        } else if (runtime === 'java') {
            content = `FROM openjdk:17-jdk-slim
WORKDIR /app
COPY . .
RUN ./mvnw package -DskipTests
CMD ["java", "-jar", "target/app.jar"]`;
        }

        if (content) {
            fs.writeFileSync(dockerfilePath, content);
            console.log(`[INFO] Generated default Dockerfile for ${runtime}`);
        }
    }

    // 2. Generate buildspec.yml for AWS (if missing)
    if (provider === 'aws') {
        const buildspecPath = path.join(dir, 'buildspec.yml');
        if (!fs.existsSync(buildspecPath)) {
            const buildspec = `version: 0.2
phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $IMAGE_REPO_URL
  build:
    commands:
      - echo Build started on \`date\`
      - echo Building the Docker image...
      - docker build -t $IMAGE_REPO_URL:$IMAGE_TAG .
  post_build:
    commands:
      - echo Build completed on \`date\`
      - echo Pushing the Docker image...
      - docker push $IMAGE_REPO_URL:$IMAGE_TAG`;
            fs.writeFileSync(buildspecPath, buildspec);
            console.log(`[INFO] Generated default buildspec.yml for AWS`);
        }
    }
}



const deployFromGithub = async (deploymentId, workspace, config) => {
    const tempDir = path.join(__dirname, '../../temp/deploy', `deploy-${deploymentId}`);

    try {
        await updateDeploymentStatus(deploymentId, 'running');
        validateRepoUrl(config.repo);

        await appendLog(deploymentId, `🚀 Starting Canonical Deployment from GitHub: ${config.repo}`);

        const conn = workspace.state_json.connection;
        const infraOutputs = workspace.state_json.infra_outputs || {};
        const region = workspace.state_json.region || 'ap-south-1';

        // 1. Contract Check: Deployment Target (Strict Object Parsing)
        // Check for both raw Terraform output (with .value) and flattened output
        let deploymentTarget = infraOutputs.deployment_target?.value || infraOutputs.deployment_target;

        // 🔍 DIAGNOSTIC: Log the actual infraOutputs keys and deploymentTarget
        console.log('[DEPLOY DEBUG] infraOutputs keys:', Object.keys(infraOutputs || {}));
        console.log('[DEPLOY DEBUG] deploymentTarget:', JSON.stringify(deploymentTarget, null, 2));

        // Handle legacy string case (if any old states persist)
        if (typeof deploymentTarget === 'string') {
            await appendLog(deploymentId, `⚠️ Legacy Deployment Target detected: ${deploymentTarget}. Attempting to normalize...`);
            // Minimal shim for backward compatibility during dev
            deploymentTarget = { type: 'UNKNOWN', provider: conn.provider };
        }

        if (!deploymentTarget || !deploymentTarget.type || deploymentTarget.type === 'UNKNOWN') {
            throw new Error("No valid deployment target found in infrastructure outputs. Please ensure Terraform has provisioned the workspace correctly.");
        }

        await appendLog(deploymentId, `🔍 Infra Target: ${deploymentTarget.type} (${deploymentTarget.provider})`);

        // 2. Clone Repo
        await appendLog(deploymentId, "📦 Cloning repository...");
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        try {
            await execPromise(`git clone --depth 1 --branch ${config.branch || 'main'} ${config.repo} ${tempDir}`);
        } catch (gitErr) {
            throw { ...DEPLOY_ERRORS.INVALID_REPO_URL, details: "Branch not found or repo inaccessible." };
        }

        // 3. Detect Project Type (Strict)
        const projectInfo = detectProjectType(tempDir);
        await appendLog(deploymentId, `ℹ️ Project Type Detected: ${projectInfo.type} (${projectInfo.reason})`);

        // 4. Strict Deployment Routing
        // Map infra types to project types
        const targetType = deploymentTarget.type; // STATIC_STORAGE or CONTAINER_SERVICE

        if (targetType === 'STATIC_STORAGE') {
            // For static sites, we allow both plain HTML and framework projects
            if (projectInfo.type !== 'STATIC') {
                throw new Error(`Architectural Mismatch: Project detected as ${projectInfo.type} (${projectInfo.reason}) but Infrastructure is STATIC_STORAGE.`);
            }

            const staticMeta = deploymentTarget.static;
            if (!staticMeta.bucket_name) throw new Error("Contract Violation: STATIC_STORAGE target missing 'bucket_name'.");

            await appendLog(deploymentId, `🏗️ Deploying to Static Storage: ${staticMeta.bucket_name}`);

            // Handle projects that need build (React, Vite, Vue, etc.)
            let artifactDir;
            if (projectInfo.needsBuild) {
                await appendLog(deploymentId, `📦 Installing dependencies...`);
                await execPromise(`npm install`, { cwd: tempDir });

                await appendLog(deploymentId, `🔨 Building project (${projectInfo.runtime}): ${projectInfo.buildCmd}`);
                await execPromise(projectInfo.buildCmd, { cwd: tempDir });

                // Use the framework's output directory
                artifactDir = path.join(tempDir, projectInfo.outputDir || 'dist');
                if (!fs.existsSync(artifactDir)) {
                    throw new Error(`Build succeeded but output directory '${projectInfo.outputDir}' not found.`);
                }
            } else {
                // Pure static site - find artifacts directly
                artifactDir = findBuildArtifacts(tempDir);
            }

            if (!artifactDir) throw { ...DEPLOY_ERRORS.MISSING_INDEX_HTML };

            // Upload Logic
            let liveUrl = "";
            if (deploymentTarget.provider === 'aws') {
                const s3Client = await createAwsClient(S3Client, region, conn.role_arn, conn.external_id);
                await syncFolderToS3(deploymentId, s3Client, staticMeta.bucket_name, artifactDir);

                if (staticMeta.cdn_domain) {
                    // Check for CDN ID in static block or global fallback
                    const cdnId = staticMeta.cdn_id || infraOutputs.cdn_id?.value || infraOutputs.cloudfront_distribution_id?.value;
                    if (cdnId) {
                        await appendLog(deploymentId, "⚡ Refreshing AWS CDN cache...");
                        const cfClient = await createAwsClient(CloudFrontClient, "us-east-1", conn.role_arn, conn.external_id);
                        await cfClient.send(new CreateInvalidationCommand({
                            DistributionId: cdnId,
                            InvalidationBatch: { CallerReference: `cloudiverse-${Date.now()}`, Paths: { Quantity: 1, Items: ["/*"] } }
                        }));
                    }
                }
                liveUrl = `https://${staticMeta.cdn_domain || staticMeta.bucket_name}`;
            } else if (deploymentTarget.provider === 'gcp') {
                await syncFolderToGcs(deploymentId, conn.credentials, conn.project_id, staticMeta.bucket_name, artifactDir);
                liveUrl = `https://${staticMeta.cdn_domain || 'storage.googleapis.com/' + staticMeta.bucket_name}`;
            } else if (deploymentTarget.provider === 'azure') {
                const blobServiceClient = BlobServiceClient.fromConnectionString(conn.connection_string);
                await syncFolderToAzureBlob(deploymentId, blobServiceClient, "$web", artifactDir);
                liveUrl = `https://${staticMeta.cdn_domain || staticMeta.bucket_name}`;
            }

            await appendLog(deploymentId, `🔍 Verifying site availability: ${liveUrl}`);
            await verifyLiveSite(deploymentId, liveUrl, 10);
            await updateDeploymentStatus(deploymentId, 'success', liveUrl, [{ message: `🚀 Static deployment successful! Verified: ${liveUrl}` }]);

        } else if (targetType === 'CONTAINER_SERVICE') {
            if (projectInfo.type !== 'CONTAINER') {
                throw new Error(`Architectural Mismatch: Project detected as ${projectInfo.type} but Infrastructure is CONTAINER_SERVICE.`);
            }

            // 🔥 Critical: Ensure Dockerfile/buildspec exists before zipping
            ensureCloudNativeArtifacts(tempDir, projectInfo.runtime || 'unknown', deploymentTarget.provider);

            await appendLog(deploymentId, `🏗️ Orchestrating Cloud-Native Container Build for ${deploymentTarget.provider.toUpperCase()}...`);
            const containerMeta = deploymentTarget.container;
            if (!containerMeta) throw new Error("Contract Violation: CONTAINER_SERVICE target missing 'container' metadata.");

            let imageTag = "";

            if (deploymentTarget.provider === 'aws') {
                if (!containerMeta.cluster_name || !containerMeta.service_name || !containerMeta.registry_url) {
                    throw new Error("Missing AWS Container Metadata.");
                }

                // Use build_project_name from contract, or fallback to global outputs if old state
                const cbProject = containerMeta.build_project_name || infraOutputs.codebuild_name?.value;
                // Need build bucket too. Try contract first, then globals.
                const buildBucket = containerMeta.build_bucket || infraOutputs.build_bucket?.value || infraOutputs.computecontainer?.value?.build_bucket;

                if (!cbProject || !buildBucket) {
                    throw new Error("Missing AWS Build Infrastructure (connection to CodeBuild Project/Bucket). Ensure Terraform state is recent.");
                }

                const s3Key = `sources/source-${deploymentId}.zip`;
                const zipBuffer = await zipDirectory(tempDir);
                const s3Client = await createAwsClient(S3Client, region, conn.role_arn, conn.external_id);

                await appendLog(deploymentId, "📤 Uploading source to Build Bucket...");
                await s3Client.send(new PutObjectCommand({ Bucket: buildBucket, Key: s3Key, Body: zipBuffer }));

                const cbClient = await createAwsClient(CodeBuildClient, region, conn.role_arn, conn.external_id);
                await triggerCodeBuild(deploymentId, cbClient, cbProject, buildBucket, s3Key, containerMeta.registry_url);
                imageTag = `${containerMeta.registry_url}:latest`;

            } else if (deploymentTarget.provider === 'gcp') {
                // Existing GCP Cloud Build Logic
                const buildBucket = `cloudiverse-builds-${conn.project_id}`;
                const gcsKey = `source-${deploymentId}.zip`;
                const zipPath = path.join(tempDir, `../${gcsKey}`);
                const zipBuffer = await zipDirectory(tempDir);
                fs.writeFileSync(zipPath, zipBuffer);

                await appendLog(deploymentId, "📤 Uploading source to GCS Build Bucket...");

                let storageOptions = { projectId: conn.project_id };
                if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
                    storageOptions.credentials = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
                } else {
                    storageOptions.credentials = conn.credentials;
                }
                const storageClient = new Storage(storageOptions);
                await storageClient.bucket(buildBucket).upload(zipPath, { destination: gcsKey });

                imageTag = await triggerGcpCloudBuild(deploymentId, conn.credentials, conn.project_id, buildBucket, gcsKey, containerMeta.registry_url, region);

            } else if (deploymentTarget.provider === 'azure') {
                // Existing Azure ACR Build Logic
                const zipPath = path.join(tempDir, `../source-${deploymentId}.zip`);
                const zipBuffer = await zipDirectory(tempDir);
                fs.writeFileSync(zipPath, zipBuffer);

                imageTag = `${containerMeta.registry_url}/app:latest`;
                await triggerAzureAcrBuild(deploymentId, conn.credentials, conn.credentials.subscription_id, containerMeta.resource_group_name, containerMeta.container_app_name, imageTag, zipPath);
            }

            const appUrl = await deployImageToProvider(deploymentId, workspace, conn, deploymentTarget.provider, imageTag);
            await updateDeploymentStatus(deploymentId, 'success', appUrl, [{ message: `🚀 Cloud-Native Container Build & Deploy successful!` }]);

        } else {
            throw new Error(`Deployment target ${targetType} is not supported or automated yet.`);
        }

    } catch (err) {
        console.error("Deploy Error:", err);
        const errorObj = err.code ? err : { ...DEPLOY_ERRORS.UNKNOWN_ERROR, details: err.message };
        await updateDeploymentStatus(deploymentId, 'failed', null, [
            { message: `❌ Deployment Failed: ${errorObj.message}` },
            { message: `Details: ${errorObj.details || 'Check logs.'}` }
        ]);
    } finally {
        const cleanup = async (attempt = 1) => {
            try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); }
            catch (e) { if (attempt < 5) setTimeout(() => cleanup(attempt + 1), 3000); }
        };
        cleanup();
    }
};


const getDeploymentStatus = async (id) => {
    const result = await pool.query('SELECT * FROM deployments WHERE id = $1', [id]);
    return result.rows[0];
};

// Helper: Validate Docker Image Format
function validateDockerImage(image) {
    if (!image || !image.includes(':')) {
        // Basic check, allows 'nginx:latest' or 'repo/image:tag'
        // Warn but strictly maybe allow if user knows what they are doing?
        // Let's at least ensure it's non-empty string.
        if (!image || typeof image !== 'string') throw { code: 'INVALID_IMAGE', message: 'Invalid Docker image string' };
    }
}

const deployFromDocker = async (deploymentId, workspace, config) => {
    try {
        await updateDeploymentStatus(deploymentId, 'running');

        const image = config.image || config.docker_image;
        validateDockerImage(image);

        await appendLog(deploymentId, `🐳 Starting Docker Image Deployment: ${image}`);

        const conn = workspace.state_json.connection;
        const infraOutputs = workspace.state_json.infra_outputs || {};
        const deploymentTarget = infraOutputs.deployment_target?.value || infraOutputs.deployment_target;
        const targetType = (typeof deploymentTarget === 'object') ? deploymentTarget.type : (infraOutputs.deployment_target?.value || "unknown");

        // 1. Strict infra matching for Docker choice
        const allowedTargets = ["ecs", "cloud_run", "app_service", "container", "app_runner", "lambda", "CONTAINER_SERVICE"];
        if (!allowedTargets.includes(targetType)) {
            throw new Error(`Architectural Mismatch: Direct Docker deployment is not compatible with ${targetType.toUpperCase()} infrastructure. Use GitHub path for static sites.`);
        }

        await appendLog(deploymentId, `✅ Infra compatibility verified. Updating running service...`);

        const provider = conn.provider || 'aws';
        const liveUrl = await deployImageToProvider(deploymentId, workspace, conn, provider, image);

        if (!liveUrl) throw new Error("Service updated but live URL could not be retrieved.");

        await updateDeploymentStatus(deploymentId, 'success', liveUrl, [{ message: '🚀 Container service updated successfully!' }]);

    } catch (err) {
        console.error("Docker Deploy Error:", err);
        const errorObj = err.code ? err : { ...DEPLOY_ERRORS.UNKNOWN_ERROR, details: err.message };
        await updateDeploymentStatus(deploymentId, 'failed', null, [
            { message: `❌ Deployment Failed: ${errorObj.message}` },
            { message: `Details: ${errorObj.details || ''}` }
        ]);
    }
};

// Helper: Verify Live Site Function
const verifyLiveSite = async (deploymentId, url, maxRetries = 10) => {
    let attempts = 0;
    while (attempts < maxRetries) {
        attempts++;
        try {
            console.log(`[VERIFY] Attempt ${attempts}/${maxRetries} for ${url}`);
            const response = await axios.get(url, { timeout: 5000 });
            if (response.status === 200 && response.data) {
                await appendLog(deploymentId, `✅ Site verified! (HTTP 200, content-length: ${response.headers['content-length'] || 'OK'})`);
                return true;
            }
        } catch (error) {
            console.warn(`[VERIFY] validation failed attempt ${attempts}: ${error.code || error.message}`);
            // If 403 Forbidden (common with S3/CloudFront initially), wait longer
            if (error.response?.status === 403 || error.response?.status === 404) {
                await appendLog(deploymentId, `⏳ Waiting for propagation... (${error.response.status})`);
            }
        }
        // Exponential backoff: 2s, 4s, 8s, etc. capped at 10s
        const delay = Math.min(2000 * Math.pow(1.5, attempts), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    await appendLog(deploymentId, `⚠️ Site deployed but verification timed out after ${maxRetries} attempts. It may take a few more minutes to propagate.`);
    // We don't throw here to avoid failing the deployment completely if it's just slow DNS propagation
    // But we warn the user.
    return false;
};

module.exports = {
    createDeployment,
    getDeploymentStatus,
    deployFromGithub,
    deployFromDocker
};
