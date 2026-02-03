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

        console.log(`[DOCKER] Auto-generating Dockerfile in ${repoPath}`);

        const files = fs.readdirSync(repoPath);
        let content = '';

        if (files.includes('package.json')) {
            // Node.js
            content = `FROM node:18-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm install --production\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]\n`;
        } else if (files.includes('requirements.txt')) {
            // Python
            content = `FROM python:3.9-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8080\nCMD ["python", "app.py"]\n`;
        } else if (files.includes('go.mod')) {
            // Go
            content = `FROM golang:1.19-alpine AS builder\nWORKDIR /app\nCOPY . .\nRUN go build -o main .\nFROM alpine:latest\nWORKDIR /root/\nCOPY --from=builder /app/main .\nEXPOSE 8080\nCMD ["./main"]\n`;
        } else if (files.includes('index.html')) {
            // Static Site
            content = `FROM nginx:alpine\nCOPY . /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]\n`;
        }

        if (content) {
            fs.writeFileSync(dockerfilePath, content);
            return true;
        }
        return false;
    }
}

module.exports = new GitHubService();
