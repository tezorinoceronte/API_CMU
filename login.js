const express = require('express');
const router = express.Router();
const { Pool } = require('pg'); // Se asegura de tener pg instalado
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// Definimos la configuración directamente aquí
const pool = new Pool({
    connectionString: process.env.SUPABASE_URL,
    ssl: { rejectUnauthorized: false },
    family: 4
});

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    try {
        // Ejecución rústica y directa
        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        const result = await pool.query(query, [correo]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'clave_temporal', { expiresIn: '24h' });
        
        return res.json({ success: true, token });

    } catch (err) {
        console.error("DEBUG RÚSTICO:", err);
        return res.status(500).json({ success: false, message: "Error interno: " + err.message });
    }
});

module.exports = router;
