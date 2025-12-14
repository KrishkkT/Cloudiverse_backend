# Cloudiverse Architect - Backend

This is the backend API for Cloudiverse Architect, built with Node.js, Express, and PostgreSQL.

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: PostgreSQL (NeonDB)
- **Authentication**: JWT tokens
- **Email**: Nodemailer
- **Password Security**: bcryptjs
- **Validation**: Joi

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables (see .env.example)

3. Initialize the database:
   ```bash
   node init-db.js
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Start the production server:
   ```bash
   npm start
   ```

## Deployment

This backend is designed to be deployed to Railway.app or Render.com:

1. Push code to GitHub
2. Connect repository to Railway.app
3. Set environment variables in Railway dashboard:
   ```
   DATABASE_URL=your_neon_db_url
   JWT_SECRET=your_secret_key
   EMAIL_* variables
   ```

## API Endpoints

### Authentication
- POST /api/auth/register - Register a new user
- POST /api/auth/login - Login user
- GET /api/auth/profile - Get user profile (protected)
- PUT /api/auth/profile - Update user profile (protected)
- DELETE /api/auth/profile - Delete user account (protected)

### Workspaces
- POST /api/workspaces - Create a new workspace (protected)
- GET /api/workspaces - Get all user workspaces (protected)
- GET /api/workspaces/:id - Get a specific workspace (protected)
- PUT /api/workspaces/:id - Update a workspace (protected)
- DELETE /api/workspaces/:id - Delete a workspace (protected)

## Database Schema

### Users Table
- id (UUID, Primary Key)
- name (VARCHAR)
- email (VARCHAR, Unique)
- password (VARCHAR)
- company (VARCHAR)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### Workspaces Table
- id (UUID, Primary Key)
- user_id (UUID, Foreign Key to Users)
- name (VARCHAR)
- description (TEXT)
- project_data (JSONB)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

## Development Notes

- Uses UUIDs for all primary keys
- Implements proper foreign key relationships
- Passwords are hashed with bcrypt
- JWT tokens for authentication
- Email notifications for registration and login
- Proper error handling and validation