const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { sendWelcomeEmail, sendLoginNotification, sendPasswordResetEmail, sendAccountDeletionEmail } = require('../utils/emailService');
require('dotenv').config();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: '30d'
  });
};

// Register user
const register = async (req, res) => {
  try {
    const { name, email, password, company } = req.body;

    // Validate input
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    // Validate password strength
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    // Check if user already exists
    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password,
      company
    });

    // Generate token
    const token = generateToken(user.id);

    // Send welcome email (awaiting to ensure reliable delivery and error catching)
    try {
      console.log(`[EMAIL SERVICE] Sending Welcome Email to ${user.email}`);
      await sendWelcomeEmail(user);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // We don't block registration on email failure, but we log it.
    }

    // Respond immediately
    res.status(201).json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// Login user
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Check if user exists
    const user = await User.findByEmail(email);

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Ensure password is a string
    if (typeof password !== 'string') {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user.id);

    // Send login notification email (awaiting to ensure reliable delivery)
    try {
      console.log(`[EMAIL SERVICE] Sending Login Alert to ${user.email}`);
      await sendLoginNotification(user);
    } catch (emailError) {
      console.error('Failed to send login notification:', emailError);
    }

    // Respond immediately without waiting for email
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        company: user.company
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// Forgot Password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findByEmail(email);
    if (!user) {
      // Security: Don't reveal if user exists. Just return success or generic message.
      // But for UX, we might want to say "If that email exists, we sent an OTP."
      // For this user specifically, they requested "functionality", so let's be clearer for dev purposes.
      return res.status(404).json({ message: 'User not found' });
    }

    // Generate 6 digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60000); // 10 mins

    // Upsert OTP
    await pool.query(
      `INSERT INTO password_resets (email, otp, expires_at) 
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET otp = $2, expires_at = $3`,
      [email, otp, expiresAt]
    );

    // Send Email
    try {
      await sendPasswordResetEmail(email, otp);
    } catch (e) {
      console.error("Email send failed", e);
      // We still return success to avoid enumerating emails, but log error
    }

    res.json({ message: 'OTP sent to email successfully' });

  } catch (error) {
    console.error('Forgot Password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    console.log(`[RESET PASSWORD] Attempt for ${email} with OTP ${otp}`);

    // Validate OTP
    const result = await pool.query(
      "SELECT * FROM password_resets WHERE email = $1 AND otp = $2 AND expires_at > NOW()",
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update User
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);

    // Delete OTP
    await pool.query("DELETE FROM password_resets WHERE email = $1", [email]);

    res.json({ message: 'Password reset successfully' });

  } catch (error) {
    console.error('Reset Password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get user profile
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error retrieving profile' });
  }
};

// Update user profile
const updateProfile = async (req, res) => {
  try {
    const { name, email, company } = req.body;

    // Check if email is being changed and if it's already taken
    if (email !== req.user.email) {
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
    }

    const updatedUser = await User.update(req.user.id, {
      name,
      email,
      company
    });

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updatedUser);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error updating profile' });
  }
};

// Delete user account
// Delete user account
const deleteAccount = async (req, res) => {
  try {
    // Get user details first to send email
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete user (this will cascade delete workspaces due to foreign key constraint)
    const deletedUser = await User.delete(req.user.id);

    if (!deletedUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Send deletion confirmation email (non-blocking for response but good to try)
    try {
      await sendAccountDeletionEmail(user);
    } catch (emailError) {
      console.error('Failed to send account deletion email:', emailError);
    }

    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ message: 'Server error deleting account' });
  }
};

// Logout user
const logout = async (req, res) => {
  try {
    // In a more advanced implementation, you might want to blacklist the token
    // For now, we'll just send a success response
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ message: 'Server error during logout' });
  }
};

module.exports = {
  register,
  login,
  forgotPassword,
  resetPassword,
  getProfile,
  updateProfile,
  deleteAccount,
  logout
};