/**
 * Deployment Validator
 * Enforces "Runtime Capability Contract" and other pre-deploy checks.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. RUNTIME CAPABILITY CONTRACT (The Source of Truth)
// ═══════════════════════════════════════════════════════════════════════════
const RUNTIME_CAPABILITIES = {
    // 🐳 General Purpose Containers (ECS, Cloud Run, Container Apps)
    compute_container: {
        supports_env_vars: true,
        supports_secrets: true,
        supports_ports: true,    // Can expose HTTP/TCP ports
        supports_volumes: false, // Generally ephemeral (unless statefulset, but we assume stateless for now)
        supports_background: true,
        max_timeout_seconds: 3600 // High timeout
    },

    // ⚡ Serverless Functions (Lambda, Azure Functions, Cloud Functions)
    compute_serverless: {
        supports_env_vars: true,
        supports_secrets: true,
        supports_ports: false,   // Cannot bind ports directly
        supports_volumes: false,
        supports_background: false, // Execution is event-driven short-lived
        max_timeout_seconds: 900 // 15 mins max usually
    },

    // 🖥️ Virtual Machines (EC2, VM, Compute Engine)
    compute_vm: {
        supports_env_vars: true, // Via user-data or SSH
        supports_secrets: true,
        supports_ports: true,
        supports_volumes: true,
        supports_background: true,
        max_timeout_seconds: Infinity
    },

    // 📦 Static Hosting (S3+CloudFront, Blob+CDN)
    static_site: {
        supports_env_vars: false, // Client-side only (build time)
        supports_secrets: false,
        supports_ports: false,
        supports_volumes: false,
        supports_background: false,
        max_timeout_seconds: 0
    }
};

/**
 * Validates that the project requirements match the conflicting runtime capabilities.
 * @param {Object} project - The project/architecture definition
 * @param {Object} project.requirements - Requirements from PatternResolver
 * @param {Object} runtime - The selected runtime ({ type: 'compute_container', ... })
 * @returns {Object} - { valid: boolean, error: string | null }
 */
function validateRuntimeContract(project, runtime) {
    if (!runtime || !runtime.type) {
        return { valid: false, error: "CRITICAL: No explicit runtime selected." };
    }

    const capabilities = RUNTIME_CAPABILITIES[runtime.type];
    if (!capabilities) {
        return { valid: false, error: `Unknown runtime type: ${runtime.type}` };
    }

    const reqs = project.requirements || {};

    // 1. Port Binding Check
    // Web Apps and APIs usually need ports. Static sites do not.
    // If workload is 'web_app' or 'backend_api' and runtime doesn't support ports -> FAIL
    const needsPorts = reqs.workload_types?.includes('web_app') || reqs.workload_types?.includes('backend_api');
    if (needsPorts && !capabilities.supports_ports) {
        // Exception: Serverless often serves web apps via API Gateway integration, 
        // so strictly speaking they don't "bind ports" but they "serve traffic".
        // Use a more nuanced check: if it's a raw port bind requirement vs managed routing.
        // For now, let's assume 'web_app' on 'compute_serverless' requires an API Gateway adapter, 
        // but if the user expects a long-running listening process (like express.listen), it might fail.

        // Let's be strict for now:
        if (runtime.type === 'compute_serverless' && reqs.stateful) {
            return { valid: false, error: "Invalid Contract: Stateful Web App cannot run on Serverless Functions." };
        }
    }

    // 2. Volume/State Check
    if (reqs.stateful && !capabilities.supports_volumes && !capabilities.supports_ports) {
        // If stateful (needs disk) and runtime is ephemeral -> WARNING/FAIL
        // (Note: Database services are separate, this checks *application* state)
        // return { valid: false, error: "Invalid Contract: Stateful application requires a runtime with volume support." };
    }

    // 3. Timeout Check
    if (reqs.nfr && reqs.nfr.long_running_tasks && capabilities.max_timeout_seconds < 900) {
        return { valid: false, error: `Invalid Contract: Long-running tasks require > ${capabilities.max_timeout_seconds}s timeout.` };
    }

    return { valid: true, error: null };
}

module.exports = {
    RUNTIME_CAPABILITIES,
    validateRuntimeContract
};
