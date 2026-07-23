const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');



// Configuración robusta para evitar el error de red1.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

const logica = require('./logicaCMU');
const {
    manejarRecargas, manejarBiometricos, manejarACT_FISICO, manejarACT_ESIM,
    manejarACT_ESIM_REINTENTO, ejecutar_ACT_ESIM_EXITOSA_QR, manejarACT_FISICA_REINTENTO,
    manejarQR, manejarQR_ACT, manejarToken, obtenerSesionCompleta,
    limpiarSesionesInactivas, manejarQR_SMS
} = logica;

const WORKER_ID = process.env.WORKER_ID || 'WORKER_01';

console.log(`🔍 [DB] Intentando conectar a: ${process.env.DATABASE_URL ? "URL CONFIGURADA" : "¡ERROR! URL NO ENCONTRADA"}`);

async function cicloWorker() {
    let client;
    let tarea;
    try {
        client = await pool.connect();

        // --- CONSULTA ATÓMICA BLINDADA CONTRA CONCURRENCIA ---
        // CORRECCIÓN: capturamos el estado ORIGINAL en "estado_original"
        // antes de que el UPDATE lo sobreescriba a 'PROCESANDO'.
        const queryAtomica = `
            WITH tarea_a_procesar AS (
                SELECT id, estado AS estado_original FROM public.cola_tareas
                WHERE worker_id = $1
                AND estado IN ('ASIGNADO', 'FALLO_TOKEN_ERROR2', 'PROCESANDO_ESIM', 'REINTENTAR_QR',
                                'ACT_ESIM_REINTENTAR', 'ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO', 'ACT_ESIM',
                                'ACT_FISICA', 'ACT_ESIM_EXITOSA_QR_1', 'VALIDANDO_TOKEN')
                ORDER BY id ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            UPDATE public.cola_tareas
            SET estado = 'PROCESANDO'
            FROM tarea_a_procesar
            WHERE public.cola_tareas.id = tarea_a_procesar.id
            RETURNING public.cola_tareas.*, tarea_a_procesar.estado_original;
        `;

        const res = await client.query(queryAtomica, [WORKER_ID]);

        if (res.rows.length === 0) {
            return; // Salida silenciosa si no hay tareas pendientes
        }

        tarea = res.rows[0];
        console.log(`🚀 [Worker: ${WORKER_ID}] Tarea encontrada y bloqueada: ${tarea.id} | Estado real: ${tarea.estado_original}`);

        // --- LÓGICA DE DELEGACIÓN (usando estado_original, no estado) ---
        if (tarea.tipo_tarea === 'RECARGA') {
            await manejarRecargas(tarea, client);

        } else if (tarea.tipo_tarea === 'BIOMETRICOS') {
            if (['VALIDANDO_TOKEN', 'FALLO_TOKEN'].includes(tarea.estado_original)) {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarToken(page, tarea, client);
            } else if (tarea.estado_original === 'REINTENTAR_QR') {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarQR_SMS(page, tarea, client);
            } else {
                await manejarBiometricos(tarea, client);
            }

        } else if (tarea.tipo_tarea === 'ACT_FISICA') {
            if (['ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO'].includes(tarea.estado_original)) {
                await manejarACT_FISICA_REINTENTO(tarea, client);
            } else if (tarea.estado_original === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else {
                await manejarACT_FISICO(tarea, client);
            }

        } else if (tarea.tipo_tarea === 'ACT_ESIM') {
            if (tarea.estado_original === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else if (tarea.estado_original === 'ASIGNADO' || tarea.estado_original === 'ACT_ESIM') {
                await manejarACT_ESIM(tarea, client);
            } else if (['ACT_ESIM_REINTENTAR', 'ACT_ESIM_FALLO'].includes(tarea.estado_original)) {
                await manejarACT_ESIM_REINTENTO(tarea, client);
            } else if (tarea.estado_original === 'ACT_ESIM_EXITOSA_QR') {
                await ejecutar_ACT_ESIM_EXITOSA_QR(null, tarea);
            } else if (tarea.estado_original === 'ACT_ESIM_VINCULAR') {
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
console.log(`..📡..................................📡............... [WOKER] ON✅`);

module.exports = { iniciarWorker };
