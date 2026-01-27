const express = require('express');
const router = express.Router();
const { register, login, getProfile, updateProfile, updatePassword, deleteAccount, logout, forgotPassword, resetPassword, verifyTurnstile } = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');

// Register route
router.post('/register', register);

// Login route
router.post('/login', login);

// Password Reset Routes
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

// Logout route
router.post('/logout', authMiddleware, logout);

// Get profile (protected route)
router.get('/profile', authMiddleware, getProfile);

// Update profile (protected route)
router.put('/profile', authMiddleware, updateProfile);

// Update password (protected route)
router.put('/update-password', authMiddleware, updatePassword);

// Turnstile Verification
router.post('/verify-turnstile', verifyTurnstile);

// Delete account (protected route)
router.delete('/profile', authMiddleware, deleteAccount);

module.exports = router;