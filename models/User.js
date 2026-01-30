const pool = require('../config/db');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { name, email, password, company, google_id, avatar_url } = userData;

    let hashedPassword = null;
    if (password) {
      // Use fewer rounds in development for faster hashing
      const saltRounds = process.env.NODE_ENV === 'production' ? 12 : 8;
      hashedPassword = await bcrypt.hash(password, saltRounds);
    }

    const query = `
      INSERT INTO users (name, email, password, company, device_id, google_id, avatar_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, name, email, company, created_at, avatar_url
    `;

    const values = [name, email, hashedPassword, company, userData.device_id, google_id, avatar_url];
    const result = await pool.query(query, values);
    return result.rows[0];
  }

  static async findByGoogleId(googleId) {
    const query = 'SELECT * FROM users WHERE google_id = $1';
    const result = await pool.query(query, [googleId]);
    return result.rows[0];
  }

  static async updateGoogleInfo(id, googleId, avatarUrl) {
    const query = `
        UPDATE users 
        SET google_id = $1, avatar_url = $2
        WHERE id = $3
        RETURNING id, name, email, company, google_id, avatar_url
      `;
    const result = await pool.query(query, [googleId, avatarUrl, id]);
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