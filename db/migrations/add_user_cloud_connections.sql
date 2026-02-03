-- ===============================================================
-- USER CLOUD CONNECTIONS TABLE
-- Stores cloud provider connections at user level for reuse
-- ===============================================================

CREATE TABLE IF NOT EXISTS user_cloud_connections (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    provider VARCHAR(20) NOT NULL,  -- aws, azure, gcp
    
    -- Connection credentials (JSONB for flexibility)
    connection_data JSONB NOT NULL,
    -- AWS: {role_arn, external_id, account_id, region}
    -- Azure: {tenant_id, subscription_id, client_id, client_secret}
    -- GCP: {project_id, service_account_key, region}
    
    -- Status
    status VARCHAR(20) DEFAULT 'connected',
    verified BOOLEAN DEFAULT TRUE,
    
    -- Metadata
    connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- One connection per provider per user
    UNIQUE(user_id, provider)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_connections_user ON user_cloud_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_user_connections_provider ON user_cloud_connections(provider);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_cloud_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_user_cloud_connections_updated_at ON user_cloud_connections;
CREATE TRIGGER update_user_cloud_connections_updated_at
    BEFORE UPDATE ON user_cloud_connections
    FOR EACH ROW
    EXECUTE FUNCTION update_user_cloud_connections_updated_at();
