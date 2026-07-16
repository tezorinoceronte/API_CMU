router.post('/login', async (req, res) => {
    const { correo, password } = req.body;
    const { Pool } = require('pg');

    // CONEXIÓN DIRECTA (Sin variables de entorno)
    const pool = new Pool({
        connectionString: "postgresql://postgres.srfsdnphgdwrqjggcwfc:xSHxtYhf6rh6uXVx@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
        ssl: { rejectUnauthorized: false },
        family: 4
    });

    try {
        console.log("Intentando consulta directa a Supabase...");
        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        const result = await pool.query(query, [correo]);
        
        await pool.end(); // Cerramos conexión

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuario no encontrado" });
        }

        const user = result.rows[0];
        const bcrypt = require('bcryptjs'); // Usando bcryptjs para mayor compatibilidad
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ id: user.id }, 'clave_super_secreta_2026', { expiresIn: '24h' });
        
        return res.json({ success: true, token });

    } catch (err) {
        console.error("ERROR CRÍTICO:", err);
        return res.status(500).json({ 
            success: false, 
            message: "Fallo real: " + err.message,
            stack: err.stack 
        });
    }
});
