/**
 * ASSUMPTIONS SUMMARY GENERATOR
 * 
 * Fix 5: Surface assumptions BEFORE diagrams
 * Create explicit "Assumptions Summary" that user can review and edit
 * 
 * This builds trust and prevents worst-case surprises
 */

/**
 * Generate assumptions summary from analysis
 */
function generateAssumptionsSummary(analysis, userInput, axes) {
  const assumptions = [];
  const missingInputs = [];
  const riskDomains = [];
  
  // Detect scale assumptions
  if (!axes || !axes.provided || !axes.provided.includes('scale')) {
    assumptions.push('Medium traffic (1,000-10,000 users/month)');
    missingInputs.push('Scale & Traffic');
    riskDomains.push('scaling');
  }
  
  // Detect data sensitivity assumptions
  if (!axes || !axes.provided || !axes.provided.includes('data_sensitivity')) {
    assumptions.push('Standard security (not handling highly sensitive data)');
    missingInputs.push('Data sensitivity');
    riskDomains.push('security');
  }
  
  // Detect cost sensitivity assumptions
  if (!axes || !axes.provided || !axes.provided.includes('cost_sensitivity')) {
    assumptions.push('Balanced cost approach');
    missingInputs.push('Cost sensitivity');
  }
  
  // Detect availability assumptions
  if (!analysis.nfr || !analysis.nfr.availability) {
    assumptions.push('High availability enabled by default (99.9% uptime)');
    missingInputs.push('Availability requirements');
  }
  
  // Detect region assumptions
  if (!analysis.region || analysis.region.logical_region === 'US_PRIMARY') {
    assumptions.push('Single region deployment (US primary)');
    missingInputs.push('Geographic requirements');
  }
  
  // Detect compliance assumptions
  if (!analysis.nfr || !analysis.nfr.compliance || analysis.nfr.compliance.length === 0) {
    assumptions.push('No specific compliance requirements (GDPR, HIPAA, etc.)');
    missingInputs.push('Compliance needs');
    riskDomains.push('compliance');
  }
  
  // Detect backup assumptions
  if (!analysis.nfr || !analysis.nfr.backup_retention) {
    assumptions.push('7-day backup retention');
    missingInputs.push('Backup requirements');
  }
  
  return {
    assumptions_made: assumptions,
    missing_user_inputs: missingInputs,
    risk_domains: riskDomains,
    editable: true,
    confidence_impact: calculateConfidenceImpact(assumptions.length),
    recommendation: generateRecommendation(assumptions.length, riskDomains)
  };
}

/**
 * Calculate how assumptions affect confidence
 */
function calculateConfidenceImpact(assumptionCount) {
  if (assumptionCount === 0) {
    return { level: 'none', description: 'No assumptions - full user input' };
  }
  
  if (assumptionCount <= 2) {
    return { level: 'low', description: 'Minor assumptions - minimal impact' };
  }
  
  if (assumptionCount <= 4) {
    return { level: 'moderate', description: 'Several assumptions - review recommended' };
  }
  
  return { level: 'high', description: 'Significant assumptions - review required before deployment' };
}

/**
 * Generate recommendation based on assumptions
 */
function generateRecommendation(assumptionCount, riskDomains) {
  if (assumptionCount === 0) {
    return 'Architecture is based on your complete input. Ready to proceed.';
  }
  
  if (assumptionCount <= 2) {
    return 'We filled in some minor gaps with safe defaults. You can proceed or adjust these before deployment.';
  }
  
  if (assumptionCount <= 4) {
    return 'We made several assumptions to proceed. Please review these before generating Terraform.';
  }
  
  const riskAreas = riskDomains.length > 0 ? ` Pay special attention to ${riskDomains.join(' and ')}.` : '';
  return `We made significant assumptions based on limited input.${riskAreas} Review and adjust these before deployment.`;
}

/**
 * Format assumptions for UI display
 */
function formatAssumptionsForUI(summary) {
  return {
    title: 'Assumptions Made',
    subtitle: `We filled in ${summary.assumptions_made.length} gaps to proceed safely`,
    assumptions: summary.assumptions_made.map((assumption, index) => ({
      id: index,
      text: assumption,
      editable: true,
      category: categorizeAssumption(assumption)
    })),
    missingInputs: summary.missing_user_inputs,
    confidence: {
      level: summary.confidence_impact.level,
      description: summary.confidence_impact.description
    },
    recommendation: summary.recommendation,
    canEdit: summary.editable,
    showBeforeDiagram: true
  };
}

/**
 * Categorize assumption for better UI grouping
 */
function categorizeAssumption(assumption) {
  const text = assumption.toLowerCase();
  
  if (text.includes('traffic') || text.includes('users') || text.includes('scale')) {
    return 'scale';
  }
  if (text.includes('security') || text.includes('sensitive')) {
    return 'security';
  }
  if (text.includes('cost') || text.includes('balanced')) {
    return 'cost';
  }
  if (text.includes('availability') || text.includes('uptime')) {
    return 'availability';
  }
  if (text.includes('region') || text.includes('geographic')) {
    return 'region';
  }
  if (text.includes('compliance') || text.includes('gdpr') || text.includes('hipaa')) {
    return 'compliance';
  }
  if (text.includes('backup') || text.includes('retention')) {
    return 'backup';
  }
  
  return 'other';
}

/**
 * Validate assumptions before proceeding
 */
function validateAssumptions(assumptions) {
  const warnings = [];
  
  // Check for high-risk assumptions
  assumptions.assumptions_made.forEach(assumption => {
    const text = assumption.toLowerCase();
    
    if (text.includes('highly sensitive') || text.includes('pci') || text.includes('hipaa')) {
      warnings.push('Security assumption detected - verify compliance requirements');
    }
    
    if (text.includes('large scale') || text.includes('high traffic')) {
      warnings.push('Scale assumption detected - verify infrastructure sizing');
    }
  });
  
  return {
    valid: true,
    warnings,
    requiresReview: assumptions.confidence_impact.level === 'high'
  };
}

module.exports = {
  generateAssumptionsSummary,
  formatAssumptionsForUI,
  validateAssumptions,
  calculateConfidenceImpact
};
