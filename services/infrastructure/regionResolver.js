/**
 * REGION RESOLUTION SERVICE
 * 
 * Fix 4: Use logical regions early, resolve to provider-specific regions AFTER provider selection
 * 
 * Rule: Never default to provider-specific region before provider is chosen
 */

// Logical region intents (provider-agnostic)
const LogicalRegion = {
  US_PRIMARY: 'US_PRIMARY',
  US_SECONDARY: 'US_SECONDARY',
  EU_PRIMARY: 'EU_PRIMARY',
  EU_SECONDARY: 'EU_SECONDARY',
  ASIA_PRIMARY: 'ASIA_PRIMARY',
  ASIA_SECONDARY: 'ASIA_SECONDARY',
  GLOBAL: 'GLOBAL'
};

// Provider-specific region mapping (CANONICAL - cheapest, most stable)
const REGION_MAP = {
  aws: {
    US_PRIMARY: 'us-east-1',        // Cheapest, most services, default for tooling
    US_SECONDARY: 'us-west-2',      // Good DR pair with us-east-1
    EU_PRIMARY: 'eu-west-1',        // Ireland, cheapest EU region
    EU_SECONDARY: 'eu-central-1',   // Frankfurt, compliance-heavy
    ASIA_PRIMARY: 'ap-south-1',     // Mumbai, lowest Asia cost
    ASIA_SECONDARY: 'ap-southeast-1', // Singapore, mature infra
    GLOBAL: 'us-east-1'
  },
  gcp: {
    US_PRIMARY: 'us-central1',      // Cheapest, fastest provisioning
    US_SECONDARY: 'us-east1',       // DR + latency balancing
    EU_PRIMARY: 'europe-west1',     // Belgium, lowest EU cost
    EU_SECONDARY: 'europe-west4',   // Netherlands
    ASIA_PRIMARY: 'asia-south1',    // Mumbai
    ASIA_SECONDARY: 'asia-southeast1', // Singapore
    GLOBAL: 'us-central1'
  },
  azure: {
    US_PRIMARY: 'eastus',           // Cheapest, most examples/docs
    US_SECONDARY: 'westus2',        // Reliable DR pairing
    EU_PRIMARY: 'westeurope',       // Netherlands, best availability
    EU_SECONDARY: 'northeurope',    // Ireland, strong backup region
    ASIA_PRIMARY: 'centralindia',   // Lowest Asia cost
    ASIA_SECONDARY: 'southeastasia', // Singapore
    GLOBAL: 'eastus'
  }
};

/**
 * Detect logical region from user input or default to US_PRIMARY
 */
function detectLogicalRegion(userInput, requirements = {}) {
  // Check explicit region requirement
  if (requirements.region && requirements.region.primary_region) {
    // If it's already logical, return it
    if (Object.values(LogicalRegion).includes(requirements.region.primary_region)) {
      return requirements.region.primary_region;
    }
    
    // Try to map it back to logical
    for (const [provider, mapping] of Object.entries(REGION_MAP)) {
      for (const [logical, physical] of Object.entries(mapping)) {
        if (physical === requirements.region.primary_region) {
          return logical;
        }
      }
    }
  }
  
  // Parse user input for region hints
  if (userInput) {
    const input = userInput.toLowerCase();
    
    if (input.includes('europe') || input.includes('eu') || input.includes('gdpr')) {
      return LogicalRegion.EU_PRIMARY;
    }
    if (input.includes('asia') || input.includes('japan') || input.includes('singapore')) {
      return LogicalRegion.ASIA_PRIMARY;
    }
    if (input.includes('global') || input.includes('worldwide')) {
      return LogicalRegion.GLOBAL;
    }
  }
  
  // Default to US_PRIMARY
  return LogicalRegion.US_PRIMARY;
}

/**
 * Resolve logical region to provider-specific region
 * This should ONLY be called AFTER provider is selected
 */
function resolveRegion(logicalRegion, provider) {
  if (!provider || !logicalRegion) {
    console.error('[REGION] Cannot resolve region without provider');
    return null;
  }
  
  const providerLower = provider.toLowerCase();
  
  if (!REGION_MAP[providerLower]) {
    console.error(`[REGION] Unknown provider: ${provider}`);
    return null;
  }
  
  const resolved = REGION_MAP[providerLower][logicalRegion];
  
  if (!resolved) {
    console.warn(`[REGION] No mapping for ${logicalRegion} on ${provider}, using default`);
    return REGION_MAP[providerLower][LogicalRegion.US_PRIMARY];
  }
  
  console.log(`[REGION] Logical=${logicalRegion} → Resolved=${provider}/${resolved}`);
  
  return resolved;
}

/**
 * Get region configuration for requirements
 */
function getRegionConfig(logicalRegion, provider, multiRegion = false) {
  const primaryRegion = resolveRegion(logicalRegion, provider);
  
  if (!primaryRegion) {
    return null;
  }
  
  const config = {
    logical_region: logicalRegion,
    primary_region: primaryRegion,
    multi_region: multiRegion
  };
  
  // Add secondary region if multi-region is enabled
  if (multiRegion) {
    const secondaryLogical = getSecondaryRegion(logicalRegion);
    config.secondary_region = resolveRegion(secondaryLogical, provider);
  }
  
  return config;
}

/**
 * Get secondary region for multi-region deployments
 */
function getSecondaryRegion(primaryLogical) {
  const secondaryMap = {
    [LogicalRegion.US_PRIMARY]: LogicalRegion.US_SECONDARY,
    [LogicalRegion.US_SECONDARY]: LogicalRegion.US_PRIMARY,
    [LogicalRegion.EU_PRIMARY]: LogicalRegion.EU_SECONDARY,
    [LogicalRegion.EU_SECONDARY]: LogicalRegion.EU_PRIMARY,
    [LogicalRegion.ASIA_PRIMARY]: LogicalRegion.ASIA_SECONDARY,
    [LogicalRegion.ASIA_SECONDARY]: LogicalRegion.ASIA_PRIMARY,
    [LogicalRegion.GLOBAL]: LogicalRegion.US_SECONDARY
  };
  
  return secondaryMap[primaryLogical] || LogicalRegion.US_SECONDARY;
}

/**
 * Validate region configuration
 */
function validateRegionConfig(config) {
  if (!config || !config.primary_region) {
    return { valid: false, error: 'Missing primary region' };
  }
  
  if (config.multi_region && !config.secondary_region) {
    return { valid: false, error: 'Multi-region enabled but no secondary region specified' };
  }
  
  return { valid: true };
}

/**
 * Get user-friendly region name for UI display
 */
function getRegionDisplayName(logicalRegion) {
  const displayNames = {
    US_PRIMARY: 'United States (Primary)',
    US_SECONDARY: 'United States (Secondary)',
    EU_PRIMARY: 'Europe (Primary)',
    EU_SECONDARY: 'Europe (Secondary)',
    ASIA_PRIMARY: 'Asia (Primary)',
    ASIA_SECONDARY: 'Asia (Secondary)',
    GLOBAL: 'Global (Multi-region)'
  };
  
  return displayNames[logicalRegion] || logicalRegion;
}

/**
 * Get region explanation for UI
 */
function getRegionExplanation(logicalRegion, provider) {
  if (!provider) {
    return `Region: ${getRegionDisplayName(logicalRegion)} - Provider-specific region will be chosen automatically.`;
  }
  
  const physicalRegion = resolveRegion(logicalRegion, provider);
  const providerUpper = provider.toUpperCase();
  
  return `Final region: ${physicalRegion} (${providerUpper})`;
}

module.exports = {
  LogicalRegion,
  detectLogicalRegion,
  resolveRegion,
  getRegionConfig,
  validateRegionConfig,
  getRegionDisplayName,
  getRegionExplanation
};
