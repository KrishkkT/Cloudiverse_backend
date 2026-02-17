const axios = require('axios');
const crypto = require('crypto');

const API_URL = 'http://localhost:5000/api/ci/webhook';
const SECRET = 'test_secret'; // Matches what we'll inject into DB for testing

// 1. Mock Github Payload
const payload = {
    ref: 'refs/heads/main',
    repository: {
        full_name: 'cloudiverse-test/demo-repo',
        html_url: 'https://github.com/cloudiverse-test/demo-repo'
    },
    pusher: {
        name: 'testuser'
    },
    head_commit: {
        id: 'a1b2c3d4e5f6',
        message: 'feat: update landing page',
        timestamp: new Date().toISOString()
    },
    after: 'a1b2c3d4e5f6'
};

// 2. Generate HMAC Signature
const signature = 'sha256=' + crypto.createHmac('sha256', SECRET).update(JSON.stringify(payload)).digest('hex');

async function testWebhook() {
    console.log('🚀 Sending Test Webhook...');
    try {
        const res = await axios.post(API_URL, payload, {
            headers: {
                'X-GitHub-Event': 'push',
                'X-Hub-Signature-256': signature,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Response:', res.status, res.data);
    } catch (err) {
        console.error('❌ Error:', err.response ? err.response.data : err.message);
    }
}

testWebhook();
