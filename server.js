const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Test the database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully');
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({ message: 'Cloudiverse Backend API' });
});

// Auth routes
app.use('/api/auth', require('./routes/auth'));

// Workspace routes
app.use('/api/workspaces', require('./routes/workspaces'));

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});