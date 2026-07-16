const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4,
  max: 5
});
module.exports = pool;
