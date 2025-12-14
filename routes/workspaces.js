const express = require('express');
const router = express.Router();
const { 
  createWorkspace, 
  getUserWorkspaces, 
  getWorkspaceById, 
  updateWorkspace, 
  deleteWorkspace 
} = require('../controllers/workspaceController');
const authMiddleware = require('../middleware/auth');

// Create workspace
router.post('/', authMiddleware, createWorkspace);

// Get user workspaces
router.get('/', authMiddleware, getUserWorkspaces);

// Get workspace by ID
router.get('/:id', authMiddleware, getWorkspaceById);

// Update workspace
router.put('/:id', authMiddleware, updateWorkspace);

// Delete workspace
router.delete('/:id', authMiddleware, deleteWorkspace);

module.exports = router;