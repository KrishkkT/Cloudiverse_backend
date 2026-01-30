const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function migrate() {
    try {
        console.log('Starting migration: Add Google Auth columns to users table...');

        // Add google_id column if it doesn't exist
        await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='google_id') THEN
          ALTER TABLE users ADD COLUMN google_id VARCHAR(255) UNIQUE;
          RAISE NOTICE 'Added google_id column';
        END IF;
      END
      $$;
    `);

        // Add avatar_url column if it doesn't exist
        await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='avatar_url') THEN
          ALTER TABLE users ADD COLUMN avatar_url TEXT;
          RAISE NOTICE 'Added avatar_url column';
        END IF;
      END
      $$;
    `);

        // Make password nullable (or check constraint) - actually, for safety, let's just allow it or keep it as is. 
        // Usually Google Auth users might not have a password. 
        // We can alter the column to be NULLABLE.
        await pool.query(`
      ALTER TABLE users ALTER COLUMN password DROP NOT NULL;
    `);

        console.log('Migration completed successfully.');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await pool.end();
    }
}

migrate();
