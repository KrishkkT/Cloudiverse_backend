const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateProfile, deleteAccount, logout } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// Register route
router.post('/register', register);

// Login route
router.post('/login', login);

// Logout route
router.post('/logout', authMiddleware, logout);

// Get profile (protected route)
router.get('/profile', authMiddleware, getProfile);

// Update profile (protected route)
router.put('/profile', authMiddleware, updateProfile);

// Delete account (protected route)
router.delete('/profile', authMiddleware, deleteAccount);

module.exports = router;