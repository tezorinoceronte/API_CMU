const express = require('express');
const router = express.Router(); // <--- IMPORTANTE: Usar Router
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./cola');

// No uses app.use(cors) aquí. Eso va en api2406.js
// Tampoco uses app.post, usa router.post

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM public.usuarios_act_cmu WHERE correo = ?', [correo]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const token = jwt.sign({ id: user.id }, 'clave_secreta_2026', { expiresIn: '24h' });
        res.json({ success: true, token: token }); 
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: "Error interno" });
    }
});

module.exports = router; // <--- IMPORTANTE: Exportar el router
