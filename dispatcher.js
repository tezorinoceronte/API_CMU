const { Pool } = require('pg');

// Configuración robusta para evitar el error de red1
const pool = new Pool({
  connectionString: process.env.SUPAABASE_URL,
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

async function ejecutarQuery(sql, params = []) {
    const client = await pool.connect();
    try {
        const res = await client.query(sql, params);
        return res.rows;
    } finally {
        client.release();
    }
}

const { limpiarSesionesInactivas } = require('./logicaCMU');

async function iniciarDispatcher() {
    console.log("🚀 Dispatcher iniciado y configurado para IPv4...");
    const MAX_CONCURRENTES_POR_WORKER = 3;
    const NUM_WORKERS = 10;

    while (true) {
        try {
            await limpiarSesionesInactivas();
            
            const carga = await ejecutarQuery(
                "SELECT worker_id, COUNT(*) as activas FROM public.cola_tareas WHERE estado IN ('PROCESANDO', 'PROCESANDO_ESIM') GROUP BY worker_id"
            );
            
            const mapaCarga = (carga || []).reduce((acc, row) => {
                acc[row.worker_id] = parseInt(row.activas);
                return acc;
            }, {});

            const tareas = await ejecutarQuery(
                `SELECT id FROM public.cola_tareas 
                 WHERE worker_id IS NULL 
                 AND estado IN ('PENDIENTE', 'ACT_ESIM', 'ACT_FISICA', 'REINTENTAR_QR', 'ACT_ESIM_REINTENTAR', 'ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO') 
                 LIMIT 10`
            );

            if (tareas && tareas.length > 0) {
                for (const tarea of tareas) {
                    let asignado = false;
                    for (let i = 1; i <= NUM_WORKERS; i++) {
                        const idWorker = `WORKER_${i.toString().padStart(2, '0')}`;
                        const ocupacion = mapaCarga[idWorker] || 0;

                        if (ocupacion < MAX_CONCURRENTES_POR_WORKER) {
                            await ejecutarQuery(
                                `UPDATE public.cola_tareas SET estado = 'ASIGNADO', worker_id = $1, fecha_actualizacion = NOW() WHERE id = $2`,
                                [idWorker, tarea.id]
                            );
                            mapaCarga[idWorker] = ocupacion + 1;
                            console.log(`✅ Tarea ${tarea.id} -> ${idWorker}`);
                            asignado = true;
                            break;
                        }
                    }
                    if (!asignado) console.warn("⚠️ Todos los workers ocupados.");
                }
            }
        } catch (err) { 
            console.error("❌ ERROR DETALLADO:", err.message);
            // Si el error es de conexión, pausamos un poco más para que la red respire
            await new Promise(r => setTimeout(r, 5000));
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}
console.log(" 🚨 . . ..🚀 COMUNICATEC esta en orbita ... ...🚀  DISPATCHER  ✅");
console.log(" 🚨 . . ..🚀 ATHANATOS MIKHAEL esta en orbita ... ...🚀DISPACHER ON  ✅");
module.exports = { iniciarDispatcher };
