const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

// Datos de conexión directos
const pool = new Pool({
    host: 'aws-0-us-east-1.pooler.supabase.com',
    user: 'postgres.srfsdnphgdwrqjggcwfc',
    password: 'TyZzGz0RsYJcMcqM', // Aquí pones tu contraseña tal cual
    database: 'postgres',
    port: 5432,
    ssl: { rejectUnauthorized: false },
    family: 4
});

const JWT_SECRET = process.env.JWT_SECRET || 'clave_super_secreta_2026';

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({ success: false, message: "Datos incompletos" });
    }

    try {
        // Ejecutamos la consulta una sola vez
        const result = await pool.query('SELECT * FROM public.usuarios_act_cmu WHERE correo = $1', [correo]);
        const user = result.rows[0];

        // Verificamos si existe y comparamos contraseña
        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        // Generamos el token una sola vez
        const token = jwt.sign(
            { id: user.id, nombre: user.nombre_completo, rol: user.rol }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        console.log("✅ [LOGIN] Usuario autenticado:", correo);
        return res.json({ success: true, token: token });

    } catch (err) {
        console.error("❌ ERROR EN LOGIN:", err);
        return res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
});

module.exports = router;
