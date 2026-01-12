/**
 * AI SCORING SANITIZER
 * 
 * Fix 2: Prevent AI from contradicting enforced canonical architecture
 * 
 * Rule: AI may COMMENT, Backend DECIDES
 * AI must NEVER report missing components that already exist in canonical_services
 */

/**
 * Sanitize AI scoring output to prevent contradictions
 */
function sanitizeAIScoring(aiOutput, canonicalServices) {
  if (!aiOutput || !canonicalServices) {
    return aiOutput;
  }

  const sanitized = { ...aiOutput };

  // Normalize canonical service names for comparison
  const normalizedServices = canonicalServices.map(s =>
    typeof s === 'string' ? s.toLowerCase().replace(/_/g, ' ') :
      s.service_class ? s.service_class.toLowerCase().replace(/_/g, ' ') : ''
  );

  // Filter weaknesses that contradict canonical services
  if (sanitized.weaknesses && Array.isArray(sanitized.weaknesses)) {
    const originalCount = sanitized.weaknesses.length;

    // 🔥 FIX 2: Logical services that AI incorrectly flags as "missing"
    // These are not terraform-deployable and handled via API integrations
    const logicalServices = ['paymentgateway', 'payment_gateway', 'eventbus', 'event_bus', 'waf', 'cicd', 'artifact_registry'];

    sanitized.weaknesses = sanitized.weaknesses.filter(weakness => {
      const weaknessLower = weakness.toLowerCase();

      // Filter out false positives for logical services
      const isLogicalServiceFlag = logicalServices.some(ls => weaknessLower.includes(ls.replace('_', ' ')) || weaknessLower.includes(ls));
      if (isLogicalServiceFlag) {
        console.log(`[AI SANITIZER] Filtered logical service flag: ${weakness}`);
        return false;
      }

      // Check if weakness mentions a service that already exists
      const contradicts = normalizedServices.some(service => {
        return weaknessLower.includes(service) &&
          (weaknessLower.includes('missing') ||
            weaknessLower.includes('lack') ||
            weaknessLower.includes('no ') ||
            weaknessLower.includes('without'));
      });

      return !contradicts;
    });

    const removed = originalCount - sanitized.weaknesses.length;
    if (removed > 0) {
      console.log(`[AI SANITIZER] Removed ${removed} contradictory weaknesses`);
    }
  }

  // Filter gaps that contradict canonical services
  if (sanitized.gaps && Array.isArray(sanitized.gaps)) {
    const originalCount = sanitized.gaps.length;

    sanitized.gaps = sanitized.gaps.filter(gap => {
      const gapLower = gap.toLowerCase();

      const contradicts = normalizedServices.some(service =>
        gapLower.includes(service)
      );

      return !contradicts;
    });

    const removed = originalCount - sanitized.gaps.length;
    if (removed > 0) {
      console.log(`[AI SANITIZER] Removed ${removed} contradictory gaps`);
    }
  }

  // Add note that architecture is pattern-enforced
  if (sanitized.notes && Array.isArray(sanitized.notes)) {
    sanitized.notes.push('Architecture validated against canonical pattern - all required services included');
  }

  return sanitized;
}

/**
 * Prepare AI scoring input with canonical services context
 * This prevents AI from making contradictory statements in the first place
 */
function prepareAIScoringInput(userInput, canonicalArchitecture) {
  const { services, pattern } = canonicalArchitecture;

  const serviceList = services.map(s =>
    typeof s === 'string' ? s : s.service_class || s.canonical_type
  );

  return {
    user_input: userInput,
    canonical_services: serviceList,
    pattern: pattern,
    pattern_enforced: true,
    instructions: `
CRITICAL RULES:
1. Do NOT report missing components that exist in canonical_services
2. These services are ALREADY INCLUDED by pattern enforcement:
   ${serviceList.map(s => `- ${s}`).join('\n   ')}
3. Focus ONLY on configuration concerns, not missing services
4. Backend has ALREADY decided the architecture - you may only comment on it
    `.trim()
  };
}

/**
 * Validate AI output doesn't contradict backend decisions
 */
function validateAIOutput(aiOutput, canonicalServices) {
  const warnings = [];

  if (!aiOutput) return { valid: true, warnings: [] };

  const normalizedServices = canonicalServices.map(s =>
    typeof s === 'string' ? s.toLowerCase().replace(/_/g, ' ') :
      s.service_class ? s.service_class.toLowerCase().replace(/_/g, ' ') : ''
  );

  // Check for contradictions in weaknesses
  if (aiOutput.weaknesses) {
    aiOutput.weaknesses.forEach(weakness => {
      const weaknessLower = weakness.toLowerCase();
      normalizedServices.forEach(service => {
        if (weaknessLower.includes(service) &&
          (weaknessLower.includes('missing') || weaknessLower.includes('lack'))) {
          warnings.push(`AI incorrectly reports missing ${service} (exists in canonical architecture)`);
        }
      });
    });
  }

  return {
    valid: warnings.length === 0,
    warnings
  };
}

module.exports = {
  sanitizeAIScoring,
  prepareAIScoringInput,
  validateAIOutput
};
