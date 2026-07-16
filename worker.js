console.log(`📡 [WOKER] CONECTANDO WORKER `);

const { pool } = require('./cola'); // Asegúrate que exporte el pool de 'pg'
const logica = require('./logicaCMU');

const { 
    manejarRecargas, manejarBiometricos, manejarACT_FISICO, manejarACT_ESIM, 
    manejarACT_ESIM_REINTENTO, ejecutar_ACT_ESIM_EXITOSA_QR, manejarACT_FISICA_REINTENTO,
    manejarQR, manejarQR_ACT, manejarToken, obtenerSesionCompleta, 
    limpiarSesionesInactivas, manejarQR_SMS
} = logica;

const WORKER_ID = process.env.WORKER_ID || 'WORKER_01';

async function cicloWorker() {
    let client;
    let tarea;
    try {
        // CORRECCIÓN PG: Obtención de cliente del pool
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
            client.release();
            return;
        }

        tarea = res.rows[0];
        
        // Solo marcamos como PROCESANDO si no está en espera de interacción
        if (tarea.estado !== 'VALIDANDO_TOKEN' && tarea.estado !== 'FALLO_TOKEN') {
            await client.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['PROCESANDO', tarea.id]);
        }
        
        console.log(`🛠 [Worker: ${WORKER_ID}] Procesando tarea ${tarea.id} | Tipo: ${tarea.tipo_tarea} | Estado: ${tarea.estado}`);

        // --- LÓGICA DE DELEGACIÓN ---
        if (tarea.tipo_tarea === 'RECARGA') {
            await manejarRecargas(tarea, client);
        } 
        else if (tarea.tipo_tarea === 'BIOMETRICOS') {
            if (['VALIDANDO_TOKEN', 'FALLO_TOKEN'].includes(tarea.estado)) {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarToken(page, tarea, client);
            } 
            else if (tarea.estado === 'REINTENTAR_QR') {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarQR_SMS(page, tarea, client);
            } 
            else {
                await manejarBiometricos(tarea, client);
            }
        }
        else if (tarea.tipo_tarea === 'ACT_FISICA') {
            if (['ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO'].includes(tarea.estado)) {
                await manejarACT_FISICA_REINTENTO(tarea, client);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else {
                await manejarACT_FISICO(tarea, client);
            }
        } 
        else if (tarea.tipo_tarea === 'ACT_ESIM') {
            if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, client);
            } else if (tarea.estado === 'ASIGNADO' || tarea.estado === 'ACT_ESIM') {
                await manejarACT_ESIM(tarea, client);
            } else if (['ACT_ESIM_REINTENTAR', 'ACT_ESIM_FALLO'].includes(tarea.estado)) {
                await manejarACT_ESIM_REINTENTO(tarea, client);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR') {
                await ejecutar_ACT_ESIM_EXITOSA_QR(null, tarea); // Asegúrate de ajustar los parámetros según tu logicaCMU
            } else if (tarea.estado === 'ACT_ESIM_VINCULAR') {
                await manejarQR(null, tarea, client); 
            }
        }
    } catch (err) {
        console.error(`❌ [Worker: ${WORKER_ID}] Error crítico en tarea ${tarea?.id || 'N/A'}:`, err.message);
        if (client && tarea && tarea.id) {
            await client.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                ['ERROR', err.message.substring(0, 255), tarea.id]
            ).catch(e => console.error("❌ Falló el reporte a BD:", e));
        }
    } finally {
        if (client) client.release();
    }
}

console.log("🚀 Sistema de limpieza de sesiones iniciado.");
setInterval(limpiarSesionesInactivas, 4 * 60 * 1000);

async function iniciarWorker() {
    console.log(`✅ ${WORKER_ID} activo y esperando tareas...`);
    while (true) {
        await cicloWorker();
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

console.log(`📡 [WOKER] ON`);
iniciarWorker();
