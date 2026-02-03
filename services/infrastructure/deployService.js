const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
const { ECSClient, RegisterTaskDefinitionCommand, UpdateServiceCommand, DescribeTaskDefinitionCommand } = require("@aws-sdk/client-ecs");
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const pool = require('../../config/db');
const { ClientSecretCredential } = require("@azure/identity");
const { ContainerAppsAPIClient } = require("@azure/arm-appcontainers");
const { google } = require('googleapis');
const githubService = require('./githubService');

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

// Helper: Docker Build and Push
async function dockerBuildAndPush(deploymentId, repoPath, workspaceId) {
    const isDockerAvailable = await checkDocker();
    if (!isDockerAvailable) {
        throw new Error("Docker is not installed or not running on the server. Please install Docker Desktop to use container-based deployments.");
    }

    const ecrRegistry = `${process.env.AWS_ACCOUNT_ID}.dkr.ecr.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`;
    const repoName = `cloudiverse-ws-${workspaceId}`;
    const imageTag = `v${Date.now()}`;
    const fullImageUri = `${ecrRegistry}/${repoName}:${imageTag}`;

    await appendLog(deploymentId, `🐳 Starting Docker build: ${fullImageUri}`);

    // 1. ECR Login
    await appendLog(deploymentId, "🔑 Logging into Amazon ECR...");
    try {
        const loginCmd = `aws ecr get-login-password --region ${process.env.AWS_REGION || 'ap-south-1'} | docker login --username AWS --password-stdin ${ecrRegistry}`;
        await execPromise(loginCmd);
    } catch (err) {
        throw new Error(`ECR Login failed: ${err.message}`);
    }

    // 2. Ensure ECR Repo exists (Cloudiverse-owned)
    await appendLog(deploymentId, `📦 Ensuring ECR repository '${repoName}' exists...`);
    try {
        await execPromise(`aws ecr describe-repositories --repository-names ${repoName} || aws ecr create-repository --repository-name ${repoName}`);
    } catch (err) {
        // Ignore if error is just repository already exists
    }

    // 3. Docker Build (BuildKit for amd64)
    await appendLog(deploymentId, "🏗️ Building Docker image (linux/amd64)...");
    try {
        // Use buildx if available for cross-platform, else standard build
        await execPromise(`docker build --platform linux/amd64 -t ${repoName} .`, { cwd: repoPath });
    } catch (err) {
        throw { ...DEPLOY_ERRORS.BUILD_FAILED, details: err.message };
    }

    // 4. Tag & Push
    await appendLog(deploymentId, "🚀 Pushing image to registry...");
    try {
        await execPromise(`docker tag ${repoName} ${fullImageUri}`);
        await execPromise(`docker push ${fullImageUri}`);
    } catch (err) {
        throw new Error(`Docker push failed: ${err.message}`);
    }

    await appendLog(deploymentId, "✅ Docker image pushed successfully.");
    return fullImageUri;
}

// Helper: Target Provider Update (ECS, AppService, CloudRun, ContainerApps)
async function deployImageToProvider(deploymentId, workspace, conn, provider, image) {
    await appendLog(deploymentId, `☁️ Initiating Provider Update for ${provider.toUpperCase()}...`);
    const infraOutputs = workspace.state_json.infra_outputs;
    const region = workspace.state_json.region || 'ap-south-1';

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

    if (provider === 'aws') {
        const { ECSClient, DescribeTaskDefinitionCommand, RegisterTaskDefinitionCommand, UpdateServiceCommand, DescribeServicesCommand } = require("@aws-sdk/client-ecs");
        const { role_arn, external_id } = conn;

        const clusterName = cc.ecs_cluster_name?.value || cc.cluster_name?.value || cc.cluster_name;
        const serviceName = cc.container_service_name?.value || cc.service_name?.value || cc.service_name;

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
        const newDefInput = {
            family: oldDef.family,
            taskRoleArn: oldDef.taskRoleArn,
            executionRoleArn: oldDef.executionRoleArn,
            networkMode: oldDef.networkMode,
            containerDefinitions: oldDef.containerDefinitions.map(c => ({
                ...c,
                image: image // 🔥 SWAP IMAGE HERE
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
        const rawUrl = cc.service_endpoint?.value || cc.load_balancer_dns?.value || infraOutputs.loadbalancer?.dns_name?.value || infraOutputs.lb_dns_name?.value;
        return rawUrl ? (rawUrl.startsWith('http') ? rawUrl : `http://${rawUrl}`) : null;
    }

    if (provider === 'azure') {
        const { ContainerAppsAPIClient } = require("@azure/arm-appcontainers");
        const { ClientSecretCredential } = require("@azure/identity");

        const { client_id, client_secret, tenant_id, subscription_id } = conn.credentials;
        const containerAppName = cc.container_app_name?.value || cc.container_app_name;
        const resourceGroupName = cc.resource_group_name?.value || cc.resource_group_name;

        if (!containerAppName || !resourceGroupName) {
            throw new Error(`Missing Azure Infrastructure Outputs (Container App Name/Resource Group).`);
        }

        const credential = new ClientSecretCredential(tenant_id, client_id, client_secret);
        const client = new ContainerAppsAPIClient(credential, subscription_id);

        const currentApp = await client.containerApps.get(resourceGroupName, containerAppName);
        currentApp.template.containers[0].image = image;

        const updateOp = await client.containerApps.beginUpdateAndWait(resourceGroupName, containerAppName, currentApp);
        const fqdn = updateOp.configuration?.ingress?.fqdn;
        return fqdn ? `https://${fqdn}` : null;
    }

    if (provider === 'gcp') {
        const { google } = require('googleapis');
        const auth = new google.auth.OAuth2();
        auth.setCredentials(conn.tokens);
        const run = google.run({ version: 'v1', auth });

        const serviceName = cc.container_service_name?.value || cc.service_name?.value || cc.service_name;
        const name = `projects/${conn.project_id}/locations/${region}/services/${serviceName}`;
        const serviceRes = await run.projects.locations.services.get({ name });
        const serviceData = serviceRes.data;

        serviceData.spec.template.spec.containers[0].image = image;

        const op = await run.projects.locations.services.replaceService({
            name,
            requestBody: serviceData
        });
        return op.data.status?.url || cc.service_endpoint?.value;
    }

    throw new Error(`Provider ${provider} not supported for container deployment yet.`);
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

const axios = require('axios'); // For Verification

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

// Helper: Verify Live Site
async function verifyLiveSite(url, deploymentId) {
    console.log(`[VERIFY] Checking live site: ${url}`);

    // Retry verification 5 times with 2s delay (CloudFront propagation can take a moment)
    for (let i = 0; i < 10; i++) {
        try {
            const res = await axios.get(url, { timeout: 5000 });
            if (res.status >= 200 && res.status < 300) {
                // Sanity check HTML content
                if (typeof res.data === 'string' && res.data.toLowerCase().includes('<html')) {
                    await appendLog(deploymentId, `✅ Live site verification successful (Attempt ${i + 1})`);
                    return true;
                }
            }
        } catch (e) {
            console.log(`[VERIFY] Attempt ${i + 1} failed: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error("Live site verified failed after multiple attempts.");
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


const detectProjectType = (repoPath) => {
    if (fs.existsSync(path.join(repoPath, 'package.json'))) return "node";
    if (fs.existsSync(path.join(repoPath, 'Dockerfile'))) return "docker";
    if (fs.existsSync(path.join(repoPath, 'index.html'))) return "static";
    return "unknown";
}


const deployFromGithub = async (deploymentId, workspace, config) => {
    const tempDir = path.join(__dirname, '../../temp/deploy', `deploy-${deploymentId}`);

    try {
        await updateDeploymentStatus(deploymentId, 'running');
        validateRepoUrl(config.repo);

        await appendLog(deploymentId, `🚀 Starting unified deployment from GitHub: ${config.repo}`);

        const conn = workspace.state_json.connection;

        // 1. Clone Repo
        await appendLog(deploymentId, "📦 Cloning repository...");
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
        try {
            await execPromise(`git clone --depth 1 --branch ${config.branch || 'main'} ${config.repo} ${tempDir}`);
        } catch (gitErr) {
            throw { ...DEPLOY_ERRORS.INVALID_REPO_URL, details: "Branch not found or repo inaccessible." };
        }

        // 2. Identify Infrastructure Type & Project Type
        await appendLog(deploymentId, "🔍 Analyzing infrastructure and project type...");
        const infraOutputs = workspace.state_json.infra_outputs || {};

        // Broaden static infra matching (Step 5 often outputs storage_bucket or s3_bucket_id)
        const bucketName = infraOutputs.s3_bucket_name?.value ||
            infraOutputs.static_site?.bucket_name?.value ||
            infraOutputs.storage_bucket?.value ||
            infraOutputs.s3_bucket_id?.value;

        const isStaticInfra = !!bucketName;
        const projectType = detectProjectType(tempDir);

        await appendLog(deploymentId, `ℹ️ Infrastructure: ${isStaticInfra ? 'Static (S3/CDN)' : 'Container (ECS/AppService)'}, Project: ${projectType.toUpperCase()}`);

        let liveUrl = null;

        if (isStaticInfra && (projectType === 'static' || projectType === 'node')) {
            // --- STATIC DEPLOYMENT PATH (No Docker Required) ---
            await appendLog(deploymentId, "🏗️ Infrastructure supports direct static hosting. Bypassing Docker build...");

            // 2a. Run Build if node project
            if (projectType === 'node') {
                await appendLog(deploymentId, `🔨 Running build command: ${config.build_command || 'npm install && npm run build'}`);
                try {
                    await execPromise(config.build_command || 'npm install && npm run build', { cwd: tempDir, maxBuffer: 1024 * 1024 * 20 });
                } catch (err) {
                    throw { ...DEPLOY_ERRORS.BUILD_FAILED, details: err.message };
                }
            }

            // 2b. Find artifacts
            const artifactDir = findBuildArtifacts(tempDir);
            if (!artifactDir) {
                throw { ...DEPLOY_ERRORS.MISSING_INDEX_HTML, details: "Could not find index.html in the project or build output." };
            }

            // 2c. Upload to S3
            if (conn.provider === 'aws') {
                const { S3Client } = require("@aws-sdk/client-s3");
                const s3Client = await createAwsClient(S3Client, workspace.state_json.region || 'ap-south-1', conn.role_arn, conn.external_id);

                await appendLog(deploymentId, `📤 Syncing artifacts from '${path.basename(artifactDir)}' to S3 bucket '${bucketName}'...`);
                await syncFolderToS3(deploymentId, s3Client, bucketName, artifactDir);

                // 2d. Invalidate CDN if exists
                const cloudfrontId = infraOutputs.cdn?.distribution_id?.value || infraOutputs.cdn_id?.value;
                if (cloudfrontId) {
                    await appendLog(deploymentId, "⚡ Refreshing CloudFront cache...");
                    const { CloudFrontClient, CreateInvalidationCommand } = require("@aws-sdk/client-cloudfront");
                    const cfClient = await createAwsClient(CloudFrontClient, "us-east-1", conn.role_arn, conn.external_id);
                    await cfClient.send(new CreateInvalidationCommand({
                        DistributionId: cloudfrontId,
                        InvalidationBatch: {
                            CallerReference: `cloudiverse-${Date.now()}`,
                            Paths: { Quantity: 1, Items: ["/*"] }
                        }
                    }));
                }

                liveUrl = infraOutputs.cdn?.endpoint?.value || infraOutputs.cdn_endpoint?.value || `http://${bucketName}.s3-website-${workspace.state_json.region || 'ap-south-1'}.amazonaws.com`;
            } else {
                throw new Error(`Static deployment for provider ${conn.provider} not yet supported.`);
            }
        } else {
            // --- CONTAINER DEPLOYMENT PATH ---
            await appendLog(deploymentId, "🏗️ Infrastructure requires a container. Proceeding with Docker build...");

            // 2e. Ensure Dockerfile exists
            if (!fs.existsSync(path.join(tempDir, 'Dockerfile'))) {
                await appendLog(deploymentId, "ℹ️ No Dockerfile found. Attempting auto-generation...");
                const generated = await githubService.generateDockerfile(tempDir);
                if (!generated) {
                    throw new Error("Unable to auto-detect project type. Please provide a Dockerfile in your repository.");
                }
            }

            // 3. Docker Build & Push
            const imageUri = await dockerBuildAndPush(deploymentId, tempDir, workspace.id);

            // 4. Update Infrastructure
            liveUrl = await deployImageToProvider(deploymentId, workspace, conn, conn.provider || 'aws', imageUri);
        }

        if (!liveUrl) {
            throw new Error("Deployment completed but no live URL could be determined. Check your cloud provider console.");
        }

        await updateDeploymentStatus(deploymentId, 'success', liveUrl, [{ message: '🚀 Deployment successful!' }]);

    } catch (err) {
        console.error("GitHub Deploy Error:", err);
        const errorObj = err.code ? err : { ...DEPLOY_ERRORS.UNKNOWN_ERROR, details: err.message };
        await updateDeploymentStatus(deploymentId, 'failed', null, [
            { message: `❌ Deployment Failed: ${errorObj.message}` },
            { message: `Details: ${errorObj.details || 'Check logs for more info.'}` }
        ]);
    } finally {
        // Fail-safe cleanup with retries to avoid EBUSY crashes on Windows
        const cleanup = async (attempt = 1) => {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    console.log(`[DEPLOY] Successfully cleaned up ${tempDir}`);
                }
            } catch (e) {
                if (attempt < 5) {
                    console.warn(`[DEPLOY] Cleanup attempt ${attempt} failed (EBUSY). Retrying in 3s...`);
                    setTimeout(() => cleanup(attempt + 1), 3000);
                } else {
                    console.warn(`[DEPLOY] Final cleanup warning: ${e.message}. Manual deletion may be required for ${tempDir}`);
                }
            }
        };
        cleanup();
    }
};

/**
 * Helper: Check if Docker is installed and running
 */
async function checkDocker() {
    try {
        await execPromise('docker --version');
        return true;
    } catch (err) {
        return false;
    }
}

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

        await appendLog(deploymentId, `🐳 Starting Docker deployment for image: ${image}`);

        const conn = workspace.state_json.connection;
        const provider = conn.provider || 'aws';

        const liveUrl = await deployImageToProvider(deploymentId, workspace, conn, provider, image);
        await updateDeploymentStatus(deploymentId, 'success', liveUrl, [{ message: '🚀 Deployment successful!' }]);

    } catch (err) {
        console.error("Docker Deploy Error:", err);
        const errorObj = err.code ? err : { ...DEPLOY_ERRORS.UNKNOWN_ERROR, details: err.message };
        await updateDeploymentStatus(deploymentId, 'failed', null, [
            { message: `❌ Deployment Failed: ${errorObj.message}` },
            { message: `Details: ${errorObj.details || ''}` }
        ]);
    }
};

module.exports = {
    createDeployment,
    getDeploymentStatus,
    deployFromGithub,
    deployFromDocker
};
