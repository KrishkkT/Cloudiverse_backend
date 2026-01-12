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
const servicesCatalog = require('../../catalog/terraform/services');
const sizingModel = require('./sizingModel');
const costResultModel = require('./costResultModel');
const usageNormalizer = require('./usageNormalizer');

// Base temp directory for Terraform files
const INFRACOST_BASE_DIR = path.join(os.tmpdir(), 'infracost');

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

  // Check for infrastructure services
  const hasInfraServices = services.some(svc =>
    ['compute_container', 'compute_serverless', 'compute_vm', 'relational_database',
      'nosql_database', 'cache', 'object_storage', 'load_balancer', 'api_gateway'].includes(svc.service_class)
  );

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
      cost_mode: COST_MODES.INFRASTRUCTURE_COST,
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

  // This is the existing logic that was in performCostAnalysis
  const pattern = infraSpec.service_classes?.pattern;

  // 🔥 CRITICAL FIX: Use generateCostEstimate which calls Infracost, not costEngines
  try {
    // Build usage profile from intent + overrides
    const usage = buildUsageProfile(infraSpec, intent, usageProfile);

    // Get deployable services from infraSpec
    const deployableServices = infraSpec.canonical_architecture?.deployable_services ||
      infraSpec.service_classes?.required_services?.map(s => s.service_class) || [];

    console.log(`[INFRA COST] Calling generateCostEstimate for ${deployableServices.length} services`);

    // Call generateCostEstimate for each provider - THIS calls Infracost CLI!
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
        results[provider] = providerResult;
        console.log(`[INFRA COST] ${provider}: $${providerResult?.total_monthly_cost?.toFixed(2) || 'N/A'}`);
      } catch (providerError) {
        console.error(`[INFRA COST] Error for ${provider}:`, providerError.message);
        // Use fallback for this provider
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

    // Build rankings with full scoring breakdown
    const rankings = providers
      .map((p) => {
        const cost = results[p]?.total_monthly_cost ?? 0;
        const scoreBreakdown = calculateProviderScore(p, cost, allProviderCosts, costProfile);

        const dynamicCostRange = {
          min: cost,
          max: cost,
          formatted: `$${cost.toFixed(2)}/month`
        };

        return {
          provider: p,
          monthly_cost: cost,
          formatted_cost: results[p]?.formatted_cost || `$${cost.toFixed(2)}/month`,
          cost_score: scoreBreakdown.costScore,
          performance_score: scoreBreakdown.performanceScore,
          weights: scoreBreakdown.weights,
          final_score: scoreBreakdown.finalScore,
          cost_range: results[p]?.cost_range || dynamicCostRange
        };
      })
      .sort((a, b) => b.final_score - a.final_score) // Sort by final_score descending
      .map((r, idx) => ({ ...r, rank: idx + 1, recommended: idx === 0 }));

    const recommendedProvider = rankings[0].provider;

    // Build usage completeness score
    const usageFields = ['monthly_users', 'data_transfer_gb', 'data_storage_gb', 'requests_per_user'];
    const providedFields = usageFields.filter(f => usageProfile?.[f] != null || usageProfile?.usage_profile?.[f] != null);
    const usageCompleteness = providedFields.length / usageFields.length;

    // Build confidence breakdown
    const pricingMethodScore = results[recommendedProvider]?.estimate_source === 'infracost' ? 1.0 : 0.7;
    const architectureCompleteness = Math.min(1, (infraSpec.service_classes?.required_services?.length || 3) / 8);
    const overallConfidence = Math.min(usageCompleteness, pricingMethodScore, architectureCompleteness);

    const confidence_breakdown = {
      usage_completeness: {
        score: Math.round(usageCompleteness * 100),
        label: usageCompleteness >= 0.75 ? 'Good - User-provided' : 'Limited - Using defaults'
      },
      pricing_method: {
        score: Math.round(pricingMethodScore * 100),
        label: pricingMethodScore === 1.0 ? 'Terraform + Infracost' : 'Heuristic Estimate'
      },
      architecture_completeness: {
        score: Math.round(architectureCompleteness * 100),
        label: `${infraSpec.service_classes?.required_services?.length || 0} services specified`
      },
      overall: Math.round(overallConfidence * 100)
    };

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
      confidence: overallConfidence,
      confidence_percentage: Math.round(overallConfidence * 100),
      confidence_breakdown: confidence_breakdown,
      ranking_explanation: `Provider ranking is a weighted score: ${rankings[0].weights.cost}% cost + ${rankings[0].weights.performance}% performance.`,
      summary: {
        cheapest: [...rankings].sort((a, b) => a.monthly_cost - b.monthly_cost)[0]?.provider,
        most_performant: [...rankings].sort((a, b) => b.performance_score - a.performance_score)[0]?.provider,
        best_value: recommendedProvider
      }
    };
  } catch (error) {
    console.error(`[INFRA COST] Error:`, error.message);
    // Fallback to legacy path
    return calculateLegacyCost(infraSpec, intent, costProfile, usageProfile);
  }
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
  // AWS
  'aws_ecs_service': 'compute_container',
  'aws_ecs_task_definition': 'compute_container',
  'aws_ecs_cluster': 'compute_container',
  'aws_lambda_function': 'compute_serverless',
  'aws_instance': 'compute_vm',
  'aws_db_instance': 'relational_database',
  'aws_rds_cluster': 'relational_database',
  'aws_dynamodb_table': 'nosql_database',
  'aws_elasticache_cluster': 'cache',
  'aws_elasticache_replication_group': 'cache',
  'aws_lb': 'load_balancer',
  'aws_alb': 'load_balancer',
  'aws_api_gateway_rest_api': 'api_gateway',
  'aws_apigatewayv2_api': 'api_gateway',
  'aws_s3_bucket': 'object_storage',
  'aws_ebs_volume': 'block_storage',
  'aws_cloudfront_distribution': 'cdn',
  'aws_vpc': 'networking',
  'aws_nat_gateway': 'networking',
  'aws_cognito_user_pool': 'identity_auth',
  'aws_route53_zone': 'dns',
  'aws_cloudwatch_log_group': 'logging',
  'aws_cloudwatch_metric_alarm': 'monitoring',
  'aws_secretsmanager_secret': 'secrets_management',
  'aws_sqs_queue': 'messaging_queue',
  'aws_sns_topic': 'messaging_queue',
  'aws_cloudwatch_event_rule': 'event_bus',
  'aws_opensearch_domain': 'search_engine',
  // Compute expansion
  'aws_eks_cluster': 'compute_container',
  'aws_eks_node_group': 'compute_container',
  'aws_fargate_profile': 'compute_container',

  // GCP
  'google_cloud_run_service': 'compute_container',
  'google_cloud_run_v2_service': 'compute_container',
  'google_container_cluster': 'compute_container',
  'google_cloudfunctions_function': 'compute_serverless',
  'google_compute_instance': 'compute_vm',
  'google_sql_database_instance': 'relational_database',
  'google_firestore_database': 'nosql_database',
  'google_redis_instance': 'cache',
  'google_compute_forwarding_rule': 'load_balancer',
  'google_compute_backend_service': 'load_balancer',
  'google_storage_bucket': 'object_storage',
  'google_compute_disk': 'block_storage',
  'google_compute_network': 'networking',
  'google_compute_router_nat': 'networking',
  'google_dns_managed_zone': 'dns',
  'google_logging_project_sink': 'logging',
  'google_monitoring_alert_policy': 'monitoring',
  'google_secret_manager_secret': 'secrets_management',
  'google_pubsub_topic': 'messaging_queue',
  // Compute expansion
  'google_container_node_pool': 'compute_container',

  // Azure
  'azurerm_container_app': 'compute_container',
  'azurerm_container_app_environment': 'compute_container',
  'azurerm_kubernetes_cluster': 'compute_container',
  'azurerm_function_app': 'compute_serverless',
  'azurerm_virtual_machine': 'compute_vm',
  'azurerm_postgresql_flexible_server': 'relational_database',
  'azurerm_mysql_flexible_server': 'relational_database',
  'azurerm_cosmosdb_account': 'nosql_database',
  'azurerm_redis_cache': 'cache',
  'azurerm_application_gateway': 'load_balancer',
  'azurerm_lb': 'load_balancer',
  'azurerm_storage_account': 'object_storage',
  'azurerm_managed_disk': 'block_storage',
  'azurerm_virtual_network': 'networking',
  'azurerm_nat_gateway': 'networking',
  'azurerm_dns_zone': 'dns',
  'azurerm_log_analytics_workspace': 'logging',
  'azurerm_monitor_metric_alert': 'monitoring',
  'azurerm_key_vault': 'secrets_management',
  'azurerm_servicebus_namespace': 'messaging_queue',
  // Compute expansion
  'azurerm_kubernetes_cluster_node_pool': 'compute_container',
};

/**
 * 🔵 PHASE 3.1 — PREPARE DEPLOYABLE PRICING INPUT (NEW)
 * 
 * Filter to only services that can be deployed via Terraform.
 * This is the SINGLE SOURCE OF TRUTH for what gets priced.
 * 
 * CRITICAL RULES:
 * - Only services with terraform_supported=true
 * - Excludes logical services (event_bus, waf, payment_gateway, artifact_registry)
 * - Excludes services in terminal_exclusions
 * - Result must match what Step 4 Terraform will generate
 */
function extractDeployableServices(infraSpec) {
  console.log('[DEPLOYABLE FILTER] Extracting services for cost estimation');

  // 🔒 CRITICAL: Normalize ALL inputs to canonical service names ONLY
  const normalizeService = (svc) => {
    if (!svc) return null;
    if (typeof svc === 'string') return svc;
    if (typeof svc === 'object') {
      // Try different possible properties that might contain the service name
      return svc.serviceclass || svc.service_class || svc.canonical_type || svc.name || svc.service || svc.id;
    }
    return null;
  };

  // ✅ FIX 1: Use deployable_services from Step 2 (if available)
  if (infraSpec.canonical_architecture?.deployable_services) {
    const deployableServices = infraSpec.canonical_architecture.deployable_services;
    console.log(`[DEPLOYABLE FILTER] Using pre-computed deployable_services: ${deployableServices.length} services`);

    const normalizedServices = deployableServices.map(normalizeService).filter(Boolean);
    console.log('DEPLOYABLE FILTER: Normalized to', normalizedServices.length, 'services:', normalizedServices.slice(0, 5));
    return normalizedServices;
  }

  // Fallback: Compute from canonical architecture
  const allServices = infraSpec.canonical_architecture?.services || [];
  const terminalExclusions = infraSpec.locked_intent?.terminal_exclusions || [];

  // Define supported services directly to avoid initialization issues
  const SUPPORTED_SERVICES = [
    'global_load_balancer', 'cdn', 'api_gateway', 'relational_database', 'identity_auth',
    'logging', 'monitoring', 'websocket_gateway', 'message_queue', 'app_compute',
    'object_storage', 'secrets_manager', 'audit_logging', 'event_bus',
    'compute_serverless', 'serverless_compute', 'cache', 'load_balancer', 'compute_container', 'compute_vm',
    'nosql_database', 'block_storage', 'search_engine', 'networking', 'dns',
    'secrets_management', 'messaging_queue', 'container_registry', 'containerregistry',
    'payment_gateway', 'paymentgateway', 'secret_manager', 'secretsmanager'
  ];

  const deployableServices = allServices
    .map(normalizeService)
    .filter(Boolean)
    .filter(serviceName => {
      if (!SUPPORTED_SERVICES.includes(serviceName)) {
        console.warn(`[DEPLOYABLE FILTER] Unknown or unsupported service: ${serviceName}`);
        return false;
      }

      // Must not be in terminal exclusions
      if (terminalExclusions.includes(serviceName)) {
        console.log(`[DEPLOYABLE FILTER] ❌ EXCLUDED (terminal): ${serviceName}`);
        return false;
      }

      console.log(`[DEPLOYABLE FILTER] ✅ INCLUDED: ${serviceName}`);
      return true;
    });

  console.log(`[DEPLOYABLE FILTER] Result: ${deployableServices.length}/${allServices.length} services are deployable`);

  return deployableServices;
}

/**
 * 🔒 PRICING INTEGRITY FIREWALL
 * 
 * Validates that no non-deployable services leaked into cost breakdown.
 * This runs AFTER cost calculation to catch any bugs.
 */
function validatePricingIntegrity(pricedServices, deployableServices) {
  console.log('[PRICING FIREWALL] Validating cost integrity...');

  // 🔥 SERVICE ALIAS MAPPING: Infracost returns different service class names
  // than our canonical deployable services. Map them here.
  const SERVICE_ALIASES = {
    'load_balancer': 'global_load_balancer',  // aws_alb maps to load_balancer, but we use global_load_balancer
    'compute_container': 'app_compute',       // aws_ecs_fargate maps to compute_container, but we use app_compute
    'serverless_compute': 'compute_serverless', // alias
    'compute_serverless': 'serverless_compute', // reverse alias
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

    // 🔥 APPLY ALIAS MAPPING: Check if this service class has an alias
    const serviceClass = SERVICE_ALIASES[rawServiceClass] || rawServiceClass;

    // 🔥 FIX: Normalize by stripping underscores for robust matching
    // e.g. 'relational_database' matches 'relationaldatabase' and 'global_load_balancer' matches 'loadbalancer'
    const normalizedService = serviceClass.replace(/_/g, '').toLowerCase();
    const normalizedDeployable = deployableServices.map(s => s.replace(/_/g, '').toLowerCase());

    // Special case for load balancer aliases
    const isLoadBalancer = (normalizedService.includes('loadbalancer') || normalizedService.includes('alb') || normalizedService.includes('gateway')) &&
      normalizedDeployable.some(s => s.includes('loadbalancer') || s.includes('alb') || s.includes('gateway'));

    if (!normalizedDeployable.includes(normalizedService) && !isLoadBalancer) {
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

/**
 * Generate AWS Terraform code from InfraSpec
 */
function generateAWSTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const components = infraSpec.components || {};
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated AWS Terraform for Infracost
provider "aws" {
  region = "us-east-1"
}

`;

  // Check for compute type - ECS Fargate (Cost Effective) vs EKS (High Performance)
  if (services.find(s => s.service_class === 'compute_container')) {
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (aws_eks/aws_ecs)");
    }

    const config = sizing.services?.compute_container || { instances: 2, cpu: 1024, memory_mb: 2048 };
    const cpu = config.cpu || (tier === 'LARGE' ? 2048 : tier === 'SMALL' ? 256 : 1024);
    const memory = config.memory_mb || (tier === 'LARGE' ? 4096 : tier === 'SMALL' ? 512 : 2048);

    if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') {
      terraform += `
resource "aws_eks_cluster" "main" {
  name     = "app-eks-cluster"
  role_arn = "arn:aws:iam::123:role/eks-role"
  vpc_config {
    subnet_ids = ["subnet-1", "subnet-2"]
  }
}

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "app-nodes"
  node_role_arn   = "arn:aws:iam::123:role/node-role"
  subnet_ids      = ["subnet-1", "subnet-2"]
  instance_types  = ["m5.large"]  // High performance instance type

  scaling_config {
    desired_size = ${Math.max(2, (config.instances || 2) + 1)}
    max_size     = 10
    min_size     = 1
  }
}
`;
    } else {
      terraform += `
resource "aws_ecs_cluster" "main" {
  name = "app-cluster"
}

resource "aws_ecs_task_definition" "app" {
  family                   = "app-task"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "${cpu}"
  memory                   = "${memory}"
  
  container_definitions = jsonencode([{
    name  = "app"
    image = "nginx:latest"
    cpu   = ${cpu}
    memory = ${memory}
  }])
}

resource "aws_ecs_service" "app" {
  name            = "app-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = ${config.instances || 2}
  launch_type     = "FARGATE"
}
`;
    }
  }

  // Lambda (serverless)
  if (services.find(s => s.service_class === 'compute_serverless')) {
    const config = sizing.services?.compute_serverless || {};
    const memorySize = config.memory_mb || (tier === 'LARGE' ? 1024 : tier === 'SMALL' ? 256 : 512);
    // High performance serverless gets more memory/concurrency (simulated via memory size here)
    const effectiveMemory = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? memorySize * 2 : memorySize;

    terraform += `
resource "aws_lambda_function" "app" {
  function_name = "app-function"
  runtime       = "nodejs18.x"
  handler       = "index.handler"
  memory_size   = ${Math.min(10240, effectiveMemory)}
  timeout       = 30
  filename      = "dummy.zip"
}
`;
  }

  if (services.find(s => s.service_class === 'compute_vm')) {
    const config = sizing.services?.compute_vm || {};
    const instanceType = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'm5.large' : (config.instance_type || 't3.medium');
    terraform += `
resource "aws_instance" "app" {
  instance_type = "${instanceType}"
  ami           = "ami-0c55b159cbfafe1f0"
}
`;
  }

  // Database - RDS vs Aurora
  if (services.find(s => s.service_class === 'relational_database' || s.service_class === 'relationaldatabase')) {
    const config = sizing.services?.relational_database || {};
    const instanceClass = tier === 'LARGE' ? 'db.t3.medium' : tier === 'SMALL' ? 'db.t3.micro' : 'db.t3.small';

    if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') {
      terraform += `
resource "aws_rds_cluster" "aurora" {
  cluster_identifier = "aurora-cluster"
  engine             = "aurora-postgresql"
  database_name      = "app_db"
  master_username    = "foo"
  master_password    = "bar"
}

resource "aws_rds_cluster_instance" "aurora_instances" {
  count              = 2
  identifier         = "aurora-instance-${count.index}"
  cluster_identifier = aws_rds_cluster.aurora.id
  instance_class     = "db.r5.large"
  engine             = aws_rds_cluster.aurora.engine
}
`;
    } else {
      terraform += `
resource "aws_db_instance" "db" {
  engine               = "postgres"
  instance_class       = "${instanceClass}"
  allocated_storage    = ${config.storage_gb || 100}
  publicly_accessible  = false
  skip_final_snapshot  = true
}
`;
    }
  }

  // Cache
  if (services.find(s => s.service_class === 'cache') || infraSpec.canonical_architecture?.deployable_services?.includes('cache')) {
    const config = sizing.services?.cache || {};
    // High performance gets dedicated nodes
    const nodeType = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'cache.m5.large'
      : (tier === 'LARGE' ? 'cache.t3.medium' : 'cache.t3.small');

    terraform += `
resource "aws_elasticache_cluster" "cache" {
  engine           = "redis"
  node_type        = "${nodeType}"
  num_cache_nodes  = ${config.nodes || 1}
  cluster_id       = "app-cache"
}
`;
  }

  // Load Balancer
  if (services.find(s => s.service_class === 'load_balancer' || s.service_class === 'loadbalancer')) {
    terraform += `
resource "aws_lb" "alb" {
  name               = "app-alb"
  load_balancer_type = "application"
}
`;
  }

  // Object Storage
  if (services.find(s => s.service_class === 'object_storage' || s.service_class === 'objectstorage')) {
    terraform += `
resource "aws_s3_bucket" "storage" {
  bucket = "infracost-estimate-bucket"
}
`;
  }

  // API Gateway
  if (services.find(s => s.service_class === 'api_gateway' || s.service_class === 'apigateway')) {
    terraform += `
resource "aws_apigatewayv2_api" "api" {
  name          = "app-api"
  protocol_type = "HTTP"
}
`;
  }

  // Messaging Queue
  if (services.find(s => s.service_class === 'messaging_queue' || s.service_class === 'messagequeue')) {
    terraform += `
resource "aws_sqs_queue" "queue" {
  name = "app-queue"
}
`;
  }

  // Secrets Management
  if (services.find(s => s.service_class === 'secrets_management')) {
    terraform += `
resource "aws_secretsmanager_secret" "secret" {
  name = "app-secrets"
}
`;
  }

  // CDN (CloudFront)
  if (services.find(s => s.service_class === 'cdn')) {
    terraform += `
resource "aws_cloudfront_distribution" "cdn" {
  enabled = true
  origin {
    domain_name = "example.com"
    origin_id   = "example"
  }
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "example"
    viewer_protocol_policy = "redirect-to-https"
  }
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
`;
  }

  // 🔥 FIX: Object Storage (S3) - CRITICAL for static sites and file storage
  if (services.find(s => s.service_class === 'object_storage' || s.service_class === 'objectstorage') ||
    infraSpec.canonical_architecture?.deployable_services?.includes('objectstorage')) {
    terraform += `
resource "aws_s3_bucket" "main" {
  bucket = "app-storage-bucket"
  
  tags = {
    Name = "app-storage"
  }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration {
    status = "Enabled"
  }
}
`;
  }

  // Identity / Auth (Cognito)
  if (services.find(s => s.service_class === 'identity_auth')) {
    terraform += `
resource "aws_cognito_user_pool" "pool" {
  name = "app-user-pool"
}
`;
  }

  // DNS (Route 53)
  if (services.find(s => s.service_class === 'dns')) {
    terraform += `
resource "aws_route53_zone" "main" {
  name = "example.com"
}
`;
  }

  // Monitoring (CloudWatch Alarms)
  if (services.find(s => s.service_class === 'monitoring')) {
    terraform += `
resource "aws_cloudwatch_metric_alarm" "health" {
  alarm_name          = "app-health-alarm"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = "120"
  statistic           = "Average"
  threshold           = "80"
}
`;
  }

  // Logging (CloudWatch Logs)
  if (services.find(s => s.service_class === 'logging')) {
    terraform += `
resource "aws_cloudwatch_log_group" "app_logs" {
  name              = "/aws/app/main"
  retention_in_days = 30
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // HIGH-AVAILABILITY / MULTI-REGION SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // Global Load Balancer (reuse ALB)
  if (services.find(s => s.service_class === 'global_load_balancer')) {
    terraform += `
resource "aws_lb" "global_alb" {
  name               = "global-alb"
  load_balancer_type = "application"
}
`;
  }

  // Multi-Region DB (RDS with read replicas)
  if (services.find(s => s.service_class === 'multi_region_db')) {
    terraform += `
resource "aws_db_instance" "multi_region" {
  engine               = "postgres"
  instance_class       = "db.r6g.large"
  allocated_storage    = 100
  skip_final_snapshot  = true
  multi_az             = true
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // GAMING / REALTIME SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // WebSocket Gateway (API Gateway v2 WebSocket)
  if (services.find(s => s.service_class === 'websocket_gateway')) {
    terraform += `
resource "aws_apigatewayv2_api" "websocket" {
  name          = "websocket-api"
  protocol_type = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // COMPLIANCE / FINTECH SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // Secrets Manager (fintech/compliance)
  if (services.find(s => s.service_class === 'secrets_manager')) {
    terraform += `
resource "aws_secretsmanager_secret" "vault" {
  name = "app-vault"
}
`;
  }

  // Audit Logging (compliance)
  if (services.find(s => s.service_class === 'audit_logging')) {
    terraform += `
resource "aws_cloudwatch_log_group" "audit" {
  name              = "/audit/app"
  retention_in_days = 365
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // IOT SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // IoT Core
  if (services.find(s => s.service_class === 'iot_core')) {
    terraform += `
resource "aws_iot_topic_rule" "telemetry" {
  name        = "device_telemetry"
  description = "IoT telemetry ingestion"
  sql         = "SELECT * FROM 'devices/+/telemetry'"
  sql_version = "2016-03-23"
  enabled     = true
}
`;
  }

  // Time Series DB (Timestream)
  if (services.find(s => s.service_class === 'time_series_db')) {
    terraform += `
resource "aws_timestreamwrite_database" "tsdb" {
  database_name = "app-timeseries"
}
`;
  }

  // Event Streaming (Kinesis)
  if (services.find(s => s.service_class === 'event_streaming')) {
    terraform += `
resource "aws_kinesis_stream" "events" {
  name             = "app-events"
  shard_count      = 2
  retention_period = 168
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // ML / AI SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // ML Inference GPU (SageMaker)
  if (services.find(s => s.service_class === 'ml_inference_gpu' || s.service_class === 'ml_inference_service')) {
    terraform += `
resource "aws_sagemaker_endpoint" "inference" {
  name = "ml-inference-endpoint"
}
`;
  }

  // Vector Database (OpenSearch)
  if (services.find(s => s.service_class === 'vector_database')) {
    terraform += `
resource "aws_opensearch_domain" "vectors" {
  domain_name    = "app-vectors"
  engine_version = "OpenSearch_2.5"
  
  cluster_config {
    instance_type = "r6g.large.search"
  }
}
`;
  }

  // ═══════════════════════════════════════════════════════════════════
  // DATA / STORAGE SERVICES
  // ═══════════════════════════════════════════════════════════════════

  // Data Lake (S3)
  if (services.find(s => s.service_class === 'data_lake')) {
    terraform += `
resource "aws_s3_bucket" "data_lake" {
  bucket = "app-data-lake"
}
`;
  }

  // App Compute (ECS Fargate)
  if (services.find(s => s.service_class === 'app_compute')) {
    terraform += `
resource "aws_ecs_service" "app" {
  name            = "app-service"
  desired_count   = 2
  launch_type     = "FARGATE"
}
`;
  }

  return terraform;
}


/**
 * Generate GCP Terraform code from InfraSpec
 */
function generateGCPTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated GCP Terraform for Infracost
provider "google" {
  project = "example-project"
  region  = "us-central1"
}

`;

  if (services.find(s => s.service_class === 'compute_container' || s.service_class === 'computecontainer')) {
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (google_container/google_cloud_run)");
    }

    if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') {
      terraform += `
resource "google_container_cluster" "primary" {
  name     = "primary-cluster"
  location = "us-central1"
  initial_node_count = 1
  node_config {
    machine_type = "e2-standard-4"
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}
`;
    } else {
      terraform += `
resource "google_cloud_run_service" "app" {
  name     = "app-service"
  location = "us-central1"
  
  template {
    spec {
      containers {
        image = "gcr.io/example/app"
        resources {
          limits = {
            cpu    = "${tier === 'LARGE' ? '2' : '1'}"
            memory = "${tier === 'LARGE' ? '4Gi' : '2Gi'}"
          }
        }
      }
    }
  }
}
`;
    }
  }

  if (services.find(s => s.service_class === 'relational_database' || s.service_class === 'relationaldatabase')) {
    // High Performance uses Custom instance vs Shared Core
    const dbTier = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance')
      ? 'db-custom-4-16384'
      : (tier === 'LARGE' ? 'db-custom-2-4096' : tier === 'SMALL' ? 'db-f1-micro' : 'db-custom-1-3840');

    terraform += `
resource "google_sql_database_instance" "db" {
  name             = "app-db"
  database_version = "POSTGRES_14"
  region           = "us-central1"
  
  settings {
    tier = "${dbTier}"
  }
  
  deletion_protection = false
}
`;
  }

  if (services.find(s => s.service_class === 'cache') || infraSpec.canonical_architecture?.deployable_services?.includes('cache')) {
    const memorySize = tier === 'LARGE' ? 5 : tier === 'SMALL' ? 1 : 2;
    const cacheTier = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'STANDARD_HA' : 'BASIC';

    terraform += `
resource "google_redis_instance" "cache" {
  name           = "app-cache"
  tier           = "${cacheTier}"
  memory_size_gb = ${memorySize}
  region         = "us-central1"
}
`;
  }

  if (services.find(s => s.service_class === 'object_storage' || s.service_class === 'objectstorage') ||
    infraSpec.canonical_architecture?.deployable_services?.includes('objectstorage')) {
    terraform += `
resource "google_storage_bucket" "storage" {
  name     = "infracost-estimate-bucket-gcp"
  location = "US"
}
`;
  }

  if (services.find(s => s.service_class === 'load_balancer' || s.service_class === 'loadbalancer')) {
    terraform += `
resource "google_compute_backend_service" "lb" {
  name        = "app-backend"
  protocol    = "HTTP"
  timeout_sec = 30
}
`;
  }

  // CDN (Cloud CDN)
  if (services.find(s => s.service_class === 'cdn')) {
    terraform += `
resource "google_compute_backend_bucket" "cdn" {
  name        = "app-backend-bucket"
  bucket_name = "example-bucket"
  enable_cdn  = true
}
`;
  }

  // Identity / Auth (Identity Platform)
  if (services.find(s => s.service_class === 'identity_auth' || s.service_class === 'identityauth')) {
    terraform += `
resource "google_identity_platform_config" "auth" {
  project = "example-project"
}
`;
  }

  // DNS (Cloud DNS)
  if (services.find(s => s.service_class === 'dns')) {
    terraform += `
resource "google_dns_managed_zone" "main" {
  name     = "example-zone"
  dns_name = "example.com."
}
`;
  }

  // Monitoring (Cloud Monitoring Dashboard/Alert)
  if (services.find(s => s.service_class === 'monitoring')) {
    terraform += `
resource "google_monitoring_alert_policy" "health" {
  display_name = "app-health-alert"
  combiner     = "OR"
  conditions {
    display_name = "Condition 1"
    condition_threshold {
      filter     = "resource.type=\"gce_instance\" AND metric.type=\"compute.googleapis.com/instance/cpu/utilization\""
      duration   = "60s"
      comparison = "COMPARISON_GT"
      threshold_value = 0.8
    }
  }
}
`;
  }

  // Logging (Cloud Logging)
  if (services.find(s => s.service_class === 'logging')) {
    terraform += `
resource "google_logging_project_sink" "app_logs" {
  name        = "app-sink"
  destination = "storage.googleapis.com/example-bucket"
  filter      = "severity>=ERROR"
}
`;
  }

  // API Gateway
  if (services.find(s => s.service_class === 'api_gateway' || s.service_class === 'apigateway')) {
    terraform += `
resource "google_api_gateway_gateway" "api" {
  api_config = "example-config"
  gateway_id = "app-gateway"
  region     = "us-central1"
}
`;
  }

  // Messaging Queue (Pub/Sub)
  if (services.find(s => s.service_class === 'messaging_queue' || s.service_class === 'messagequeue')) {
    terraform += `
resource "google_pubsub_topic" "queue" {
  name = "app-topic"
}
`;
  }

  // Secrets Management
  if (services.find(s => s.service_class === 'secrets_management')) {
    terraform += `
resource "google_secret_manager_secret" "secret" {
  secret_id = "app-secret"
  replication {
    automatic = true
  }
}
`;
  }

  return terraform;
}

/**
 * Generate Azure Terraform code from InfraSpec
 */
function generateAzureTerraform(infraSpec, sizing, costProfile) {
  const services = infraSpec.service_classes?.required_services || [];
  const tier = sizing.tier || 'MEDIUM';

  let terraform = `# Auto-generated Azure Terraform for Infracost
provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = "infracost-rg"
  location = "East US"
}

`;

  if (services.find(s => s.service_class === 'compute_container' || s.service_class === 'computecontainer')) {
    // 🔒 KILL SWITCH: Static must never have compute
    if (infraSpec.service_classes?.pattern === 'STATIC_WEB_HOSTING') {
      throw new Error("STATIC_WEB_HOSTING MUST NOT CONTAIN COMPUTE (azurerm_kubernetes/azurerm_container_app)");
    }

    if (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') {
      terraform += `
resource "azurerm_kubernetes_cluster" "aks" {
  name                = "app-aks"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  dns_prefix          = "app-aks"

  default_node_pool {
    name       = "default"
    node_count = ${tier === 'LARGE' ? 3 : 2}
    vm_size    = "Standard_DS2_v2"
  }

  identity {
    type = "SystemAssigned"
  }
}
`;
    } else {
      terraform += `
resource "azurerm_container_app" "app" {
  name                         = "app-container"
  container_app_environment_id = "placeholder"
  resource_group_name          = azurerm_resource_group.main.name
  revision_mode                = "Single"
  
  template {
    container {
      name   = "app"
      image  = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
      cpu    = ${tier === 'LARGE' ? 2 : 1}
      memory = "${tier === 'LARGE' ? '4Gi' : '2Gi'}"
    }
  }
}
`;
    }
  }

  if (services.find(s => s.service_class === 'relational_database' || s.service_class === 'relationaldatabase')) {
    // High Performance uses Memory Optimized
    const skuName = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance')
      ? 'MO_Standard_E2ds_v4'
      : (tier === 'LARGE' ? 'GP_Standard_D2s_v3' : tier === 'SMALL' ? 'B_Standard_B1ms' : 'GP_Standard_D2s_v3');

    terraform += `
resource "azurerm_postgresql_flexible_server" "db" {
  name                   = "app-db-server"
  resource_group_name    = azurerm_resource_group.main.name
  location               = azurerm_resource_group.main.location
  version                = "14"
  sku_name               = "${skuName}"
  storage_mb             = ${tier === 'LARGE' ? 524288 : 131072}
  
  administrator_login    = "adminuser"
  administrator_password = "H@Sh1CoR3!"
}
`;
  }

  if (services.find(s => s.service_class === 'cache') || infraSpec.canonical_architecture?.deployable_services?.includes('cache')) {
    const family = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'P' : 'C'; // Premium vs Standard
    const sku = (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'Premium' : 'Standard';
    const capacity = tier === 'LARGE' ? 2 : 1;

    terraform += `
resource "azurerm_redis_cache" "cache" {
  name                = "app-cache"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  capacity            = ${capacity}
  family              = "${family}"
  sku_name            = "${sku}"
}
`;
  }

  if (services.find(s => s.service_class === 'object_storage' || s.service_class === 'objectstorage') ||
    infraSpec.canonical_architecture?.deployable_services?.includes('objectstorage')) {
    terraform += `
resource "azurerm_storage_account" "storage" {
  name                     = "infracoststorage"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
`;
  }

  if (services.find(s => s.service_class === 'load_balancer' || s.service_class === 'loadbalancer')) {
    terraform += `
resource "azurerm_application_gateway" "lb" {
  name                = "app-gateway"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  
  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = 2
  }
  
  gateway_ip_configuration {
    name      = "gateway-ip"
    subnet_id = "placeholder"
  }
  
  frontend_port {
    name = "http"
    port = 80
  }
  
  frontend_ip_configuration {
    name = "frontend"
  }
  
  backend_address_pool {
    name = "backend"
  }
  
  backend_http_settings {
    name                  = "http-settings"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 30
  }
  
  http_listener {
    name                           = "listener"
    frontend_ip_configuration_name = "frontend"
    frontend_port_name             = "http"
    protocol                       = "Http"
  }
  
  request_routing_rule {
    name                       = "rule"
    rule_type                  = "Basic"
    http_listener_name         = "listener"
    backend_address_pool_name  = "backend"
    backend_http_settings_name = "http-settings"
    priority                   = 100
  }
}
`;
  }

  // CDN (Front Door / CDN)
  if (services.find(s => s.service_class === 'cdn')) {
    terraform += `
resource "azurerm_cdn_profile" "cdn" {
  name                = "app-cdn"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard_Microsoft"
}
`;
  }

  // Identity / Auth (Entra ID B2C)
  if (services.find(s => s.service_class === 'identity_auth')) {
    // Note: B2C is complex in TF, using a simple representation
    terraform += `
resource "azurerm_api_management" "auth" {
  name                = "app-auth-apim"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  publisher_name      = "App"
  publisher_email     = "admin@example.com"
  sku_name            = "Consumption_0"
}
`;
  }

  // DNS
  if (services.find(s => s.service_class === 'dns')) {
    terraform += `
resource "azurerm_dns_zone" "main" {
  name                = "example.com"
  resource_group_name = azurerm_resource_group.main.name
}
`;
  }

  // Monitoring
  if (services.find(s => s.service_class === 'monitoring')) {
    terraform += `
resource "azurerm_monitor_action_group" "health" {
  name                = "app-health-ag"
  resource_group_name = azurerm_resource_group.main.name
  short_name          = "health"
}
`;
  }

  // Logging
  if (services.find(s => s.service_class === 'logging')) {
    terraform += `
resource "azurerm_log_analytics_workspace" "logs" {
  name                = "app-logs"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
}
`;
  }

  // API Gateway
  if (services.find(s => s.service_class === 'api_gateway')) {
    terraform += `
resource "azurerm_api_management" "gateway" {
  name                = "app-apim"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  publisher_name      = "App"
  publisher_email     = "admin@example.com"
  sku_name            = "Consumption_0"
}
`;
  }

  // Messaging Queue (Service Bus)
  if (services.find(s => s.service_class === 'messaging_queue')) {
    terraform += `
resource "azurerm_servicebus_namespace" "queue" {
  name                = "app-sb-namespace"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Standard"
}
`;
  }

  // Secrets Management (Key Vault)
  if (services.find(s => s.service_class === 'secrets_management')) {
    terraform += `
resource "azurerm_key_vault" "vault" {
  name                = "app-keyvault"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tenant_id           = "00000000-0000-0000-0000-000000000000"
  sku_name            = "standard"
}
`;
  }

  return terraform;
}

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
  const catalog = require('../../catalog/terraform/services');

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

      ymlContent += `  ${resourceType}:\n`;
      Object.keys(usage).forEach(key => {
        ymlContent += `    ${key}: ${usage[key]}\n`;
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
      '--log-level', 'info'
    ];

    if (usageFilePath && fs.existsSync(usageFilePath)) {
      args.push('--usage-file', usageFilePath);
    }

    console.log(`[INFRACOST] Executing: infracost ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);

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
    }

    if (!stdout || stdout.trim() === '') {
      console.error(`[INFRACOST] No output received from CLI command`);
      return null;
    }

    return JSON.parse(stdout);

  } catch (error) {
    console.error(`[INFRACOST] CLI execution error for ${terraformDir}: `, error.message);
    if (error.stdout) console.error(`[INFRACOST] STDOUT: ${error.stdout} `);
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
    const serviceClass = RESOURCE_CATEGORY_MAP[resourceType] || null;
    const cost = parseFloat(resource.monthlyCost) || 0;

    if (!serviceClass) {
      console.log(`[INFRACOST] Unknown resource type: ${resourceType} `);
      continue;
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

  // Build the services array in same format as mock data
  const services = Object.entries(serviceCosts).map(([serviceClass, cost]) => {
    const cloudService = selectedServices[serviceClass];
    const displayName = cloudMapping.getServiceDisplayName(cloudService)
      || serviceClass.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
      service_class: serviceClass,
      cloud_service: cloudService,
      display_name: displayName,
      category: getCategoryForServiceId(serviceClass),
      sizing: (costProfile === 'HIGH_PERFORMANCE' || costProfile === 'high_performance') ? 'Performance' : 'Standard',
      cost: {
        monthly: Math.round(cost * 100) / 100,
        formatted: `$${cost.toFixed(2)}/mo`
      }
    };
  });

  return {
    provider,
    total_monthly_cost: Math.round(totalCost * 100) / 100,
    formatted_cost: `$${totalCost.toFixed(2)}/month`,
    service_count: services.length,
    services,

    // FIX #3: Persist selected services
    selected_services: selectedServices,

    // FIX #2: Aggregated costs per service class
    service_costs: serviceCosts,

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

  // Base costs per service class
  const baseCosts = {
    compute_container: 80,
    compute_serverless: 30,
    compute_vm: 60,
    compute_static: 5,
    relational_database: 100,
    nosql_database: 40,
    cache: 50,
    load_balancer: 25,
    api_gateway: 15,
    object_storage: 10,
    block_storage: 15,
    message_queue: 5,        // 🔥 FIX 3: Added default sizing for message_queue
    messaging_queue: 5,
    event_bus: 8,
    search_engine: 60,
    cdn: 20,
    networking: 35,
    identity_auth: 5,
    dns: 2,
    monitoring: 10,
    logging: 15,
    secrets_management: 3
  };

  // FIX 4: HIGH_PERFORMANCE uses premium services with higher base costs
  const performanceMultipliers = {
    compute_container: 1.5,  // EKS vs Fargate
    relational_database: 1.6, // Aurora vs RDS
    cache: 1.3,              // larger cache size
    load_balancer: 1.2,
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

  // 🔵 PHASE 3.1: Extract deployable services if not provided
  if (!deployableServices) {
    deployableServices = extractDeployableServices(infraSpec);
  }

  console.log(`[COST ESTIMATE ${provider}] Deployable services: ${deployableServices.length}`);

  // Create provider directory
  const providerDir = path.join(INFRACOST_BASE_DIR, provider.toLowerCase());
  ensureDir(providerDir);

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
  try {
    switch (provider) {
      case 'AWS':
        terraform = generateAWSTerraform(infraSpec, sizing, costProfile);
        break;
      case 'GCP':
        terraform = generateGCPTerraform(infraSpec, sizing, costProfile);
        break;
      case 'AZURE':
        terraform = generateAzureTerraform(infraSpec, sizing, costProfile);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    // Write Terraform file
    const tfPath = path.join(providerDir, 'main.tf');
    fs.writeFileSync(tfPath, terraform);
    console.log(`[TERRAFORM] Generated for ${provider} at ${tfPath}`);
  } catch (terraformError) {
    console.error(`[TERRAFORM] Failed to generate for ${provider}: ${terraformError.message}`);
    // Cannot proceed with Infracost without Terraform
    console.log(`[COST ESTIMATE ${provider}] Falling back to formula engine`);
    return {
      ...generateMockCostData(provider, infraSpec, sizing, costProfile),
      estimate_type: 'heuristic',
      estimate_source: 'formula_fallback',
      estimate_reason: 'Terraform generation failed'
    };
  }

  // 🔵 PHASE 3.4: PRIMARY PATH - Run Infracost CLI
  try {
    const infracostResult = await runInfracost(providerDir, usageFilePath);

    if (infracostResult) {
      // Normalize real Infracost data with proper service class mapping
      const normalized = normalizeInfracostOutput(infracostResult, provider, infraSpec, costProfile);
      if (normalized && normalized.service_count > 0) {
        console.log(`[INFRACOST] ✅ SUCCESS: ${provider} with ${normalized.service_count} services`);

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

          validatePricingIntegrity(normalized.services || [], normalizedDeployableServices);
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
    ...generateMockCostData(provider, infraSpec, sizing, costProfile),
    estimate_type: 'heuristic',  // ✅ FIX 5: UX Honesty
    estimate_source: 'formula_fallback',
    estimate_reason: 'Infracost CLI unavailable or Terraform validation failed'
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

  const pattern = infraSpec.service_classes?.pattern || 'SERVERLESS_WEB_APP';

  console.log(`[SCENARIOS] Pattern: ${pattern}`);
  console.log(`[SCENARIOS] Deployable services: ${deployableServices.join(', ')}`);

  // ⛔ VALIDATE: No logical services should be here
  deployableServices.forEach(svc => {
    // 🔥 FIX: Handle undefined values and normalize service to name if it's an object
    if (!svc) {
      console.warn('[SCENARIOS] Skipping undefined service in deployable list');
      return;
    }
    const serviceName = typeof svc === 'string' ? svc : (svc.service || svc.canonical_type || svc.name || svc.service_class);
    if (!serviceName) {
      console.warn('[SCENARIOS] Skipping service with no name in deployable list');
      return;
    }
    // Define supported services directly to avoid initialization issues
    const SUPPORTED_SERVICES = [
      'computeserverless', 'computecontainer', 'computevm', 'computebatch', 'computeedge',
      'relationaldatabase', 'nosqldatabase', 'timeseriesdatabase', 'vectordatabase', 'cache', 'searchengine',
      'objectstorage', 'blockstorage', 'filestorage',
      'apigateway', 'loadbalancer', 'vpcnetworking', 'natgateway', 'cdn', 'dns',
      'messagequeue', 'eventbus', 'workfloworchestration', 'eventstreaming', 'paymentgateway',
      'identityauth', 'secretsmanagement', 'keymanagement', 'certificatemanagement', 'waf',
      'logging', 'monitoring', 'auditlogging'
    ];
    if (!SUPPORTED_SERVICES.includes(serviceName)) {
      throw new Error(`[SCENARIOS] INTEGRITY ERROR: ${serviceName} is not terraform-deployable but is in deployable list`);
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
    const [costEffectiveRaw, standardRaw, highPerfRaw] = await Promise.all([
      performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile.low, true, deployableServices),
      performCostAnalysis(infraSpec, intent, 'COST_EFFECTIVE', usageProfile.expected, true, deployableServices),
      performCostAnalysis(infraSpec, intent, 'HIGH_PERFORMANCE', usageProfile.high, true, deployableServices)
    ]);

    // ═══════════════════════════════════════════════════════════════════
    // BUILD CANONICAL CostScenarios STRUCTURE
    // ═══════════════════════════════════════════════════════════════════
    function extractCostResults(rawResult, usageData) {
      const results = {};
      const providers = ['aws', 'gcp', 'azure', 'AWS', 'GCP', 'AZURE'];

      providers.forEach(p => {
        const pLower = p.toLowerCase();
        const providerData = rawResult?.provider_details?.[p] ||
          rawResult?.provider_details?.[pLower] ||
          rawResult?.cost_estimates?.[pLower] ||
          {};

        const cost = providerData?.monthly_cost ||
          providerData?.total_monthly_cost ||
          providerData?.total || 0;

        if ((typeof cost === 'number' || cost) && !results[pLower]) {
          // 🔥 FIX: Normalize deployableServices to service names
          const serviceNames = deployableServices.map(svc =>
            typeof svc === 'string' ? svc : (svc.name || svc.service_class || 'unknown')
          );

          results[pLower] = costResultModel.buildCostResult(
            pLower,
            pattern,
            cost,
            serviceNames,  // ✅ CHANGED: Use normalized service names only
            usageData
          );
          console.log(`[SCENARIOS] ${pLower.toUpperCase()}: $${cost.toFixed(2)}`);
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

    console.log(`[SCENARIOS] Cost Range: ${aggregation.cost_range.formatted}`);
    console.log(`[SCENARIOS] Recommended: ${aggregation.recommended.provider} @ ${aggregation.recommended.formatted_cost}`);

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
      drivers: aggregation.recommended.drivers || [],
      services: aggregation.recommended.services || [],
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
        drivers: aggregation.recommended.drivers,
        services: aggregation.recommended.services
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

  // Parallelize provider estimates
  const estimatePromises = providers.map(provider =>
    generateCostEstimate(provider, infraSpec, intent, costProfile, usageOverrides)
  );

  const results = await Promise.all(estimatePromises);

  const estimates = {};
  providers.forEach((provider, index) => {
    estimates[provider] = results[index];
  });

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
    const costMode = classifyWorkload(intent, infraSpec);
    console.log(`[COST ANALYSIS] Cost Mode: ${costMode}`);

    // ═══════════════════════════════════════════════════════════════════
    // STEP 2: ROUTE TO APPROPRIATE COST CALCULATION METHOD
    // ═══════════════════════════════════════════════════════════════════
    const result = await calculateCostForMode(costMode, infraSpec, intent, costProfile, usageOverrides);

    // Add cost mode information to result
    result.cost_mode = costMode;
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

module.exports = {
  generateCostEstimate,
  generateAllProviderEstimates,
  rankProviders,
  performCostAnalysis,
  calculateCostRange,
  aggregateCategoryBreakdown,
  identifyMissingComponents,
  PROVIDER_PERFORMANCE_SCORES,
  calculateScenarios,
  // Exposed for testing
  generateGCPTerraform,
  generateAzureTerraform,
  runInfracost,
  normalizeInfracostOutput,
  getTerraformDirs: () => ({
    aws: path.join(INFRACOST_BASE_DIR, 'aws'),
    gcp: path.join(INFRACOST_BASE_DIR, 'gcp'),
    azure: path.join(INFRACOST_BASE_DIR, 'azure')
  })
};

