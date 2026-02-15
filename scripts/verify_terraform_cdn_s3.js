const fs = require('fs');
const path = require('path');
const terraformGenerator = require('../services/infrastructure/terraformGeneratorV2');

async function run() {
    const provider = 'aws';
    const pattern = 'STATIC_WEBSITE';
    const services = ['cdn', 'objectstorage'];
    const options = {
        region: 'us-east-1',
        projectName: 'verify-cdn-s3', // projectName expected in options or args
        requirements: {
            compliance: 'none'
        },
        deploymentId: 'verify-123',
        connectionData: {
            role_arn: 'arn:aws:iam::123456789012:role/CloudiverseExecutionRole',
            external_id: 'verify-ext-id'
        }
    };

    console.log(`Generating Terraform for ${provider} with services: ${services.join(', ')}...`);

    const canonicalArchitecture = {
        services: services,
        pattern: pattern,
        sizing: {}
    };

    // Correct Signature: canonicalArchitecture, provider, region, projectName, options
    const result = await terraformGenerator.generateTerraform(
        canonicalArchitecture,
        provider,
        options.region,
        options.projectName,
        options
    );

    const tfFiles = result.files || result;
    console.log('Generated files keys:', Object.keys(tfFiles));

    if (Object.keys(tfFiles).length === 0) {
        console.error('ERROR: No files generated!');
    }

    const outputDir = path.join(__dirname, '../verification/cdn_s3');
    console.log('Writing to directory:', outputDir);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write files
    for (const [filename, content] of Object.entries(tfFiles)) {
        const filePath = path.join(outputDir, filename);
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content);
        console.log(`Wrote ${filename}`);
    }

    console.log('Generation complete. You can now run terraform init/plan in ' + outputDir);
}

run().catch(console.error);
