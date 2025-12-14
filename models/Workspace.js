const pool = require('../config/db');

class Workspace {
  static async create(workspaceData) {
    const { user_id, name, description, project_data } = workspaceData;
    
    const query = `
      INSERT INTO workspaces (user_id, name, description, project_data)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const values = [user_id, name, description, project_data];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByUserId(userId) {
    const query = 'SELECT * FROM workspaces WHERE user_id = $1 ORDER BY created_at DESC';
    const result = await pool.query(query, [userId]);
    return result.rows;
  }

  static async findById(id) {
    const query = 'SELECT * FROM workspaces WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  static async update(id, workspaceData) {
    const { name, description, project_data } = workspaceData;
    const query = `
      UPDATE workspaces 
      SET name = $1, description = $2, project_data = $3, updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
    
    const values = [name, description, project_data, id];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async delete(id) {
    const query = 'DELETE FROM workspaces WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = Workspace;