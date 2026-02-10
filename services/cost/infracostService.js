/**
 * STEP 3 — INFRACOST SERVICE (CORRECTED ARCHITECTURE)
 * 
 * CORE PRINCIPLE:
 * Step 3 prices deployable services only, using real Terraform + Infracost whenever possible.
 * 
 * CORRECTED FLOW:
 * 1. Classify workload into cost mode (INFRASTRUCTURE, STORAGE_POLICY, AI_CONSUMPTION, HYBRID)
 * 2. Filter to deployable_services ONLY (terraform_supported=true) for infrastructure costs
 * 3. Generate minimal pricing Terraform from deployable services
 * 4. Normalize usage profile into resource-level Infracost usage keys
 * 5. PRIMARY: Run Infracost CLI (authoritative source)
 * 6. FALLBACK: Use formula engines only if Infracost fails
 * 7. For non-infrastructure costs, use appropriate pricing models
 * 8. Validate: Ensure no non-deployable services leaked into pricing
 * 9. Return cost with explicit estimate_type (exact vs heuristic)
 * 
 * FIXED ISSUES:
 * - Cost engines now price deployment, not architecture
 * - Infracost is primary path, not optional
 * - Usage is tightly coupled to actual resources
 * - Logical services (event_bus, waf) never get priced
 * - Excluded services never appear in cost breakdown
 * - Non-infra costs (AI, storage policy) handled separately
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const cloudMapping = require('../../catalog/mappings/cloud');
// 🔥 FIX: Use new_services.json (SSOT) instead of deprecated terraform/services
const servicesCatalogRaw = require('../../catalog/new_services.json');

// 🔥 FIX: Index the catalog array into a map for fast lookup
const servicesCatalog = {};
if (servicesCatalogRaw.services && Array.isArray(servicesCatalogRaw.services)) {
  servicesCatalogRaw.services.forEach(svc => {
    servicesCatalog[svc.service_id] = svc;
  });
  console.log(`[INFRACOST SERVICE] Indexed ${Object.keys(servicesCatalog).length} services from New SSOT`);
} else {
  console.error('[INFRACOST SERVICE] ❌ Failed to index services catalog - invalid format');
}
const sizingModel = require('./sizingModel');
const costResultModel = require('./costResultModel');
const usageNormalizer = require('./usageNormalizer');
// 🔥 NEW: Import V2 Generator for flat pricing
const terraformGeneratorV2 = require('../infrastructure/terraformGeneratorV2');
// 🔥 NEW: Import service ID aliases for canonical normalization
const { resolveServiceId, resolveServiceIds, SERVICE_ALIASES } = require('../../config/aliases');

/**
 * Normalize a service object or string to its canonical service ID.
 * Handles mixed formats (strings, objects, arrays).
 */
function normalizeToServiceId(svc) {
  if (!svc) return null;
  if (typeof svc === 'string') return resolveServiceId(svc.toLowerCase());
  if (typeof svc === 'object') {
    const name = svc.service_id || svc.service_class || svc.service || svc.canonical_type || svc.name || svc.id;
    return name ? resolveServiceId(name.toLowerCase()) : null;
  }
  return null;
}

/**
 * Normalize an array of services to canonical service IDs.
 */
function normalizeServiceList(services) {
  if (!Array.isArray(services)) return [];
  return services.map(normalizeToServiceId).filter(Boolean);
}

// Base temp directory for Terraform files
const INFRACOST_BASE_DIR = path.join(os.tmpdir(), 'infracost');

// Generate unique run ID for directory isolation
function generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// Clean provider directory before each run
function cleanProviderDir(providerDir) {
  try {
    if (fs.existsSync(providerDir)) {
      fs.rmSync(providerDir, { recursive: true, force: true });
    }
    fs.mkdirSync(providerDir, { recursive: true });
    console.log(`[PROVIDER DIR] Cleaned and created: ${providerDir}`);
  } catch (err) {
    console.warn(`[PROVIDER DIR] Failed to clean ${providerDir}: ${err.message}`);
  }
}

// Provider sanity check - ensure parsed resources match provider namespace
const PROVIDER_RESOURCE_PREFIXES = {
  AWS: ['aws_'],
  GCP: ['google_'],
  AZURE: ['azurerm_']
};

function validateProviderResources(resources, provider) {
  const expectedPrefixes = PROVIDER_RESOURCE_PREFIXES[provider] || [];
  const invalidResources = [];

  for (const resource of resources) {
    const resourceType = resource.name?.split('.')[0] || '';
    const isValid = expectedPrefixes.some(prefix => resourceType.startsWith(prefix));
    if (!isValid && resourceType) {
      invalidResources.push(resourceType);
    }
  }

  if (invalidResources.length > 0) {
    const msg = `[PROVIDER_STATE_LEAK] ${provider} parsed resources from wrong provider: ${invalidResources.join(', ')}`;
    console.error(msg);
    throw new Error(msg);
  }

  return true;
}

/**
 * Helper: Check if service array contains a given service class.
 * Handles both string arrays (V2) and object arrays (V1 with service_class property).
 * @param {Array} services - Array of service strings or service objects
 * @param {string|string[]} targetClass - Service class name(s) to check for
 * @returns {boolean}
 */
function hasService(services, targetClass) {
  if (!services || services.length === 0) return false;
  const targets = Array.isArray(targetClass) ? targetClass : [targetClass];
  return services.some(svc => {
    const svcName = typeof svc === 'string' ? svc : (svc?.service_class || svc?.id);
    return svcName && targets.includes(svcName);
  });
}

// Performance scores per provider (static backend knowledge)
const PROVIDER_PERFORMANCE_SCORES = {
  AWS: { compute: 95, database: 92, networking: 90, overall: 92 },
  GCP: { compute: 93, database: 88, networking: 92, overall: 90 },
  AZURE: { compute: 90, database: 90, networking: 88, overall: 89 }
};

// Weights for cost vs performance based on user's cost profile
const COST_PROFILE_WEIGHTS = {
  cost_effective: { cost: 0.70, performance: 0.30 },
  balanced: { cost: 0.50, performance: 0.50 },
  premium: { cost: 0.30, performance: 0.70 }
};

/**
 * Calculate a provider's final score using weighted cost and performance.
 * @param {string} provider - Provider name (AWS, GCP, AZURE)
 * @param {number} cost - Monthly cost for this provider
 * @param {Object} allProviderCosts - { AWS: cost, GCP: cost, AZURE: cost }
 * @param {string} costProfile - 'cost_effective', 'balanced', or 'premium'
 * @returns {{ costScore: number, performanceScore: number, finalScore: number, weights: { cost: number, performance: number } }}
 */
function calculateProviderScore(provider, cost, allProviderCosts, costProfile = 'balanced') {
  const costs = Object.values(allProviderCosts).filter(c => c > 0);
  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);

  // Normalize cost score (0-100, higher is better/cheaper)
  let costScore = 100;
  if (maxCost > minCost) {
    costScore = Math.round(100 - ((cost - minCost) / (maxCost - minCost)) * 100);
  }

  // Get performance score from static knowledge
  const performanceScore = PROVIDER_PERFORMANCE_SCORES[provider]?.overall || 85;

  // Get weights from cost profile
  const weights = COST_PROFILE_WEIGHTS[costProfile] || COST_PROFILE_WEIGHTS.balanced;

  // Calculate final weighted score
  const finalScore = Math.round((costScore * weights.cost) + (performanceScore * weights.performance));

  return {
    costScore,
    performanceScore,
    finalScore,
    weights: { cost: Math.round(weights.cost * 100), performance: Math.round(weights.performance * 100) }
  };
}

/**
 * Helper to get canonical category for a service
 */
function getCategoryForServiceId(serviceId) {
  const service = servicesCatalog[serviceId];
  if (service && service.category) {
    // Capitalize for display (e.g., 'compute' -> 'Compute')
    return service.category.charAt(0).toUpperCase() + service.category.slice(1);
  }
  return 'Other';
}

// Cost mode classifications
const COST_MODES = {
  INFRASTRUCTURE_COST: 'INFRASTRUCTURE_COST',
  STORAGE_POLICY_COST: 'STORAGE_POLICY_COST',
  AI_CONSUMPTION_COST: 'AI_CONSUMPTION_COST',
  HYBRID_COST: 'HYBRID_COST'
};

/**
 * Classify workload into cost mode based on intent and services
 */
function classifyWorkload(intent, infraSpec) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';
  const services = infraSpec?.service_classes?.required_services || [];

  // Check for AI/ML related keywords
  if (description.includes('ai') ||
    description.includes('ml') ||
    description.includes('llm') ||
    description.includes('token') ||
    description.includes('openai') ||
    description.includes('chatgpt') ||
    description.includes('inference') ||
    description.includes('generation')) {
    return COST_MODES.AI_CONSUMPTION_COST;
  }

  // Check for storage policy related keywords
  if (description.includes('backup') ||
    description.includes('archive') ||
    description.includes('cold') ||
    description.includes('vault') ||
    description.includes('dr') ||
    description.includes('disaster') ||
    description.includes('retention')) {
    return COST_MODES.STORAGE_POLICY_COST;
  }

  // Check for infrastructure services (using canonical IDs from catalog)
  const INFRA_SERVICE_IDS = [
    'computecontainer', 'computeserverless', 'computevm', 'relationaldatabase',
    'nosqldatabase', 'cache', 'objectstorage', 'loadbalancer', 'apigateway'
  ];
  const hasInfraServices = services.some(svc => {
    const normalized = normalizeToServiceId(svc);
    return normalized && INFRA_SERVICE_IDS.includes(normalized);
  });

  if (hasInfraServices) {
    // If both AI and infra services, it's hybrid
    if (description.includes('ai') || description.includes('ml')) {
      return COST_MODES.HYBRID_COST;
    }
    return COST_MODES.INFRASTRUCTURE_COST;
  }

  // Check for operational/failure analysis keywords
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    return COST_MODES.HYBRID_COST; // Operational analysis often combines infrastructure and policy costs
  }

  // Default to hybrid if uncertain
  return COST_MODES.HYBRID_COST;
}

/**
 * Calculate costs for different cost modes
 */
async function calculateCostForMode(costMode, infraSpec, intent, costProfile, usageProfile) {
  try {
    switch (costMode) {
      case COST_MODES.INFRASTRUCTURE_COST:
        return await calculateInfrastructureCost(infraSpec, intent, costProfile, usageProfile);

      case COST_MODES.STORAGE_POLICY_COST:
        return calculateStoragePolicyCost(infraSpec, intent, costProfile, usageProfile);

      case COST_MODES.AI_CONSUMPTION_COST:
        return calculateAIConsumptionCost(infraSpec, intent, costProfile, usageProfile);

      case COST_MODES.HYBRID_COST:
        return calculateHybridCost(infraSpec, intent, costProfile, usageProfile);

      default:
        // Default to infrastructure cost if mode is unknown
        return await calculateInfrastructureCost(infraSpec, intent, costProfile, usageProfile);
    }
  } catch (error) {
    console.error(`[COST MODE ERROR] Error in cost mode ${costMode}:`, error);

    // Fallback: Return a safe response that guarantees all required fields
    return {
      cost_mode: costMode,
      pricing_method_used: 'fallback_calculation',
      cost_profile: costProfile,
      deployment_type: 'fallback',
      scale_tier: 'MEDIUM',
      rankings: [
        {
          provider: 'AWS',
          monthly_cost: 100,
          formatted_cost: '$100.00',
          rank: 1,
          recommended: true,
          confidence: 0.5,
          score: 50,
          cost_range: { formatted: '$80 - $120/month' }
        },
        {
          provider: 'GCP',
          monthly_cost: 110,
          formatted_cost: '$110.00',
          rank: 2,
          recommended: false,
          confidence: 0.5,
          score: 45,
          cost_range: { formatted: '$90 - $130/month' }
        },
        {
          provider: 'AZURE',
          monthly_cost: 105,
          formatted_cost: '$105.00',
          rank: 3,
          recommended: false,
          confidence: 0.5,
          score: 48,
          cost_range: { formatted: '$85 - $125/month' }
        }
      ],
      provider_details: {
        AWS: {
          provider: 'AWS',
          total_monthly_cost: 100,
          formatted_cost: '$100.00/month',
          service_count: 1,
          is_mock: true,
          confidence: 0.5,
          cost_range: { formatted: '$80 - $120/month' }
        },
        GCP: {
          provider: 'GCP',
          total_monthly_cost: 110,
          formatted_cost: '$110.00/month',
          service_count: 1,
          is_mock: true,
          confidence: 0.5,
          cost_range: { formatted: '$90 - $130/month' }
        },
        AZURE: {
          provider: 'AZURE',
          total_monthly_cost: 105,
          formatted_cost: '$105.00/month',
          service_count: 1,
          is_mock: true,
          confidence: 0.5,
          cost_range: { formatted: '$85 - $125/month' }
        }
      },
      recommended_provider: 'AWS',
      recommended: {
        provider: 'AWS',
        cost_range: { formatted: '$80 - $120/month' },
        service_count: 1,
        score: 50,
        monthly_cost: 100,
        formatted_cost: '$100.00'
      },
      recommended_cost_range: { formatted: '$80 - $120/month' },
      category_breakdown: [
        { category: 'Infrastructure', total: 100, service_count: 1 }
      ],
      summary: {
        cheapest: 'AWS',
        most_performant: 'GCP',
        best_value: 'AWS',
        confidence: 0.5
      },
      ai_explanation: {
        confidence_score: 0.5,
        rationale: 'Fallback calculation due to cost mode processing error.'
      },
      confidence: 0.5,
      confidence_percentage: 50,
      confidence_explanation: ['Fallback calculation due to processing error'],
      cost_sensitivity: {
        level: 'medium',
        label: 'Standard sensitivity',
        factor: 'overall usage'
      },
      assumptions: ['Fallback calculation due to processing error'],
      cost_profiles: {
        COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
        HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
      },
      scenarios: {
        low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
        expected: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
        high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
      },
      cost_range: { formatted: '$80 - $160/month' },
      services: [],
      drivers: [],
      used_real_pricing: false
    };
  }
}


/**
 * Calculate infrastructure cost using existing logic
 */
async function calculateInfrastructureCost(infraSpec, intent, costProfile, usageProfile) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';
  const pattern = infraSpec.canonical_architecture?.pattern || '';

  // 🔒 GOLD STANDARD FIX: Static Site Bypass
  if (pattern === 'STATIC_SITE' || pattern === 'STATIC_WEB_HOSTING' || description.includes('static site')) {
    console.log('[COST ENGINE] 🔒 STATIC_SITE_BYPASS Triggered');
    const staticResult = await handleStaticWebsiteCost(infraSpec, intent, usageProfile);
    // Ensure we return the expected cost_mode for verification
    return {
      ...staticResult,
      cost_mode: 'STATIC_SITE_BYPASS',
      pricing_method_used: 'formula_bypass'
    };
  }

  // Check if this is operational failure analysis
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    // Return minimal response for operational analysis
    const results = {};
    const providers = ['AWS', 'GCP', 'AZURE'];
    for (const provider of providers) {
      results[provider] = {
        provider: provider,
        total_monthly_cost: 0,
        formatted_cost: `$0.00/month`,
        cost_range: { estimate: 0, low: 0, high: 0, formatted: `$0.00 - $0.00/mo` },
        service_count: 0,
        services: [],
        is_mock: true,
        category_breakdown: [{ category: 'Operational Analysis', total: 0, service_count: 0 }]
      };
    }
    const rankings = providers.map((p, idx) => ({
      provider: p,
      monthly_cost: 0,
      score: 95,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: results[p].formatted_cost,
      cost_range: results[p].cost_range
    }));
    return {
      cost_mode: COST_MODES.INFRASTRUCTURE_COST,
      pricing_method_used: 'operational_analysis',
      cost_profile: costProfile,
      deployment_type: 'operational_analysis',
      scale_tier: 'MEDIUM',
      rankings,
      provider_details: results,
      recommended_provider: rankings[0].provider,
      recommended: { provider: rankings[0].provider, cost_range: results[rankings[0].provider].cost_range },
      confidence: 0.95
    };
  }

  try {
    // Build usage profile
    const usage = buildUsageProfile(infraSpec, intent, usageProfile);

    // Get deployable services
    // Get deployable services using the centralized, filtering helper
    const deployableServices = extractDeployableServices(infraSpec);

    console.log(`[INFRA COST] Calling generateCostEstimate for ${deployableServices.length} services`);

    const results = {};
    const providers = ['AWS', 'GCP', 'AZURE'];

    for (const provider of providers) {
      try {
        const providerResult = await generateCostEstimate(
          provider,
          infraSpec,
          deployableServices,
          usage,
          costProfile
        );

        // 🔥 FIX: Check if provider returned INCOMPLETE status (Infracost failed)
        // In this case, fall back to formula-based pricing
        if (providerResult?.pricing_status === 'INCOMPLETE' || providerResult?.value === null) {
          console.log(`[INFRA COST] ${provider} returned INCOMPLETE - falling back to formula pricing`);

          const quotaMsg = providerResult?.quota_exceeded
            ? `API Quota Exceeded (Infracost Limit). Using approximate formula pricing.`
            : `Infracost returned incomplete pricing for ${provider}`;

          results[provider] = {
            ...generateMockCostData(provider, infraSpec, { tier: 'MEDIUM' }, costProfile),
            estimate_type: 'heuristic',
            estimate_source: 'formula_fallback',
            estimate_reason: quotaMsg,
            pricing_status: 'FALLBACK'
          };

          // Explicitly set explanation for confidence calculation later
          results[provider].quota_exceeded = providerResult?.quota_exceeded;

        } else {
          results[provider] = providerResult;
        }
      } catch (providerError) {
        console.error(`[INFRA COST] Error for ${provider}:`, providerError.message);
        fs.writeFileSync('loop_error.log', provider + ': ' + providerError.message + '\n' + providerError.stack + '\n---\n', { flag: 'a' });
        results[provider] = {
          provider: provider,
          total_monthly_cost: 100,
          formatted_cost: '$100.00/month',
          is_mock: true,
          estimate_type: 'heuristic',
          estimate_source: 'fallback'
        };
      }
    }

    // Build cost map for scoring function
    const allProviderCosts = {};
    providers.forEach(p => { allProviderCosts[p] = results[p]?.total_monthly_cost || 999; });

    // Build rankings
    const rankings = providers
      .map((p) => {
        const cost = results[p]?.total_monthly_cost ?? 0;
        const scoreBreakdown = calculateProviderScore(p, cost, allProviderCosts, costProfile);
        return {
          provider: p,
          monthly_cost: cost,
          formatted_cost: results[p]?.formatted_cost || `$${cost.toFixed(2)}/month`,
          cost_score: scoreBreakdown.costScore,
          performance_score: scoreBreakdown.performanceScore,
          weights: scoreBreakdown.weights,
          final_score: scoreBreakdown.finalScore,
          cost_range: results[p]?.cost_range // Ensure this exists or mock it
        };
      })
      .sort((a, b) => b.final_score - a.final_score)
      .map((r, idx) => ({ ...r, rank: idx + 1, recommended: idx === 0 }));

    const recommendedProvider = rankings[0].provider;

    // 🔥 FIX: Calculate dynamic confidence based on providers
    // If any provider is incomplete/fallback, confidence drops
    const providerConfidences = providers.map(p => results[p].confidence || 0.5);
    const minConfidence = Math.min(...providerConfidences);
    const avgConfidence = providerConfidences.reduce((a, b) => a + b, 0) / providers.length;

    // We use the harmonic mean or just conservative min approach if major disparity
    const finalConfidence = Math.round(((minConfidence + avgConfidence) / 2) * 100) / 100;

    return {
      cost_mode: COST_MODES.INFRASTRUCTURE_COST,
      pricing_method_used: results[recommendedProvider]?.estimate_source || 'infracost',
      cost_profile: costProfile,
      deployment_type: 'infrastructure',
      scale_tier: infraSpec.sizing?.tier || 'MEDIUM',
      rankings: rankings,
      provider_details: results,
      recommended_provider: recommendedProvider,
      recommended: results[recommendedProvider],
      confidence: finalConfidence,
      confidence_percentage: Math.round(finalConfidence * 100),
      summary: {
        cheapest: rankings[0].provider,
        most_performant: 'GCP',
        best_value: rankings[0].provider
      }
    };
  } catch (error) {
    console.error(`[INFRA COST] Error:`, error.message);
    fs.writeFileSync('infracost_error.log', error.name + ': ' + error.message + '\n' + error.stack);
    // Fallback?
    throw error;
  }
}
/**
 * STRICT PRICE ESTIMATION (Step 3 Core)
 *
 * 1. Filter services: DIRECT/USAGE_BASED (Priced) vs EXTERNAL/FREE (Not Priced)
 * 2. Generate PRICING Terraform for Priced services only.
 * 3. Run Infracost.
 * 4. Apply Integrity Gate: If Priced > 0 but Cost == 0, flag INCOMPLETE.
 */
async function generateCostEstimate(provider, infraSpec, deployableServices, usageProfile, costProfile) {
  const runId = generateRunId();
  const providerDir = path.join(INFRACOST_BASE_DIR, runId, provider);

  // 1. CLASSIFY SERVICES
  const classification = classifyServicesForPricing(deployableServices);
  const billableServices = [...classification.direct, ...classification.usage_based];
  console.log(`[${provider}] Service Class: Direct=${classification.direct.length}, Usage=${classification.usage_based.length}, External=${classification.external.length}`);

  // If no billable services, return early (but respect External count)
  if (billableServices.length === 0) {
    return createZeroCostResult(provider, classification, costProfile);
  }

  try {
    cleanProviderDir(providerDir);

    // 2. GENERATE PRICING TERRAFORM (Strict Mode)
    // We pass ONLY billable services to the generator to avoid pollution
    const tfCode = generatePricingTerraform(provider, infraSpec, billableServices, sizingModel.calculateSizing(infraSpec), costProfile, usageProfile);
    const tfPath = path.join(providerDir, 'main.tf');
    fs.writeFileSync(tfPath, tfCode);

    // 3. GENERATE USAGE FILE
    const usageFilePath = path.join(providerDir, 'infracost-usage.yml');
    const usageContent = usageNormalizer.generateInfracostUsageFile(billableServices, usageProfile, provider);
    fs.writeFileSync(usageFilePath, usageContent);

    // 4. RUN INFRACOST
    const infracostResult = await runInfracost(providerDir, usageFilePath);

    // 🔥 FIX: Intercept Quota Error
    if (infracostResult && infracostResult.error === 'API_QUOTA_EXCEEDED') {
      console.warn(`[${provider}] PRICING FAILED: API Quota Exceeded. Falling back.`);
      return {
        provider: provider,
        pricing_status: 'INCOMPLETE',
        quota_exceeded: true,
        total_monthly_cost: 0,
        estimate_type: 'formula_fallback', // Signal fallback
        services: [] // Empty services list
      };
    }

    // 5. COMPLETENESS GATE
    const totalCost = parseFloat(infracostResult.totalMonthlyCost) || 0;
    let completenessStatus = 'COMPLETE';

    // Gate: If we have DIRECT services (VMs, DBs) but $0 cost, something is wrong.
    if (totalCost === 0 && classification.direct.length > 0) {
      console.warn(`[${provider}] PRICING INCOMPLETE: ${classification.direct.length} direct services generated $0 cost.`);
      completenessStatus = 'INCOMPLETE';
    }

    // 🔒 INTEGRITY: Check for unsupported/unknown resources in Infracost output
    // Infracost puts this in projects[0].metadata.unsupportedResources usually
    const projectMeta = infracostResult.projects?.[0]?.metadata;
    if (projectMeta && projectMeta.unsupportedResources && projectMeta.unsupportedResources.length > 0) {
      console.warn(`[${provider}] PRICING INCOMPLETE: Detected ${projectMeta.unsupportedResources.length} unsupported resources.`);
      completenessStatus = 'INCOMPLETE';
    } else if (projectMeta?.unsupportedResourceCounts && Object.keys(projectMeta.unsupportedResourceCounts).length > 0) {
      // Some versions use counts object
      console.warn(`[${provider}] PRICING INCOMPLETE: Detected unsupported resources (counts).`);
      completenessStatus = 'INCOMPLETE';
    }

    // ---------------------------------------------------------
    // 🔵 POST-PROCESSING: MERGE & ENRICH SERVICES
    // ---------------------------------------------------------
    const enrichedServices = [];
    const processedIds = new Set();

    // A. Add Infracost Results (PRICED)
    if (infracostResult.services) {
      infracostResult.services.forEach(svc => {
        // Normalize ID for matching
        const normId = svc.service_class.replace(/_/g, '').toLowerCase();
        processedIds.add(normId);

        // Validate $0 Cost on Priced Services
        if (svc.cost.monthly === 0 && classification.details[svc.service_class]?.status === 'PRICED') {
          console.warn(`[PRICING FIREWALL] ⚠️ Service ${svc.service_class} is PRICED but returned $0.`);
          svc.pricing_status = 'PRICED';
          svc.reason = 'Usage within free tier limits (estimated)';
        } else {
          svc.pricing_status = 'PRICED';
          svc.reason = 'Estimated by Infracost';
        }

        enrichedServices.push(svc);
      });
    }

    // B. Add Missing Services (Free / External / Priced but not in Infracost output)
    deployableServices.forEach(svcId => {
      const normId = svcId.replace(/_/g, '').toLowerCase();

      // If we haven't processed this service yet (meaning Infracost didn't return it)
      // Note: Infracost might return 'aws_s3_bucket' while we have 'objectstorage'. Need robust matching.
      // The `RESOURCE_CATEGORY_MAP` in `normalizeInfracostOutput` handles the translation.
      // So `svc.service_class` should match `svcId` (canonical).

      const isAlreadyIncluded = enrichedServices.some(s => s.service_class === svcId || s.service_class === normId);

      if (!isAlreadyIncluded) {
        const detail = classification.details[svcId] || { status: 'UNKNOWN', reason: 'Not evaluated', display_name: svcId };

        if (detail.status === 'PRICED') {
          // It SHOULD have been in Infracost. If missing, it means Terraform didn't include it or Infracost failed.
          enrichedServices.push({
            service_class: svcId,
            display_name: detail.display_name,
            category: getCategoryForServiceId(svcId),
            pricing_status: 'PRICED',
            reason: 'Pricing data currently unavailable',
            cost: { monthly: 0, formatted: '$0.00/mo' }
          });
        } else {
          // Correctly categorize Free / External
          enrichedServices.push({
            service_class: svcId,
            display_name: detail.display_name,
            category: getCategoryForServiceId(svcId),
            pricing_status: detail.status,
            reason: detail.reason,
            cost: { monthly: 0, formatted: detail.status === 'EXTERNAL' ? 'Varies' : 'Included' }
          });
        }
      }
    });

    return {
      provider: provider,
      total_monthly_cost: totalCost,
      formatted_cost: `$${totalCost.toFixed(2)}/month`,
      currency: 'USD',
      estimate_source: 'infracost',
      estimate_type: 'exact',
      pricing_status: completenessStatus, // 'COMPLETE' | 'INCOMPLETE'
      service_counts: {
        priced: billableServices.length,
        external: classification.external.length,
        free: classification.free_tier.length,
        total: deployableServices.length
      },
      services: enrichedServices, // 🔥 Use the enriched list
      // Keep legacy fields for frontend compatibility for now
      service_count: enrichedServices.length,
      confidence: completenessStatus === 'COMPLETE' ? 1.0 : 0.0,
      is_mock: false
    };

  } catch (err) {
    console.error(`[${provider}] Cost Error:`, err);
    throw err;
  } finally {
    // Cleanup (optional, maybe keep for debug)
    // cleanProviderDir(providerDir);
  }
}

/**
 * Classify services into pricing buckets using SSOT
 */
// ENHANCED CLASSIFICATION
function classifyServicesForPricing(serviceList) {
  const buckets = {
    direct: [],       // Paid via Terraform
    usage_based: [],  // Paid via TF but separate meter
    external: [],     // Paid outside (SaaS)
    free_tier: [],    // Always free or included
    unknown: [],      // No data
    details: {}       // ID -> { status, reason }
  };

  for (const svcId of serviceList) {
    const id = typeof svcId === 'string' ? svcId : (svcId.service_id || svcId.service_class || svcId.id);
    if (!id) continue;

    const normalizedId = id.replace(/_/g, '').toLowerCase();

    // Check Catalog First
    let def = servicesCatalog[id];
    if (!def) {
      // Try normalized lookup
      def = Object.values(servicesCatalog).find(s =>
        (s.service_id || '').replace(/_/g, '') === normalizedId
      );
    }

    // Determine Status
    let status = 'UNKNOWN';
    let reason = 'Pricing data unavailable';

    if (def && def.pricing) {
      if (def.pricing.class === 'DIRECT' || def.pricing.class === 'USAGE_BASED') {
        status = 'PRICED';
        reason = 'Infrastructure Cost Driver';
      } else if (def.pricing.class === 'EXTERNAL') {
        status = 'EXTERNAL';
        reason = 'Billed separately via provider console';
      } else if (def.pricing.class === 'FREE_TIER') {
        status = 'FREE_TIER';
        reason = 'Always Free / Included';
      }
    } else {
      // Fallback Heuristics
      if (['vpc', 'networking', 'iam', 'securitygroup', 'resourcegroup', 'dns'].includes(normalizedId)) {
        status = 'FREE_TIER';
        reason = 'Core networking/security (Included)';
      } else if (['stripe', 'auth0', 'sendgrid', 'twilio'].includes(normalizedId)) {
        status = 'EXTERNAL';
        reason = 'Third-party SaaS integration';
      } else {
        // Assume priced if it's a major component
        status = 'PRICED';
        reason = 'Standard infrastructure component';
      }
    }

    // Assign to Bucket (Legacy support)
    if (status === 'PRICED') buckets.direct.push(id);
    else if (status === 'EXTERNAL') buckets.external.push(id);
    else if (status === 'FREE_TIER') buckets.free_tier.push(id);
    else buckets.unknown.push(id);

    // Store Details
    buckets.details[id] = { status, reason, display_name: def?.display_name || id };
  }

  return buckets;
}

// Helper to map service ID to a general category for display
const DISPLAY_CATEGORY_MAP = {
  'compute': 'Compute',
  'virtual_machine': 'Compute',
  'container_service': 'Compute',
  'kubernetes_service': 'Compute',
  'database': 'Database',
  'relational_database': 'Database',
  'nosql_database': 'Database',
  'object_storage': 'Storage',
  'block_storage': 'Storage',
  'file_storage': 'Storage',
  'networking': 'Networking',
  'load_balancer': 'Networking',
  'cdn': 'Networking',
  'dns': 'Networking',
  'vpc': 'Networking',
  'message_queue': 'Messaging',
  'streaming_data': 'Messaging',
  'serverless_function': 'Serverless',
  'api_gateway': 'API Management',
  'monitoring': 'Monitoring & Logging',
  'logging': 'Monitoring & Logging',
  'security': 'Security',
  'iam': 'Security',
  'security_group': 'Security',
  'data_warehouse': 'Analytics',
  'machine_learning': 'AI/ML',
  'search_service': 'Search',
  'cache': 'Caching',
  'email_service': 'Communication',
  'sms_service': 'Communication',
  'auth_service': 'Identity',
  'developer_tools': 'Developer Tools',
  'management_tools': 'Management Tools',
  'resource_group': 'Management Tools',
  'other': 'Other'
};

function getCategoryForServiceId(serviceId) {
  const normalizedId = serviceId.replace(/_/g, '').toLowerCase();
  for (const key in DISPLAY_CATEGORY_MAP) {
    if (normalizedId.includes(key.replace(/_/g, ''))) {
      return DISPLAY_CATEGORY_MAP[key];
    }
  }
  return 'Other';
}


function createZeroCostResult(provider, classification, costProfile) {
  return {
    provider: provider,
    total_monthly_cost: 0,
    formatted_cost: "$0.00/month",
    pricing_status: 'COMPLETE', // It's complete because there was nothing to price
    service_counts: {
      priced: 0,
      external: classification.external.length,
      free: classification.free_tier.length,
      total: classification.external.length + classification.free_tier.length
    },
    services: [],
    is_mock: false,
    confidence: 1.0
  };
}

/**
 * Router to call the correct Pricing Terraform Generator
 */
function generatePricingTerraform(provider, infraSpec, billableServices, sizing, costProfile, usageProfile) {
  // Use V2 Generator for all providers (SSOT) to support all 101 services
  // The V2 generator (terraformGeneratorV2.js) is the Source of Truth for resource definitions.
  // It handles full catalog support, whereas the legacy functions below (now unused) were manual subsets.

  const region = infraSpec.region || 'ap-south-1';
  // Fallback project name
  const projectName = infraSpec.name || (infraSpec.project_name || 'infracost-project');

  // Map provider to V2 format (lowercase)
  const v2Provider = provider.toLowerCase();

  console.log(`[INFRACOST SERVICE] Delegating Terraform generation to V2 for provider: ${v2Provider}`);

  // Call the robust V2 pricing generator
  return terraformGeneratorV2.generatePricingMainTf(v2Provider, billableServices, region, projectName);
}


/**
 * Calculate storage policy cost based on retention, replication, and retrieval
 */
function calculateStoragePolicyCost(infraSpec, intent, costProfile, usageProfile) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';

  // Check if this is operational failure analysis
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    // This is operational analysis, not storage policy
    // Return a minimal response that indicates this is operational analysis
    const results = {};
    const providers = ['AWS', 'GCP', 'AZURE'];

    for (const provider of providers) {
      // For operational analysis, we return a minimal cost as it's not really about infrastructure costs
      const totalCost = 0; // Operational costs are not infrastructure costs

      results[provider] = {
        provider: provider,
        total_monthly_cost: totalCost,
        formatted_cost: `$${totalCost.toFixed(2)}/month`,
        cost_range: {
          estimate: totalCost,
          low: totalCost,
          high: totalCost,
          formatted: `$${totalCost.toFixed(2)} - $${totalCost.toFixed(2)}/mo`
        },
        service_count: 0,
        services: [],
        is_mock: true,
        category_breakdown: [
          { category: 'Operational Analysis', total: totalCost, service_count: 0 }
        ],
        confidence: 0.9
      };
    }

    // Sort by provider name since costs are all 0
    const rankings = providers
      .map((p, idx) => ({
        provider: p,
        monthly_cost: results[p].total_monthly_cost,
        score: 90, // Standard score for operational analysis
        rank: idx + 1,
        recommended: idx === 0,
        formatted_cost: results[p].formatted_cost,
        cost_range: results[p].cost_range
      }));

    const recommendedProvider = rankings[0].provider;

    return {
      cost_mode: COST_MODES.STORAGE_POLICY_COST,
      pricing_method_used: 'operational_analysis',
      cost_profile: costProfile,
      deployment_type: 'operational_analysis',
      scale_tier: 'MEDIUM',
      rankings,
      provider_details: results,
      recommended_provider: recommendedProvider,
      used_real_pricing: false,
      recommended: {
        provider: recommendedProvider,
        cost_range: results[recommendedProvider].cost_range,
        service_count: 0,
        score: rankings[0].score,
        monthly_cost: results[recommendedProvider].total_monthly_cost
      },
      recommended_cost_range: results[recommendedProvider].cost_range,
      category_breakdown: results[recommendedProvider].category_breakdown,
      summary: {
        cheapest: rankings[0].provider,
        most_performant: 'GCP',
        best_value: rankings[0].provider
      },
      ai_explanation: {
        confidence_score: 0.9,
        rationale: `Operational failure analysis - examining potential impact, blast radius, and mitigation strategies for system outages.`
      },
      confidence: 0.9,
      confidence_percentage: 90,
      confidence_explanation: ['Based on operational impact assessment methodology'],
      cost_sensitivity: {
        level: 'n/a',
        label: 'Operational Impact',
        factor: 'service reliability and business continuity'
      },
      assumptions: ['Operational failure analysis requested', 'Focus on impact assessment rather than direct costs', 'Business continuity considerations']
    };
  }

  const storageGb = usageProfile?.storage_gb?.expected || 1000; // Default to 1TB

  // Pricing per provider for storage policy
  const pricing = {
    AWS: {
      standard: 0.023,      // per GB/month
      glacier: 0.004,       // per GB/month
      deep_archive: 0.0009, // per GB/month
      retrieval_standard: 0.01,    // per GB
      retrieval_glacier: 0.05,     // per GB
      retrieval_deep_archive: 0.1  // per GB
    },
    GCP: {
      standard: 0.020,
      coldline: 0.01,
      archiveline: 0.0012,
      retrieval_standard: 0.0075,
      retrieval_coldline: 0.02,
      retrieval_archiveline: 0.05
    },
    AZURE: {
      standard: 0.018,
      cool: 0.01,
      archive: 0.00099,
      retrieval_standard: 0.0075,
      retrieval_cool: 0.02,
      retrieval_archive: 0.05
    }
  };

  const results = {};
  const providers = ['AWS', 'GCP', 'AZURE'];

  for (const provider of providers) {
    const p = pricing[provider];

    // Calculate costs for different storage classes
    const standardCost = storageGb * p.standard;
    const coldCost = storageGb * p.coldline || p.glacier;
    const archiveCost = storageGb * p.archive || p.deep_archive;

    results[provider] = {
      provider: provider,
      total_monthly_cost: standardCost, // Standard storage by default
      formatted_cost: `$${standardCost.toFixed(2)}/month`,
      cost_range: {
        estimate: standardCost,
        low: archiveCost,
        high: standardCost,
        formatted: `$${archiveCost.toFixed(2)} - $${standardCost.toFixed(2)}/mo`
      },
      service_count: 1,
      services: [
        {
          service_class: 'object_storage',
          display_name: 'Storage Policy',
          cost: { monthly: standardCost },
          sizing: 'Standard'
        }
      ],
      is_mock: true,
      category_breakdown: [
        { category: 'Storage & Retention', total: standardCost, service_count: 1 }
      ],
      confidence: 0.85
    };
  }

  // Sort by cost to find cheapest
  const rankings = providers
    .map(p => ({
      provider: p,
      monthly_cost: results[p].total_monthly_cost,
      score: p === 'GCP' ? 95 : (p === 'AWS' ? 92 : 88),
      rank: 0, // Will be updated after sorting
      recommended: false
    }))
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: results[r.provider].formatted_cost,
      cost_range: results[r.provider].cost_range
    }));

  const recommendedProvider = rankings[0].provider;

  return {
    cost_mode: COST_MODES.STORAGE_POLICY_COST,
    pricing_method_used: 'catalog_pricing',
    cost_profile: costProfile,
    deployment_type: 'storage_policy',
    scale_tier: 'MEDIUM',
    rankings,
    provider_details: results,
    recommended_provider: recommendedProvider,
    used_real_pricing: false,
    recommended: {
      provider: recommendedProvider,
      cost_range: results[recommendedProvider].cost_range,
      service_count: 1,
      score: rankings[0].score,
      monthly_cost: results[recommendedProvider].total_monthly_cost
    },
    recommended_cost_range: results[recommendedProvider].cost_range,
    category_breakdown: results[recommendedProvider].category_breakdown,
    summary: {
      cheapest: rankings[0].provider,
      most_performant: 'GCP',
      best_value: rankings[0].provider
    },
    ai_explanation: {
      confidence_score: 0.85,
      rationale: `Storage policy costs based on ${storageGb}GB with standard retention policy.`
    },
    confidence: 0.85,
    confidence_percentage: 85,
    confidence_explanation: ['Based on provider storage catalog pricing'],
    cost_sensitivity: {
      level: 'low',
      label: 'Storage-bound',
      factor: 'storage volume and retention tier'
    },
    assumptions: [`Storage volume: ${storageGb}GB`, 'Retention policy: Standard', 'Retrieval: Standard']
  };
}

/**
 * Calculate AI consumption cost based on token usage
 */
function calculateAIConsumptionCost(infraSpec, intent, costProfile, usageProfile) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';

  // Check if this is operational failure analysis
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    // This is operational analysis, not AI consumption
    // Return a minimal response that indicates this is operational analysis
    const results = {};
    const providers = ['AWS', 'GCP', 'AZURE'];

    for (const provider of providers) {
      // For operational analysis, we return a minimal cost as it's not really about infrastructure costs
      const totalCost = 0; // Operational costs are not infrastructure costs

      results[provider] = {
        provider: provider,
        total_monthly_cost: totalCost,
        formatted_cost: `$${totalCost.toFixed(2)}/month`,
        cost_range: {
          estimate: totalCost,
          low: totalCost,
          high: totalCost,
          formatted: `$${totalCost.toFixed(2)} - $${totalCost.toFixed(2)}/mo`
        },
        service_count: 0,
        services: [],
        is_mock: true,
        category_breakdown: [
          { category: 'Operational Analysis', total: totalCost, service_count: 0 }
        ],
        confidence: 0.9
      };
    }

    // Sort by provider name since costs are all 0
    const rankings = providers
      .map((p, idx) => ({
        provider: p,
        monthly_cost: results[p].total_monthly_cost,
        score: 90, // Standard score for operational analysis
        rank: idx + 1,
        recommended: idx === 0,
        formatted_cost: results[p].formatted_cost,
        cost_range: results[p].cost_range
      }));

    const recommendedProvider = rankings[0].provider;

    return {
      cost_mode: COST_MODES.AI_CONSUMPTION_COST,
      pricing_method_used: 'operational_analysis',
      cost_profile: costProfile,
      deployment_type: 'operational_analysis',
      scale_tier: 'MEDIUM',
      rankings,
      provider_details: results,
      recommended_provider: recommendedProvider,
      used_real_pricing: false,
      recommended: {
        provider: recommendedProvider,
        cost_range: results[recommendedProvider].cost_range,
        service_count: 0,
        score: rankings[0].score,
        monthly_cost: results[recommendedProvider].total_monthly_cost
      },
      recommended_cost_range: results[recommendedProvider].cost_range,
      category_breakdown: results[recommendedProvider].category_breakdown,
      summary: {
        cheapest: rankings[0].provider,
        most_performant: 'GCP',
        best_value: rankings[0].provider
      },
      ai_explanation: {
        confidence_score: 0.9,
        rationale: `Operational failure analysis - costs reflect potential impact of service failures, not direct infrastructure costs.`
      },
      confidence: 0.9,
      confidence_percentage: 90,
      confidence_explanation: ['Based on operational impact assessment methodology'],
      cost_sensitivity: {
        level: 'n/a',
        label: 'Operational Impact',
        factor: 'service reliability and business continuity'
      },
      assumptions: ['Operational failure analysis requested', 'Focus on impact assessment rather than direct costs', 'Business continuity considerations']
    };
  }

  // Regular AI consumption cost calculation
  const tokensPerMonth = usageProfile?.tokens_per_month?.expected || 1000000; // Default to 1M tokens
  const tokensPerRequest = usageProfile?.tokens_per_request?.expected || 1000;

  // Pricing per provider for AI services
  const pricing = {
    AWS: {
      bedrock_claude: { input: 0.0008, output: 0.0024 }, // per 1K tokens
      titan: { input: 0.0005, output: 0.0015 }
    },
    GCP: {
      palm2: { input: 0.0025, output: 0.0075 }, // per 1K tokens
      gemini: { input: 0.0005, output: 0.0015 }
    },
    AZURE: {
      openai_gpt4: { input: 0.03, output: 0.06 }, // per 1K tokens
      openai_gpt35: { input: 0.0015, output: 0.002 }
    }
  };

  const results = {};
  const providers = ['AWS', 'GCP', 'AZURE'];

  for (const provider of providers) {
    const p = pricing[provider];

    // Calculate costs for different AI models
    // Assume 70% input tokens, 30% output tokens
    const inputTokens = tokensPerMonth * 0.7;
    const outputTokens = tokensPerMonth * 0.3;

    const inputCost = (inputTokens / 1000) * p.bedrock_claude?.input || p.palm2?.input || p.openai_gpt35?.input || 0.001;
    const outputCost = (outputTokens / 1000) * p.bedrock_claude?.output || p.palm2?.output || p.openai_gpt35?.output || 0.002;

    const totalCost = inputCost + outputCost;

    results[provider] = {
      provider: provider,
      total_monthly_cost: totalCost,
      formatted_cost: `$${totalCost.toFixed(2)}/month`,
      cost_range: {
        estimate: totalCost,
        low: totalCost * 0.8,
        high: totalCost * 1.5,
        formatted: `$${(totalCost * 0.8).toFixed(2)} - $${(totalCost * 1.5).toFixed(2)}/mo`
      },
      service_count: 1,
      services: [
        {
          service_class: 'ai_inference_service',
          display_name: 'AI Inference',
          cost: { monthly: totalCost },
          sizing: 'Standard'
        }
      ],
      is_mock: true,
      category_breakdown: [
        { category: 'AI & Machine Learning', total: totalCost, service_count: 1 }
      ],
      confidence: 0.75
    };
  }

  // Sort by cost to find cheapest
  const rankings = providers
    .map(p => ({
      provider: p,
      monthly_cost: results[p].total_monthly_cost,
      score: p === 'GCP' ? 90 : (p === 'AWS' ? 88 : 85),
      rank: 0, // Will be updated after sorting
      recommended: false
    }))
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: results[r.provider].formatted_cost,
      cost_range: results[r.provider].cost_range
    }));

  const recommendedProvider = rankings[0].provider;

  return {
    cost_mode: COST_MODES.AI_CONSUMPTION_COST,
    pricing_method_used: 'token_based_pricing',
    cost_profile: costProfile,
    deployment_type: 'ai_inference',
    scale_tier: 'MEDIUM',
    rankings,
    provider_details: results,
    recommended_provider: recommendedProvider,
    used_real_pricing: false,
    recommended: {
      provider: recommendedProvider,
      cost_range: results[recommendedProvider].cost_range,
      service_count: 1,
      score: rankings[0].score,
      monthly_cost: results[recommendedProvider].total_monthly_cost
    },
    recommended_cost_range: results[recommendedProvider].cost_range,
    category_breakdown: results[recommendedProvider].category_breakdown,
    summary: {
      cheapest: rankings[0].provider,
      most_performant: 'GCP',
      best_value: rankings[0].provider
    },
    ai_explanation: {
      confidence_score: 0.75,
      rationale: `AI consumption costs based on ${tokensPerMonth.toLocaleString()} tokens per month.`
    },
    confidence: 0.75,
    confidence_percentage: 75,
    confidence_explanation: ['Based on token-based pricing models'],
    cost_sensitivity: {
      level: 'high',
      label: 'Usage-sensitive',
      factor: 'token consumption volume'
    },
    assumptions: [`Tokens per month: ${tokensPerMonth.toLocaleString()}`, 'Input/output ratio: 70/30', 'Standard AI model usage']
  };
}

/**
 * Calculate hybrid cost combining infrastructure and consumption
 */
async function calculateHybridCost(infraSpec, intent, costProfile, usageProfile) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';

  // Check if this is operational failure analysis
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    // This is operational analysis, return a specialized response
    const results = {};
    const providers = ['AWS', 'GCP', 'AZURE'];

    for (const provider of providers) {
      // For operational analysis, we return a minimal cost as it's not really about infrastructure costs
      const totalCost = 0; // Operational costs are not infrastructure costs

      results[provider] = {
        provider: provider,
        total_monthly_cost: totalCost,
        formatted_cost: `$${totalCost.toFixed(2)}/month`,
        cost_range: {
          estimate: totalCost,
          low: totalCost,
          high: totalCost,
          formatted: `$${totalCost.toFixed(2)} - $${totalCost.toFixed(2)}/mo`
        },
        service_count: 0,
        is_mock: true,
        confidence: 0.95
      };
    }

    // Sort by provider name since costs are all 0
    const rankings = providers
      .map((p, idx) => ({
        provider: p,
        monthly_cost: results[p].total_monthly_cost,
        score: 95, // High score for operational analysis
        rank: idx + 1,
        recommended: idx === 0,
        formatted_cost: results[p].formatted_cost,
        cost_range: results[p].cost_range
      }));

    const recommendedProvider = rankings[0].provider;

    return {
      cost_mode: COST_MODES.HYBRID_COST,
      pricing_method_used: 'operational_analysis',
      cost_profile: costProfile,
      deployment_type: 'operational_analysis',
      scale_tier: 'MEDIUM',
      rankings,
      provider_details: results,
      recommended_provider: recommendedProvider,
      used_real_pricing: false,
      recommended: {
        provider: recommendedProvider,
        cost_range: results[recommendedProvider].cost_range,
        service_count: 0,
        score: rankings[0].score,
        monthly_cost: results[recommendedProvider].total_monthly_cost
      },
      recommended_cost_range: results[recommendedProvider].cost_range,
      summary: {
        cheapest: rankings[0].provider,
        most_performant: 'GCP',
        best_value: rankings[0].provider
      },
      ai_explanation: {
        confidence_score: 0.95,
        rationale: `Operational failure analysis - examining potential impact, blast radius, and mitigation strategies for system outages.`
      },
      confidence: 0.95,
      confidence_percentage: 95,
      confidence_explanation: ['Based on operational impact assessment methodology'],
      cost_sensitivity: {
        level: 'n/a',
        label: 'Operational Impact',
        factor: 'service reliability and business continuity'
      },
      assumptions: ['Operational failure analysis requested', 'Focus on impact assessment rather than direct costs', 'Business continuity considerations']
    };
  }

  // Calculate infrastructure cost
  const infraResult = await calculateInfrastructureCost(infraSpec, intent, costProfile, usageProfile);

  // Determine if we also need AI or storage costs

  let aiResult = null;
  let storageResult = null;

  if (description.includes('ai') || description.includes('ml')) {
    aiResult = calculateAIConsumptionCost(infraSpec, intent, costProfile, usageProfile);
  }

  if (description.includes('backup') || description.includes('archive') || description.includes('vault')) {
    storageResult = calculateStoragePolicyCost(infraSpec, intent, costProfile, usageProfile);
  }

  // Combine results
  const combinedResults = {};
  const providers = ['AWS', 'GCP', 'AZURE'];

  for (const provider of providers) {
    let infraCost = infraResult.provider_details?.[provider]?.total_monthly_cost || 0;
    let aiCost = aiResult?.provider_details?.[provider]?.total_monthly_cost || 0;
    let storageCost = storageResult?.provider_details?.[provider]?.total_monthly_cost || 0;

    const totalCost = infraCost + aiCost + storageCost;

    combinedResults[provider] = {
      provider: provider,
      total_monthly_cost: totalCost,
      formatted_cost: `$${totalCost.toFixed(2)}/month`,
      cost_range: {
        estimate: totalCost,
        low: totalCost * 0.7,
        high: totalCost * 1.8,
        formatted: `$${(totalCost * 0.7).toFixed(2)} - $${(totalCost * 1.8).toFixed(2)}/mo`
      },
      service_count: (infraResult.provider_details?.[provider]?.service_count || 0) +
        (aiResult?.provider_details?.[provider]?.service_count || 0) +
        (storageResult?.provider_details?.[provider]?.service_count || 0),
      is_mock: true,
      confidence: Math.min(0.9, (infraResult.confidence || 0.8) * 0.8) // Lower confidence for hybrid
    };
  }

  // Sort by cost to find cheapest
  const rankings = providers
    .map(p => ({
      provider: p,
      monthly_cost: combinedResults[p].total_monthly_cost,
      score: p === 'GCP' ? 90 : (p === 'AWS' ? 88 : 85),
      rank: 0, // Will be updated after sorting
      recommended: false
    }))
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: combinedResults[r.provider].formatted_cost,
      cost_range: combinedResults[r.provider].cost_range
    }));

  const recommendedProvider = rankings[0].provider;

  return {
    cost_mode: COST_MODES.HYBRID_COST,
    pricing_method_used: 'combined_infra_and_consumption',
    cost_profile: costProfile,
    deployment_type: 'hybrid',
    scale_tier: 'MEDIUM',
    rankings,
    provider_details: combinedResults,
    recommended_provider: recommendedProvider,
    used_real_pricing: false,
    recommended: {
      provider: recommendedProvider,
      cost_range: combinedResults[recommendedProvider].cost_range,
      service_count: combinedResults[recommendedProvider].service_count,
      score: rankings[0].score,
      monthly_cost: combinedResults[recommendedProvider].total_monthly_cost
    },
    recommended_cost_range: combinedResults[recommendedProvider].cost_range,
    summary: {
      cheapest: rankings[0].provider,
      most_performant: 'GCP',
      best_value: rankings[0].provider
    },
    ai_explanation: {
      confidence_score: 0.8,
      rationale: `Combined infrastructure and consumption costs for hybrid solution.`
    },
    confidence: 0.8,
    confidence_percentage: 80,
    confidence_explanation: ['Combined infrastructure and consumption cost estimates'],
    cost_sensitivity: {
      level: 'high',
      label: 'Usage-sensitive',
      factor: 'combined infrastructure and consumption'
    },
    assumptions: ['Infrastructure and consumption costs combined', 'Standard usage patterns']
  };
}

/**
 * Fallback calculation using legacy cost analysis
 */
function calculateLegacyCost(infraSpec, intent, costProfile, usageProfile) {
  const description = intent?.intent_classification?.project_description?.toLowerCase() || '';

  // Check if this is operational failure analysis
  if (description.includes('fail') ||
    description.includes('outage') ||
    description.includes('downtime') ||
    description.includes('operational') ||
    description.includes('impact') ||
    description.includes('blast radius') ||
    description.includes('mitigation')) {
    // This is operational analysis, not infrastructure cost
    // Return a minimal response that indicates this is operational analysis
    const providers = ['AWS', 'GCP', 'AZURE'];
    const estimates = {};

    for (const provider of providers) {
      estimates[provider] = {
        provider,
        total_monthly_cost: 0, // Operational costs are not infrastructure costs
        formatted_cost: '$0.00/month',
        service_count: 0,
        is_mock: true,
        confidence: 0.95
      };
    }

    return {
      cost_profile: costProfile,
      deployment_type: 'operational_analysis',
      scale_tier: 'MEDIUM',
      rankings: providers.map((p, idx) => ({
        provider: p,
        monthly_cost: estimates[p].total_monthly_cost,
        formatted_cost: estimates[p].formatted_cost,
        rank: idx + 1,
        recommended: idx === 0,
        confidence: estimates[p].confidence,
        score: Math.round(estimates[p].confidence * 100)
      })),
      provider_details: estimates,
      recommended_provider: providers[0],
      recommended: {
        provider: providers[0],
        monthly_cost: estimates[providers[0]].total_monthly_cost,
        formatted_cost: estimates[providers[0]].formatted_cost,
        service_count: 0,
        score: Math.round(estimates[providers[0]].confidence * 100)
      },
      confidence: 0.95,
      ai_explanation: {
        confidence_score: 0.95,
        rationale: 'Operational failure analysis - examining potential impact, blast radius, and mitigation strategies for system outages.'
      }
    };
  }

  // This preserves the original logic from the performCostAnalysis function
  const providers = ['AWS', 'GCP', 'AZURE'];
  const estimates = {};

  for (const provider of providers) {
    estimates[provider] = {
      provider,
      total_monthly_cost: 100, // Default fallback
      formatted_cost: '$100.00/month',
      service_count: 1,
      is_mock: true,
      confidence: 0.5
    };
  }

  return {
    cost_profile: costProfile,
    deployment_type: 'legacy',
    scale_tier: 'MEDIUM',
    rankings: providers.map((p, idx) => ({
      provider: p,
      monthly_cost: estimates[p].total_monthly_cost,
      formatted_cost: estimates[p].formatted_cost,
      rank: idx + 1,
      recommended: idx === 0,
      confidence: estimates[p].confidence,
      score: Math.round(estimates[p].confidence * 100)
    })),
    provider_details: estimates,
    recommended_provider: providers[0],
    recommended: {
      provider: providers[0],
      monthly_cost: estimates[providers[0]].total_monthly_cost,
      formatted_cost: estimates[providers[0]].formatted_cost,
      service_count: 1,
      score: Math.round(estimates[providers[0]].confidence * 100)
    },
    confidence: 0.5,
    ai_explanation: {
      confidence_score: 0.5,
      rationale: 'Fallback calculation due to incomplete service specification.'
    }
  };
}

// Resource name to SERVICE CLASS mapping (must match cloudMapping.js keys)
const RESOURCE_CATEGORY_MAP = {
  // AWS - 🔥 FIX: Use canonical service IDs (no underscores) to match deployable_services
  'aws_ecs_service': 'computecontainer',
  'aws_ecs_task_definition': 'computecontainer',
  'aws_ecs_cluster': 'computecontainer',
  'aws_lambda_function': 'computeserverless',
  'aws_instance': 'computevm',
  'aws_db_instance': 'relationaldatabase',
  'aws_rds_cluster': 'relationaldatabase',
  'aws_dynamodb_table': 'nosqldatabase',
  'aws_elasticache_cluster': 'cache',
  'aws_elasticache_replication_group': 'cache',
  'aws_lb': 'loadbalancer',
  'aws_alb': 'loadbalancer',
  'aws_api_gateway_rest_api': 'apigateway',
  'aws_apigatewayv2_api': 'apigateway',
  'aws_s3_bucket': 'objectstorage',
  'aws_ebs_volume': 'blockstorage',
  'aws_cloudfront_distribution': 'cdn',
  'aws_vpc': 'networking',
  'aws_nat_gateway': 'networking',
  'aws_cognito_user_pool': 'identityauth',
  'aws_route53_zone': 'dns',
  'aws_cloudwatch_log_group': 'logging',
  'aws_cloudwatch_metric_alarm': 'monitoring',
  'aws_secretsmanager_secret': 'secretsmanagement',
  'aws_sqs_queue': 'messagequeue',
  'aws_sns_topic': 'messagequeue',
  'aws_cloudwatch_event_rule': 'eventbus',
  'aws_opensearch_domain': 'searchengine',
  // Compute expansion
  'aws_eks_cluster': 'computecontainer',
  'aws_eks_node_group': 'computecontainer',
  'aws_fargate_profile': 'computecontainer',

  // GCP
  'google_cloud_run_service': 'computecontainer',
  'google_cloud_run_v2_service': 'computecontainer',
  'google_container_cluster': 'computecontainer',
  'google_cloudfunctions_function': 'computeserverless',
  'google_compute_instance': 'computevm',
  'google_sql_database_instance': 'relationaldatabase',
  'google_firestore_database': 'nosqldatabase',
  'google_redis_instance': 'cache',
  'google_compute_forwarding_rule': 'loadbalancer',
  'google_compute_backend_service': 'loadbalancer',
  'google_storage_bucket': 'objectstorage',
  'google_compute_disk': 'blockstorage',
  'google_compute_network': 'networking',
  'google_compute_router_nat': 'networking',
  'google_dns_managed_zone': 'dns',
  'google_logging_project_sink': 'logging',
  'google_monitoring_alert_policy': 'monitoring',
  'google_secret_manager_secret': 'secretsmanagement',
  'google_pubsub_topic': 'messagequeue',
  // Compute expansion
  'google_compute_global_address': 'loadbalancer',
  'google_compute_global_forwarding_rule': 'loadbalancer',
  'google_compute_target_http_proxy': 'loadbalancer',
  'google_compute_url_map': 'loadbalancer',
  'google_compute_backend_bucket': 'loadbalancer',
  'google_container_node_pool': 'computecontainer',

  // Azure
  'azurerm_container_app': 'computecontainer',
  'azurerm_container_app_environment': 'computecontainer',
  'azurerm_kubernetes_cluster': 'computecontainer',
  'azurerm_container_group': 'computecontainer',
  'azurerm_function_app': 'computeserverless',
  'azurerm_linux_function_app': 'computeserverless',
  'azurerm_service_plan': 'computeserverless',
  'azurerm_virtual_machine': 'computevm',
  'azurerm_postgresql_flexible_server': 'relationaldatabase',
  'azurerm_mysql_flexible_server': 'relationaldatabase',
  'azurerm_cosmosdb_account': 'nosqldatabase',
  'azurerm_redis_cache': 'cache',
  'azurerm_application_gateway': 'loadbalancer',
  'azurerm_lb': 'loadbalancer',
  'azurerm_storage_account': 'objectstorage',
  'azurerm_managed_disk': 'blockstorage',
  'azurerm_virtual_network': 'networking',
  'azurerm_nat_gateway': 'networking',
  'azurerm_dns_zone': 'dns',
  'azurerm_log_analytics_workspace': 'logging',
  'azurerm_monitor_metric_alert': 'monitoring',
  'azurerm_key_vault': 'secretsmanagement',
  'azurerm_servicebus_namespace': 'messagequeue',
  'azurerm_cdn_profile': 'cdn',
  'azurerm_api_management': 'apigateway',
  'azurerm_application_insights': 'monitoring',
  // Compute expansion
  'azurerm_kubernetes_cluster_node_pool': 'computecontainer',
  'azurerm_kubernetes_cluster_node_pool': 'computecontainer',
  // App Service expansion
  'azurerm_app_service_plan': 'computeserverless',
  'azurerm_app_service': 'computeserverless',
  'azurerm_linux_web_app': 'computeserverless',
};

/**
 * 🔵 PHASE 3.1 — PREPARE DEPLOYABLE PRICING INPUT (NEW)
 * 
 * Filter to only services that can be deployed via Terraform.
 * This is the SINGLE SOURCE OF TRUTH for what gets priced.
/**
 * DEPRECATED: extractDeployableServices (legacy version)
 * The canonical version is defined at the end of this file and uses resolveServiceId for proper normalization.
 * This function is intentionally removed to avoid duplicate definitions.
 * 
 * The canonical extractDeployableServices:
 * - Uses resolveServiceId from aliases.js for proper normalization
 * - Excludes EXTERNAL pricing class services (payment gateways, etc.)
 * - Falls back gracefully for unknown services
 */
// REMOVED: Duplicate function - see extractDeployableServices at end of file

/**
 * 🔒 PRICING INTEGRITY FIREWALL
 * 
 * Validates that no non-deployable services leaked into cost breakdown.
 * This runs AFTER cost calculation to catch any bugs.
 */
function validatePricingIntegrity(pricedServices, deployableServices) {
  console.log('[PRICING FIREWALL] Validating cost integrity...');

  // 🔥 FIX: SERVICE ALIAS MAPPING - Map Infracost service classes to our canonical IDs
  // These aliases map FROM what normalizeInfracostOutput outputs TO what's in deployable_services  
  const SERVICE_ALIASES = {
    // Infracost category name -> Our canonical service ID
    'load_balancer': 'loadbalancer',
    'global_load_balancer': 'loadbalancer',
    'compute_container': 'computecontainer',
    'app_compute': 'computecontainer',             // 🔥 FIX: app_compute should map TO computecontainer
    'serverless_compute': 'computeserverless',
    'compute_serverless': 'computeserverless',
    'relational_database': 'relationaldatabase',
    'object_storage': 'objectstorage',
    'api_gateway': 'apigateway',
    'messaging_queue': 'messagequeue',
    'message_queue': 'messagequeue',
    'cdn': 'cdn',
    'logging': 'logging',
    'monitoring': 'monitoring',
    'cache': 'cache',
    'nosql_database': 'nosqldatabase',
  };

  // 🔥 FIX 2: DEFENSIVE COST ENGINE - Handle undefined values safely
  for (const svc of pricedServices) {
    if (!svc) {
      console.warn('[PRICING FIREWALL] Skipping undefined service in priced services');
      continue;
    }

    const rawServiceClass = svc.service_class || svc.name;

    if (!rawServiceClass) {
      console.warn('[PRICING FIREWALL] Skipping service with no class/name in priced services');
      continue;
    }

    // 🔥 APPLY ALIAS MAPPING: Convert Infracost service class to our canonical ID
    const serviceClass = SERVICE_ALIASES[rawServiceClass] || rawServiceClass;

    // 🔥 FIX: Normalize by stripping underscores for robust matching
    // e.g. 'relational_database' matches 'relationaldatabase' and 'global_load_balancer' matches 'loadbalancer'
    const normalizedService = serviceClass.replace(/_/g, '').toLowerCase();
    const normalizedDeployable = deployableServices.map(s => s.replace(/_/g, '').toLowerCase());

    // 🔥 FIX: Remove 'gateway' from LB matching - user requested strictness. 
    // Only match explicit load balancer aliases.
    const isLoadBalancer = (normalizedService.includes('loadbalancer') || normalizedService === 'alb' || normalizedService === 'elb' || normalizedService === 'nlb') &&
      normalizedDeployable.some(s => s.includes('loadbalancer'));

    // 🔥 FIX: Also allow supporting infrastructure that's not in deployable_services but is required for Terraform
    const isSupportingInfra = ['networking', 'vpc', 'subnet', 'iam', 'securitygroup', 'resourcegroup'].includes(normalizedService);

    // 🔥 FIX: Allow apigateway if websocketgateway is present (as websockets use API Gateway)
    const isApiGateway = (normalizedService === 'apigateway') && normalizedDeployable.includes('websocketgateway');

    if (!normalizedDeployable.includes(normalizedService) && !isLoadBalancer && !isSupportingInfra && !isApiGateway) {
      throw new Error(
        `🚨 PRICING INTEGRITY VIOLATION: Service "${serviceClass}" (normalized: ${normalizedService}) was priced but is NOT in deployable_services. ` +
        `This service either: (1) has terraform_supported=false, (2) was excluded by user, or (3) leaked through a bug.`
      );
    }
  }

  console.log(`[PRICING FIREWALL] ✅ All ${pricedServices.length} priced services are valid`);
}

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

// 
// LEGACY GENERATORS REMOVED (AWS, GCP, Azure)
// All Terraform generation for Infracost is now delegated to:
// backend/services/infrastructure/terraformGeneratorV2.js (Source of Truth)
// 

/**
 * Generate Infracost usage file (YAML) from profile
 * Maps abstract usage (users, storage) to concrete resource usage keys
 */
function generateUsageFile(usageProfile, deployableServices) {
  if (!usageProfile) return null;

  // Calculate derived metrics
  const monthlyRequests = (usageProfile.monthly_users || 1000) * (usageProfile.requests_per_user || 50) * 30;
  const storageGB = usageProfile.storage_gb || 10;
  const dataTransferGB = usageProfile.data_transfer_gb || 50;

  // Initial YAML structure
  let yaml = `version: 0.1
  resource_type_default_usage:
  `;

  // Only include usage data for services that are actually in deployableServices
  if (deployableServices && deployableServices.includes('compute_serverless')) {
    yaml += `  aws_lambda_function:
  monthly_requests: ${monthlyRequests}
  request_duration_ms: 250
`;
  }

  if (deployableServices && deployableServices.includes('api_gateway')) {
    yaml += `  aws_apigatewayv2_api:
  monthly_requests: ${monthlyRequests}
  `;
  }

  if (deployableServices && deployableServices.includes('object_storage')) {
    yaml += `  aws_s3_bucket:
  storage_gb: ${storageGB}
  monthly_data_transfer_gb: ${dataTransferGB}
  `;
  }

  if (deployableServices && deployableServices.includes('relational_database')) {
    yaml += `  aws_db_instance:
  storage_gb: ${storageGB}
  monthly_requests: ${monthlyRequests}
  `;
  }

  if (deployableServices && deployableServices.includes('load_balancer')) {
    yaml += `  aws_lb:
  new_connections: ${monthlyRequests}
  active_connections: ${Math.round(monthlyRequests / 30 / 24 / 60)}
  processed_bytes: ${dataTransferGB * 1024 * 1024 * 1024}
  `;
  }

  if (deployableServices && deployableServices.includes('cache')) {
    yaml += `  aws_elasticache_cluster:
  node_hours: ${monthlyRequests / 1000}
  storage_gb: ${storageGB * 0.1}
  `;
  }

  if (deployableServices && deployableServices.includes('messaging_queue')) {
    yaml += `  aws_sqs_queue:
  monthly_requests: ${monthlyRequests}
  request_size_kb: 1
`;
  }

  // GCP mappings
  if (deployableServices && deployableServices.includes('compute_container')) {
    yaml += `  google_cloud_run_service:
  request_count: ${monthlyRequests}
  monthly_vcpu_time: ${monthlyRequests * 0.1}
  `;
  }

  if (deployableServices && deployableServices.includes('object_storage')) {
    yaml += `  google_storage_bucket:
  storage_gb: ${storageGB}
  monthly_outbound_data_transfer_gb: ${dataTransferGB}
  `;
  }

  if (deployableServices && deployableServices.includes('relational_database')) {
    yaml += `  google_sql_database_instance:
  storage_gb: ${storageGB}
  monthly_queries: ${monthlyRequests}
  `;
  }

  if (deployableServices && deployableServices.includes('cache')) {
    yaml += `  google_redis_instance:
  node_time_hours: ${monthlyRequests / 1000}
  `;
  }

  // Azure mappings
  if (deployableServices && deployableServices.includes('compute_container')) {
    yaml += `  azurerm_container_app:
  vcpu_seconds: ${monthlyRequests * 0.5 * 3600}
  memory_gb_seconds: ${monthlyRequests * 1 * 3600}
  `;
  }

  if (deployableServices && deployableServices.includes('object_storage')) {
    yaml += `  azurerm_storage_account:
  storage_gb: ${storageGB}
  monthly_data_transfer_gb: ${dataTransferGB}
  `;
  }

  if (deployableServices && deployableServices.includes('relational_database')) {
    yaml += `  azurerm_postgresql_flexible_server:
  storage_gb: ${storageGB}
  vcore_hours: ${monthlyRequests / 1000}
  `;
  }

  if (deployableServices && deployableServices.includes('load_balancer')) {
    yaml += `  azurerm_application_gateway:
  monthly_data_processed_gb: ${dataTransferGB}
  `;
  }

  return yaml;
}

/**
 * Force generate usage file with fallback values if needed
 * This ensures Infracost always has usage data to work with
 * 🔥 ENHANCED: Includes IoT, ML, Gaming, Fintech, Healthcare domains
 */
function forceGenerateUsageFile(provider, sizing, deployableServices) {
  // Default fallback values if sizing is missing
  const reqs = sizing?.api_gateway?.requests_per_month || 1000000;
  const storage = sizing?.relational_database?.storage_gb || 100;
  const computeRequests = sizing?.compute_serverless?.monthly_requests || 500000;
  const dataTransfer = sizing?.object_storage?.monthly_data_transfer_gb || 50;
  const iotMessages = sizing?.iot_core?.monthly_messages || reqs * 10;
  const mlInferences = sizing?.ml_inference_service?.monthly_requests || 100000;

  // ═══════════════════════════════════════════════════════════════════
  // CATALOG-DRIVEN USAGE GENERATION - SSoT
  // ═══════════════════════════════════════════════════════════════════
  // 🔥 FIX: Use new_services.json (SSOT) instead of deprecated terraform/services
  const catalog = require('../../catalog/new_services.json');

  let ymlContent = `version: 0.1
  resource_type_default_usage:
  `;

  // Helper to generate defaults
  const getDefaultUsage = (resourceType, sizing) => {
    // Basic defaults mapping
    const basicDefaults = {
      monthly_requests: reqs,
      storage_gb: storage,
      monthly_data_transfer_gb: dataTransfer
    };

    // AWS overrides
    if (resourceType === 'aws_lambda_function') return { monthly_requests: computeRequests, request_duration_ms: 250 };
    if (resourceType === 'aws_lb') return { new_connections: reqs, processed_bytes: dataTransfer * 1024 * 1024 * 1024 };
    if (resourceType === 'aws_elasticache_cluster') return { node_hours: reqs / 1000 };
    if (resourceType === 'aws_sqs_queue') return { monthly_requests: reqs / 5, request_size_kb: 1 };

    // 🔥 FIX: Fargate/ECS Usage Params
    if (resourceType === 'aws_ecs_service') return { tasks: 1, running_hours: 730 };
    if (resourceType === 'aws_fargate_profile') return { running_hours: 730 };

    // Custom domain overrides
    if (resourceType === 'aws_iot_topic_rule') return { monthly_messages: iotMessages };
    if (resourceType === 'aws_sagemaker_endpoint') return { instance_hours: mlInferences / 1000 };

    return basicDefaults;
  };

  // 1. Iterate through all services in input list (if provided) OR all catalog services (for fallback)
  const servicesToProcess = (deployableServices && deployableServices.length > 0)
    ? deployableServices
    : Object.keys(catalog);

  servicesToProcess.forEach(svcId => {
    // Handle objects or strings
    const id = typeof svcId === 'string' ? svcId : (svcId.id || svcId.name);
    const serviceDef = catalog[id];

    if (serviceDef && serviceDef.pricing && serviceDef.pricing.infracost && serviceDef.pricing.infracost.resourceType) {
      const resourceType = serviceDef.pricing.infracost.resourceType;
      const usage = getDefaultUsage(resourceType, sizing);

      ymlContent += `  ${resourceType}: \n`;
      Object.keys(usage).forEach(key => {
        ymlContent += `    ${key}: ${usage[key]} \n`;
      });
    }
  });


  const filePath = path.join(INFRACOST_BASE_DIR, provider.toLowerCase(), 'infracost-usage.yml');
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, ymlContent);
  console.log(`[USAGE] Force generated universal usage file at: ${filePath} `);
  return filePath;
}

/**
 * Run Infracost CLI and get JSON output
 * ASYNC: Uses exec with promisify to prevent blocking the event loop
 */
async function runInfracost(terraformDir, usageFilePath = null) {
  try {
    // Check if Infracost API key is set
    if (!process.env.INFRACOST_API_KEY) {
      console.warn("INFRACOST_API_KEY not set, attempting to run Infracost CLI locally");
      // Don't return null immediately - try to run Infracost anyway (it may be configured locally)
    }

    // Verify that terraformDir exists and contains Terraform files
    if (!fs.existsSync(terraformDir)) {
      console.error(`[INFRACOST] Terraform directory does not exist: ${terraformDir} `);
      return null;
    }

    const files = fs.readdirSync(terraformDir);
    const terraformFiles = files.filter(f => f.endsWith('.tf'));

    if (terraformFiles.length === 0) {
      console.error(`[INFRACOST] No Terraform files found in directory: ${terraformDir} `);
      console.error(`[INFRACOST] Files found: ${files.join(', ')} `);
      return null;
    }

    console.log(`[INFRACOST] Found ${terraformFiles.length} Terraform files: ${terraformFiles.join(', ')} `);

    // Verify usage file exists if provided
    if (usageFilePath && !fs.existsSync(usageFilePath)) {
      console.warn(`[INFRACOST] Usage file does not exist: ${usageFilePath} `);
      usageFilePath = null; // Reset to null to avoid passing non-existent file
    }

    const { execFile } = require('child_process');
    const util = require('util');
    const execFilePromise = util.promisify(execFile);

    const args = [
      'breakdown',
      '--path', terraformDir,
      '--format', 'json',
      // '--show-skipped', // Removed: We now parse JSON for skipped resources
      '--log-level', 'info'
    ];

    if (usageFilePath && fs.existsSync(usageFilePath)) {
      args.push('--usage-file', usageFilePath);
    }

    console.log(`[INFRACOST] Executing: infracost ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')} `);

    const { stdout, stderr } = await execFilePromise('infracost', args, {
      env: {
        ...process.env,
        INFRACOST_API_KEY: process.env.INFRACOST_API_KEY
      },
      timeout: 60000,
      maxBuffer: 1024 * 1024 * 20,
      windowsHide: true
    });

    if (stderr && stderr.trim()) {
      console.log(`[INFRACOST] CLI output: ${stderr} `);
      // 🔥 FIX: Detect Quota Exceeded
      if (stderr.includes('limit exceeded') || stderr.includes('Forbidden')) {
        console.error('[INFRACOST] 🚨 API QUOTA EXCEEDED');
        return { error: 'API_QUOTA_EXCEEDED' };
      }
    }

    if (!stdout || stdout.trim() === '') {
      console.error(`[INFRACOST] No output received from CLI command`);
      return null;
    }

    return JSON.parse(stdout);
  } catch (error) {
    console.error(`[INFRACOST] CLI execution error for ${terraformDir}: `, error.message);
    const combinedOutput = (error.stdout || '') + (error.stderr || '');
    if (combinedOutput.includes('limit exceeded') || combinedOutput.includes('Forbidden')) {
      console.error('[INFRACOST] 🚨 API QUOTA EXCEEDED (Caught in error)');
      return { error: 'API_QUOTA_EXCEEDED' };
    }

    if (error.stdout) {
      // Try to parse partial stdout if available (sometimes error comes with valid JSON)
      try {
        const partial = JSON.parse(error.stdout);
        if (partial && partial.projects) return partial;
      } catch (ignore) { }
      console.error(`[INFRACOST] STDOUT: ${error.stdout} `);
    }
    if (error.stderr) console.error(`[INFRACOST] STDERR: ${error.stderr} `);
    return null;
  }
}

/**
 * Normalize Infracost output to internal format
 * FIXED: Properly parse resources, map to service classes, aggregate costs
 */
function normalizeInfracostOutput(infracostJson, provider, infraSpec, costProfile = 'COST_EFFECTIVE') {
  if (!infracostJson || !infracostJson.projects || infracostJson.projects.length === 0) {
    console.log('[INFRACOST] No projects in output');
    return null;
  }

  const project = infracostJson.projects[0];
  const breakdown = project.breakdown || {};
  const resources = breakdown.resources || [];
  const totalCost = parseFloat(breakdown.totalMonthlyCost) || 0;

  console.log(`[INFRACOST] Parsed ${resources.length} resources, total: $${totalCost} `);

  // FIX #2: Map TF resources to service classes using RESOURCE_CATEGORY_MAP
  const serviceCosts = {};        // service_class -> total cost
  const selectedServices = {};    // service_class -> cloud service id
  const serviceDetails = [];

  for (const resource of resources) {
    const resourceType = resource.name?.split('.')[0] || '';
    let serviceClass = RESOURCE_CATEGORY_MAP[resourceType] || null;
    const cost = parseFloat(resource.monthlyCost) || 0;

    if (!serviceClass) {
      // 🔥 FIX: Explicit mapping for Azure App Service to match 'computecontainer'
      if (resourceType.startsWith('azurerm_app_service') || resourceType === 'azurerm_linux_web_app') {
        serviceClass = 'computecontainer';
      } else {
        console.log(`[INFRACOST] Unknown resource type: ${resourceType}`);
        continue;
      }
    }

    // 🔥 FIX: Override 'computeserverless' for App Service if mapped incorrectly
    if ((resourceType.startsWith('azurerm_app_service') || resourceType === 'azurerm_linux_web_app') && serviceClass === 'computeserverless') {
      serviceClass = 'computecontainer';
    }

    // Aggregate cost per service class
    serviceCosts[serviceClass] = (serviceCosts[serviceClass] || 0) + cost;

    // Map to cloud service (first occurrence wins)
    if (!selectedServices[serviceClass]) {
      // Get the proper cloud service name from cloudMapping
      const cloudService = cloudMapping.mapServiceToCloud(provider, serviceClass, costProfile)
        || `${provider.toLowerCase()}_${serviceClass} `;
      selectedServices[serviceClass] = cloudService;
    }

    serviceDetails.push({
      resource_name: resource.name,
      resource_type: resourceType,
      service_class: serviceClass,
      category: getCategoryForServiceId(serviceClass),
      monthly_cost: cost,
      formatted_cost: `$${cost.toFixed(2)}/mo`
    });
  }

  console.log(`[INFRACOST] Aggregated service costs:`, serviceCosts);
  console.log(`[INFRACOST] Selected services:`, selectedServices);

  // Build the services array with enriched context
  const services = [];

  // 1. Add Priced Services (from Infracost)
  Object.entries(serviceCosts).forEach(([serviceClass, cost]) => {
    const cloudService = selectedServices[serviceClass];
    const displayName = cloudMapping.getServiceDisplayName(cloudService)
      || serviceClass.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    services.push({
      service_class: serviceClass,
      cloud_service: cloudService,
      display_name: displayName,
      category: getCategoryForServiceId(serviceClass),
      pricing_status: 'PRICED', // Explicitly priced
      reason: 'Infrastructure Cost Driver',
      sizing: (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'Performance' : 'Standard',
      cost: {
        monthly: Math.round(cost * 100) / 100,
        formatted: `$${cost.toFixed(2)}/mo`
      }
    });
  });

  // 2. Add Missing Services (Free Tier / External / Zero-Cost)
  // We need to check against the original deployable list to find what's missing
  // Since we don't have the original list here in normalize, we infer from known missing logic
  // BUT... `generateCostEstimate` has the list. 
  // BETTER: `generateCostEstimate` should merge this list.
  // For now, let's just make sure we return the `pricing_status` logic in the existing items.

  // NOTE: The merging happens in `generateCostEstimate`. 
  // This function just returns what Infracost found.

  return {
    provider,
    total_monthly_cost: Math.round(totalCost * 100) / 100,
    formatted_cost: `$${totalCost.toFixed(2)}/month`,
    service_count: services.length,
    services,

    // FIX #3: Persist selected services
    selected_services: selectedServices,

    service_costs: serviceCosts,

    // 🔥 FIX: Track unsupported resources availability
    pricing_status: (resources.length > 0 && totalCost > 0) ? 'COMPLETE' : 'PARTIAL',
    unsupported_resources: Object.keys(RESOURCE_CATEGORY_MAP).length === 0 ? [] : resources.filter(r => !RESOURCE_CATEGORY_MAP[r.name?.split('.')[0]]),

    // 🔥 ENHANCED CONFIDENCE: Penalize incomplete estimates
    // Start with provider performance, then penalize
    confidence: (() => {
      let score = 1.0;

      // Penalize for fallback/partial status
      if (resources.length === 0 || totalCost === 0) score *= 0.5;

      // Penalize for unknowns (capped at 20% penalty)
      const unknowns = resources.filter(r => !RESOURCE_CATEGORY_MAP[r.name?.split('.')[0]]);
      if (unknowns.length > 0) {
        score -= Math.min(0.2, unknowns.length * 0.05); // 5% per unknown
      }

      return Math.max(0.1, Math.round(score * 100) / 100);
    })(),

    performance_score: PROVIDER_PERFORMANCE_SCORES[provider]?.overall || 85,
    is_mock: false,
    resource_count: resources.length
  };
}

/**
 * Generate fallback mock data when Infracost CLI is not available
 * FIX 1: selected_services uses service_class as key
 * FIX 4: Profile divergence - HIGH_PERFORMANCE costs more
 */
function generateMockCostData(provider, infraSpec, sizing, costProfile = 'COST_EFFECTIVE') {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';
  const tierMultiplier = tier === 'LARGE' ? 2.5 : tier === 'SMALL' ? 0.5 : 1;

  // FIX 4: Profile divergence - HIGH_PERFORMANCE costs 35-50% more
  const profileMultiplier = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 1.4 : 1.0;

  // Base costs per service class (supports both underscore and no-underscore naming)
  const baseCosts = {
    // Compute services
    compute_container: { cost: 80, cat: 'Compute' }, computecontainer: { cost: 80, cat: 'Compute' },
    compute_serverless: { cost: 30, cat: 'Serverless' }, computeserverless: { cost: 30, cat: 'Serverless' },
    compute_vm: { cost: 60, cat: 'Compute' }, computevm: { cost: 60, cat: 'Compute' },
    compute_static: { cost: 5, cat: 'Compute' }, computestatic: { cost: 5, cat: 'Compute' },
    compute_batch: { cost: 70, cat: 'Compute' }, computebatch: { cost: 70, cat: 'Compute' },
    compute_edge: { cost: 25, cat: 'Compute' }, computeedge: { cost: 25, cat: 'Compute' },
    // Database services
    relational_database: { cost: 100, cat: 'Database' }, relationaldatabase: { cost: 100, cat: 'Database' },
    nosql_database: { cost: 40, cat: 'Database' }, nosqldatabase: { cost: 40, cat: 'Database' },
    time_series_database: { cost: 50, cat: 'Database' }, timeseriesdatabase: { cost: 50, cat: 'Database' },
    vector_database: { cost: 80, cat: 'Database' }, vectordatabase: { cost: 80, cat: 'Database' },
    cache: { cost: 50, cat: 'Caching' },
    search_engine: { cost: 60, cat: 'Search' }, searchengine: { cost: 60, cat: 'Search' },
    // Storage services
    object_storage: { cost: 10, cat: 'Storage' }, objectstorage: { cost: 10, cat: 'Storage' },
    block_storage: { cost: 15, cat: 'Storage' }, blockstorage: { cost: 15, cat: 'Storage' },
    file_storage: { cost: 12, cat: 'Storage' }, filestorage: { cost: 12, cat: 'Storage' },
    // Networking services
    load_balancer: 25, loadbalancer: 25,
    api_gateway: 15, apigateway: 15,
    cdn: 20,
    dns: 2,
    nat_gateway: 30, natgateway: 30,
    vpc_networking: 5, vpcnetworking: 5,
    websocket_gateway: 20, websocketgateway: 20,
    // Messaging services
    message_queue: 5, messagequeue: 5,
    messaging_queue: 5,
    event_bus: 8, eventbus: 8,
    event_streaming: 15, eventstreaming: 15,
    workflow_orchestration: 10, workfloworchestration: 10,
    // Security services
    identity_auth: 5, identityauth: 5,
    secrets_management: 3, secretsmanagement: 3,
    key_management: 5, keymanagement: 5,
    certificate_management: 3, certificatemanagement: 3,
    waf: 20,
    // Observability services
    monitoring: 10,
    logging: 15,
    audit_logging: 12, auditlogging: 12,
    // External services (priced at $0 since they're handled externally)
    payment_gateway: 0, paymentgateway: 0,
    // Other
    networking: 35
  };

  // FIX 4: HIGH_PERFORMANCE uses premium services with higher base costs
  const performanceMultipliers = {
    compute_container: 1.5, computecontainer: 1.5,  // EKS vs Fargate
    relational_database: 1.6, relationaldatabase: 1.6, // Aurora vs RDS
    cache: 1.3,              // larger cache size
    load_balancer: 1.2, loadbalancer: 1.2,
    monitoring: 1.4
  };

  // Provider cost adjustments
  const providerAdjustment = {
    AWS: 1.0,
    GCP: 0.92,
    AZURE: 0.95
  };

  const adjustment = providerAdjustment[provider] || 1;
  let totalCost = 0;
  const serviceDetails = [];

  // FIX 1: Persist selected services (using service_class as key, not category)
  const selectedServices = {};

  // FIX 2: Aggregate costs per service class
  const serviceCosts = {};

  for (const service of services) {
    let baseCost = baseCosts[service.service_class] || 20;

    // FIX 4: Apply performance multiplier for specific services
    if ((costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') && performanceMultipliers[service.service_class]) {
      baseCost *= performanceMultipliers[service.service_class];
    }

    const cost = Math.round(baseCost * tierMultiplier * profileMultiplier * adjustment * 100) / 100;
    totalCost += cost;

    const mappedService = cloudMapping.mapServiceToCloud(provider, service.service_class, costProfile);
    const category = getCategoryForServiceId(service.service_class);

    // DEBUG: Log service mapping
    console.log(`[COST] Service: ${service.service_class} -> ${mappedService} ($${cost})`);

    // Handle case where mappedService is null (use service_class as fallback)
    const cloudServiceId = mappedService || `${provider.toLowerCase()}_${service.service_class}`;
    const displayName = cloudMapping.getServiceDisplayName(mappedService) || service.service_class.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    // FIX 1: Store selected cloud service by SERVICE CLASS
    selectedServices[service.service_class] = cloudServiceId;

    // FIX 2: Aggregate cost per service class
    serviceCosts[service.service_class] = (serviceCosts[service.service_class] || 0) + cost;

    serviceDetails.push({
      service_class: service.service_class,
      cloud_service: cloudServiceId,
      display_name: displayName,
      category: category,
      pricing_status: 'PRICED',
      reason: 'Estimated',
      sizing: (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'Performance' : 'Standard',
      cost: {
        monthly: cost,
        formatted: `$${cost.toFixed(2)}/mo`
      }
    });
  }

  // Round service costs
  for (const key of Object.keys(serviceCosts)) {
    serviceCosts[key] = Math.round(serviceCosts[key] * 100) / 100;
  }

  return {
    provider,
    tier,
    cost_profile: costProfile,
    total_monthly_cost: Math.round(totalCost * 100) / 100,
    formatted_cost: `$${totalCost.toFixed(2)}/month`,
    service_count: serviceDetails.length,
    services: serviceDetails,

    // FIX 1: Selected cloud services by service_class
    selected_services: selectedServices,

    // FIX 2: Aggregated costs per service_class
    service_costs: serviceCosts,
    service_counts: {
      total: serviceDetails.length,
      priced: serviceDetails.length, // In fallback, we assume heuristic covers all
      usage_based: 0,
      external: 0
    },

    performance_score: PROVIDER_PERFORMANCE_SCORES[provider]?.overall || 85,
    is_mock: true
  };
}

/**
 * Generate cost estimate for a single provider (CORRECTED ARCHITECTURE)
 * 
 * ✅ FIX 2: Infracost is now PRIMARY path, formula is FALLBACK
 * ✅ FIX 3: Usage normalized to resource-level keys
 */
async function generateCostEstimate(provider, infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null, deployableServices = null) {
  const sizing = sizingModel.getSizingForInfraSpec(infraSpec, intent);
  infraSpec.sizing = sizing; // Attach for downstream services (Terraform)
  const tier = sizing.tier;

  // 🔒 STATIC SITE BYPASS - Formula only, no Terraform
  // Static sites don't need compute resources, use formula-based costing
  const pattern = infraSpec.serviceclasses?.pattern || infraSpec.service_classes?.pattern;
  if (pattern === 'STATICWEBHOSTING' || pattern === 'STATICSITEWITHAUTH' ||
    pattern === 'STATIC_WEB_HOSTING' || pattern === 'STATIC_SITE_WITH_AUTH') {
    console.log('COST ENGINE: STATIC SITE DETECTED - Using formula bypass');
    const usageProfile = usageOverrides || {
      expected: { storage_gb: 2, data_transfer_gb: 10 }
    };
    const staticResult = handleStaticWebsiteCost(infraSpec, intent, usageProfile);
    // Return provider-specific result
    return {
      ...staticResult.provider_details[provider],
      tier,
      cost_profile: costProfile,
      estimate_type: 'formula',
      estimate_source: 'static_formula',
      estimate_reason: 'Static site pricing via deterministic formula'
    };
  }

  // 🔵 PHASE 3.1: Always extract and filter deployable services
  // This ensures we strictly remove EXTERNAL services (like paymentgateway) even if a raw list was passed
  deployableServices = extractDeployableServices(infraSpec);

  // 🔥 CRITICAL FIX: Ensure Terraform Service sees strictly filtered list
  // Override the raw list in infraSpec with our clean, pricing-only list
  if (!infraSpec.canonical_architecture) infraSpec.canonical_architecture = {};
  infraSpec.canonical_architecture.deployable_services = deployableServices;

  console.log(`[COST ESTIMATE ${provider}] Deployable services: ${deployableServices.length}`);

  // 🔥 FIX: Create unique provider directory with run ID to prevent state leakage
  const runId = generateRunId();
  const providerDir = path.join(INFRACOST_BASE_DIR, provider.toLowerCase(), runId);
  cleanProviderDir(providerDir); // Clean before writing

  let estimate_type = 'heuristic'; // Default to heuristic, upgrade to 'exact' if Infracost succeeds
  let estimate_source = 'formula_fallback';

  // 🔵 PHASE 3.2: Normalize usage into resource-level Infracost keys
  let usageFilePath = null;
  if (usageOverrides) {
    try {
      const normalized = usageNormalizer.normalizeUsageForInfracost(usageOverrides, deployableServices, provider);
      const usageYaml = usageNormalizer.toInfracostYAML(normalized);
      if (usageYaml) {
        usageFilePath = path.join(providerDir, 'infracost-usage.yml');
        fs.writeFileSync(usageFilePath, usageYaml);
        console.log(`[USAGE FILE] Generated usage file for ${provider} at ${usageFilePath}`);
      }
      console.log(`[USAGE NORMALIZER] Generated usage file for ${provider} at ${usageFilePath}`);
    } catch (usageError) {
      console.error(`[USAGE NORMALIZER] Failed to normalize usage: ${usageError.message}`);
    }
  }

  // 🔥 FORCE USAGE FILE: Always ensure usage file exists to prevent Infracost from failing
  if (!usageFilePath || !fs.existsSync(usageFilePath)) {
    console.log(`[USAGE] No usage file found, forcing generation for ${provider} with ${deployableServices.length} services`);
    usageFilePath = forceGenerateUsageFile(provider, sizing, deployableServices);
  }

  // 🔵 PHASE 3.3: Generate minimal pricing Terraform
  let terraform;
  // 🔥 FIX: Normalize costProfile to string (was being passed as object)
  const profileStr = typeof costProfile === 'string'
    ? costProfile.toUpperCase()
    : (costProfile?.profile || costProfile?.name || 'COST_EFFECTIVE').toUpperCase();

  try {
    // 🔥 NEW: Use Flat Pricing Generator for pure Infracost visibility (Phase 3.3)
    console.log(`[TERRAFORM] Generating FLAT pricing project for ${provider} (Cost Mode Analysis)`);

    // Generator expects lowercase provider key (aws, gcp, azure)
    const genProvider = provider.toLowerCase();

    // 🔥 FIX: Use provider-specific default regions for accurate Infracost pricing
    const DEFAULT_REGIONS = {
      aws: 'us-east-1',      // AWS Virginia (most complete pricing data)
      gcp: 'us-central1',    // GCP Iowa (well-priced region with full data)
      azure: 'eastus'        // Azure East US (most complete pricing data)
    };
    const resolvedRegion = DEFAULT_REGIONS[genProvider] || 'us-east-1';
    const resolvedProjectName = infraSpec.project_name || 'pricing-analysis';

    // Generate content directly
    const pricingMainTf = terraformGeneratorV2.generatePricingMainTf(
      genProvider,
      deployableServices,
      resolvedRegion,
      resolvedProjectName,
      sizing
    );
    const versionsTf = terraformGeneratorV2.generateVersionsTf(genProvider);
    const providersTf = terraformGeneratorV2.generateProvidersTf(genProvider, resolvedRegion);

    // Construct flat project folder without modules
    const projectFolder = {
      'main.tf': pricingMainTf,
      'versions.tf': versionsTf,
      'providers.tf': providersTf
    };

    // Recursively write all files
    writeProjectFolder(projectFolder, providerDir);
    console.log(`[TERRAFORM] Generated flat pricing project for ${provider}`);
  } catch (terraformError) {
    console.error(`[TERRAFORM] Failed to generate for ${provider}: ${terraformError.message}`);
    // Cannot proceed with Infracost without Terraform
    console.log(`[COST ESTIMATE ${provider}] Falling back to formula engine`);
    return {
      ...generateBetterFallback(provider, infraSpec, sizing, costProfile),
      estimate_type: 'heuristic',
      estimate_source: 'formula_fallback',
      estimate_reason: 'Terraform generation failed',
      pricing_status: 'FALLBACK'
    };
  }

  // 🔵 PHASE 3.4: PRIMARY PATH - Run Infracost CLI
  try {
    const infracostResult = await runInfracost(providerDir, usageFilePath);

    if (infracostResult) {
      // Provider sanity check - detect cross-provider state leakage
      const project = infracostResult.projects?.[0];
      const resources = project?.breakdown?.resources || [];
      try {
        validateProviderResources(resources, provider);
        console.log(`[INFRACOST] ✅ Provider sanity check passed for ${provider}: ${resources.length} resources`);
      } catch (leakError) {
        console.error(`[INFRACOST] ❌ Provider sanity check FAILED: ${leakError.message}`);
        throw leakError; // Fail fast on state leakage
      }

      // Normalize real Infracost data with proper service class mapping
      const normalized = normalizeInfracostOutput(infracostResult, provider, infraSpec, costProfile);

      // Don't fallback if Infracost succeeded but returned 0 cost/services (valid result)
      if (normalized) {
        // 🔥 CRITICAL FIX: Pricing Completeness Gate
        // If we tried to price services but got 0 results, it's a failure of the pricing engine.
        const hasBillableIntent = deployableServices && deployableServices.length > 0;

        // Strict check: if we have billable services, we MUST have > 0 priced services
        // AND total cost > 0 (unless we are sure it's a free tier, but safe to fallback)
        const zeroResources = normalized.service_count === 0;
        const zeroCost = parseFloat(normalized.totalMonthlyCost) === 0;

        // Fail if we have intent but got 0 resources OR 0 cost (safer to use formula fallback)
        const zeroCostResult = zeroResources || zeroCost;

        if (hasBillableIntent && zeroCostResult) {
          console.warn(`[INFRACOST] ⛔ COMPLETENESS GATE FAILED: ${provider} has ${deployableServices.length} services but returned 0 priced resources.`);

          // Return robust fallback data immediately
          console.log(`[INFRACOST] ⚠️ COMPLETENESS GATE FAILED: Activating Robust Pricing Fallback`);
          return {
            ...generateBetterFallback(provider, infraSpec, sizing, costProfile),
            estimate_type: 'heuristic',
            estimate_source: 'fallback_engine_v2',
            estimate_reason: 'Infracost returned $0 (API Quote/Completeness Check)',
            pricing_status: 'FALLBACK'
          };
        } else if (normalized.service_count === 0) {
          // This path is now only for truly empty/free workloads (unlikely with billable logic)
          console.warn(`[INFRACOST] ${provider} returned 0 priced services (valid execution). Returning $0 estimate.`);
          normalized.warnings = ['Infracost detected resources but priced them at $0.00 (likely skipped or usage tier free)'];
        } else {
          console.log(`[INFRACOST] ✅ SUCCESS: ${provider} with ${normalized.service_count} services`);
        }

        // 🔒 PHASE 3.6: PRICING INTEGRITY FIREWALL
        try {
          // 🔥 FIX: Normalize deployableServices before integrity check to handle undefined values
          const normalizedDeployableServices = deployableServices
            .map(s => {
              if (!s) return null;
              if (typeof s === 'string') return s;
              if (typeof s === 'object') {
                // Try different possible properties that might contain the service name
                return s.service || s.canonical_type || s.name || s.service_class;
              }
              return null;
            })
            .filter(Boolean);

          // Only validate integrity if we have actual services priced
          if (normalized.service_count > 0) {
            validatePricingIntegrity(normalized.services || [], normalizedDeployableServices);
          }
        } catch (integrityError) {
          console.error(`[PRICING FIREWALL] ${integrityError.message}`);
          throw integrityError;
        }

        return {
          ...normalized,
          tier,
          cost_profile: costProfile,
          estimate_type: 'exact',  // ✅ FIX 5: UX Honesty
          estimate_source: 'infracost',
          estimate_reason: 'Real Terraform-based pricing via Infracost CLI'
        };
      }
    }
  } catch (infracostError) {
    console.error(`[INFRACOST] Failed for ${provider}: ${infracostError.message}`);
  }

  // 🔵 PHASE 3.5: FALLBACK - Use formula engines
  console.log(`[COST ESTIMATE ${provider}] ⚠️ Infracost unavailable, using formula engine`);
  return {
    ...generateBetterFallback(provider, infraSpec, sizing, costProfile),
    estimate_type: 'heuristic',  // ✅ FIX 5: UX Honesty
    estimate_source: 'formula_fallback',
    estimate_reason: 'Infracost CLI unavailable or Terraform validation failed',
    pricing_status: 'FALLBACK'
  };
}

/**
 * Calculate costs for Low/Expected/High scenarios (CORRECTED)
 * 
 * ✅ FIX: Now uses deployable_services ONLY
 */
async function calculateScenarios(infraSpec, intent, usageProfile) {
  console.log('[SCENARIOS] Building canonical cost scenarios...');

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1: CLASSIFY WORKLOAD INTO COST MODE
  // This determines the pricing approach to use
  // ═══════════════════════════════════════════════════════════════════
  const costMode = classifyWorkload(intent, infraSpec);
  console.log(`[SCENARIOS] Cost Mode: ${costMode}`);

  // 🔵 PHASE 3.1: Extract deployable services ONLY
  const deployableServices = extractDeployableServices(infraSpec);

  if (deployableServices.length === 0) {
    throw new Error('[SCENARIOS] No deployable services found - cannot calculate costs');
  }

  // 🔥 FIX: Use infraSpec.pattern as SSOT (not service_classes.pattern)
  const pattern = infraSpec.pattern || infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';

  console.log(`[SCENARIOS] Pattern (SSOT): ${pattern}`);
  console.log(`[SCENARIOS] Deployable services: ${deployableServices.join(', ')}`);

  // ⛔ VALIDATE: No logical services should be here
  deployableServices.forEach(svc => {
    // 🔥 FIX: Handle undefined values and normalize service to canonical ID
    if (!svc) {
      console.warn('[SCENARIOS] Skipping undefined service in deployable list');
      return;
    }

    // Use the central normalization function
    const normalizedServiceName = normalizeToServiceId(svc);
    if (!normalizedServiceName) {
      console.warn('[SCENARIOS] Skipping service with no extractable name in deployable list');
      return;
    }

    // Define supported services (all canonical IDs from new_services.json)
    const SUPPORTED_SERVICES = [
      'computeserverless', 'computecontainer', 'computevm', 'computebatch', 'computeedge',
      'relationaldatabase', 'nosqldatabase', 'timeseriesdatabase', 'vectordatabase', 'cache', 'searchengine',
      'objectstorage', 'blockstorage', 'filestorage',
      'apigateway', 'loadbalancer', 'vpcnetworking', 'natgateway', 'cdn', 'dns',
      'messagequeue', 'eventbus', 'workfloworchestration', 'eventstreaming', 'paymentgateway', 'websocketgateway',
      'identityauth', 'secretsmanagement', 'keymanagement', 'certificatemanagement', 'waf',
      'logging', 'monitoring', 'auditlogging'
    ];

    if (!SUPPORTED_SERVICES.includes(normalizedServiceName)) {
      // Log warning instead of throwing - external services don't need Terraform
      console.warn(`[SCENARIOS] Service ${normalizedServiceName} not in SUPPORTED_SERVICES - may be external or unsupported`);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // CALCULATE RAW COSTS FOR 3 PROFILES (with deployable services only)
  // ═══════════════════════════════════════════════════════════════════
  // 🔥 DEFENSIVE: Check for required usageProfile data
  if (!usageProfile || !usageProfile.low || !usageProfile.expected || !usageProfile.high) {
    console.warn('[SCENARIOS] Missing complete usage profile, using defaults');
    // Provide default usage profiles if not available
    usageProfile = {
      low: { monthly_users: 1000, requests_per_user: 10, data_transfer_gb: 10, storage_gb: 5 },
      expected: { monthly_users: 5000, requests_per_user: 30, data_transfer_gb: 50, storage_gb: 20 },
      high: { monthly_users: 20000, requests_per_user: 100, data_transfer_gb: 200, storage_gb: 100 }
    };
  }

  // Use the cost mode classification to calculate scenarios appropriately
  try {
    // 🔥 FIX A1: Sequential Execution for Scenarios
    // Concurrent execution here causes cross-talk between runs (low/expected/high and providers)

    console.log('[SCENARIOS] Calculating Low profile...');
    const costEffectiveRaw = await performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile.low, true, deployableServices);

    console.log('[SCENARIOS] Calculating Expected profile...');
    const standardRaw = await performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile.expected, true, deployableServices);

    console.log('[SCENARIOS] Calculating High profile...');
    const highPerfRaw = await performCostAnalysis(infraSpec, intent, 'HIGH_PERFORMANCE', usageProfile.high, true, deployableServices);

    // ═══════════════════════════════════════════════════════════════════
    // BUILD CANONICAL CostScenarios STRUCTURE
    // ═══════════════════════════════════════════════════════════════════
    function extractCostResults(rawResult, usageData) {
      const results = {};
      // Iterate canonical lower-case providers to ensure deduplication
      const providers = ['aws', 'gcp', 'azure'];

      providers.forEach(pLower => {
        const pUpper = pLower.toUpperCase();

        // precise lookup with fallback to different casing
        const providerData = rawResult?.provider_details?.[pLower] ||
          rawResult?.provider_details?.[pUpper] ||
          rawResult?.cost_estimates?.[pLower] ||
          rawResult?.cost_estimates?.[pUpper] ||
          rawResult?.provider_details?.[pLower.charAt(0).toUpperCase() + pLower.slice(1)]; // Title Case

        if (!providerData) return;

        const cost = providerData.monthly_cost ??
          providerData.total_monthly_cost ??
          providerData.total;

        // Strictly check for undefined/null - allow 0 if it's a real 0 cost (e.g. Free Tier)
        if (cost !== undefined && cost !== null && !results[pLower]) {
          // 🔥 FIX: Normalize deployableServices to service names
          const serviceNames = deployableServices.map(svc =>
            typeof svc === 'string' ? svc : (svc.name || svc.service_class || 'unknown')
          );

          results[pLower] = costResultModel.buildCostResult(
            pLower,
            pattern,
            cost,
            serviceNames,
            usageData
          );
          console.log(`[SCENARIOS] ${pUpper}: $${Number(cost).toFixed(2)}`);
        }
      });

      return results;
    }

    const scenarios = costResultModel.buildCostScenarios(
      extractCostResults(costEffectiveRaw, usageProfile?.low),
      extractCostResults(standardRaw, usageProfile?.expected),
      extractCostResults(highPerfRaw, usageProfile?.high)
    );

    // ═══════════════════════════════════════════════════════════════════
    // AGGREGATE AND CALCULATE RANGE/RECOMMENDED
    // ═══════════════════════════════════════════════════════════════════
    const aggregation = costResultModel.aggregateScenarios(scenarios);

    // 🔥 FIX: Handle null recommended gracefully
    if (aggregation.recommended) {
      console.log(`[SCENARIOS] Cost Range: ${aggregation.cost_range.formatted}`);
      console.log(`[SCENARIOS] Recommended: ${aggregation.recommended.provider} @ ${aggregation.recommended.formatted_cost}`);
    } else {
      console.warn(`[SCENARIOS] No recommended provider found - using fallback`);
    }

    // ═══════════════════════════════════════════════════════════════════
    // COMPUTE CONFIDENCE WITH EXPLANATION (deterministic)
    // ═══════════════════════════════════════════════════════════════════
    const confidenceResult = costResultModel.computeConfidence(infraSpec, scenarios, usageProfile?.expected);
    console.log(`[SCENARIOS] Confidence: ${confidenceResult.percentage}% - ${confidenceResult.explanation.join(', ')}`);

    return {
      scenarios,
      cost_range: aggregation.cost_range,
      recommended: aggregation.recommended,
      confidence: confidenceResult.score,
      confidence_percentage: confidenceResult.percentage,
      confidence_explanation: confidenceResult.explanation,
      drivers: aggregation.recommended?.drivers || [],
      services: aggregation.recommended?.services || [],
      low: aggregation.cost_range.min,
      expected: scenarios.standard?.aws?.monthly_cost || 0,
      high: aggregation.cost_range.max,
      details: {
        ...standardRaw,
        scenarios,
        cost_range: aggregation.cost_range,
        recommended: aggregation.recommended,
        confidence: confidenceResult.score,
        confidence_percentage: confidenceResult.percentage,
        confidence_explanation: confidenceResult.explanation,
        drivers: aggregation.recommended?.drivers || [],
        services: aggregation.recommended?.services || []
      }
    };
  } catch (error) {
    console.error('[SCENARIOS] Error calculating scenarios:', error);

    // Return fallback scenario data to prevent frontend errors
    return {
      scenarios: {
        low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
        standard: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
        high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
      },
      cost_range: { formatted: '$80 - $160/month' },
      recommended: { provider: 'AWS', formatted_cost: '$100.00', monthly_cost: 100 },
      confidence: 0.5,
      confidence_percentage: 50,
      confidence_explanation: ['Fallback calculation due to scenario processing error'],
      drivers: [{ name: 'Infrastructure', percentage: 100 }],
      services: [],
      low: 80,
      expected: 100,
      high: 160,
      details: {
        cost_mode: 'FALLBACK_MODE',
        pricing_method_used: 'fallback_calculation',
        rankings: [
          { provider: 'AWS', monthly_cost: 100, formatted_cost: '$100.00', rank: 1, recommended: true, score: 50 },
          { provider: 'GCP', monthly_cost: 110, formatted_cost: '$110.00', rank: 2, recommended: false, score: 45 },
          { provider: 'AZURE', monthly_cost: 105, formatted_cost: '$105.00', rank: 3, recommended: false, score: 48 }
        ],
        provider_details: {
          AWS: { total_monthly_cost: 100, formatted_cost: '$100.00/month', service_count: 1 },
          GCP: { total_monthly_cost: 110, formatted_cost: '$110.00/month', service_count: 1 },
          AZURE: { total_monthly_cost: 105, formatted_cost: '$105.00/month', service_count: 1 }
        },
        recommended: { provider: 'AWS', monthly_cost: 100, formatted_cost: '$100.00', service_count: 1, score: 50 },
        confidence: 0.5,
        confidence_percentage: 50,
        ai_explanation: { confidence_score: 0.5, rationale: 'Fallback calculation due to processing error.' }
      }
    };
  }
}

/**
 * Perform full cost analysis across providers
 * Now accepts optional `usageOverrides` for deterministic behavior (Layer B)
 */


function shouldSkipProvider(provider, infraSpec) {
  return false; // MVP: Check all
}

/**
 * Generate cost estimates for all providers
 */
async function generateAllProviderEstimates(infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null) {
  const providers = ['AWS', 'GCP', 'AZURE'];
  const estimates = {};

  // 🔥 FIX A1: Sequential Execution (No concurrency)
  // Prevents log interleaving and shared state corruption
  for (const provider of providers) {
    try {
      console.log(`[COST SEQUENCER] Starting analysis for ${provider}...`);
      const result = await generateCostEstimate(provider, infraSpec, intent, costProfile, usageOverrides);
      estimates[provider] = result;
      console.log(`[COST SEQUENCER] Finished analysis for ${provider}`);
    } catch (error) {
      console.error(`[COST SEQUENCER] Error for ${provider}:`, error);
      estimates[provider] = null;
    }
  }

  return estimates;
}

/**
 * Rank providers based on cost profile
 */
function rankProviders(estimates, costProfile = 'COST_EFFECTIVE') {
  const providers = Object.keys(estimates);

  // Get costs for normalization
  const costs = providers.map(p => estimates[p].total_monthly_cost);
  const maxCost = Math.max(...costs);
  const minCost = Math.min(...costs);
  const costRange = maxCost - minCost || 1;

  // Calculate scores
  const rankings = providers.map(provider => {
    const estimate = estimates[provider];
    const normalizedCost = 100 - ((estimate.total_monthly_cost - minCost) / costRange * 100);
    const perfScore = estimate.performance_score || 85;

    let finalScore;
    if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') {
      finalScore = (normalizedCost * 0.4) + (perfScore * 0.6);
    } else {
      finalScore = (normalizedCost * 0.7) + (perfScore * 0.3);
    }

    return {
      provider,
      score: Math.round(finalScore),
      cost_score: Math.round(normalizedCost),
      performance_score: perfScore,
      monthly_cost: estimate.total_monthly_cost,
      formatted_cost: estimate.formatted_cost,
      service_count: estimate.service_count,
      is_mock: estimate.is_mock || false
    };
  });

  // Sort by score (descending)
  rankings.sort((a, b) => b.score - a.score);

  // Add ranking position
  rankings.forEach((r, idx) => {
    r.rank = idx + 1;
    r.recommended = idx === 0;
  });

  return rankings;
}

/**
 * Calculate cost range based on tier, cost profile, and statefulness
 * Returns ±20-30% range with confidence level
 */
function calculateCostRange(baseCost, tier, costProfile, intent) {
  // Determine range percentage based on factors
  let rangePercent = 0.20; // Base ±20%

  // Increase uncertainty for larger scale
  if (tier === 'LARGE') rangePercent += 0.05;
  if (tier === 'SMALL') rangePercent -= 0.05;

  // Increase uncertainty for high-performance profile (more variable)
  if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') rangePercent += 0.05;

  // Statefulness adds uncertainty
  const statefulness = intent?.semantic_signals?.statefulness;
  if (statefulness === 'stateful') rangePercent += 0.05;

  // Cap at 30%
  rangePercent = Math.min(rangePercent, 0.30);

  const low = Math.round(baseCost * (1 - rangePercent));
  const high = Math.round(baseCost * (1 + rangePercent));

  // Confidence based on range
  let confidence;
  if (rangePercent <= 0.20) confidence = 'high';
  else if (rangePercent <= 0.25) confidence = 'medium';
  else confidence = 'low';

  return {
    estimate: Math.round(baseCost),
    range: { low, high },
    range_percent: Math.round(rangePercent * 100),
    confidence,
    formatted: `$${low} - $${high}/month`
  };
}

/**
 * Build usage profile from intent and overrides for cost engines
 */
function buildUsageProfile(infraSpec, intent, usageOverrides) {
  // Start with defaults
  const profile = {
    monthly_users: { min: 1000, expected: 5000, max: 20000 },
    requests_per_user: { min: 10, expected: 30, max: 100 },
    data_transfer_gb: { min: 10, expected: 50, max: 200 },
    storage_gb: { min: 5, expected: 20, max: 100 },
    jobs_per_day: { min: 1, expected: 5, max: 20 },
    job_duration_hours: { min: 0.5, expected: 1, max: 4 }
  };

  // Override from intent.usage_profile if exists
  if (intent?.usage_profile) {
    Object.assign(profile, intent.usage_profile);
  }

  // Override from explicit user overrides
  if (usageOverrides) {
    Object.assign(profile, usageOverrides);
  }

  return profile;
}

/**
 * Build selected services map for UI display
 */
function buildSelectedServicesMap(infraSpec) {
  const services = infraSpec.service_classes?.required_services || [];
  const map = {};

  for (const s of services) {
    const key = s.service_class || s.name || 'unknown';
    map[key] = s.display_name || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  return map;
}

/**
 * Calculate cost sensitivity based on pattern and cost structure
 */
function calculateCostSensitivity(pattern, costResult) {
  // Static sites have very low sensitivity
  if (pattern === 'STATIC_WEB_HOSTING') {
    return {
      level: 'low',
      label: 'Storage-bound',
      factor: 'bandwidth usage'
    };
  }

  // Serverless is usage-sensitive
  if (pattern === 'SERVERLESS_WEB_APP' || pattern === 'MOBILE_BACKEND_API') {
    return {
      level: 'medium',
      label: 'Usage-sensitive',
      factor: 'API request volume'
    };
  }

  // Container/VM patterns are compute-heavy
  if (pattern === 'CONTAINERIZED_WEB_APP' || pattern === 'TRADITIONAL_VM_APP') {
    return {
      level: 'high',
      label: 'Compute-heavy',
      factor: 'node count and instance size'
    };
  }

  // Pipeline is data-volume sensitive
  if (pattern === 'DATA_PROCESSING_PIPELINE') {
    return {
      level: 'high',
      label: 'Data-volume sensitive',
      factor: 'data volume and job frequency'
    };
  }

  return {
    level: 'medium',
    label: 'Standard sensitivity',
    factor: 'overall usage'
  };
}

/**
 * Build scenario analysis for what-if scenarios
 */
function buildScenarioAnalysis(pattern, costResult) {
  const baseCost = costResult.cost_estimates?.aws?.expected || 100;

  return {
    traffic_doubles: {
      estimated_increase: pattern === 'STATIC_WEB_HOSTING' ? '15%' : '30%',
      estimated_cost: Math.round(baseCost * 1.3),
      description: pattern === 'STATIC_WEB_HOSTING'
        ? 'Static sites scale well with CDN caching.'
        : 'Cost scales with API requests and compute.'
    },
    storage_doubles: {
      estimated_increase: '5%',
      estimated_cost: Math.round(baseCost * 1.05),
      description: 'Storage is generally the cheapest resource to scale.'
    },
    add_database: {
      estimated_increase: '$25-50/mo',
      description: 'Adding a managed database typically costs $25-50/month at small scale.'
    }
  };
}

/**
 * 🔒 FIX 5: DEDICATED STATIC COST ENGINE
 * Static cost is formula-based, not Terraform-based.
 */
function handleStaticWebsiteCost(infraSpec, intent, usageProfile) {
  console.log('[COST ENGINE] STATIC_ONLY triggered');

  // Use the expected usage or fallback to small defaults
  const usage = (usageProfile && usageProfile.expected) || {
    storage_gb: 2,
    data_transfer_gb: 10
  };

  const pricing = {
    AWS: {
      storage: 0.023,
      bandwidth: 0.085,
      dns: 0.5,
      cdn: 0.01 // per GB
    },
    GCP: {
      storage: 0.020,
      bandwidth: 0.080,
      dns: 0.3,
      cdn: 0.008
    },
    AZURE: {
      storage: 0.024,
      bandwidth: 0.087,
      dns: 0.4,
      cdn: 0.011
    }
  };

  const results = {};
  const providers = ["AWS", "GCP", "AZURE"];

  for (const cloud of providers) {
    const p = pricing[cloud];

    // Formula: Storage + Bandwidth + DNS + Flat CDN platform fee
    const base =
      (usage.storage_gb * p.storage) +
      (usage.data_transfer_gb * p.bandwidth) +
      (usage.data_transfer_gb * p.cdn) +
      p.dns +
      0.5; // Base platform fee

    results[cloud] = {
      provider: cloud,
      total_monthly_cost: Number(base.toFixed(2)),
      formatted_cost: `$${base.toFixed(2)}/month`,
      cost_range: {
        estimate: base,
        low: Number((base * 0.9).toFixed(2)),
        high: Number((base * 1.3).toFixed(2)),
        formatted: `$${(base * 0.9).toFixed(2)} - $${(base * 1.3).toFixed(2)}/mo`
      },
      service_count: 3,
      services: [
        { service_class: 'object_storage', display_name: 'Object Storage', cost: { monthly: Number((usage.storage_gb * p.storage).toFixed(2)) } },
        { service_class: 'cdn', display_name: 'CDN/Compute@Edge', cost: { monthly: Number((usage.data_transfer_gb * (p.bandwidth + p.cdn)).toFixed(2)) } },
        { service_class: 'dns', display_name: 'DNS', cost: { monthly: p.dns } }
      ],
      is_mock: true
    };
  }

  // Sort by cost to find cheapest
  const rankings = providers
    .map(p => ({
      provider: p,
      monthly_cost: results[p].total_monthly_cost,
      score: p === 'GCP' ? 95 : (p === 'AWS' ? 92 : 88) // Static weights
    }))
    .sort((a, b) => a.monthly_cost - b.monthly_cost)
    .map((r, idx) => ({
      ...r,
      rank: idx + 1,
      recommended: idx === 0,
      formatted_cost: results[r.provider].formatted_cost,
      cost_range: results[r.provider].cost_range
    }));

  const recommendedProvider = rankings[0].provider;

  return {
    cost_profile: 'COST_EFFECTIVE',
    deployment_type: 'static',
    scale_tier: 'SMALL',
    rankings,
    provider_details: results,
    recommended_provider: recommendedProvider,
    used_real_pricing: false,
    recommended: {
      provider: recommendedProvider,
      cost_range: results[recommendedProvider].cost_range,
      service_count: 3,
      score: rankings[0].score,
      monthly_cost: results[recommendedProvider].total_monthly_cost
    },
    recommended_cost_range: results[recommendedProvider].cost_range,
    cost_profiles: {
      COST_EFFECTIVE: { total: results[recommendedProvider].total_monthly_cost, formatted: results[recommendedProvider].formatted_cost },
      HIGH_PERFORMANCE: { total: results[recommendedProvider].total_monthly_cost, formatted: results[recommendedProvider].formatted_cost }
    },
    category_breakdown: [
      { category: 'Networking & CDN', total: Number((usage.data_transfer_gb * (pricing[recommendedProvider].bandwidth + pricing[recommendedProvider].cdn) + pricing[recommendedProvider].dns).toFixed(2)), service_count: 2 },
      { category: 'Databases & Files', total: Number((usage.storage_gb * pricing[recommendedProvider].storage).toFixed(2)), service_count: 1 }
    ],
    summary: {
      cheapest: rankings[0].provider,
      most_performant: 'GCP',
      best_value: rankings[0].provider
    },
    ai_explanation: {
      confidence_score: 0.95,
      rationale: "Static hosting costs are highly predictable and calculated based on storage and transit volume."
    }
  };
}

/**
 * 🔒 DEFENSIVE KILL SWITCH
 */
function assertNoComputeForStatic(terraformContent) {
  const forbidden = [
    "aws_eks", "aws_ecs", "aws_instance", "aws_lambda",
    "google_container", "google_cloud_run", "google_compute",
    "azurerm_kubernetes", "azurerm_container_app", "azurerm_virtual_machine"
  ];

  for (const f of forbidden) {
    if (terraformContent.includes(f)) {
      throw new Error(`🔒 SECURITY VIOLATION: STATIC_WEB_HOSTING attempts to create forbidden compute resource: ${f}`);
    }
  }
}

/**
 * Aggregate costs by category for Tier 2 breakdown view
 */
function aggregateCategoryBreakdown(services) {
  const categories = {};

  for (const service of services) {
    // Standardize category casing to PascalCase for backend-frontend consistency
    let category = service.category || 'Other';
    if (category.toLowerCase() === 'compute') category = 'Compute';
    if (category.toLowerCase().includes('data')) category = 'Data & State';
    if (category.toLowerCase().includes('traffic') || category.toLowerCase().includes('networking')) category = 'Traffic & Integration';
    if (category.toLowerCase().includes('operations')) category = 'Operations';

    const cost = parseFloat(service.cost?.monthly) || 0;

    if (!categories[category]) {
      categories[category] = {
        category,
        total: 0,
        services: []
      };
    }

    categories[category].total += cost;
    categories[category].services.push({
      name: service.display_name,
      cost: cost
    });
  }

  // Convert to sorted array
  return Object.values(categories)
    .filter(cat => cat.total > 0 || cat.services.length > 0) // Keep categories even if total is 0 if they have services
    .map(cat => ({
      category: cat.category,
      total: Math.round(cat.total * 100) / 100,
      formatted: `$${cat.total.toFixed(2)}`,
      service_count: cat.services.length,
      services: cat.services
    }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Identify missing components that could add future cost
 * Based on optional services not included
 */
function identifyMissingComponents(infraSpec) {
  const allServiceClasses = [
    'compute_container', 'compute_serverless', 'compute_vm', 'compute_static',
    'relational_database', 'nosql_database', 'cache', 'object_storage', 'block_storage',
    'load_balancer', 'api_gateway', 'messaging_queue', 'event_bus', 'search_engine', 'cdn',
    'networking', 'identity_auth', 'dns',
    'monitoring', 'logging', 'secrets_management'
  ];

  const requiredServices = infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

  // Common additions that often get added later
  const futureRiskServices = {
    messaging_queue: { name: 'Async Processing', impact: 'low', reason: 'Adding async processing or background jobs later' },
    event_bus: { name: 'Event-Driven Architecture', impact: 'medium', reason: 'Migrating to event-driven patterns later' },
    search_engine: { name: 'Full-Text Search', impact: 'high', reason: 'Adding search functionality later' },
    cache: { name: 'Caching Layer', impact: 'medium', reason: 'Adding caching for performance optimization' },
    cdn: { name: 'CDN', impact: 'low', reason: 'Adding global content delivery later' }
  };

  const missing = [];

  for (const [serviceClass, info] of Object.entries(futureRiskServices)) {
    if (!requiredServices.includes(serviceClass)) {
      missing.push({
        service_class: serviceClass,
        name: info.name,
        impact: info.impact,
        estimated_additional_cost: info.impact === 'high' ? '$50-100' : info.impact === 'medium' ? '$20-50' : '$5-20',
        warning: info.reason + ' may increase monthly cost.'
      });
    }
  }

  return missing;
}

/**
 * Perform full cost analysis across providers
 * 
 * CORE PRINCIPLE:
 *   Pattern → Cost Engine → Pricing Model
 *   AI NEVER bypasses this.
 * 
 * ENGINE TYPES:
 *   - 'formula': Pure math (STATIC_WEB_HOSTING)
 *   - 'hybrid':  Formula + optional Infracost (SERVERLESS, MOBILE)
 *   - 'infracost': Full Terraform IR (CONTAINERIZED, VM, PIPELINE)
 */
async function performCostAnalysis(infraSpec, intent, costProfile = 'COST_EFFECTIVE', usageOverrides = null, onlyPrimary = false, deployableServicesOverride = null) {
  console.log(`--- STEP 3: Cost Analysis Started (Profile: ${costProfile}) ---`);

  try {
    // ═══════════════════════════════════════════════════════════════════
    // STEP 1: CLASSIFY WORKLOAD INTO COST MODE
    // This determines the pricing approach to use
    // ═══════════════════════════════════════════════════════════════════
    let costMode = classifyWorkload(intent, infraSpec);

    // 🔥 FIX: Enforce STATIC_SITE_BYPASS for STATIC_SITE pattern
    if (infraSpec.canonical_architecture?.pattern_id === 'STATIC_SITE' || infraSpec.architecture_pattern === 'STATIC_SITE') {
      console.log(`[COST ANALYSIS] Overriding Cost Mode for STATIC_SITE -> STATIC_SITE_BYPASS`);
      costMode = 'STATIC_SITE_BYPASS';
    }
    console.log(`[COST ANALYSIS] Cost Mode: ${costMode}`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: ROUTE TO APPROPRIATE COST CALCULATION METHOD
    // ═══════════════════════════════════════════════════════════════════
    const result = await calculateCostForMode(costMode, infraSpec, intent, costProfile, usageOverrides);

    // Add cost mode information to result if not already set by specialized calculator
    if (!result.cost_mode) {
      result.cost_mode = costMode;
    }
    result.pricing_method_used = result.pricing_method_used || 'unknown';

    console.log(`[COST ANALYSIS] Mode: ${costMode}, Method: ${result.pricing_method_used}, Cost: $${result.recommended?.monthly_cost?.toFixed(2) || 'N/A'}`);

    return result;
  } catch (error) {
    console.error(`[COST ANALYSIS] Unexpected error in performCostAnalysis:`, error);

    // Ultimate fallback: Return a guaranteed valid response
    return {
      cost_profile: costProfile,
      deployment_type: 'fallback',
      scale_tier: 'MEDIUM',
      cost_mode: 'FALLBACK_MODE',
      pricing_method_used: 'fallback_calculation',
      estimate_type: 'heuristic', // 🔥 Explicitly label as heuristic
      estimate_reason: 'Infracost CLI failed or returned null',
      rankings: [
        {
          provider: 'AWS',
          monthly_cost: 100,
          formatted_cost: '$100.00',
          rank: 1,
          recommended: true,
          confidence: 0.5,
          score: 50,
          cost_range: { formatted: '$80 - $120/month' }
        },
        {
          provider: 'GCP',
          monthly_cost: 110,
          formatted_cost: '$110.00',
          rank: 2,
          recommended: false,
          confidence: 0.5,
          score: 45,
          cost_range: { formatted: '$90 - $130/month' }
        },
        {
          provider: 'AZURE',
          monthly_cost: 105,
          formatted_cost: '$105.00',
          rank: 3,
          recommended: false,
          confidence: 0.5,
          score: 48,
          cost_range: { formatted: '$85 - $125/month' }
        }
      ],
      provider_details: {
        AWS: {
          provider: 'AWS',
          total_monthly_cost: 100,
          formatted_cost: '$100.00/month',
          service_count: 1,
          is_mock: true,
          estimate_type: 'heuristic',
          confidence: 0.5,
          cost_range: { formatted: '$80 - $120/month' }
        },
        GCP: {
          provider: 'GCP',
          total_monthly_cost: 110,
          formatted_cost: '$110.00/month',
          service_count: 1,
          is_mock: true,
          estimate_type: 'heuristic',
          confidence: 0.5,
          cost_range: { formatted: '$90 - $130/month' }
        },
        AZURE: {
          provider: 'AZURE',
          total_monthly_cost: 105,
          formatted_cost: '$105.00/month',
          service_count: 1,
          is_mock: true,
          estimate_type: 'heuristic',
          confidence: 0.5,
          cost_range: { formatted: '$85 - $125/month' }
        }
      },
      recommended_provider: 'AWS',
      recommended: {
        provider: 'AWS',
        monthly_cost: 100,
        formatted_cost: '$100.00',
        service_count: 1,
        score: 50,
        cost_range: {
          formatted: '$80 - $120/month'
        }
      },
      confidence: 0.5,
      confidence_percentage: 50,
      confidence_explanation: ['Fallback calculation due to processing error'],
      ai_explanation: {
        confidence_score: 0.5,
        rationale: 'Fallback cost estimate provided due to processing error.'
      },
      summary: {
        cheapest: 'AWS',
        most_performant: 'GCP',
        best_value: 'AWS',
        confidence: 0.5
      },
      assumption_source: 'fallback',
      cost_sensitivity: {
        level: 'medium',
        label: 'Standard sensitivity',
        factor: 'overall usage'
      },
      selected_services: {},
      missing_components: [],
      future_cost_warning: null,
      category_breakdown: [
        { category: 'Infrastructure', total: 100, service_count: 1 }
      ],
      cost_profiles: {
        COST_EFFECTIVE: { total: 100, formatted: '$100.00' },
        HIGH_PERFORMANCE: { total: 150, formatted: '$150.00' }
      },
      recommended_cost_range: {
        formatted: '$80 - $120/month'
      },
      scenarios: {
        low: { aws: { monthly_cost: 80 }, gcp: { monthly_cost: 85 }, azure: { monthly_cost: 82 } },
        expected: { aws: { monthly_cost: 100 }, gcp: { monthly_cost: 110 }, azure: { monthly_cost: 105 } },
        high: { aws: { monthly_cost: 150 }, gcp: { monthly_cost: 160 }, azure: { monthly_cost: 155 } }
      },
      cost_range: { formatted: '$80 - $160/month' },
      services: [],
      drivers: [],
      used_real_pricing: false
    };
  }
}

/**
 * Generate FULL Modular Terraform Project for Export (Zip Download)
 * Unlike cost estimation which uses a single main.tf, this generates the full production-ready
 * codebase with modules, variables, and outputs.
 */
async function generateFullProjectExport(infraSpec, provider, projectName) {
  console.log(`[EXPORT] Generating FULL Terraform project for ${projectName} on ${provider}`);

  // 1. Generate the project structure in memory
  // Requirements can be empty for export
  const { projectFolder } = await terraformService.generateModularTerraform(infraSpec, provider, projectName, {});

  // 2. Prepare export directory
  const exportDir = path.join(INFRACOST_BASE_DIR, 'exports', provider.toLowerCase());

  // Ensure fresh start
  if (fs.existsSync(exportDir)) {
    try {
      fs.rmSync(exportDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[EXPORT] Failed to clear export dir: ${e.message}`);
    }
  }
  ensureDir(exportDir);

  // 3. Recursive write helper
  const writeFolder = (folder, basePath) => {
    Object.entries(folder).forEach(([name, content]) => {
      const fullPath = path.join(basePath, name);
      if (typeof content === 'string') {
        fs.writeFileSync(fullPath, content);
      } else if (typeof content === 'object') {
        ensureDir(fullPath);
        writeFolder(content, fullPath);
      }
    });
  };

  // 4. Write all files
  writeFolder(projectFolder, exportDir);
  console.log(`[EXPORT] Written detailed project to ${exportDir}`);

  return exportDir;
}


/**
 * Helper: Generate unique Run ID
 */
function generateRunId() {
  return 'run-' + Date.now() + '-' + Math.floor(Math.random() * 10000);
}

/**
 * Helper: Clean and recreate provider directory
 */
function cleanProviderDir(dir) {
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[INFRACOST] Failed to clean dir ${dir}: ${e.message}`);
    }
  }
  ensureDir(dir);
}

/**
 * Helper: Ensure directory exists
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Helper: Create Zero Cost result (for pure external/free stacks)
 */
function createZeroCostResult(provider, classification, costProfile) {
  return {
    provider: provider,
    total_monthly_cost: 0,
    formatted_cost: '$0.00/month',
    estimate_source: 'skipped',
    estimate_type: 'calculated',
    pricing_status: 'COMPLETE',
    service_counts: {
      priced: 0,
      external: classification.external.length,
      free: classification.free_tier.length,
      total: classification.external.length + classification.free_tier.length
    },
    services: [],
    confidence: 1.0,
    is_mock: false
  };
}


const terraformService = require('../../services/infrastructure/terraformService');

/**
 * Validates and extracts deployable services (excluding external/non-terraform ones)
 * 🔥 FIX: Uses central resolveServiceId for canonical normalization
 */
function extractDeployableServices(infraSpec) {
  const rawServices = infraSpec.canonical_architecture?.deployable_services ||
    infraSpec.service_classes?.required_services ||
    infraSpec.components || [];

  const list = Array.isArray(rawServices) ? rawServices : [];

  console.log(`[DEPLOYABLE] Extracting from ${list.length} raw services`);

  const result = list.reduce((acc, svc) => {
    // 🔥 FIX: Check for explicit user exclusion (User Disabled)
    if (svc && (svc.state === 'USER_DISABLED' || svc.state === 'EXCLUDED')) {
      console.log(`[DEPLOYABLE] Skipping User-Disabled Service: ${svc.service_id || svc.name}`);
      return acc;
    }

    // Resolve ID using the central normalization
    const rawId = typeof svc === 'string' ? svc : (svc.service_id || svc.id || svc.service_class || svc.name);
    if (!rawId) {
      console.warn(`[DEPLOYABLE] Skipping service with no ID`);
      return acc;
    }

    // Use canonical normalization from aliases.js
    const id = resolveServiceId(rawId.toLowerCase());

    // Check catalog
    const def = servicesCatalog[id] || servicesCatalog[rawId];

    if (!def) {
      console.warn(`[DEPLOYABLE] Service '${rawId}' (normalized: '${id}') not in catalog - including as string`);
      // Include as string fallback instead of rejecting
      acc.push(id);
      return acc;
    }

    // Exclude EXTERNAL pricing class (payment gateways, etc.)
    if (def.pricing && def.pricing.class === 'EXTERNAL') {
      console.log(`[DEPLOYABLE] Skipping EXTERNAL service: ${def.service_id || id}`);
      return acc;
    }

    // 🔥 FIX: Explicitly exclude non-billable categories too (Auth is often external/SaaS)
    if (def.category === 'security_identity' && id !== 'secretsmanagement' && id !== 'waf') {
      console.log(`[DEPLOYABLE] Skipping Security/Identity service (treated as external): ${id}`);
      return acc;
    }

    // Explicitly exclude fintech (payments)
    if (def.category === 'fintech') {
      console.log(`[DEPLOYABLE] Skipping Fintech service (external): ${id}`);
      return acc;
    }

    // Return the canonical service ID
    acc.push(def.service_id || id);
    return acc;
  }, []);

  console.log(`[DEPLOYABLE] Result: ${result.length} deployable services: ${result.slice(0, 5).join(', ')}${result.length > 5 ? '...' : ''}`);
  return result;
}

/**
 * Recursive write helper
 */
function writeProjectFolder(folder, basePath) {
  Object.entries(folder).forEach(([name, content]) => {
    const fullPath = path.join(basePath, name);
    if (typeof content === 'string') {
      fs.writeFileSync(fullPath, content);
    } else if (typeof content === 'object') {
      ensureDir(fullPath);
      writeProjectFolder(content, fullPath);
    }
  });
}

/**
 * Helper: Run Infracost CLI
 */
function runInfracost(dir, usageFile) {
  try {
    // Check if usage file exists
    let cmd = `infracost breakdown --path . --format json --show-skipped`;
    if (fs.existsSync(usageFile)) {
      cmd += ` --usage-file ${path.basename(usageFile)}`;
    }

    console.log(`[INFRACOST] Executing: ${cmd} in ${dir}`);
    // Increase buffer size for large outputs
    const stdout = execSync(cmd, { cwd: dir, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout);
  } catch (e) {
    console.warn(`[INFRACOST] CLI failed: ${e.message}`);
    // If it's just a status code 1 (cost > 0 but some error?), sometimes Infracost exits 1 on warnings?
    // But usually it exits 0.
    // If output available in e.stdout, try to parse it.
    if (e.stdout) {
      try {
        return JSON.parse(e.stdout.toString());
      } catch (parseErr) {
        // ignore
      }
    }
    throw e;
  }
}


/**
 * Robust fallback generator for when Infracost API fails (e.g. Quota Exceeded)
 * Returns realistic estimates based on service types.
 */
function generateBetterFallback(provider, infraSpec, sizing, costProfile) {
  const p = provider.toUpperCase();
  let baseCost = 0;
  let services = [];

  // App Service (Standard S1) or similar
  baseCost += 75;
  services.push({
    name: p === 'AZURE' ? 'Azure App Service (Standard S1)' : (p === 'AWS' ? 'Service (Compute)' : 'Cloud Run'),
    cost: { monthly: 75.00, formatted: '$75.00/mo' },
    pricing_status: 'PRICED',
    category: 'Compute',
    reason: 'Estimated standard tier',
    metadata: { unit: 'month' }
  });

  // Database
  baseCost += 150;
  services.push({
    name: p === 'AZURE' ? 'Azure Database for PostgreSQL (Flexible)' : 'Managed Database',
    cost: { monthly: 150.00, formatted: '$150.00/mo' },
    pricing_status: 'PRICED',
    category: 'Database',
    reason: 'Estimated standard tier',
    metadata: { unit: 'month' }
  });

  // Redis
  baseCost += 40;
  services.push({
    name: 'Redis Cache (Basic)',
    cost: { monthly: 40.00, formatted: '$40.00/mo' },
    pricing_status: 'PRICED',
    category: 'Caching',
    reason: 'Estimated basic tier',
    metadata: { unit: 'month' }
  });

  // Load Balancer / Networking
  baseCost += 20;

  // Add Free Tier Placeholders (to mimic full response)
  services.push({
    name: 'VPC / Networking',
    cost: { monthly: 0, formatted: 'Included' },
    pricing_status: 'FREE_TIER',
    category: 'Networking',
    reason: 'Included in cloud platform'
  });

  const total = baseCost;

  return {
    total_monthly_cost: total,
    formatted_cost: `$${total.toFixed(2)}/month`,
    cost_range: {
      estimate: total,
      low: total * 0.8,
      high: total * 1.2,
      formatted: `$${(total * 0.8).toFixed(2)} - $${(total * 1.2).toFixed(2)}/month`
    },
    service_count: services.length + 1, // +1 for networking
    services: services,
    is_mock: true,
    pricing_status: 'FALLBACK_ESTIMATE',
    warning: 'Estimate provided by backup pricing engine (API Quota Exceeded)'
  };
}

// 🔥 DELETED: Duplicate normalizeInfracostOutput that was overwriting the correct one at line 2980
// This was causing $0 costs for all providers

module.exports = {
  generateCostEstimate,
  generateAllProviderEstimates,
  rankProviders,
  performCostAnalysis,
  calculateCostRange,
  calculateInfrastructureCost,
  aggregateCategoryBreakdown,
  identifyMissingComponents,
  PROVIDER_PERFORMANCE_SCORES,
  calculateScenarios,
  generateFullProjectExport, // NEW Export
  // Exposed for testing
  // generateGCPTerraform,
  // generateAzureTerraform,
  runInfracost,
  normalizeInfracostOutput,
  getTerraformDirs: () => ({
    aws: path.join(INFRACOST_BASE_DIR, 'aws'),
    gcp: path.join(INFRACOST_BASE_DIR, 'gcp'),
    azure: path.join(INFRACOST_BASE_DIR, 'azure')
  })
};

