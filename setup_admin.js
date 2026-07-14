const bcrypt = require('bcrypt');
const { pool } = require('./api2406'); 

async function repararAdmin() {
    try {
        console.log("Intentando limpiar y recrear admin...");
        
        // 1. Borramos el registro para evitar el conflicto
        await pool.execute('DELETE FROM usuarios_act_cmu WHERE correo = ?', ['7443263557']);
        
        // 2. Recreamos el usuario
        const passwordHash = await bcrypt.hash('sigma781', 12);
        await pool.execute(
            'INSERT INTO usuarios_act_cmu (nombre_completo, correo, password_hash, rol) VALUES (?, ?, ?, ?)',
            ['Admin Principal', '7443263557', passwordHash, 'admin']
        );
        
        console.log("✅ Admin recreado exitosamente con ID: 7443263557");
    } catch (err) {
        console.error("❌ Error al reparar admin:", err);
    } finally {
        process.exit(); // Cierra el proceso al terminar
    }
}

repararAdmin();