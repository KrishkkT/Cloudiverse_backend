-- Optimizing the workspaces table for JSON traversal
CREATE INDEX IF NOT EXISTS idx_workspaces_state_json ON workspaces USING gin (state_json);

-- Optional: If you want to query connection status efficiently
CREATE INDEX IF NOT EXISTS idx_workspaces_connection_status 
ON workspaces ((state_json->'connection'->>'status'));
