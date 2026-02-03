const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const githubService = require('../services/infrastructure/githubService');
const axios = require('axios');

const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

/**
 * GET /api/github/connect
 * Redirects user to GitHub for OAuth
 */
router.get('/connect', auth, (req, res) => {
    const scope = 'repo,user,read:org';
    const baseUrl = (process.env.VITE_API_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
    const redirectUri = `${baseUrl}/api/github/callback`;
    const authUrl = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=${scope}&state=${req.user.id}&redirect_uri=${encodeURIComponent(redirectUri)}`;
    res.redirect(authUrl);
});

/**
 * GET /api/github/callback
 * Handles OAuth redirection from GitHub
 */
router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const userId = state;

    if (!code) {
        return res.status(400).send("GitHub connection failed: No code provided");
    }

    try {
        // 1. Exchange code for access token
        const tokenResponse = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
        }, {
            headers: { Accept: 'application/json' }
        });

        const { access_token, refresh_token, expires_in } = tokenResponse.data;

        if (!access_token) {
            throw new Error("Failed to obtain access token from GitHub");
        }

        // 2. Fetch User Profile for name and avatar
        const userResponse = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `token ${access_token}` }
        });

        const { login, avatar_url } = userResponse.data;

        // 3. Save/Update token in database
        const expiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;

        await pool.query(
            `INSERT INTO github_installations (user_id, access_token, refresh_token, expires_at, account_name, account_avatar, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP) 
             ON CONFLICT (user_id) DO UPDATE SET 
                access_token = $2,
                refresh_token = $3,
                expires_at = $4,
                account_name = $5,
                account_avatar = $6,
                updated_at = CURRENT_TIMESTAMP`,
            [userId, access_token, refresh_token, expiresAt, login, avatar_url]
        );

        // 4. Send success response with window closure script
        res.send(`
            <html>
                <body style="background: #0f172a; color: white; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'GITHUB_CONNECTED', status: 'success' }, '*');
                        }
                        setTimeout(() => window.close(), 2000);
                    </script>
                    <div style="text-align: center; background: rgba(255,255,255,0.05); padding: 40px; border-radius: 24px; border: 1px border: rgba(255,255,255,0.1); box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                        <div style="font-size: 64px; margin-bottom: 20px;">🚀</div>
                        <h2 style="margin: 0; font-size: 24px;">Connected Successfully!</h2>
                        <p style="color: #94a3b8; margin-top: 10px;">Your GitHub account is now linked. This window will close automatically.</p>
                        <button onclick="window.close()" style="margin-top: 20px; padding: 12px 24px; background: #3b82f6; border: none; color: white; font-weight: bold; border-radius: 12px; cursor: pointer;">Close Now</button>
                    </div>
                </body>
            </html>
        `);
    } catch (err) {
        console.error("[GITHUB CALLBACK] Error:", err.message);
        res.status(500).send("Error connecting GitHub: " + err.message);
    }
});

/**
 * Helper to get a valid access token, refreshing if necessary
 */
async function getValidToken(userId) {
    const { rows } = await pool.query(
        'SELECT access_token, refresh_token, expires_at FROM github_installations WHERE user_id = $1',
        [userId]
    );

    if (rows.length === 0 || !rows[0].access_token) return null;

    const { access_token, refresh_token, expires_at } = rows[0];

    // If no expiration set or not yet expired (with 1 min buffer)
    if (!expires_at || new Date(expires_at).getTime() > Date.now() + 60000) {
        return access_token;
    }

    // Try to refresh if we have a refresh token
    if (refresh_token) {
        try {
            console.log(`[GITHUB] Refreshing token for user ${userId}...`);
            const response = await axios.post('https://github.com/login/oauth/access_token', {
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                grant_type: 'refresh_token',
                refresh_token: refresh_token
            }, {
                headers: { Accept: 'application/json' }
            });

            const { access_token: newToken, refresh_token: newRefreshToken, expires_in } = response.data;

            if (newToken) {
                const newExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : null;
                await pool.query(
                    'UPDATE github_installations SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = CURRENT_TIMESTAMP WHERE user_id = $4',
                    [newToken, newRefreshToken || refresh_token, newExpiresAt, userId]
                );
                return newToken;
            }
        } catch (err) {
            console.error("[GITHUB REFRESH] Error:", err.response?.data || err.message);
        }
    }

    return access_token; // Fallback to old token
}

/**
 * GET /api/github/account
 * Get connected account details
 */
router.get('/account', auth, async (req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT account_name, account_avatar FROM github_installations WHERE user_id = $1',
            [req.user.id]
        );

        if (rows.length === 0 || !rows[0].account_name) {
            return res.status(404).json({ message: "No GitHub connection found." });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error("[GITHUB ACCOUNT] Error:", err.message);
        res.status(500).json({ message: "Error fetching account details", error: err.message });
    }
});

/**
 * GET /api/github/repos
 * List repositories for the connected user
 */
router.get('/repos', auth, async (req, res) => {
    try {
        const token = await getValidToken(req.user.id);
        if (!token) {
            return res.status(404).json({ message: "No GitHub connection found." });
        }

        const repos = await githubService.getRepositories(token);
        res.json(repos);
    } catch (err) {
        console.error("[GITHUB REPOS] Error:", err.message);
        res.status(500).json({ message: "Error fetching repositories", error: err.message });
    }
});

/**
 * GET /api/github/branches/:owner/:repo
 * List branches for a repository
 */
router.get('/branches/:owner/:repo', auth, async (req, res) => {
    try {
        const token = await getValidToken(req.user.id);
        if (!token) {
            return res.status(404).json({ message: "No GitHub connection found." });
        }

        const branches = await githubService.getBranches(token, req.params.owner, req.params.repo);
        res.json(branches);
    } catch (err) {
        console.error("[GITHUB BRANCHES] Error:", err.message);
        res.status(500).json({ message: "Error fetching branches", error: err.message });
    }
});

/**
 * GET /api/github/detect/:owner/:repo
 */
router.get('/detect/:owner/:repo', auth, async (req, res) => {
    const { branch } = req.query;
    try {
        const token = await getValidToken(req.user.id);
        if (!token) {
            return res.status(404).json({ message: "No GitHub connection found." });
        }

        const config = await githubService.detectConfig(token, req.params.owner, req.params.repo, branch || 'main');
        res.json(config);
    } catch (err) {
        console.error("[GITHUB DETECT] Error:", err.message);
        res.status(500).json({ message: "Error detecting config", error: err.message });
    }
});

/**
 * DELETE /api/github
 */
router.delete('/', auth, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM github_installations WHERE user_id = $1',
            [req.user.id]
        );
        res.json({ message: "GitHub account disconnected." });
    } catch (err) {
        console.error("[GITHUB DISCONNECT] Error:", err.message);
        res.status(500).json({ message: "Error disconnecting GitHub", error: err.message });
    }
});

module.exports = router;
