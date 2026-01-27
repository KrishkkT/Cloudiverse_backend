const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function migrate() {
    console.log('Starting Subscription Migration (Free/Pro)...');

    try {
        const sqlPath = path.join(__dirname, 'migrate_subscriptions.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Executing SQL...');
        await pool.query(sql);

        console.log('✅ Migration successful! Tables created/updated.');
    } catch (err) {
        console.error('❌ Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
