const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./cola'); // IMPORTA EL POOL CENTRALIZADO

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({ success: false, message: "Faltan datos" });
    }

    try {
        // 1. Buscar usuario
        const result = await pool.query('SELECT * FROM public.usuarios_act_cmu WHERE correo = $1', [correo]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuario no encontrado" });
        }

        const user = result.rows[0];

        // 2. Verificar contraseña
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        // 3. Generar token
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '24h' });
        
        res.json({ success: true, token });

    } catch (err) {
        console.error("LOG DE ERROR DETALLADO:", err);
        res.status(500).json({ success: false, message: "Error interno, revisa logs" });
    }
});

module.exports = router;
