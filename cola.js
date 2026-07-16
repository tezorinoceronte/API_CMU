// Nuevo contenido de cola.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4
});

module.exports = { pool };
