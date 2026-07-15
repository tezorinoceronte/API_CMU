const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // <-- NUEVO
const { pool } = require('./cola');

const JWT_SECRET = 'clave_super_secreta_2026'; // Guárdala en una variable de entorno

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    try {
        const [rows] = await pool.execute('SELECT * FROM usuarios_act_cmu WHERE correo = ?', [correo]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        // Generar Token
        const token = jwt.sign(
            { id: user.id, nombre: user.nombre_completo, rol: user.rol }, 
            JWT_SECRET, 
            { expiresIn: '24h' }
        );

        console.log("✅ [LOGIN] Usuario autenticado, token generado.");
        res.json({ success: true, token: token }); // Enviamos el token al cliente

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;