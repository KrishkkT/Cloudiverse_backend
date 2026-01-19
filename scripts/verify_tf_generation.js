const fs = require('fs');
const path = require('path');
const os = require('os');
const infracostService = require('../services/cost/infracostService');

// Mock external dependencies if needed, or rely on internal logic that writes to disk
// generateCostEstimate writes to disk BEFORE calling runInfracost.
// We can catch the error from runInfracost (since we don't have CLI) and check the file.

async function verifyTerraformGeneration() {
    console.log('--- STARTING TERRAFORM CONFIG & ID VERIFICATION ---');

    const runId = `verify_conf_${Date.now()}`;
    const runContext = {
        runId: runId,
        workspaceId: 'verify-ws',
        timestamp: new Date().toISOString()
    };

    // Spec with AWS Lambda (compute_serverless) and GCP Cloud SQL (relational_database)
    // These use keys that were previously mismatched or missing config
    const infraSpec = {
        service_classes: {
            pattern: 'SERVERLESS_API',
            required_services: [
                { service_class: 'compute_serverless', service: 'aws_lambda_function' }
            ]
        },
        canonical_architecture: {
            // "compute_serverless" - Testing ID match (snake_case)
            deployable_services: ['compute_serverless', 'relational_database'],
            services: ['compute_serverless', 'relational_database']
        },
        region: {
            provider_regions: {
                aws: 'us-east-1',
                gcp: 'us-central1'
            },
            resolved_region: 'us-east-1'
        },
        components: {
            // Optional: Hints for engines
            relational_database: { engine: 'postgres' }
        }
    };

    const baseDir = path.join(os.tmpdir(), 'infracost');
    const runDir = path.join(baseDir, runId);

    // TEST AWS GENERATION
    console.log('[TEST] Generating AWS Terraform...');
    try {
        await infracostService.generateCostEstimate('aws', infraSpec, 'SERVERLESS_API', 'COST_EFFECTIVE', null, ['compute_serverless'], runContext);
    } catch (e) {
        // Expected error from missing Infracost CLI, but file should be written
        if (!e.message.includes('infracost')) console.log(`[WARN] Unexpected error: ${e.message}`);
    }

    const awsTfPath = path.join(runDir, 'aws', 'main.tf');
    if (fs.existsSync(awsTfPath)) {
        const content = fs.readFileSync(awsTfPath, 'utf8');
        console.log('[PASS] AWS main.tf created.');

        // CHECK 1: ID Resolution (compute_serverless -> aws_lambda_function)
        if (content.includes('resource "aws_lambda_function"')) {
            console.log('[PASS] "compute_serverless" resolved to "aws_lambda_function".');
        } else {
            console.error('[FAIL] "compute_serverless" did NOT resolve to correct resource. Content:\n', content);
        }

        // CHECK 2: Configuration Defaults (memory_size, timeout)
        if (content.includes('memory_size = 128') && content.includes('runtime = "nodejs18.x"')) {
            console.log('[PASS] AWS Lambda has correct default config (memory/runtime).');
        } else {
            console.error('[FAIL] AWS Lambda missing defaults. Content snippet:\n', content.substring(0, 500));
        }
    } else {
        console.error(`[FAIL] AWS Terraform file not found at ${awsTfPath}`);
    }

    // TEST GCP GENERATION
    console.log('[TEST] Generating GCP Terraform...');
    // Mock GCP infraSpec
    const gcpInfraSpec = { ...infraSpec }; // Clone
    try {
        await infracostService.generateCostEstimate('gcp', gcpInfraSpec, 'SERVERLESS_API', 'COST_EFFECTIVE', null, ['relational_database'], runContext);
    } catch (e) {
        // Expected error
    }

    const gcpTfPath = path.join(runDir, 'gcp', 'main.tf');
    if (fs.existsSync(gcpTfPath)) {
        const content = fs.readFileSync(gcpTfPath, 'utf8');
        console.log('[PASS] GCP main.tf created.');

        // CHECK 3: GCP Config (tier, availability_type)
        if (content.includes('tier = "db-f1-micro"') && content.includes('availability_type = "ZONAL"')) {
            console.log('[PASS] GCP Cloud SQL has correct default config.');
        } else {
            console.error('[FAIL] GCP Cloud SQL missing defaults. Content snippet:\n', content.substring(0, 500));
        }
    } else {
        console.error(`[FAIL] GCP Terraform file not found at ${gcpTfPath}`);
    }

}

verifyTerraformGeneration().catch(e => console.error(e));
