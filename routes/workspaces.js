const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');
const emailService = require('../utils/emailService');

/**
 * @route POST /api/workspaces/save
 * @desc Save current draft state (Creates new or Updates existing)
 * @access Private
 */
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const { workspaceId, projectId, name, step, state } = req.body;

    // Validation
    if (!step || !state) {
      return res.status(400).json({ msg: "Step and State are required" });
    }

    let currentWorkspaceId = workspaceId;
    let targetProjectId = projectId;

    // 1. UPDATE EXISTING WORKSPACE
    // If the client sent a workspaceId, we try to update that record.
    if (currentWorkspaceId) {
      const updateRes = await pool.query(
        `UPDATE workspaces 
                 SET step = $1, state_json = $2, name = COALESCE($3, name), updated_at = NOW(), save_count = save_count + 1
                 WHERE id = $4 
                 RETURNING id, project_id, updated_at`,
        [step, state, name, currentWorkspaceId]
      );

      // If update succeeded, return it.
      if (updateRes.rows.length > 0) {
        const updatedWs = updateRes.rows[0];

        // ALSO UPDATE PARENT PROJECT Metadata (Name & Description)
        // Prioritize Generated Summary, then User Input, then Default
        const msgDescription = state?.infraSpec?.project_summary || state?.description || "Auto-saved draft";
        await pool.query(
          "UPDATE projects SET name = $1, description = $2 WHERE id = $3",
          [name, msgDescription, updatedWs.project_id]
        );

        return res.json({
          msg: "Draft Updated",
          workspaceId: updatedWs.id,
          projectId: updatedWs.project_id,
          updatedAt: updatedWs.updated_at
        });
      }

      // If we are here, the ID was not found (deleted?). 
      // FALLBACK: Allow execution to continue to INSERT a new record instead of 404ing.
      // We explicitly set currentWorkspaceId to null to trigger the create flow.
      console.log(`Workspace ${currentWorkspaceId} not found during update. Creating new copy.`);
      currentWorkspaceId = null;
    }

    // 2. CREATE NEW PROJECT (IF NEEDED) OR VERIFY EXISTENCE
    // If we have a targetProjectId, we must ensure it actually exists in the DB.
    // If it doesn't exist (e.g. user cleared DB), we must create a NEW one to avoid FK error.
    if (targetProjectId) {
      const projCheck = await pool.query("SELECT id FROM projects WHERE id = $1", [targetProjectId]);
      if (projCheck.rows.length === 0) {
        console.log(`Project ${targetProjectId} not found. Creating new project container.`);
        targetProjectId = null; // Reset to force creation below
      }
    }

    if (!targetProjectId) {
      const projRes = await pool.query(
        "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id",
        [name || "Untitled Draft", "Auto-saved draft", req.user?.id || null]
      );
      targetProjectId = projRes.rows[0].id;
    }

    // 3. INSERT NEW WORKSPACE
    const saveRes = await pool.query(
      "INSERT INTO workspaces (project_id, name, step, state_json, save_count) VALUES ($1, $2, $3, $4, 1) RETURNING id, updated_at",
      [targetProjectId, name || "Draft", step, state]
    );

    res.json({
      msg: "Draft Created",
      workspaceId: saveRes.rows[0].id,
      projectId: targetProjectId,
      updatedAt: saveRes.rows[0].updated_at
    });

  } catch (err) {
    console.error("Save Draft Error:", err);
    console.error("Payload size approx:", JSON.stringify(req.body).length);
    res.status(500).json({
      msg: "Server Error during save",
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

// ... existing POST /save code ...

/**
 * @route GET /api/workspaces/:id
 * @desc Get workspace state by ID
 * @access Private
 */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      "SELECT * FROM workspaces WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Get Workspace Error:", err);
    res.status(500).send("Server Error");
  }
});

/**
 * @route POST /api/workspaces
 * @desc Create a new Workspace (and Project)
 * @access Private
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, project_data } = req.body;

    // 1. Create Project
    const projRes = await pool.query(
      "INSERT INTO projects (name, description, owner_id) VALUES ($1, $2, $3) RETURNING id",
      [name || "Untitled Project", description, req.user?.id || null]
    );
    const projectId = projRes.rows[0].id;

    // 2. Create Workspace
    // Initial state includes the description provided by the user
    const initialState = {
      projectData: {
        name: name,
        description: description,
        // ...project_data can be merged if needed
      },
      history: [],
      currentQuestion: null
    };

    const workspaceRes = await pool.query(
      "INSERT INTO workspaces (project_id, name, step, state_json) VALUES ($1, $2, $3, $4) RETURNING id, updated_at",
      [projectId, name || "Untitled Workspace", "input", initialState]
    );

    res.json({
      id: workspaceRes.rows[0].id,
      project_id: projectId,
      name: name,
      description: description,
      created_at: workspaceRes.rows[0].updated_at // using updated_at as created proxy
    });

  } catch (err) {
    console.error("Create Workspace Error:", err);
    res.status(500).send("Server Error");
  }
});

/**
 * @route GET /api/workspaces
 * @desc Get all workspaces (List view)
 * @access Private
 */
router.get('/', authMiddleware, async (req, res) => {
  try {
    // Filter by authenticated user's ID to ensure isolation
    const userId = req.user.id;
    // console.log(`[GET /workspaces] Fetching for User ID: ${userId}`);

    const result = await pool.query(
      `SELECT 
        w.id, 
        w.name, 
        w.step, 
        w.updated_at, 
        w.save_count,
        w.project_id,
        w.state_json,
        p.description, 
        p.created_at 
      FROM workspaces w 
      JOIN projects p ON w.project_id = p.id 
      WHERE p.owner_id = $1::varchar
      ORDER BY w.updated_at DESC`,
      [String(userId)] // Ensure it's a string for VARCHAR comparison
    );

    // console.log(`[GET /workspaces] Found ${result.rows.length} workspaces`);

    res.json(result.rows);
  } catch (err) {
    console.error("List Workspaces Error:", err);
    res.status(500).send("Server Error");
  }
});

/**
 * @route DELETE /api/workspaces/:id
 * @desc Delete a workspace (and its parent project to clean up)
 * @access Private
 */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    // Retrieve project_id first so we can delete the parent Project container
    // This ensures we don't leave orphaned projects.
    // The Schema has ON DELETE CASCADE, so deleting Project -> deletes Workspace.
    const wsRes = await pool.query("SELECT project_id, name FROM workspaces WHERE id = $1", [id]);

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    const { project_id: projectId, name: workspaceName } = wsRes.rows[0];

    // Delete the Project (Cascades to Workspace)
    await pool.query("DELETE FROM projects WHERE id = $1", [projectId]);

    // Send Notification Email (Feature Requested)
    try {
      const userRes = await pool.query("SELECT email, name FROM users WHERE id = $1", [req.user.id]);
      if (userRes.rows.length > 0) {
        await emailService.sendWorkspaceDeletionEmail(userRes.rows[0], workspaceName);
      }
    } catch (emailErr) {
      console.error("Failed to send deletion email:", emailErr);
      // Don't block the response
    }

    res.json({ msg: "Workspace and Project deleted" });
  } catch (err) {
    console.error("Delete Workspace Error:", err);
    res.status(500).send("Server Error");
  }
});

/**
 * @route PUT /api/workspaces/:id/deploy
 * @desc Mark workspace as ACTIVE DEPLOYMENT and increment active_deployments count
 * @access Private
 */
router.put('/:id/deploy', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { deployment_method, provider } = req.body;

    // Get workspace data including state for email
    const wsRes = await pool.query(
      "SELECT project_id, name, state_json FROM workspaces WHERE id = $1",
      [id]
    );

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    const { project_id: projectId, name: workspaceName, state_json: stateJson } = wsRes.rows[0];

    // Update workspace to active deployment status
    const updateWorkspaceRes = await pool.query(
      `UPDATE workspaces 
       SET state_json = COALESCE(state_json, '{}'::jsonb) || $1::jsonb,
       step = 'deployed',
       updated_at = NOW()
       WHERE id = $2 AND (state_json->>'is_deployed' IS NULL OR state_json->>'is_deployed' != 'true')
       RETURNING id`,
      [
        JSON.stringify({
          is_deployed: true,
          is_live: true,
          deployment: {
            method: deployment_method,
            provider,
            deployed_at: new Date().toISOString()
          }
        }),
        id
      ]
    );

    // Only proceed with side effects if the update actually happened (idempotency key)
    let newCount = 0;
    if (updateWorkspaceRes.rowCount > 0) {
      // Increment active_deployments count in projects table
      const updateResult = await pool.query(
        `UPDATE projects 
           SET active_deployments = COALESCE(active_deployments, 0) + 1,
               updated_at = NOW()
           WHERE id = $1
           RETURNING active_deployments`,
        [projectId]
      );

      if (updateResult.rows.length === 0) {
        console.error(`[DEPLOYMENT] Project ${projectId} not found`);
        return res.status(404).json({ msg: "Project not found" });
      }

      newCount = updateResult.rows[0].active_deployments;
      console.log(`[DEPLOYMENT] Workspace ${id} marked as ACTIVE DEPLOYMENT - ${deployment_method} to ${provider}`);
      console.log(`[DEPLOYMENT] Project ${projectId} active_deployments incremented to ${newCount}`);

      // Send Deployment Ready Email
      try {
        const userRes = await pool.query("SELECT email, name FROM users WHERE id = $1", [req.user.id]);

        // 🔥 FIX: Prevent duplicate emails
        const alreadySent = stateJson?.deployment_email_sent_at;

        if (userRes.rows.length > 0 && !alreadySent) {
          const infraSpec = stateJson?.infraSpec || {};
          const costEstimation = stateJson?.costEstimation || {};
          const selectedProvider = provider || infraSpec?.resolved_region?.provider || 'unknown';

          await emailService.sendDeploymentReadyEmail(userRes.rows[0], {
            workspaceId: id, // Pass ID for report link
            workspaceName: workspaceName || 'Untitled Project',
            provider: selectedProvider,
            estimatedCost: costEstimation?.rankings?.find(r => r.provider?.toLowerCase() === selectedProvider?.toLowerCase())?.formatted_cost
              || costEstimation?.recommended?.formatted_cost
              || 'N/A',
            pattern: infraSpec?.canonical_architecture?.pattern_name || infraSpec?.pattern_key || 'Custom',
            services: infraSpec?.canonical_architecture?.deployable_services || [],
            region: infraSpec?.resolved_region?.resolved || infraSpec?.resolved_region?.logical || 'Default'
          });
          console.log(`[DEPLOYMENT] First-time deployment: Sent email to ${userRes.rows[0].email}`);

          // Update state to record email sent
          await pool.query(
            `UPDATE workspaces 
             SET state_json = jsonb_set(state_json, '{deployment_email_sent_at}', $1)
             WHERE id = $2`,
            [JSON.stringify(new Date().toISOString()), id]
          );
        } else if (alreadySent) {
          console.log(`[DEPLOYMENT] Skipping email - already sent at ${alreadySent}`);
        }
      } catch (emailErr) {
        console.error("Failed to send deployment email:", emailErr);
      }
    } else {
      console.log(`[DEPLOYMENT] Workspace ${id} already deployed - skipping increment/email`);
    }

    res.json({
      msg: "Workspace self-deployed - active_deployments incremented",
      id,
      deployment_method,
      provider,
      status: 'active_self_deployed',
      active_deployments: newCount
    });
  } catch (err) {
    console.error("Deploy Workspace Error:", err);
    console.error("Error details:", err.message);
    console.error("Error stack:", err.stack);

    // Check if it's a column missing error
    if (err.message && err.message.includes('active_deployments')) {
      return res.status(500).json({
        msg: "Database schema missing active_deployments column. Please run migrations.",
        error: err.message
      });
    }

    res.status(500).json({ msg: "Server Error", error: err.message });
  }
});

/**
 * @route PUT /api/workspaces/:id/suggestion-preference
 * @desc Toggle using_suggestion preference for self-deployment projects
 * @access Private
 */
router.put('/:id/suggestion-preference', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { using_suggestion } = req.body;

    // Get current state_json
    const wsRes = await pool.query(
      "SELECT state_json FROM workspaces WHERE id = $1",
      [id]
    );

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    // Update state_json with using_suggestion preference
    const currentState = wsRes.rows[0].state_json || {};
    const updatedState = {
      ...currentState,
      using_suggestion: using_suggestion
    };

    await pool.query(
      `UPDATE workspaces SET state_json = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(updatedState), id]
    );

    console.log(`[WORKSPACE] Using suggestion preference updated to ${using_suggestion} for workspace ${id}`);

    res.json({
      msg: "Suggestion preference updated",
      id,
      using_suggestion
    });
  } catch (err) {
    console.error("Toggle Suggestion Preference Error:", err);
    res.status(500).json({ msg: "Server Error", error: err.message });
  }
});



/**
 * @route PUT /api/workspaces/:id/live-status
 * @desc Toggle project live/offline status
 * @access Private
 */
router.put('/:id/live-status', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_live } = req.body;

    // Get current state_json with robust ownership check (Project Owner OR Workspace User)
    const wsRes = await pool.query(
      `SELECT w.state_json 
       FROM workspaces w
       JOIN projects p ON w.project_id = p.id
       WHERE w.id = $1 AND (p.owner_id = $2 OR w.user_id = $2)`,
      [id, String(req.user.id)]
    );

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    // Update state_json with live status AND enforce step='deployed'
    const currentState = wsRes.rows[0].state_json || {};
    const updatedState = {
      ...currentState,
      is_live: is_live,
      is_deployed: is_live, // Sync deployed flag with live status as requested
      live_status_updated_at: new Date().toISOString()
    };

    // We also update 'step' to 'deployed' to ensure the toggle remains visible 
    // even if is_deployed becomes false (OFF).
    await pool.query(
      `UPDATE workspaces 
       SET state_json = $1, 
           step = 'deployed',
           updated_at = NOW() 
       WHERE id = $2`,
      [JSON.stringify(updatedState), id]
    );

    console.log(`[WORKSPACE] Live status updated to ${is_live}, is_deployed synced, step enforced to 'deployed' for workspace ${id}`);

    res.json({
      msg: "Live status updated",
      id,
      is_live
    });
  } catch (err) {
    console.error("Live Status Update Error:", err);
    res.status(500).json({ msg: "Server Error", error: err.message });
  }
});

/**
 * @route PUT /api/workspaces/:id
 * @desc Update workspace name and description
 * @access Private
 */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    // First verify workspace exists and get project_id
    const wsRes = await pool.query(
      "SELECT project_id FROM workspaces WHERE id = $1",
      [id]
    );

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    const projectId = wsRes.rows[0].project_id;

    // Update workspace name
    if (name) {
      await pool.query(
        "UPDATE workspaces SET name = $1, updated_at = NOW() WHERE id = $2",
        [name, id]
      );
    }

    // Update project name and description
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }

    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }

    if (updates.length > 0) {
      values.push(projectId);
      await pool.query(
        `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        values
      );
    }

    res.json({
      msg: "Workspace updated successfully",
      id,
      name,
      description
    });
  } catch (err) {
    console.error("Update Workspace Error:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;