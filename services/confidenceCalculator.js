/**
 * CONFIDENCE CALCULATOR
 * 
 * Fix 3: Split confidence into 3 separate scores
 * - Intent confidence (from user input quality)
 * - Architecture confidence (from pattern/service completeness)
 * - Cost confidence (from pricing data quality)
 * 
 * Final confidence = MIN of all three (honest, never inflated)
 */

/**
 * Calculate intent confidence based on user input quality
 */
function calculateIntentConfidence(userInput, axes, assumptions) {
  let score = 1.0;
  
  // Penalty for very short input
  if (!userInput || userInput.trim().length < 20) {
    score -= 0.4;
  } else if (userInput.trim().length < 50) {
    score -= 0.2;
  }
  
  // Penalty for missing critical axes
  const criticalAxes = ['scale', 'data_sensitivity', 'cost_sensitivity'];
  const missingCritical = criticalAxes.filter(axis => 
    axes && axes.missing && axes.missing.includes(axis)
  );
  
  score -= missingCritical.length * 0.15;
  
  // Penalty for auto-filled assumptions
  if (assumptions && assumptions.length > 0) {
    score -= Math.min(assumptions.length * 0.1, 0.4);
  }
  
  return Math.max(0.1, Math.min(1.0, score));
}

/**
 * Calculate architecture confidence based on pattern/service completeness
 */
function calculateArchitectureConfidence(pattern, services, requirements) {
  let score = 0.85; // Start high for validated patterns
  
  // If pattern is enforced, architecture is complete
  if (pattern && pattern.includes('PLATFORM')) {
    score = 0.95;
  }
  
  // Penalty if services count is low
  if (services && services.length < 3) {
    score -= 0.15;
  }
  
  // Bonus for explicit requirements
  if (requirements && Object.keys(requirements).length > 5) {
    score += 0.05;
  }
  
  return Math.max(0.5, Math.min(1.0, score));
}

/**
 * Calculate cost confidence based on data quality
 */
function calculateCostConfidence(costAnalysis, provider) {
  let score = 0.9; // High confidence for formula-based costs
  
  // Lower confidence if cost data is missing
  if (!costAnalysis || !costAnalysis.recommended) {
    score = 0.5;
  }
  
  // Lower confidence if provider not selected
  if (!provider || provider === 'auto') {
    score -= 0.1;
  }
  
  return Math.max(0.5, Math.min(1.0, score));
}

/**
 * Calculate final confidence (MIN of all three - honest approach)
 */
function calculateFinalConfidence(intentConf, architectureConf, costConf) {
  const finalScore = Math.min(intentConf, architectureConf, costConf);
  
  // Find limiting factor
  let limitingFactor = 'intent';
  if (architectureConf === finalScore) {
    limitingFactor = 'architecture';
  } else if (costConf === finalScore) {
    limitingFactor = 'cost';
  }
  
  return {
    final: finalScore,
    percentage: Math.round(finalScore * 100),
    breakdown: {
      intent: intentConf,
      architecture: architectureConf,
      cost: costConf
    },
    limitingFactor
  };
}

/**
 * Generate confidence explanation for UI
 */
function generateConfidenceExplanation(confidence, assumptions) {
  const { percentage, limitingFactor, breakdown } = confidence;
  
  if (percentage >= 85) {
    return 'High confidence - comprehensive input with clear requirements';
  }
  
  if (percentage >= 70) {
    return 'Good confidence - minor assumptions made for optimal design';
  }
  
  if (percentage >= 50) {
    const reasons = [];
    
    if (breakdown.intent < 0.6) {
      reasons.push('limited input details');
    }
    if (breakdown.architecture < 0.6) {
      reasons.push('simplified architecture');
    }
    if (breakdown.cost < 0.6) {
      reasons.push('estimated pricing');
    }
    
    if (assumptions && assumptions.length > 0) {
      return `Moderate confidence - key assumptions were auto-filled: ${reasons.join(', ')}`;
    }
    
    return `Moderate confidence - ${reasons.join(', ')}`;
  }
  
  return 'Low confidence - significant assumptions made due to limited input. Review assumptions before deployment.';
}

/**
 * Main confidence calculation function
 */
function calculateConfidence(params) {
  const {
    userInput,
    axes,
    assumptions,
    pattern,
    services,
    requirements,
    costAnalysis,
    provider
  } = params;
  
  const intentConf = calculateIntentConfidence(userInput, axes, assumptions);
  const architectureConf = calculateArchitectureConfidence(pattern, services, requirements);
  const costConf = calculateCostConfidence(costAnalysis, provider);
  
  const confidence = calculateFinalConfidence(intentConf, architectureConf, costConf);
  confidence.explanation = generateConfidenceExplanation(confidence, assumptions);
  
  return confidence;
}

module.exports = {
  calculateConfidence,
  calculateIntentConfidence,
  calculateArchitectureConfidence,
  calculateCostConfidence,
  generateConfidenceExplanation
};
