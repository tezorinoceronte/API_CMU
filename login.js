const express = require('express');
const bcrypt = require('bcrypt');
const cookieParser = require('cookie-parser');
const { pool } = require('./cola'); // Nota: sin .js en CommonJS

const router = express.Router();

router.use(cookieParser());

router.post('/login', async (req, res) => {
    const { correo, password } = req.body;

    if (!correo || !password) {
        return res.status(400).json({ success: false, message: "Campos incompletos" });
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM usuarios_act_cmu WHERE correo = ?', [correo]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        if (user.bloqueado) {
            return res.status(403).json({ success: false, message: "Cuenta bloqueada." });
        }

        res.cookie('auth_session', JSON.stringify({
            userId: user.id,
            rol: user.rol,
            nombre: user.nombre_completo,
            correo: user.correo,
            estado: user.estado,
            municipio: user.municipio
        }), {
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            path: '/',
            maxAge: 3600000 
        });

        await pool.execute('UPDATE usuarios_act_cmu SET intentos_fallidos = 0 WHERE id = ?', [user.id]);
        return res.json({ success: true, message: "Bienvenido" });

    } catch (err) {
        res.status(500).json({ success: false, message: "Error en el servidor" });
    }
});

router.post('/registro', async (req, res) => {
    const cookieData = req.cookies.auth_session ? JSON.parse(req.cookies.auth_session) : null;
    
    if (!cookieData) {
        return res.status(401).json({ success: false, message: "Sesión no válida" });
    }

    const { nombre, correo, password, rol, estado, municipio } = req.body;
    const rolCreador = cookieData.rol;
    const creatorId = cookieData.userId;

    const permisos = {
        'admin': ['supervisor', 'vendedor', 'cliente'],
        'supervisor': ['vendedor', 'cliente'],
        'vendedor': ['cliente']
    };

    if (!permisos[rolCreador] || !permisos[rolCreador].includes(rol)) {
        return res.status(403).json({ success: false, message: "No tienes permiso para crear este usuario" });
    }

    try {
        if (!nombre || !correo || !password || !rol) {
            return res.status(400).json({ success: false, message: "Faltan datos obligatorios" });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        
        await pool.execute(
            'INSERT INTO usuarios_act_cmu (nombre_completo, correo, password_hash, rol, estado, municipio, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [nombre, correo, passwordHash, rol, estado, municipio, creatorId]
        );
        
        res.json({ success: true, message: "Usuario registrado correctamente" });
    } catch (err) {
        if (err.errno === 1062) {
            return res.status(400).json({ success: false, message: "El correo ya está registrado" });
        }
        res.status(500).json({ success: false, message: "Error interno: " + err.message });
    }
});

router.post('/logout', (req, res) => {
    res.clearCookie('auth_session');
    res.json({ success: true, message: "Sesión cerrada" });
});

router.get('/me', async (req, res) => {
    const cookieData = req.cookies.auth_session ? JSON.parse(req.cookies.auth_session) : null;
    if (!cookieData) return res.status(401).json({ success: false });
    
    try {
        const [rows] = await pool.execute(`
            SELECT u.nombre_completo, u.rol, u.estado, u.municipio, 
                   COALESCE(creator.nombre_completo, 'No tiene creador') AS nombre_creador 
            FROM usuarios_act_cmu u 
            LEFT JOIN usuarios_act_cmu creator ON u.parent_id = creator.id 
            WHERE u.id = ?`, [cookieData.userId]);
            
        const user = rows[0];
        res.json({ 
            success: true, 
            nombre: user.nombre_completo, 
            rol: user.rol, 
            estado: user.estado,
            municipio: user.municipio,
            creado_por: user.nombre_creador 
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/usuarios', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT * FROM usuarios_act_cmu ORDER BY id DESC');
        
        let html = `
        <style>
            body { font-family: 'Segoe UI', sans-serif; margin: 20px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #2c3e50; color: white; padding: 8px; text-align: left; position: sticky; top: 0; }
            td { border: 1px solid #ddd; padding: 6px; }
            tr:nth-child(even) { background: #f9f9f9; }
            h2 { color: #2c3e50; }
        </style>
        <h2>Lista de Usuarios Registrados</h2>
        <table>
            <tr>
                ${Object.keys(rows[0] || {}).map(col => `<th>${col}</th>`).join('')}
            </tr>
            ${rows.map(r => `
                <tr>
                    ${Object.values(r).map(val => `<td>${val ?? '-'}</td>`).join('')}
                </tr>
            `).join('')}
        </table>`;
        
        res.send(html);
    } catch (err) {
        res.status(500).send("<h1>Error al cargar usuarios:</h1>" + err.message);
    }
});

router.get('/api/obtener-mi-id', (req, res) => {
    const cookieData = req.cookies.auth_session ? JSON.parse(req.cookies.auth_session) : null;
    
    if (!cookieData) {
        return res.status(401).json({ success: false, message: "No autenticado" });
    }
    
    res.json({ success: true, userId: cookieData.userId });
});

module.exports = router;