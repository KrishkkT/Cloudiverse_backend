const pool = require('../config/db');

async function runMigration() {
    console.log('Starting migration: Adding cloud_credentials to users table...');
    try {
        const query = `
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS cloud_credentials JSONB DEFAULT '{}';
    `;
        await pool.query(query);
        console.log('Migration successful: cloud_credentials column added/verified.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await pool.end();
    }
}

runMigration();
