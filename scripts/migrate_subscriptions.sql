-- ===============================================================
-- MIGRATION: SUBSCRIPTIONS & USER SETTINGS (FREE/PRO)
-- ===============================================================

-- 1. Add roles to users table if not exists (Source of Truth for generic RBAC)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN 
        ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user'; 
    END IF; 
END $$;

-- 2. Create Subscriptions Table
-- Source of Truth for Plan Status
CREATE TABLE IF NOT EXISTS subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free' or 'pro'
    status VARCHAR(50) NOT NULL DEFAULT 'active', -- 'active', 'trialing', 'past_due', 'canceled', 'halted'
    razorpay_customer_id VARCHAR(255),
    razorpay_subscription_id VARCHAR(255),
    current_period_end TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id) -- One subscription per user
);

-- Index for fast gating checks
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- 3. Create User Settings Table
-- Stores preferences. AI Keys are no longer strict requirement for Pro (System AI included),
-- but we keep the table for future flexibility or other settings.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences JSONB DEFAULT '{}', -- Theme, notifications, default_profile
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Triggers for updated_at
DROP TRIGGER IF EXISTS update_subscriptions_updated_at ON subscriptions;
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at
    BEFORE UPDATE ON user_settings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 5. Auto-populate settings/subscriptions (Optional / Lazy load preferred)
-- We will handle creation on user registration or first login instead of bulk insert here to avoid noise.
