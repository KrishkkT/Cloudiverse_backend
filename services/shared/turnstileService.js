const axios = require('axios');
require('dotenv').config();

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * secret: The secret key for your widget (from environment variables)
 * Test secret keys:
 * - Always Pass: 1x0000000000000000000000000000000AA
 * - Always Fail: 2x0000000000000000000000000000000AA
 * - Token Expired: 3x0000000000000000000000000000000AA
 */
const getSecretKey = () => {
    return process.env.TURNSTILE_SECRET_KEY || '1x0000000000000000000000000000000AA';
};

/**
 * Verify Turnstile token
 * @param {string} token - The token from the client-side widget
 * @param {string} ip - The client's IP address (optional but recommended)
 * @returns {Promise<{success: boolean, error?: string, messages?: string[]}>}
 */
const verifyToken = async (token, ip) => {
    try {
        if (!token) {
            return { success: false, error: 'Token is missing' };
        }

        const formData = new URLSearchParams();
        formData.append('secret', getSecretKey());
        formData.append('response', token);
        if (ip) {
            formData.append('remoteip', ip);
        }

        const result = await axios.post(TURNSTILE_VERIFY_URL, formData);
        const data = result.data;

        if (data.success) {
            return { success: true };
        } else {
            return {
                success: false,
                error: 'Verification failed',
                messages: data['error-codes'] || []
            };
        }

    } catch (error) {
        console.error('[Turnstile Service] Error verifying token:', error.message);
        return { success: false, error: 'Internal verification error' };
    }
};

module.exports = {
    verifyToken
};
