const { Pool } = require('pg');
require('dotenv').config();

// In config/db.js, update the pool configuration:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Optimize connection pooling for better performance & Neon compatibility
  max: 10, // Reduced max to prevent "Too many connections" (Neon often limits this)
  min: 2,  // Keep a few alive
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 20000
});

// FIX: Prevent crash on idle client errors (Critical for Neon)
pool.on('error', (err, client) => {
  console.error('Unexpected PG Pool Error (Idle Client)', err);
  // Do not exit process
});

module.exports = pool;