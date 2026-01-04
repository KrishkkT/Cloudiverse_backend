const { Client } = require('pg');
require('dotenv').config();

// Create a client with the database URL
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Read schema from file
const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(__dirname, 'database', 'cloudiverse_schema.sql'), 'utf8');

async function initDatabase() {
  try {
    console.log('Connecting to database...');

    // Connect to the database
    await client.connect();

    // Execute the schema
    await client.query(schema);

    console.log('Database initialized successfully!');

    // Close the connection
    await client.end();
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

// Run the initialization
initDatabase();
