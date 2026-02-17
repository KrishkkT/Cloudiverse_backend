const fs = require('fs');
const path = require('path');

/**
 * Project Analyzer Service
 * Implements 3-Layer Deterministic Project Detection
 */
class ProjectAnalyzer {

    /**
     * analyze(repoPath)
     * @param {string} repoPath - Absolute path to the repository root
     * @returns {Object} AnalysisResult
     */
    static analyze(repoPath) {
        if (!fs.existsSync(repoPath)) {
            throw new Error(`Repository path not found: ${repoPath}`);
        }

        console.log(`[ProjectAnalyzer] 🔍 Analyzing: ${repoPath}`);

        // 1️⃣ LAYER 1: DOCKER DETECTION (Explicit Runtime)
        const dockerResult = this.detectDocker(repoPath);
        if (dockerResult) {
            console.log(`[ProjectAnalyzer] ✅ Layer 1 (Docker) Matched: ${JSON.stringify(dockerResult)}`);
            return dockerResult;
        }

        // 2️⃣ LAYER 2: FRAMEWORK DETECTION (package.json)
        const frameworkResult = this.detectFramework(repoPath);
        if (frameworkResult) {
             // If fullstack split suspected, verify structure in Layer 3
            if (frameworkResult.strategy === 'FULLSTACK_SPLIT') {
                 console.log(`[ProjectAnalyzer] ⚠️ Layer 2 suspected FULLSTACK_SPLIT. Verifying structure...`);
                 const structureResult = this.detectStructure(repoPath);
                 if (structureResult) {
                     console.log(`[ProjectAnalyzer] ✅ Layer 3 (Structure) Confirmed Split: ${JSON.stringify(structureResult)}`);
                     // Merge framework and structure details
                     return { ...frameworkResult, ...structureResult }; 
                 } else {
                     console.log(`[ProjectAnalyzer] ⚠️ Layer 3 failed to confirm split. Fallback to MONOLITH.`);
                     // Fallback to single container monolith if structure doesn't match
                     return { ...frameworkResult, strategy: 'CONTAINER', reason: 'Fullstack frameworks found but Monorepo structure missing' };
                 }
            }

            console.log(`[ProjectAnalyzer] ✅ Layer 2 (Framework) Matched: ${JSON.stringify(frameworkResult)}`);
            return frameworkResult;
        }
        
        // 3️⃣ LAYER 3: GENERIC STRUCTURE (Last Resort)
        // If no package.json or unknown stack, check generic patterns (e.g., just static HTML)
        const genericResult = this.detectGeneric(repoPath);
        if (genericResult) {
            console.log(`[ProjectAnalyzer] ✅ Layer 3 (Generic) Matched: ${JSON.stringify(genericResult)}`);
            return genericResult;
        }

        // ❌ UNKNOWN
        console.error(`[ProjectAnalyzer] 🛑 Could not detect project type.`);
        return {
            strategy: 'UNKNOWN',
            reason: 'No Dockerfile, framework, or standard structure detected.'
        };
    }

    /**
     * Layer 1: Docker
     */
    static detectDocker(repoPath) {
        const files = fs.readdirSync(repoPath);
        if (files.includes('Dockerfile')) {
            return {
                strategy: 'CONTAINER',
                runtime: 'docker',
                framework: 'custom',
                builder: 'docker',
                reason: 'Found Dockerfile'
            };
        }
        if (files.includes('docker-compose.yml') || files.includes('docker-compose.yaml')) {
             return {
                strategy: 'CONTAINER', // Or MULTI_CONTAINER in future
                runtime: 'docker-compose',
                framework: 'custom',
                builder: 'docker',
                reason: 'Found docker-compose.yml'
            };
        }
        return null;
    }

    /**
     * Layer 2: Framework (package.json)
     */
    static detectFramework(repoPath) {
        const pkgPath = path.join(repoPath, 'package.json');
        if (!fs.existsSync(pkgPath)) return null;

        let pkg;
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (e) {
            console.warn("[ProjectAnalyzer] Failed to parse package.json", e);
            return null;
        }

        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        const scripts = pkg.scripts || {};

        // A. Next.js Check (Most Complex)
        if (deps['next']) {
            // Check next.config.js for "output: export"
            let isStatic = false;
            const nextConfigPath = path.join(repoPath, 'next.config.js');
            const nextConfigMjsPath = path.join(repoPath, 'next.config.mjs');
            
            // Heuristic check for 'output: "export"' or "export"
            // (Robust parsing would require AST, but grep is fast/effective for now)
            try {
                if (fs.existsSync(nextConfigPath)) {
                    const content = fs.readFileSync(nextConfigPath, 'utf8');
                    if (content.includes(`output: 'export'`) || content.includes(`output: "export"`)) isStatic = true;
                } else if (fs.existsSync(nextConfigMjsPath)) { // Check MJS as well
                     const content = fs.readFileSync(nextConfigMjsPath, 'utf8');
                     if (content.includes(`output: 'export'`) || content.includes(`output: "export"`)) isStatic = true;
                }
            } catch (e) { /* ignore read error */ }

            // Check script "next export" (Older Next.js)
            if (scripts.build && scripts.build.includes('next export')) isStatic = true;
            if (scripts.export) isStatic = true;

            if (isStatic) {
                return {
                    strategy: 'STATIC',
                    runtime: 'node', // Build time only
                    framework: 'next',
                    builder: 'npm',
                    buildCommand: 'npm run build',
                    outputDir: 'out', // Standard Next.js export dir
                    reason: 'Next.js with static export detected'
                };
            } else {
                return {
                    strategy: 'CONTAINER',
                    runtime: 'node',
                    framework: 'next',
                    builder: 'docker', // We will generate Dockerfile
                    reason: 'Next.js SSR detected (default)'
                };
            }
        }

        // B. Static Frameworks (Vite, React, Vue, etc.)
        // These produce static assets.
        const staticIndicators = [
            { id: 'vite', check: d => d['vite'], out: 'dist' },
            { id: 'react-scripts', check: d => d['react-scripts'], out: 'build' },
            { id: 'gatsby', check: d => d['gatsby'], out: 'public' },
            { id: 'astro', check: d => d['astro'], out: 'dist' },
            { id: 'nuxt', check: d => d['nuxt'], out: '.output/public' }, // Nuxt can be SSR too, check config? assume static validation later?
            // Note: Nuxt is often SSR. Let's treat Nuxt like Next.js later. For now, Nuxt logic usually implies server unless 'target: static'.
            // Keeping simple for MVP as requested.
        ];

        for (const ind of staticIndicators) {
            if (ind.check(deps)) {
                // Special handling for Nuxt to be safe? 
                // Let's stick to User's "React/Vite = STATIC" rule.
                return {
                    strategy: 'STATIC',
                    runtime: 'node',
                    framework: ind.id,
                    builder: 'npm',
                    buildCommand: 'npm run build',
                    outputDir: ind.out,
                    reason: `Matched static framework: ${ind.id}`
                };
            }
        }

        // C. Backend API Frameworks
        const backendIndicators = ['express', 'fastify', 'nestjs', '@nestjs/core', 'koa', 'hapi'];
        const hasBackend = backendIndicators.some(f => deps[f]);
        
        // D. Check for Monorepo / Fullstack Split Signals
        // If we see BOTH frontend (react) AND backend (express) deps in root, 
        // OR we see "workspaces" in package.json
        const hasFrontend = deps['react'] || deps['vue'] || deps['svelte'];

        if (hasBackend && hasFrontend) {
             return {
                 strategy: 'FULLSTACK_SPLIT', // Tentative, needs Layer 3 confirmation
                 runtime: 'node',
                 framework: 'mixed',
                 reason: 'Detected both frontend and backend dependencies in root'
             };
        }

        if (pkg.workspaces) {
             return {
                 strategy: 'FULLSTACK_SPLIT', // Workspaces imply monorepo
                 runtime: 'node',
                 framework: 'monorepo',
                 reason: 'Detected npm/yarn workspaces'
             };
        }

        if (hasBackend) {
            return {
                strategy: 'CONTAINER',
                runtime: 'node',
                framework: 'express-like', // Generic node server
                builder: 'docker',
                reason: 'Backend framework detected'
            };
        }
        
        // Fallback: If only scripts.start exists -> Container
        if (scripts.start) {
            return {
                strategy: 'CONTAINER',
                runtime: 'node',
                framework: 'node-generic',
                builder: 'docker',
                reason: 'Generic Node.js (has start script)'
            };
        }

        return null;
    }

    /**
     * Layer 3: Folder Structure
     */
    static detectStructure(repoPath) {
        const dirs = fs.readdirSync(repoPath).filter(f => {
            try { return fs.statSync(path.join(repoPath, f)).isDirectory(); } 
            catch { return false; }
        });

        // Heuristics for Split
        const clientDirs = ['client', 'frontend', 'web', 'ui', 'app'];
        const serverDirs = ['server', 'backend', 'api', 'services'];

        const hasClient = dirs.find(d => clientDirs.includes(d));
        const hasServer = dirs.find(d => serverDirs.includes(d));

        if (hasClient && hasServer) {
            return {
                strategy: 'FULLSTACK_SPLIT',
                structure: {
                    frontend: hasClient,
                    backend: hasServer
                },
                reason: `Found separate folders: ${hasClient} & ${hasServer}`
            };
        }

        // Check 'apps' folder (Monorepo standard)
        if (dirs.includes('apps')) {
             const appsPath = path.join(repoPath, 'apps');
             const apps = fs.readdirSync(appsPath);
             // Verify at least 2 apps? logic can be extended
             return {
                 strategy: 'FULLSTACK_SPLIT',
                 structure: { appsDir: 'apps', apps },
                 reason: 'Found apps directory'
             };
        }

        return null;
    }

    /**
     * Layer 4: Generic / Static HTML
     */
    static detectGeneric(repoPath) {
        const files = fs.readdirSync(repoPath);

        // Pure Static HTML
        if (files.includes('index.html')) {
            return {
                strategy: 'STATIC',
                runtime: 'static',
                framework: 'html',
                builder: 'none',
                outputDir: '.',
                reason: 'Found index.html at root'
            };
        }
        
        // Serverless (serverless.yml)
        if (files.includes('serverless.yml') || files.includes('serverless.yaml')) {
             return {
                 strategy: 'SERVERLESS',
                 runtime: 'serverless-framework',
                 framework: 'serverless',
                 reason: 'Found serverless.yml'
             };
        }

        return null;
    }
}

module.exports = ProjectAnalyzer;
