const { Pool } = require('pg'); 

// 2. AHORA SÍ PUEDES USARLA
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4 // Fuerza IPv4 para evitar el error ENETUNREACH
});

module.exports = pool;
