const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.SUPABASE_URL || "postgresql://postgres.srfsdnphgdwrqjggcwfc:xSHxtYhf6rh6uXVx@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

const pool = new Pool({
  connectionString: connectionString,
  ssl: { rejectUnauthorized: false },
  family: 4
});

module.exports = pool;
