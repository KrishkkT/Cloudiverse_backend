/**
 * WORKFLOW STATE MACHINE
 * 
 * Prevents duplicate phase entries and cleans log noise
 * Enforces strict phase transitions with guards
 */

const { v4: uuidv4 } = require('uuid');

// Phase enum (strict control)
const WorkflowPhase = {
  INTENT: "INTENT",
  AXIS_CLARIFICATION: "AXIS_CLARIFICATION",
  PATTERN_RESOLUTION: "PATTERN_RESOLUTION",
  COST_ANALYSIS: "COST_ANALYSIS",
  DIAGRAM: "DIAGRAM",
  TERRAFORM: "TERRAFORM",
  COMPLETE: "COMPLETE"
};

// In-memory workflow state store (replace with DB in production)
const workflowStore = new Map();

/**
 * Initialize new workflow
 */
function initWorkflow(workspaceId) {
  const workflowId = uuidv4();
  const workflow = {
    id: workflowId,
    workspaceId,
    phase: WorkflowPhase.INTENT,
    locked: false,
    startedAt: new Date(),
    transitions: []
  };
  
  workflowStore.set(workflowId, workflow);
  logPhaseTransition(workflowId, WorkflowPhase.INTENT, 'INIT');
  
  return workflow;
}

/**
 * Get workflow by ID or workspace ID
 */
function getWorkflow(workflowId, workspaceId) {
  // Try by workflow ID first
  if (workflowId && workflowStore.has(workflowId)) {
    return workflowStore.get(workflowId);
  }
  
  // Try by workspace ID
  if (workspaceId) {
    for (const [id, workflow] of workflowStore.entries()) {
      if (workflow.workspaceId === workspaceId) {
        return workflow;
      }
    }
  }
  
  return null;
}

/**
 * Phase guard - prevents duplicate entries
 * Returns true if transition allowed, false if already in phase
 */
function enterPhase(workflow, nextPhase) {
  if (!workflow) {
    console.error('[WORKFLOW] No workflow provided to enterPhase');
    return false;
  }
  
  // Already in this phase - prevent duplicate
  if (workflow.phase === nextPhase) {
    console.warn(`[WORKFLOW] Already in phase ${nextPhase} - blocking duplicate entry`);
    return false;
  }
  
  // Check if workflow is locked
  if (workflow.locked) {
    console.warn(`[WORKFLOW] Workflow ${workflow.id} is locked - cannot transition`);
    return false;
  }
  
  // Valid transition
  const previousPhase = workflow.phase;
  workflow.phase = nextPhase;
  workflow.transitions.push({
    from: previousPhase,
    to: nextPhase,
    timestamp: new Date()
  });
  
  logPhaseTransition(workflow.id, nextPhase, 'ENTER', previousPhase);
  
  return true;
}

/**
 * Lock workflow (prevents concurrent modifications)
 */
function lockWorkflow(workflow) {
  if (!workflow) return false;
  workflow.locked = true;
  return true;
}

/**
 * Unlock workflow
 */
function unlockWorkflow(workflow) {
  if (!workflow) return false;
  workflow.locked = false;
  return true;
}

/**
 * Log phase transition (ONLY place phase logs should occur)
 */
function logPhaseTransition(workflowId, phase, event = 'START', fromPhase = null) {
  const timestamp = new Date().toISOString();
  
  if (event === 'INIT') {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[WORKFLOW ${workflowId}] INITIALIZED`);
    console.log(`[PHASE] ${phase}`);
    console.log(`[TIME] ${timestamp}`);
    console.log(`${'='.repeat(80)}\n`);
  } else if (event === 'ENTER') {
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`[WORKFLOW ${workflowId}] PHASE TRANSITION`);
    console.log(`[FROM] ${fromPhase} → [TO] ${phase}`);
    console.log(`[TIME] ${timestamp}`);
    console.log(`${'─'.repeat(80)}\n`);
  } else {
    console.log(`[WORKFLOW ${workflowId}] [PHASE ${phase}] ${event} at ${timestamp}`);
  }
}

/**
 * Get workflow status
 */
function getWorkflowStatus(workflow) {
  if (!workflow) return null;
  
  return {
    id: workflow.id,
    phase: workflow.phase,
    locked: workflow.locked,
    startedAt: workflow.startedAt,
    transitionCount: workflow.transitions.length,
    lastTransition: workflow.transitions[workflow.transitions.length - 1]
  };
}

/**
 * Complete workflow
 */
function completeWorkflow(workflow) {
  if (!workflow) return false;
  
  if (enterPhase(workflow, WorkflowPhase.COMPLETE)) {
    logPhaseTransition(workflow.id, WorkflowPhase.COMPLETE, 'COMPLETED');
    return true;
  }
  
  return false;
}

module.exports = {
  WorkflowPhase,
  initWorkflow,
  getWorkflow,
  enterPhase,
  lockWorkflow,
  unlockWorkflow,
  logPhaseTransition,
  getWorkflowStatus,
  completeWorkflow
};
