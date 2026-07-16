router.post('/login', async (req, res) => {
    const { correo, password } = req.body;
    
    // Conexión rústica (aquí mismo)
    const { Pool } = require('pg');
    const pool = new Pool({
        connectionString: process.env.SUPABASE_URL,
        ssl: { rejectUnauthorized: false },
        family: 6
    });

    try {
        console.log("Intentando consulta para:", correo);
        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        const result = await pool.query(query, [correo]);
        
        // Cerramos el pool inmediatamente después de la consulta
        await pool.end(); 

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuario no existe" });
        }

        const user = result.rows[0];
        const bcrypt = require('bcrypt');
        const match = await bcrypt.compare(password, user.password_hash);
        
        if (!match) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET || 'dev_key', { expiresIn: '24h' });
        
        res.json({ success: true, token });

    } catch (err) {
        console.error("ERROR RÚSTICO:", err);
        // ESTA LÍNEA TE DIRÁ LA VERDAD EN EL NAVEGADOR
        res.status(500).json({ 
            success: false, 
            message: "Fallo real: " + err.message,
            stack: err.stack 
        });
    }
});
