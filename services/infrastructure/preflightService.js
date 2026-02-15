const { STSClient, GetCallerIdentityCommand, AssumeRoleCommand } = require("@aws-sdk/client-sts");
const { S3Client, ListBucketsCommand } = require("@aws-sdk/client-s3");
const { CloudFrontClient, ListDistributionsCommand } = require("@aws-sdk/client-cloudfront");
const { KMSClient, ListKeysCommand } = require("@aws-sdk/client-kms");
const { CloudTrailClient, DescribeTrailsCommand } = require("@aws-sdk/client-cloudtrail");

/**
 * Preflight Validation Service
 * Catches permission and configuration errors early.
 */
class PreflightService {
    /**
     * Core validation orchestrator
     */
    static async validateAWS(region, conn, services = []) {
        const results = {
            valid: true,
            checks: []
        };

        try {
            // Check 1: Base STS Connectivity
            const sts = new STSClient({ region });
            await sts.send(new GetCallerIdentityCommand({}));
            results.checks.push({ name: "STS Connectivity", status: "PASS" });

            // Check 2: Role Assumption
            if (conn.role_arn) {
                try {
                    const assumeCmd = new AssumeRoleCommand({
                        RoleArn: conn.role_arn,
                        RoleSessionName: "CloudiversePreflight",
                        ExternalId: conn.external_id
                    });
                    const assumed = await sts.send(assumeCmd);
                    results.checks.push({ name: "Role Assumption", status: "PASS" });

                    // Use temporary credentials for downstream checks
                    const credentials = {
                        accessKeyId: assumed.Credentials.AccessKeyId,
                        secretAccessKey: assumed.Credentials.SecretAccessKey,
                        sessionToken: assumed.Credentials.SessionToken
                    };

                    // Check 3: S3 Capability (Essential for State and Storage)
                    const s3 = new S3Client({ region, credentials });
                    await s3.send(new ListBucketsCommand({}));
                    results.checks.push({ name: "S3 Permissions", status: "PASS" });

                    // Check 4: KMS Capability (Landing Zone Encryption)
                    const kms = new KMSClient({ region, credentials });
                    await kms.send(new ListKeysCommand({ Limit: 1 }));
                    results.checks.push({ name: "KMS Access", status: "PASS" });

                    // Check 5: CloudTrail Capability (Landing Zone Auditing)
                    const trail = new CloudTrailClient({ region, credentials });
                    await trail.send(new DescribeTrailsCommand({ trailNameList: [] }));
                    results.checks.push({ name: "CloudTrail Access", status: "PASS" });

                    // Check 6: CloudFront Capability (If applicable)
                    if (services.includes('cdn') || services.includes('cloudfront')) {
                        const cf = new CloudFrontClient({ region: "us-east-1", credentials });
                        await cf.send(new ListDistributionsCommand({ MaxItems: 1 }));
                        results.checks.push({ name: "CloudFront Availability", status: "PASS" });
                    }

                } catch (err) {
                    results.valid = false;
                    results.checks.push({ name: "Role Permissions", status: "FAIL", error: err.message });
                    return results;
                }
            } else {
                results.valid = false;
                results.checks.push({ name: "Role Config", status: "FAIL", error: "No Role ARN provided in connection" });
            }

        } catch (err) {
            results.valid = false;
            results.checks.push({ name: "Preflight", status: "ERROR", error: err.message });
        }

        return results;
    }
}

module.exports = PreflightService;
