const pool = require('../config/db');
const credentialProvider = require('../services/infrastructure/credentialProvider');
const { ECRClient, DeleteRepositoryCommand } = require("@aws-sdk/client-ecr");
const { IAMClient, DeleteRoleCommand, DetachRolePolicyCommand, ListAttachedRolePoliciesCommand } = require("@aws-sdk/client-iam");
const { CloudWatchLogsClient, DeleteLogGroupCommand } = require("@aws-sdk/client-cloudwatch-logs");
const { RDSClient, DeleteDBSubnetGroupCommand, DeleteDBInstanceCommand } = require("@aws-sdk/client-rds");
const { STSClient, AssumeRoleCommand } = require("@aws-sdk/client-sts");

const WORKSPACE_ID = 477;

async function runCleanup() {
    console.log(`Starting cleanup for workspace ${WORKSPACE_ID}...`);

    try {
        const res = await pool.query('SELECT state_json FROM workspaces WHERE id = $1', [WORKSPACE_ID]);
        if (res.rows.length === 0) {
            console.error('Workspace not found!');
            process.exit(1);
        }

        const connectionData = res.rows[0].state_json.connection;
        if (!connectionData) {
            console.error('No connection data found!');
            process.exit(1);
        }

        console.log('Obtaining AWS credentials...');
        const { envVars } = await credentialProvider.getCredentials('aws', connectionData, '.');

        const config = {
            region: envVars.AWS_DEFAULT_REGION,
            credentials: {
                accessKeyId: envVars.AWS_ACCESS_KEY_ID,
                secretAccessKey: envVars.AWS_SECRET_ACCESS_KEY,
                sessionToken: envVars.AWS_SESSION_TOKEN
            }
        };

        const ecr = new ECRClient(config);
        const iam = new IAMClient(config);
        const logs = new CloudWatchLogsClient(config);
        const rds = new RDSClient(config);

        // 1. Delete ECR Repo
        try {
            console.log('Deleting ECR repo: node-js-web-application-repo...');
            await ecr.send(new DeleteRepositoryCommand({ repositoryName: 'node-js-web-application-repo', force: true }));
            console.log('✅ Deleted ECR repo');
        } catch (e) {
            console.log(`⚠️ ECR error: ${e.message}`);
        }

        // 2. Delete Log Groups
        const logGroups = ['/ecs/node-js-web-application', '/aws/node-js-web-application/logs'];
        for (const lg of logGroups) {
            try {
                console.log(`Deleting Log Group: ${lg}...`);
                await logs.send(new DeleteLogGroupCommand({ logGroupName: lg }));
                console.log(`✅ Deleted Log Group: ${lg}`);
            } catch (e) {
                console.log(`⚠️ Log Group error (${lg}): ${e.message}`);
            }
        }

        // 3. Delete DB Instance & Subnet Group
        try {
            const dbInstanceId = 'node-js-web-application-db';
            console.log(`Deleting RDS Instance: ${dbInstanceId}...`);
            await rds.send(new DeleteDBInstanceCommand({
                DBInstanceIdentifier: dbInstanceId,
                SkipFinalSnapshot: true
            }));
            console.log('⏳ Waiting for RDS deletion (this may take a while)...');
            // We won't wait indefinitely here, but basic wait or user retry is needed.
            await new Promise(r => setTimeout(r, 10000));

            console.log('Deleting DB Subnet Group: node-js-web-application-db-subnet-group...');
            await rds.send(new DeleteDBSubnetGroupCommand({ DBSubnetGroupName: 'node-js-web-application-db-subnet-group' }));
            console.log('✅ Deleted DB Subnet Group');
        } catch (e) {
            console.log(`⚠️ RDS error: ${e.message}`);
        }

        // 4. Delete IAM Role
        const roleName = 'node-js-web-application-app-role';
        try {
            console.log(`Cleaning up IAM Role: ${roleName}...`);

            // Detach policies first
            try {
                const attached = await iam.send(new ListAttachedRolePoliciesCommand({ RoleName: roleName }));
                for (const policy of attached.AttachedPolicies || []) {
                    console.log(`  Detaching policy: ${policy.PolicyArn}`);
                    await iam.send(new DetachRolePolicyCommand({ RoleName: roleName, PolicyArn: policy.PolicyArn }));
                }
            } catch (e) {
                console.log(`  ⚠️ IAM List/Detach error: ${e.message}`);
            }

            // Delete Role
            await iam.send(new DeleteRoleCommand({ RoleName: roleName }));
            console.log('✅ Deleted IAM Role');
        } catch (e) {
            console.log(`⚠️ IAM error: ${e.message}`);
        }

        console.log('Cleanup complete!');
    } catch (err) {
        console.error('Fatal error:', err);
    } finally {
        pool.end();
    }
}

runCleanup();
