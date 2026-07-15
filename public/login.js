const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./cola');

const JWT_SECRET = process.env.JWT_SECRET || 'clave_super_secreta_2026';

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({ success: false, message: "Datos incompletos" });
    }

    try {
        // CORRECCIÓN 1: Usar .query en lugar de .execute
        // CORRECCIÓN 2: Usar $1 en lugar de ?
        const result = await pool.query('SELECT * FROM public.usuarios_act_cmu WHERE correo = $1', [correo]);
        
        // CORRECCIÓN 3: Extraer 'rows' del resultado de pg
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const token = jwt.sign(
            { id: user.id, nombre: user.nombre_completo, rol: user.rol }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        console.log("✅ [LOGIN] Usuario autenticado, token generado.");
        res.json({ success: true, token: token });

    } catch (err) {
        console.error("❌ ERROR EN LOGIN:", err);
        res.status(500).json({ success: false, message: "Error interno del servidor" });
    }
});

module.exports = router;
