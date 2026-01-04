-- ===============================================================
-- CLOUDIVERSE DATABASE SCHEMA (EXCLUDING USER TABLES)
-- Complete SQL Script for Application Tables
-- ===============================================================

-- ---------------------------------------------------------------
-- 1. PROJECTS TABLE
-- Stores project metadata, each user can have multiple projects
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    owner_id VARCHAR(255),                -- User ID (references users table)
    status VARCHAR(50) DEFAULT 'active',  -- active, archived, deleted
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast project lookups by owner
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);


-- ---------------------------------------------------------------
-- 2. WORKSPACES TABLE
-- Main table for storing infrastructure workflow state
-- Each workspace represents one infrastructure design session
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    user_id VARCHAR(255),                 -- User who owns this workspace
    name VARCHAR(255) NOT NULL DEFAULT 'Untitled Workspace',
    
    -- Workflow step tracking
    step VARCHAR(50) NOT NULL DEFAULT 'input',
    -- Possible values: 'input', 'processing', 'question', 
    --                  'processing_spec', 'review_spec', 
    --                  'processing_cost', 'cost_estimation', 
    --                  'deployment_ready'
    
    -- Full state stored as JSON (includes all workflow data)
    state_json JSONB NOT NULL DEFAULT '{}',
    -- Contains: history, description, currentQuestion, infraSpec, 
    --          projectData, aiSnapshot, costEstimation, costProfile
    
    -- Metadata
    is_active BOOLEAN DEFAULT TRUE,
    save_count INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for workspace queries
CREATE INDEX IF NOT EXISTS idx_workspaces_project ON workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_user ON workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_step ON workspaces(step);
CREATE INDEX IF NOT EXISTS idx_workspaces_active ON workspaces(is_active);
CREATE INDEX IF NOT EXISTS idx_workspaces_updated ON workspaces(updated_at DESC);


-- ---------------------------------------------------------------
-- 3. PASSWORD_RESETS TABLE
-- Stores OTP tokens for password reset flow
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    otp VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast OTP lookups
CREATE INDEX IF NOT EXISTS idx_password_resets_email ON password_resets(email);
CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON password_resets(expires_at);


-- ---------------------------------------------------------------
-- 4. INFRASTRUCTURE_TEMPLATES TABLE (OPTIONAL - FUTURE USE)
-- Pre-built templates for common infrastructure patterns
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS infrastructure_templates (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(100),                -- e.g., 'web_app', 'api', 'data_pipeline'
    template_json JSONB NOT NULL,         -- Pre-configured InfraSpec
    is_public BOOLEAN DEFAULT TRUE,
    created_by VARCHAR(255),
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_templates_category ON infrastructure_templates(category);
CREATE INDEX IF NOT EXISTS idx_templates_public ON infrastructure_templates(is_public);


-- ---------------------------------------------------------------
-- 5. COST_HISTORY TABLE (OPTIONAL - FUTURE USE)
-- Track historical cost estimates for analytics
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_history (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL,        -- AWS, GCP, AZURE
    cost_profile VARCHAR(30),             -- COST_EFFECTIVE, HIGH_PERFORMANCE
    
    -- Cost data
    estimated_cost DECIMAL(10,2),
    cost_range_low DECIMAL(10,2),
    cost_range_high DECIMAL(10,2),
    confidence VARCHAR(20),               -- high, medium, low
    
    -- Breakdown (stored as JSON for flexibility)
    category_breakdown JSONB,
    
    -- Metadata
    service_count INTEGER,
    scale_tier VARCHAR(20),               -- SMALL, MEDIUM, LARGE
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_history_workspace ON cost_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cost_history_provider ON cost_history(provider);
CREATE INDEX IF NOT EXISTS idx_cost_history_created ON cost_history(created_at DESC);


-- ---------------------------------------------------------------
-- 6. AUDIT_LOG TABLE (OPTIONAL - FUTURE USE)
-- Track user actions for compliance and debugging
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255),
    workspace_id INTEGER,
    action VARCHAR(100) NOT NULL,         -- e.g., 'workspace_created', 'cost_estimated', 'spec_approved'
    details JSONB,                         -- Additional context
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_log(workspace_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);


-- ---------------------------------------------------------------
-- HELPER: Auto-update updated_at timestamp
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to projects table
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to workspaces table
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ===============================================================
-- SAMPLE DATA (OPTIONAL - for testing)
-- ===============================================================

-- Sample project
-- INSERT INTO projects (name, description, owner_id) 
-- VALUES ('My First Project', 'Test project for development', 'test-user-id');

-- Sample workspace
-- INSERT INTO workspaces (project_id, user_id, name, step, state_json) 
-- VALUES (1, 'test-user-id', 'E-commerce Backend', 'input', '{"description": "Test"}');


-- ===============================================================
-- CLEANUP OLD DATA (Run periodically)
-- ===============================================================

-- Delete expired password reset tokens
-- DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL '24 hours';

-- Archive old inactive workspaces
-- UPDATE workspaces SET is_active = FALSE WHERE updated_at < NOW() - INTERVAL '90 days';

-- ---------------------------------------------------------------
-- 7. COST_FEEDBACK TABLE
-- Stores user feedback about cost estimates and recommendations
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_feedback (
    id SERIAL PRIMARY KEY,
    workspace_id INTEGER REFERENCES workspaces(id) ON DELETE CASCADE,
    cost_intent VARCHAR(50),                    -- e.g., 'startup', 'enterprise', 'hobby'
    estimated_min DECIMAL(12,2),                -- Lower bound of cost estimate
    estimated_max DECIMAL(12,2),                -- Upper bound of cost estimate
    selected_provider VARCHAR(20),              -- AWS, GCP, AZURE
    selected_profile VARCHAR(30),               -- cost_effective, standard, high_performance
    user_feedback TEXT NOT NULL,                -- User's feedback about the estimate
    feedback_details JSONB,                     -- Additional details about feedback
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_feedback_workspace ON cost_feedback(workspace_id);
CREATE INDEX IF NOT EXISTS idx_cost_feedback_provider ON cost_feedback(selected_provider);
CREATE INDEX IF NOT EXISTS idx_cost_feedback_created ON cost_feedback(created_at DESC);
