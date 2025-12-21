const express = require('express');
const cors = require('cors');
require('dotenv').config();
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Test the database connection and Run Auto-Migrations
pool.query('SELECT NOW()', async (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully');

    // Robust Migration Script
    // Handles Table Creation AND Schema Evolution (adding missing columns)
    const migrationQuery = `
      -- 1. Create Tables if not exist
      CREATE TABLE IF NOT EXISTS projects (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          owner_id VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS workspaces (
          id SERIAL PRIMARY KEY,
          project_id INTEGER REFERENCES projects(id),
          name VARCHAR(255),
          step VARCHAR(50) NOT NULL,
          state_json JSONB NOT NULL,
          save_count INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 2. Repair Schema (Fix missing columns for existing tables)
      DO $$
      BEGIN
          -- REPAIR PROJECTS TABLE
          -- Step 1: Add owner_id if missing (as VARCHAR)
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='owner_id') THEN
              ALTER TABLE projects ADD COLUMN owner_id VARCHAR(255);
          ELSE
              -- Step 2: Ensure it is VARCHAR (Fix UUID vs Integer mismatch)
              IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='owner_id' AND data_type NOT LIKE 'character varying%') THEN
                   ALTER TABLE projects ALTER COLUMN owner_id TYPE VARCHAR(255);
              END IF;
          END IF;

          -- Add description to projects if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='projects' AND column_name='description') THEN
              ALTER TABLE projects ADD COLUMN description TEXT;
          END IF;

          -- REPAIR WORKSPACES TABLE
          -- Add project_id to workspaces if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='project_id') THEN
              ALTER TABLE workspaces ADD COLUMN project_id INTEGER REFERENCES projects(id);
          END IF;
          
          -- Add name to workspaces if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='name') THEN
              ALTER TABLE workspaces ADD COLUMN name VARCHAR(255);
          END IF;

          -- Add step if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='step') THEN
              ALTER TABLE workspaces ADD COLUMN step VARCHAR(50) DEFAULT 'input';
          END IF;

          -- Add state_json if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='state_json') THEN
              ALTER TABLE workspaces ADD COLUMN state_json JSONB DEFAULT '{}';
          END IF;

          -- Add is_active if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='is_active') THEN
              ALTER TABLE workspaces ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
          END IF;

          -- Add save_count if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='save_count') THEN
              ALTER TABLE workspaces ADD COLUMN save_count INTEGER DEFAULT 0;
          END IF;
      END $$;
    `;

    try {
      await pool.query(migrationQuery);
      console.log("Database Schema Verified & Patched");
    } catch (migErr) {
      console.error("Auto-Migration Failed:", migErr);
    }
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

// Workflow routes
app.use('/api/workflow', require('./routes/workflow'));

// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({ message: "Endpoint not found" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({
    message: "Internal Server Error",
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});