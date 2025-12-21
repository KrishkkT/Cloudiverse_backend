-- Cloudiverse Database Schema & Migration Script
-- Run this to initialize or repair the database

-- 1. Projects Table
CREATE TABLE IF NOT EXISTS projects (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL DEFAULT 'Untitled Project',
    description TEXT,
    owner_id INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Workspaces Table
CREATE TABLE IF NOT EXISTS workspaces (
    id SERIAL PRIMARY KEY,
    project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(255),
    step VARCHAR(50) NOT NULL,
    state_json JSONB NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Schema Repairs (Idempotent Migrations)
-- This block fixes tables if they were created by an older version of the script
DO $$
BEGIN
    -- Add project_id to workspaces if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='project_id') THEN
        ALTER TABLE workspaces ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE;
    END IF;

    -- Add name to workspaces if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='name') THEN
        ALTER TABLE workspaces ADD COLUMN name VARCHAR(255);
    END IF;

    -- Add is_active to workspaces if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='workspaces' AND column_name='is_active') THEN
        ALTER TABLE workspaces ADD COLUMN is_active BOOLEAN DEFAULT TRUE;
    END IF;
END $$;
