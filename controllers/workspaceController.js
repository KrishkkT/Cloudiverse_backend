const Workspace = require('../models/Workspace');

// Create workspace
const createWorkspace = async (req, res) => {
  try {
    const { name, description, project_data } = req.body;
    
    const workspace = await Workspace.create({
      user_id: req.user.id,
      name,
      description,
      project_data
    });

    res.status(201).json(workspace);
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get user workspaces
const getUserWorkspaces = async (req, res) => {
  try {
    const workspaces = await Workspace.findByUserId(req.user.id);
    res.json(workspaces);
  } catch (error) {
    console.error('Get workspaces error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get workspace by ID
const getWorkspaceById = async (req, res) => {
  try {
    const workspace = await Workspace.findById(req.params.id);
    
    // Check if workspace belongs to user
    if (workspace.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json(workspace);
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update workspace
const updateWorkspace = async (req, res) => {
  try {
    const { name, description, project_data } = req.body;
    
    // First check if workspace exists and belongs to user
    const existingWorkspace = await Workspace.findById(req.params.id);
    if (!existingWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    if (existingWorkspace.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const workspace = await Workspace.update(req.params.id, {
      name,
      description,
      project_data
    });

    res.json(workspace);
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete workspace
const deleteWorkspace = async (req, res) => {
  try {
    // First check if workspace exists and belongs to user
    const existingWorkspace = await Workspace.findById(req.params.id);
    if (!existingWorkspace) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    
    if (existingWorkspace.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const workspace = await Workspace.delete(req.params.id);
    res.json({ message: 'Workspace deleted successfully' });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createWorkspace,
  getUserWorkspaces,
  getWorkspaceById,
  updateWorkspace,
  deleteWorkspace
};