const { Pool } = require('pg');
require('dotenv').config();

// In config/db.js, update the pool configuration:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Optimize connection pooling for better performance
  max: 20, // Maximum number of clients in the pool
  min: 5,  // Minimum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
  keepAlive: true, // Keep TCP connection alive
  keepAliveInitialDelayMillis: 10000 // Delay before starting to send keep alive probes
});


// Test the connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.stack);
  } else {
    console.log('Database connected successfully');
  }
});

// FIX: Prevent crash on idle client errors
pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  // Don't exit process, just log. This keeps the server alive during transient DB issues.
});

module.exports = pool;