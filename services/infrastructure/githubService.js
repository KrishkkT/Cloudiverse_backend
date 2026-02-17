const fs = require('fs');
const path = require('path');
require('dotenv').config();

class GitHubService {
    constructor() {
        this.appId = process.env.GITHUB_APP_ID;
        this.privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n');
        this.webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

        if (!this.appId || !this.privateKey) {
            console.warn("[GITHUB] Missing GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY in .env");
        }
    }

    async getOctokit(token) {
        // Octokit is ESM only since v19
        const { Octokit } = await import("octokit");

        if (token && typeof token === 'string' && !token.startsWith('installation_')) {
            // User-level OAuth token
            return new Octokit({ auth: token });
        }

        // App-level installation or App authentication
        const { createAppAuth } = await import("@octokit/auth-app");
        const authOptions = {
            appId: this.appId,
            privateKey: this.privateKey,
        };

        if (token && typeof token === 'string' && token.startsWith('installation_')) {
            authOptions.installationId = token.replace('installation_', '');
        }

        return new Octokit({
            authStrategy: createAppAuth,
            auth: authOptions,
        });
    }

    /**
     * Fetch all repositories for an authenticated user (OAuth) or installation
     */
    async getRepositories(token) {
        const octokit = await this.getOctokit(token);
        let repositories = [];

        if (token && typeof token === 'string' && !token.startsWith('installation_')) {
            // Standard OAuth Repo List
            const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                sort: 'updated',
                per_page: 100
            });
            repositories = data;
        } else {
            // Legacy App Installation Repo List
            const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
            repositories = data.repositories;
        }

        return repositories.map(repo => ({
            id: repo.id,
            name: repo.name,
            full_name: repo.full_name,
            private: repo.private,
            owner: repo.owner.login,
            default_branch: repo.default_branch,
            html_url: repo.html_url,
            language: repo.language,
            description: repo.description
        }));
    }

    /**
     * Fetch branches for a specific repository
     */
    async getBranches(token, owner, repo) {
        const octokit = await this.getOctokit(token);
        const { data } = await octokit.rest.repos.listBranches({
            owner,
            repo,
        });
        return data.map(branch => ({
            name: branch.name,
            protected: branch.protected
        }));
    }

    /**
     * Fetch repo contents to detect Dockerfile/package.json etc.
     */
    async getRepoMetadata(token, owner, repo, ref = 'main') {
        const octokit = await this.getOctokit(token);
        try {
            const { data: contents } = await octokit.rest.repos.getContent({
                owner,
                repo,
                path: '',
                ref
            });

            const files = Array.isArray(contents) ? contents.map(f => f.name) : [];

            return {
                files,
                hasDockerfile: files.includes('Dockerfile'),
                hasDockerCompose: files.includes('docker-compose.yml') || files.includes('docker-compose.yaml'),
                hasPackageJson: files.includes('package.json'),
                hasRequirementsTxt: files.includes('requirements.txt'),
                hasIndexHtml: files.includes('index.html')
            };
        } catch (err) {
            console.error(`[GITHUB] Error fetching contents for ${owner}/${repo}:`, err.message);
            return { files: [], error: err.message };
        }
    }

    /**
     * Auto-detect project configuration without cloning
     */
    async detectConfig(token, owner, repo, ref) {
        const metadata = await this.getRepoMetadata(token, owner, repo, ref);

        if (metadata.hasDockerfile) {
            return { type: 'docker', buildType: 'Dockerfile' };
        }

        if (metadata.hasPackageJson) {
            return { type: 'node', buildType: 'npm' };
        }

        if (metadata.hasIndexHtml) {
            return { type: 'static', buildType: 'none' };
        }

        return { type: 'unknown', buildType: 'none' };
    }

    /**
     * Generate a default Dockerfile if one is missing
     */
    async generateDockerfile(repoPath) {
        const dockerfilePath = path.join(repoPath, 'Dockerfile');
        if (fs.existsSync(dockerfilePath)) return;

        // ... existing logic ...
        // (This part is fine, just showing context)
    }

    /**
     * Create a repository webhook programmatically
     */
    async createWebhook(token, owner, repo, webhookUrl, secret) {
        const octokit = await this.getOctokit(token);

        try {
            // Check existing hooks first to avoid duplicates
            const { data: hooks } = await octokit.rest.repos.listWebhooks({
                owner,
                repo
            });

            const existingHook = hooks.find(h => h.config.url === webhookUrl);
            if (existingHook) {
                console.log(`[GITHUB] Webhook already exists for ${owner}/${repo}`);
                return existingHook;
            }

            const { data } = await octokit.rest.repos.createWebhook({
                owner,
                repo,
                name: 'web',
                active: true,
                events: ['push', 'pull_request'],
                config: {
                    url: webhookUrl,
                    content_type: 'json',
                    secret: secret,
                    insecure_ssl: '0'
                }
            });

            console.log(`[GITHUB] Webhook created for ${owner}/${repo}: ${data.id}`);
            return data;
        } catch (err) {
            console.error(`[GITHUB] Failed to create webhook: ${err.message}`);
            // Don't throw, just return null so we don't block the setup flow
            return null;
        }
    }
}

module.exports = new GitHubService();
