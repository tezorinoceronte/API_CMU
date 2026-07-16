const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  // Asegúrate de usar la clave exacta que está en el panel de Render
  connectionString: process.env.SUPABASE_URL, 
  ssl: { rejectUnauthorized: false },
  family: 4, 
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 5
});

module.exports = pool;
