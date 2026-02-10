const terraformGenerator = require('../services/infrastructure/terraformGeneratorV2');

async function verifyAzureGen() {
    try {
        const services = ['networking', 'compute_container', 'relationaldatabase'];
        const provider = 'azure';
        const projectId = 'test-proj';
        const workspaceId = 'test-ws';
        const region = 'eastus';

        console.log("Generating Terraform code for Azure...");
        const result = await terraformGenerator.generateTerraform({ services }, provider, region, projectId);
        const files = result.files;

        console.log("\n--- providers.tf ---");
        console.log(files['providers.tf']);

        console.log("\n--- variables.tf ---");
        console.log(files['variables.tf']);

        console.log("\n--- main.tf ---");
        console.log(files['main.tf']);

        console.log("\n--- modules/networking/main.tf ---");
        // Accessing module content might require digging into the generator internals or the returned object structure
        // The generator returns a flat map of filenames to content, including modules?
        // Let's check if the generator returns deep structure or flat.
        // Based on previous reads, it returns a flat object: { 'main.tf': ..., 'modules/networking/main.tf': ... }
        // or it might return { modules: { ... } }

        // Let's inspect the keys
        Object.keys(files).forEach(f => {
            if (f.includes('networking') && f.endsWith('main.tf')) {
                console.log(`\n--- ${f} ---`);
                console.log(files[f]);
            }
        });

    } catch (error) {
        console.error("Verification Failed:", error);
    }
}

verifyAzureGen();
