/**
 * Test Script for V2 Workflow
 * Simulates a request to the deterministic V2 pipeline.
 */

// const axios = require('axios'); // Not needed for printing instructions

async function testV2() {
    const input = {
        description: "High traffic e-commerce platform with analytics",
        domains: ["commerce", "analytics"],
        toggles: {
            traffic: "large",
            scaling: "auto"
        },
        exclusions: {
            // "database": true // Uncomment to test constraint violation
        }
    };

    console.log("sending input:", JSON.stringify(input, null, 2));

    try {
        // Assume server running on localhost:5000 (adjust if needed)
        // You might need to have a valid token if authMiddleware is active
        // For testing, we might need to bypass auth or login first.
        // Assuming dev environment might have open access or we mock req.user logic if we run this internally.

        // Actually, since this is an external script hitting the API, we need a token.
        // OR we can bypass auth for local dev testing if we modify the router momentarily.
        // But let's assume we can hit it if we had a token.

        // For now, let's just log the curl command to run manually since we can't easily login here.
        console.log("\nRun this CURL command to test:");
        console.log(`curl -X POST http://localhost:5000/api/workflow/v2/analyze \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(input)}'`);

    } catch (error) {
        console.error("Error:", error.response ? error.response.data : error.message);
    }
}

testV2();
