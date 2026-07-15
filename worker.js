const { pool } = require('./cola');
const logica = require('./logicaCMU');

const { 
    manejarRecargas, 
    manejarBiometricos, 
    manejarACT_FISICO, 
    manejarACT_ESIM, 
    manejarACT_ESIM_REINTENTO, 
    ejecutar_ACT_ESIM_EXITOSA_QR, 
    manejarACT_FISICA_REINTENTO,
    manejarQR,
    manejarQR_ACT,
    manejarToken,
    obtenerSesionCompleta, 
    limpiarSesionesInactivas,
    manejarQR_SMS
} = logica;

const WORKER_ID = process.env.WORKER_ID || 'WORKER_01';

async function cicloWorker() {
    let connection;
    let tarea;
    try {
        connection = await pool.getConnection();
        
        const [tareas] = await connection.execute(
            `SELECT * FROM public.cola_tareas 
             WHERE worker_id = ? 
             AND estado IN ('ASIGNADO', 'FALLO_TOKEN_ERROR2', 'PROCESANDO_ESIM', 'REINTENTAR_QR', 
                            'ACT_ESIM_REINTENTAR', 'ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO', 'ACT_ESIM', 
                            'ACT_FISICA', 'ACT_ESIM_EXITOSA_QR_1', 'VALIDANDO_TOKEN') 
             LIMIT 1`, [WORKER_ID]
        );

        if (tareas.length === 0) {
            connection.release();
            return;
        }

        tarea = tareas[0];
        
        // Solo marcamos como PROCESANDO si no está en espera de interacción
        if (tarea.estado !== 'VALIDANDO_TOKEN' && tarea.estado !== 'FALLO_TOKEN') {
            await connection.execute("UPDATE public.cola_tareas SET estado = 'PROCESANDO' WHERE id = ?", [tarea.id]);
        }
        
        console.log(`🛠 [Worker: ${WORKER_ID}] Procesando tarea ${tarea.id} | Tipo: ${tarea.tipo_tarea} | Estado: ${tarea.estado}`);

        // --- LÓGICA DE DELEGACIÓN ---
        if (tarea.tipo_tarea === 'RECARGA') {
            await manejarRecargas(tarea, connection);
        } 
  
        
        else if (tarea.tipo_tarea === 'BIOMETRICOS') {
            if (['VALIDANDO_TOKEN', 'FALLO_TOKEN'].includes(tarea.estado)) {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarToken(page, tarea, connection);
            } 
            // Bloque corregido:
            else if (tarea.estado === 'REINTENTAR_QR') {
                const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
                const page = await obtenerSesionCompleta(tarea.user_id, url);
                await manejarQR_SMS(page, tarea, connection);
            } 
            else {
                await manejarBiometricos(tarea, connection);
            }
        }



         
        else if (tarea.tipo_tarea === 'ACT_FISICA') {
            if (['ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO'].includes(tarea.estado)) {
                await manejarACT_FISICA_REINTENTO(tarea, connection);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, connection);
            } else {
                await manejarACT_FISICO(tarea, connection);
            }
        } 
        else if (tarea.tipo_tarea === 'ACT_ESIM') {
            if (tarea.estado === 'ACT_ESIM_EXITOSA_QR_1') {
                const page = await obtenerSesionCompleta(tarea.user_id, 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login');
                await manejarQR_ACT(page, tarea, connection);
            } else if (tarea.estado === 'ASIGNADO' || tarea.estado === 'ACT_ESIM') {
                await manejarACT_ESIM(tarea, connection);
            } else if (['ACT_ESIM_REINTENTAR', 'ACT_ESIM_FALLO'].includes(tarea.estado)) {
                await manejarACT_ESIM_REINTENTO(tarea, connection);
            } else if (tarea.estado === 'ACT_ESIM_EXITOSA_QR') {
                await ejecutar_ACT_ESIM_EXITOSA_QR(tarea, connection);
            } else if (tarea.estado === 'ACT_ESIM_VINCULAR') {
                await manejarQR(null, tarea, connection); 
            }
        }
    } catch (err) {
        console.error(`❌ [Worker: ${WORKER_ID}] Error crítico en tarea ${tarea?.id || 'N/A'}:`, err.message);
        if (connection && tarea && tarea.id) {
            await connection.execute(
                "UPDATE cola_tareas SET estado = 'ERROR', resultado = ? WHERE id = ?", 
                [err.message.substring(0, 255), tarea.id]
            ).catch(e => console.error("❌ Falló el reporte a BD:", e));
        }
    } finally {
        if (connection) connection.release();
    }
}

console.log("🚀 Sistema de limpieza de sesiones iniciado.");
setInterval(limpiarSesionesInactivas, 4 * 60 * 1000);

// Bucle inteligente: Espera a que termine la ejecución antes de programar la siguiente
async function iniciarWorker() {
    console.log(`✅ ${WORKER_ID} activo y esperando tareas...`);
    while (true) {
        await cicloWorker();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Espera 2 segundos entre tareas
    }
}

iniciarWorker();
