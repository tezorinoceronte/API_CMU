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


const logica = require('./logicaCMU');

const { 
    manejarRecargas, manejarBiometricos, manejarACT_FISICO, manejarACT_ESIM, 
    manejarACT_ESIM_REINTENTO, ejecutar_ACT_ESIM_EXITOSA_QR, manejarACT_FISICA_REINTENTO,
    manejarQR, manejarQR_ACT, manejarToken, obtenerSesionCompleta, 
    limpiarSesionesInactivas, manejarQR_SMS
} = logica;

console.log(`🔍 [DB] Intentando conectar a: ${process.env.SUPABASE_URL? "URL CONFIGURADA" : "¡ERROR! URL NO ENCONTRADA"}`);
const WORKER_ID = process.env.WORKER_ID || 'WORKER_01';

console.log(`🔍 [DB] Intentando conectar a: ${process.env.SUPABASE_URL ? "URL CONFIGURADA" : "¡ERROR! URL NO ENCONTRADA"}`);


async function cicloWorker() {
    let client;
    let tarea;
    try {
        // 1. Intento de conexión
        client = await pool.connect();
        
        const res = await client.query(
            `SELECT * FROM public.cola_tareas 
             WHERE worker_id = $1 
             AND estado IN ('ASIGNADO', 'FALLO_TOKEN_ERROR2', 'PROCESANDO_ESIM', 'REINTENTAR_QR', 
                            'ACT_ESIM_REINTENTAR', 'ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO', 'ACT_ESIM', 
                            'ACT_FISICA', 'ACT_ESIM_EXITOSA_QR_1', 'VALIDANDO_TOKEN') 
             LIMIT 1`, [WORKER_ID]
        );

        if (res.rows.length === 0) {
            // Eliminado el client.release() de aquí para evitar conflictos con el finally
            return; // Salida silenciosa si no hay tareas
        }

        tarea = res.rows[0];
        console.log(`🚀 [Worker: ${WORKER_ID}] Tarea encontrada: ${tarea.id} | Estado: ${tarea.estado}`);

        // 2. Marcamos como procesando (solo si no es validación de token)
        if (tarea.estado !== 'VALIDANDO_TOKEN' && tarea.estado !== 'FALLO_TOKEN') {
            await client.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['PROCESANDO', tarea.id]);
        }

        // --- LÓGICA DE DELEGACIÓN ---
        if (tarea.tipo_tarea === 'RECARGA') {
            await manejarRecargas(tarea, client);
        } else if (tarea.tipo_tarea === 'BIOMETRICOS') {
            if (['VALIDANDO_TOKEN', 'FALLO_TOKEN'].includes(tarea.estado)) {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarToken(page, tarea, client);
            } else if (tarea.estado === 'REINTENTAR_QR') {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarQR_SMS(page, tarea, client);
            } else {
                await manejarBiometricos(tarea, client);
            }
        } else if (tarea.tipo_tarea === 'ACT_FISICA') {
            if (['ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO'].includes(tarea.estado)) {
                await manejarACT_FISICA_REINTENTO(tarea, client);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else {
                await manejarACT_FISICO(tarea, client);
            }
        } else if (tarea.tipo_tarea === 'ACT_ESIM') {
            if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else if (tarea.estado === 'ASIGNADO' || tarea.estado === 'ACT_ESIM') {
                await manejarACT_ESIM(tarea, client);
            } else if (['ACT_ESIM_REINTENTAR', 'ACT_ESIM_FALLO'].includes(tarea.estado)) {
                await manejarACT_ESIM_REINTENTO(tarea, client);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR') {
                await ejecutar_ACT_ESIM_EXITOSA_QR(null, tarea);
            } else if (tarea.estado === 'ACT_ESIM_VINCULAR') {
                await manejarQR(null, tarea, client);
            }
        }

    } catch (err) {
        console.error(`🚨 [Worker: ${WORKER_ID}] ERROR DETALLADO:`);
        console.error(`   Mensaje: ${err.message}`);
        console.error(`   Stack: ${err.stack}`);
        
        if (client && tarea && tarea.id) {
            try {
                await client.query(
                    "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                    ['ERROR', err.message.substring(0, 255), tarea.id]
                );
            } catch (e) {
                console.error("❌ Falló el reporte de error a BD:", e.message);
            }
        }
    } finally {
        // La única forma de asegurar que no haya doble liberación
        if (client) {
            client.release();
        }
    }
}

async function iniciarWorker() {
    console.log(`✅ ${WORKER_ID} activo y esperando tareas...`);
    while (true) {
        await cicloWorker();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}


console.log(`📡 [WOKER] ON`);
iniciarWorker();
console.log(`..📡..................................📡............... [WOKER] ON✅`);
console.log(`..📡.....📡............................................ [WOKER] ON✅`);
module.exports = { iniciarWorker };
