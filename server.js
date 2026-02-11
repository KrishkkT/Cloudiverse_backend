const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
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
      -- 1. Create Core Tables if not exist
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
          user_id VARCHAR(255), -- Added for ownership
          name VARCHAR(255),
          step VARCHAR(50) NOT NULL,
          state_json JSONB NOT NULL,
          save_count INTEGER DEFAULT 0,
          deployment_status VARCHAR(20) DEFAULT 'DRAFT', -- DRAFT, INFRA_READY, DEPLOYED, DESTROYING, DESTROYED
          deployed_at TIMESTAMP,
          deployment_history JSONB DEFAULT '[]'::jsonb, -- Audit log of deploy/destroy actions
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- Add columns if they don't exist (for existing databases)
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deployment_status VARCHAR(20) DEFAULT 'DRAFT';
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP;
      ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS deployment_history JSONB DEFAULT '[]'::jsonb;

      -- Auto-detect existing deployed workspaces (one-time migration)
      UPDATE workspaces 
      SET deployment_status = 'DEPLOYED', 
          deployed_at = COALESCE(deployed_at, updated_at)
      WHERE deployment_status = 'DRAFT' 
        AND state_json->'infra_outputs'->'deployment_target' IS NOT NULL
        AND state_json->'infra_outputs'->'deployment_target'->>'type' IS NOT NULL;

      CREATE TABLE IF NOT EXISTS password_resets (
          email VARCHAR(255) PRIMARY KEY,
          otp VARCHAR(10) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 2. Create Analytics Tables
      CREATE TABLE IF NOT EXISTS infrastructure_templates (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          category VARCHAR(100),
          template_json JSONB NOT NULL,
          is_public BOOLEAN DEFAULT TRUE,
          created_by VARCHAR(255),
          usage_count INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cost_history (
          id SERIAL PRIMARY KEY,
          workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
          provider VARCHAR(20) NOT NULL,
          cost_profile VARCHAR(30),
          estimated_cost DECIMAL(10,2),
          cost_range_low DECIMAL(10,2),
          cost_range_high DECIMAL(10,2),
          confidence VARCHAR(20),
          category_breakdown JSONB,
          service_count INTEGER,
          scale_tier VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS audit_log (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255),
          workspace_id INTEGER,
          action VARCHAR(100) NOT NULL,
          details JSONB,
          ip_address INET,
          user_agent TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 3. Create cost_feedback table for Step 4 (Feedback before Terraform)
      CREATE TABLE IF NOT EXISTS cost_feedback (
          id SERIAL PRIMARY KEY,
          workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
          cost_intent VARCHAR(20),
          estimated_min DECIMAL(10,2),
          estimated_max DECIMAL(10,2),
          selected_provider VARCHAR(20),
          selected_profile VARCHAR(30),
          user_feedback VARCHAR(50),
          feedback_details JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 4. Create deployments table for Application Deployment Phase
      CREATE TABLE IF NOT EXISTS deployments (
          id SERIAL PRIMARY KEY,
          workspace_id INTEGER REFERENCES workspaces(id),
          source_type VARCHAR(20) NOT NULL, -- 'github' | 'docker'
          status VARCHAR(20) DEFAULT 'pending', -- pending, running, success, failed
          url TEXT,
          commit_hash VARCHAR(100),
          image_tag VARCHAR(100),
          logs JSONB DEFAULT '[]',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 5. Create GitHub Installations table (now used for OAuth)
      CREATE TABLE IF NOT EXISTS github_installations (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR(255) NOT NULL UNIQUE,
          installation_id VARCHAR(255), -- Keep for backward compatibility if needed, but make nullable
          access_token TEXT,
          refresh_token TEXT,
          expires_at TIMESTAMP,
          account_name VARCHAR(255),
          account_avatar TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      -- 6. Create Indexes for Analytics Tables
      CREATE INDEX IF NOT EXISTS idx_templates_category ON infrastructure_templates(category);
      CREATE INDEX IF NOT EXISTS idx_cost_history_workspace ON cost_history(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_cost_history_provider ON cost_history(provider);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_cost_feedback_workspace ON cost_feedback(workspace_id);

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
          
          -- Fix: ensure password_resets table exists (if we just added the CREATE above, this is redundant but safe)
          -- No specific column repairs needed for password_resets newly created.
          
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

          -- Add user_id to workspaces if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='user_id') THEN
              ALTER TABLE workspaces ADD COLUMN user_id VARCHAR(255);
          END IF;

          -- Add is_active if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='is_active') THEN
              ALTER TABLE workspaces ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
          END IF;

          -- Add save_count if missing
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='save_count') THEN
              ALTER TABLE workspaces ADD COLUMN save_count INTEGER DEFAULT 0;
          END IF;
          -- REPAIR GITHUB_INSTALLATIONS TABLE
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='github_installations') THEN
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='github_installations' AND column_name='access_token') THEN
                  ALTER TABLE github_installations ADD COLUMN access_token TEXT;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='github_installations' AND column_name='refresh_token') THEN
                  ALTER TABLE github_installations ADD COLUMN refresh_token TEXT;
              END IF;
              IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='github_installations' AND column_name='expires_at') THEN
                  ALTER TABLE github_installations ADD COLUMN expires_at TIMESTAMP;
              END IF;
              -- Make installation_id nullable if it was required
              ALTER TABLE github_installations ALTER COLUMN installation_id DROP NOT NULL;
              -- Ensure UNIQUE(user_id) exists specifically for user_id
              IF NOT EXISTS (
                  SELECT 1 
                  FROM information_schema.table_constraints tc 
                  JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name 
                    AND tc.table_schema = kcu.table_schema
                  WHERE tc.constraint_type = 'UNIQUE' 
                    AND tc.table_name = 'github_installations' 
                    AND kcu.column_name = 'user_id'
              ) THEN
                  -- Optional: Clean up duplicates if they exists before adding constraint
                  -- DELETE FROM github_installations WHERE id NOT IN (SELECT MIN(id) FROM github_installations GROUP BY user_id);
                  ALTER TABLE github_installations ADD CONSTRAINT github_installations_user_id_key UNIQUE (user_id);
              END IF;
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
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
const path = require('path');
app.use('/downloads', express.static(path.join(__dirname, 'public/downloads')));

// Log every request to debug routing issues
app.use((req, res, next) => {
  console.log(`[API REQUEST] ${req.method} ${req.url}`);
  next();
});

// Import routes
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspaces');
const workflowRoutes = require('./routes/workflow');
const workflowV2Routes = require('./routes/workflowV2');
const feedbackRoutes = require('./routes/feedback');
const analyticsRoutes = require('./routes/analytics');
const architectureRoutes = require('./routes/architectureRoutes');
const projectRoutes = require('./routes/projects'); // New import
const billingRoutes = require('./routes/billing'); // New import
const settingsRoutes = require('./routes/settings'); // New import
const cloudRoutes = require('./routes/cloud'); // New import
const githubRoutes = require('./routes/github');
const aiRoutes = require('./routes/ai');

// Routes
// Health Check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

app.get('/', (req, res) => {
  res.json({ message: 'Cloudiverse Backend API' });
});

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/workflow/v2', workflowV2Routes);
app.use('/api', feedbackRoutes); // Feedback mounts at root /api/feedback usually, check file. Assuming /api based on previous
app.use('/api/analytics', analyticsRoutes);
app.use('/api/architecture', architectureRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/cloud', cloudRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/deploy', require('./routes/deploy')); // New Deployment Route
app.use('/api/ai', aiRoutes);

app.use('/api', require('./routes/feedback'));

// Analytics routes (templates, cost history, audit logs)
app.use('/api/analytics', require('./routes/analytics'));

// Architecture routes (validation, reconciliation)
app.use('/api/architecture', require('./routes/architectureRoutes'));

// Initialize built-in templates on startup
const templateService = require('./services/infrastructure/templateService');
templateService.initializeBuiltInTemplates();

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
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[NETWORK] Listening on 0.0.0.0:${PORT} (All Interfaces)`);
});

// Process Error Handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

