// Nuevo contenido de cola.js
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Fuerza a usar IPv4
  host: 'db.srfsdnphgdwrqjggcwfc.supabase.co', // Asegúrate de extraer solo el host aquí
  family: 4 
});
