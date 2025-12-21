const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth');

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
    res.status(500).send("Server Error");
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
    // In a real app, filtering by user would happen here: WHERE owner_id = req.user.id
    // For now, valid user gets all (or filter by project owner if we enforced that relation)

    const result = await pool.query(
      `SELECT 
        w.id, 
        w.name, 
        w.step, 
        w.updated_at, 
        w.save_count,
        w.project_id, 
        p.description, 
        p.created_at 
      FROM workspaces w 
      LEFT JOIN projects p ON w.project_id = p.id 
      ORDER BY w.updated_at DESC`
    );

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
    const wsRes = await pool.query("SELECT project_id FROM workspaces WHERE id = $1", [id]);

    if (wsRes.rows.length === 0) {
      return res.status(404).json({ msg: "Workspace not found" });
    }

    const projectId = wsRes.rows[0].project_id;

    // Delete the Project (Cascades to Workspace)
    await pool.query("DELETE FROM projects WHERE id = $1", [projectId]);

    res.json({ msg: "Workspace and Project deleted" });
  } catch (err) {
    console.error("Delete Workspace Error:", err);
    res.status(500).send("Server Error");
  }
});

module.exports = router;