/**
 * Deployment Strategy Resolver
 * Maps Project Analysis to Concrete Cloud Infrastructure
 */

const Strategies = {
    STATIC: 'STATIC',
    CONTAINER: 'CONTAINER',
    SERVERLESS: 'SERVERLESS',
    FULLSTACK_SPLIT: 'FULLSTACK_SPLIT',
    HYBRID_PLATFORM: 'HYBRID_PLATFORM' // Fallback
};

class DeploymentStrategyResolver {

    /**
     * resolve(analysis)
     * Maps the ProjectAnalyzer result to a deployment strategy and its specs.
     */
    static resolve(analysis) {
        if (!analysis || !analysis.strategy) {
            return {
                strategy: Strategies.CONTAINER, // Default safe fallback
                reason: "No analysis provided, defaulting to CONTAINER"
            };
        }

        console.log(`[DeploymentStrategyResolver] 🏛️ Resolving Strategy for: ${analysis.strategy}`);

        switch (analysis.strategy) {
            case 'STATIC':
                return this.resolveStatic(analysis);

            case 'CONTAINER':
                return this.resolveContainer(analysis);

            case 'SERVERLESS':
                return this.resolveServerless(analysis);

            case 'FULLSTACK_SPLIT':
                return this.resolveSplit(analysis);

            default:
                return {
                    strategy: Strategies.CONTAINER,
                    reason: `Unknown strategy '${analysis.strategy}', defaulting to CONTAINER`
                };
        }
    }

    /**
     * 🟢 STATIC -> S3 + CloudFront
     */
    static resolveStatic(analysis) {
        return {
            strategy: Strategies.STATIC,
            runtime: 'static',
            infrastructure: {
                compute: 'none',
                storage: 's3',
                cdn: 'cloudfront',
                dns: 'route53',
                https: 'acm'
            },
            build: {
                builder: analysis.builder || 'npm',
                command: analysis.buildCommand || 'npm run build',
                outputDir: analysis.outputDir || 'dist'
            }
        };
    }

    /**
     * 🟢 CONTAINER -> ECS Fargate + ALB
     */
    static resolveContainer(analysis) {
        return {
            strategy: Strategies.CONTAINER,
            runtime: analysis.runtime || 'docker',
            infrastructure: {
                compute: 'ecs_fargate',
                cluster: 'default',
                load_balancer: 'alb', // Mandatory for public apps
                registry: 'ecr',
                network: 'vpc_public_private'
            },
            build: {
                builder: 'docker',
                dockerfile: analysis.runtime === 'docker' ? 'existing' : 'generate'
            }
        };
    }

    /**
     * 🟢 SERVERLESS -> Lambda + API Gateway
     */
    static resolveServerless(analysis) {
        return {
            strategy: Strategies.SERVERLESS,
            runtime: analysis.runtime || 'nodejs18.x',
            infrastructure: {
                compute: 'lambda',
                gateway: 'api_gateway',
                permissions: 'iam_execution_role'
            },
            build: {
                builder: 'serverless-framework',
                config: 'serverless.yml'
            }
        };
    }

    /**
     * 🟢 FULLSTACK MATCH -> Split Deployment or Hybrid
     */
    static resolveSplit(analysis) {
        // If it's a Monorepo Split
        return {
            strategy: Strategies.FULLSTACK_SPLIT,
            components: [
                {
                    name: 'frontend',
                    strategy: Strategies.STATIC,
                    path: analysis.structure?.frontend || 'client'
                },
                {
                    name: 'backend',
                    strategy: Strategies.CONTAINER,
                    path: analysis.structure?.backend || 'server'
                }
            ],
            reason: 'Detected separate frontend/backend roots'
        };
    }
}

module.exports = { DeploymentStrategyResolver, Strategies };
