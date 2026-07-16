const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

// Configuración robusta para evitar el error de red1
const pool = new Pool({
  connectionString: process.env.SUPABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  // Forzar IPv4 para evitar el error ENETUNREACH
  family: 4, 
  // Aumentar tiempos de espera para entornos en la nube
  connectionTimeoutMillis: 15000,
  idleTimeoutMillis: 30000,
  max: 5 // Reducir conexiones simultáneas para evitar saturación
});

const JWT_SECRET = process.env.JWT_SECRET || 'clave_super_secreta_2026';

router.post('/login', async (req, res) => {
    try {
        console.log("Intentando login para:", req.body.correo);
        const { correo, password } = req.body;
        
        // Verifica si el pool está disponible
        if (!pool) throw new Error("Pool de base de datos no inicializado");

        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        const result = await pool.query(query, [correo]);
        
        console.log("Resultado de DB obtenido:", result.rows.length);
        // ... resto de tu lógica
    } catch (err) {
        console.error("ERROR DETALLADO EN LOGIN:", err); // <-- ESTE ES EL LOG QUE DEBES BUSCAR EN RENDER
        res.status(500).json({ success: false, message: "Error interno" });
    }
});
