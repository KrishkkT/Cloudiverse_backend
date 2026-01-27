const pool = require('../config/db');

async function runMigration() {
    console.log('--- Starting Migration: Usage Tracking & Security ---');
    try {
        // 1. Add device_id column
        await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS device_id VARCHAR(255);
    `);
        console.log('✅ Added device_id column');

        // 2. Add usage counters
        await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS ai_usage_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS terraform_export_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS report_export_count INT DEFAULT 0,
      ADD COLUMN IF NOT EXISTS diagram_export_count INT DEFAULT 0;
    `);
        console.log('✅ Added usage counter columns');

        console.log('--- Migration Completed Successfully ---');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration Failed:', err);
        process.exit(1);
    }
}

runMigration();
