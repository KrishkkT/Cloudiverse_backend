-- Migration: Add deployment lifecycle columns to workspaces table
-- These columns track deployment status, timestamp, and history for the workspace lifecycle

-- Add deployment_status column (DRAFT, DEPLOYED, DESTROYED, FAILED)
ALTER TABLE workspaces 
ADD COLUMN IF NOT EXISTS deployment_status VARCHAR(20) DEFAULT 'DRAFT';

-- Add deployed_at timestamp (set when first successfully deployed)
ALTER TABLE workspaces 
ADD COLUMN IF NOT EXISTS deployed_at TIMESTAMP;

-- Add deployment_history JSONB array for tracking lifecycle events
-- Format: [{action: 'DEPLOY_SUCCESS', timestamp: '...', deployment_id: '...', live_url: '...'}, ...]
ALTER TABLE workspaces 
ADD COLUMN IF NOT EXISTS deployment_history JSONB DEFAULT '[]'::jsonb;

-- Index for filtering by deployment status
CREATE INDEX IF NOT EXISTS idx_workspaces_deployment_status 
ON workspaces(deployment_status);

-- Index for deployed_at queries
CREATE INDEX IF NOT EXISTS idx_workspaces_deployed_at 
ON workspaces(deployed_at);

-- GIN index for deployment history queries
CREATE INDEX IF NOT EXISTS idx_workspaces_deployment_history 
ON workspaces USING gin(deployment_history);
