const fs = require('fs');
const path = require('path');

/**
 * Detects the project type based on the repository content.
 * Enhanced to distinguish between:
 * - TRUE backends (Express, Fastify, NestJS, etc.) -> CONTAINER
 * - Static site frameworks (React, Vue, Vite, Next export) -> STATIC (needs build)
 * - Pure static HTML -> STATIC (no build)
 * 
 * @param {string} repoPath - Absolute path to the cloned repository
 * @returns {object} { type: 'CONTAINER' | 'STATIC', runtime: string, needsBuild: boolean, buildCmd: string, reason: string }
 * @throws {Error} if type cannot be detected
 */
function detectProjectType(repoPath) {
    if (!fs.existsSync(repoPath)) {
        throw new Error(`Repository path does not exist: ${repoPath}`);
    }

    const files = fs.readdirSync(repoPath);

    // 1. DOCKERFILE (Highest Priority - User explicitly wants container)
    if (files.includes('Dockerfile')) {
        return { type: 'CONTAINER', runtime: 'docker', needsBuild: false, buildCmd: null, reason: 'Found Dockerfile' };
    }

    // 2. NODE.JS PROJECT - Analyze package.json to determine type
    if (files.includes('package.json')) {
        const pkgPath = path.join(repoPath, 'package.json');
        let pkg = {};
        try {
            pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        } catch (e) {
            // If we can't parse, assume container
            return { type: 'CONTAINER', runtime: 'node', needsBuild: false, buildCmd: null, reason: 'Found package.json (parse failed)' };
        }

        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const scripts = pkg.scripts || {};

        // Static Site Framework Detection (order matters)
        // These are ALWAYS static sites that need build
        const staticFrameworks = [
            { name: 'vite', check: () => deps['vite'], buildCmd: 'npm run build', outDir: 'dist' },
            { name: 'react-scripts', check: () => deps['react-scripts'], buildCmd: 'npm run build', outDir: 'build' },
            { name: 'vue-cli', check: () => deps['@vue/cli-service'], buildCmd: 'npm run build', outDir: 'dist' },
            { name: 'astro', check: () => deps['astro'], buildCmd: 'npm run build', outDir: 'dist' },
            { name: 'gatsby', check: () => deps['gatsby'], buildCmd: 'npm run build', outDir: 'public' },
            { name: 'parcel', check: () => deps['parcel'] || deps['parcel-bundler'], buildCmd: 'npm run build', outDir: 'dist' },
            { name: 'snowpack', check: () => deps['snowpack'], buildCmd: 'npm run build', outDir: 'build' },
        ];

        for (const fw of staticFrameworks) {
            if (fw.check()) {
                return {
                    type: 'STATIC',
                    runtime: fw.name,
                    needsBuild: true,
                    buildCmd: fw.buildCmd,
                    outputDir: fw.outDir,
                    reason: `Static site framework: ${fw.name}`
                };
            }
        }

        // Next.js - Can be SSR (container) or static export (static)
        if (deps['next']) {
            // Check for static export config
            const hasStaticExport = scripts.build?.includes('next export') ||
                scripts.export ||
                fs.existsSync(path.join(repoPath, 'out'));
            if (hasStaticExport) {
                return { type: 'STATIC', runtime: 'next-static', needsBuild: true, buildCmd: 'npm run build && npm run export', outputDir: 'out', reason: 'Next.js static export' };
            }
            // Default Next.js = SSR = Container
            return { type: 'CONTAINER', runtime: 'next', needsBuild: false, buildCmd: null, reason: 'Next.js SSR (requires Node runtime)' };
        }

        // Backend Detection (Express, Fastify, etc.)
        const backendFrameworks = ['express', 'fastify', 'koa', 'hapi', 'nestjs', '@nestjs/core', 'socket.io', 'ws'];
        for (const fw of backendFrameworks) {
            if (deps[fw]) {
                return { type: 'CONTAINER', runtime: 'node', needsBuild: false, buildCmd: null, reason: `Backend framework: ${fw}` };
            }
        }

        // Check for server.js / app.js (likely backend)
        if (files.includes('server.js') || files.includes('app.js')) {
            return { type: 'CONTAINER', runtime: 'node', needsBuild: false, buildCmd: null, reason: 'Found server.js/app.js (Node backend)' };
        }

        // Has React/Vue but no specific bundler detected - assume Vite or similar
        if (deps['react'] || deps['vue']) {
            return {
                type: 'STATIC',
                runtime: deps['react'] ? 'react' : 'vue',
                needsBuild: true,
                buildCmd: 'npm run build',
                outputDir: 'dist',
                reason: `Frontend framework detected (${deps['react'] ? 'React' : 'Vue'})`
            };
        }

        // Generic Node.js with start script - likely backend
        if (scripts.start) {
            return { type: 'CONTAINER', runtime: 'node', needsBuild: false, buildCmd: null, reason: 'Has npm start script' };
        }

        // Fallback: package.json with no clear purpose = assume simple static
        if (scripts.build) {
            return { type: 'STATIC', runtime: 'node-static', needsBuild: true, buildCmd: 'npm run build', outputDir: 'dist', reason: 'Has build script (assumed static)' };
        }
    }

    // 3. PYTHON (Implies Container)
    if (files.includes('requirements.txt') || files.includes('Pipfile')) {
        return { type: 'CONTAINER', runtime: 'python', needsBuild: false, buildCmd: null, reason: 'Found Python project files' };
    }

    // 4. JAVA (Implies Container)
    if (files.includes('pom.xml') || files.includes('build.gradle')) {
        return { type: 'CONTAINER', runtime: 'java', needsBuild: false, buildCmd: null, reason: 'Found Java project files' };
    }

    // 5. STATIC SITE (No build needed)
    const hasIndexRoot = files.includes('index.html');
    let hasIndexPublic = false;
    if (!hasIndexRoot && fs.existsSync(path.join(repoPath, 'public'))) {
        const publicFiles = fs.readdirSync(path.join(repoPath, 'public'));
        hasIndexPublic = publicFiles.includes('index.html');
    }

    if (hasIndexRoot || hasIndexPublic) {
        return { type: 'STATIC', runtime: 'static', needsBuild: false, buildCmd: null, outputDir: hasIndexRoot ? '.' : 'public', reason: 'Found index.html (Pure static site)' };
    }

    // 6. UNKNOWN
    throw new Error('Could not detect project type. No Dockerfile, package.json, requirements.txt, or index.html found.');
}

module.exports = { detectProjectType };

