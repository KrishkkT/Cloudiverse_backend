const pool = require('../config/db');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { name, email, password, company } = userData;
    // Use fewer rounds in development for faster hashing
    const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 8;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const query = `
      INSERT INTO users (name, email, password, company, device_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, email, company, created_at
    `;

    const values = [name, email, hashedPassword, company, userData.device_id];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByEmail(email) {
    const query = 'SELECT * FROM users WHERE email = $1';
    const result = await pool.query(query, [email]);
    return result.rows[0];
  }

  static async findById(id) {
    const query = 'SELECT id, name, email, company, created_at FROM users WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  static async update(id, userData) {
    const { name, email, company } = userData;
    const query = `
      UPDATE users 
      SET name = $1, email = $2, company = $3
      WHERE id = $4
      RETURNING id, name, email, company, updated_at
    `;

    const values = [name, email, company, id];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async delete(id) {
    // First delete all workspaces belonging to the user
    await pool.query('DELETE FROM workspaces WHERE user_id = $1', [id]);

    // Then delete the user
    const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }
}

module.exports = User;