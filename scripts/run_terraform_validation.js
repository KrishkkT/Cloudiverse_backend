const path = require('path');
console.log('Script running in:', __dirname);
const execPath = path.resolve(__dirname, '../services/infrastructure/terraformExecutor');
console.log('Attempting to require:', execPath);

let terraformExecutor;
try {
    terraformExecutor = require(execPath);
} catch (e) {
    console.error('Failed to load terraformExecutor:', e);
    process.exit(1);
}

async function run() {
    const workingDir = path.join(__dirname, '../verification/cdn_s3');

    // Create a job context
    const job = terraformExecutor.createJob('terraform', 'validation-ws', { purpose: 'verification' });
    const jobId = job.id;

    console.log(`Running Terraform validation in ${workingDir}... (Job ID: ${jobId})`);

    // Ensure working directory exists
    const fs = require('fs');
    if (!fs.existsSync(workingDir)) {
        console.error(`Working directory ${workingDir} does not exist!`);
        process.exit(1);
    }

    const env = process.env;

    try {
        console.log('--- INIT ---');
        let res = await terraformExecutor.runTerraformCommand(jobId, 'init', [], workingDir, env);
        if (!res.success) throw new Error(`Init failed with code ${res.exitCode}`);

        console.log('--- VALIDATE ---');
        res = await terraformExecutor.runTerraformCommand(jobId, 'validate', [], workingDir, env);
        if (!res.success) throw new Error(`Validate failed with code ${res.exitCode}`);

        console.log('--- PLAN ---');
        // plan requires -input=false
        res = await terraformExecutor.runTerraformCommand(jobId, 'plan', ['-input=false'], workingDir, env);
        if (!res.success) throw new Error(`Plan failed with code ${res.exitCode}`);

        console.log('SUCCESS: Terraform configuration is valid and plan succeeded.');

        // Print logs
        const finalJob = terraformExecutor.getJob(jobId);
        if (finalJob && finalJob.logs) {
            console.log('--- EXECUTION LOGS ---');
            finalJob.logs.forEach(l => console.log(`[${l.type}] ${l.message}`));
        }

    } catch (error) {
        console.error('FAILURE: Terraform execution failed:', error.message);
        // Print logs on failure too
        const finalJob = terraformExecutor.getJob(jobId);
        if (finalJob && finalJob.logs) {
            console.log('--- EXECUTION LOGS (FAILURE) ---');
            finalJob.logs.forEach(l => console.log(`[${l.type}] ${l.message}`));
        }
        process.exit(1);
    }
}

run();
