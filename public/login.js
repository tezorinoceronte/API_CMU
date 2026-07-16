const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

// Datos de conexión directos
const pool = new Pool({
    connectionString: "postgresql://postgres.srfsdnphgdwrqjggcwfc:TyZzGz0RsYJcMcqM@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    ssl: { rejectUnauthorized: false },
    family: 4
});

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    try {
        console.log("Intentando consulta directa con datos directos...");
        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        const result = await pool.query(query, [correo]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuario no encontrado" });
        }

        const user = result.rows[0];
        
        // Comparación de contraseña
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        // Token usando una clave fija para evitar depender de entorno
        const token = jwt.sign({ id: user.id }, 'clave_super_secreta_2026', { expiresIn: '24h' });
        
        return res.json({ success: true, token });

    } catch (err) {
        console.error("ERROR CRÍTICO:", err);
        return res.status(500).json({ 
            success: false, 
            message: "Fallo real: " + err.message 
        });
    }
});

module.exports = router;
