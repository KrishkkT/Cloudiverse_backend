const pool = require('../config/db');

async function listColumns() {
    try {
        const res = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'workspaces'
    `);
        console.log('Columns in workspaces table:', res.rows.map(r => r.column_name));
    } catch (e) {
        console.error(e);
    } finally {
        process.exit(0);
    }
}

listColumns();
