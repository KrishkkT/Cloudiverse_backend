const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();
const pool = require('./config/db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
const path = require('path');
app.use('/downloads', express.static(path.join(__dirname, 'public/downloads')));

// Log every request to debug routing issues
app.use((req, res, next) => {
  console.log(`[API REQUEST] ${req.method} ${req.url}`);
  next();
});

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

// Feedback route
app.use('/api', require('./routes/feedback'));

// Analytics routes (templates, cost history, audit logs)
app.use('/api/analytics', require('./routes/analytics'));


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

// Prevent crashes from unhandled errors (e.g. DB connection loss)
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! 💥', err.name, err.message);
  // Keep server alive
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! 💥', err.name, err.message);
});

// Database Migration & Health Check
const runMigrations = async () => {
  console.log('[DB] Checking connection...');
  let client;
  try {
    client = await pool.connect();
    console.log('[DB] Connection successful');

    // Robust Migration Script
    const migrationQuery = `
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
          user_id VARCHAR(255),
          name VARCHAR(255),
          step VARCHAR(50) NOT NULL,
          state_json JSONB NOT NULL,
          save_count INTEGER DEFAULT 0,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          is_active BOOLEAN DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS password_resets (
          email VARCHAR(255) PRIMARY KEY,
          otp VARCHAR(10) NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

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
      
      -- Schema Evolution Checks
      DO $$ 
      BEGIN 
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='user_id') THEN
              ALTER TABLE workspaces ADD COLUMN user_id VARCHAR(255);
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='is_active') THEN
              ALTER TABLE workspaces ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
          END IF;
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='save_count') THEN
              ALTER TABLE workspaces ADD COLUMN save_count INTEGER DEFAULT 0;
          END IF;
      END $$;
    `;

    await client.query(migrationQuery);
    console.log('[DB] Core tables verified');

    // Index creation
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_templates_category ON infrastructure_templates(category);
      CREATE INDEX IF NOT EXISTS idx_cost_history_workspace ON cost_history(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_cost_history_provider ON cost_history(provider);
      CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
      CREATE INDEX IF NOT EXISTS idx_cost_feedback_workspace ON cost_feedback(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
      CREATE INDEX IF NOT EXISTS idx_infra_templates_public ON infrastructure_templates(is_public);
      CREATE INDEX IF NOT EXISTS idx_infra_templates_cat ON infrastructure_templates(category);
      CREATE INDEX IF NOT EXISTS idx_cost_history_ws ON cost_history(workspace_id);
    `);
    console.log('[DB] Indexes verified');
    return true; // Success

  } catch (err) {
    console.warn('[DB WARNING] Could not connect to Database. Server running in OFFLINE MODE.');
    console.warn(`Reason: ${err.message}`);
    return false; // Failed
  } finally {
    if (client) client.release();
  }
};

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[NETWORK] Listening on 0.0.0.0:${PORT} (All Interfaces)`);

  // Async initialization (DB + Templates)
  // This runs in background so server routes are available immediately
  runMigrations().then((dbConnected) => {
    if (dbConnected) {
      const templateService = require('./services/infrastructure/templateService');
      return templateService.initializeBuiltInTemplates();
    } else {
      console.log('[TEMPLATES] Skipping template initialization (Offline Mode)');
      return Promise.resolve();
    }
  }).then(() => {
    // console.log('[SYSTEM] Initialization complete');
  }).catch(err => {
    console.warn('[WARNING] Background initialization failed:', err.message);
  });
});
