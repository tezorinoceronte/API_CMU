const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
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
    console.log("🚀 Dispatcher conectado directamente a Supabase...");
    const MAX_CONCURRENTES_POR_WORKER = 3;
    const NUM_WORKERS = 10;

    while (true) {
        try {
            await limpiarSesionesInactivas();
            
            const carga = await ejecutarQuery(
                "SELECT worker_id, COUNT(*) as activas FROM cola_tareas WHERE estado IN ('PROCESANDO', 'PROCESANDO_ESIM') GROUP BY worker_id"
            );
            
            const mapaCarga = (carga || []).reduce((acc, row) => {
                acc[row.worker_id] = parseInt(row.activas);
                return acc;
            }, {});

            const tareas = await ejecutarQuery(
                `SELECT id FROM cola_tareas 
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
                            // AQUÍ ESTÁ EL CAMBIO PARA SEGURIDAD:
                            await ejecutarQuery(
                                `UPDATE cola_tareas SET estado = 'ASIGNADO', worker_id = $1, fecha_actualizacion = NOW() WHERE id = $2`,
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
           console.error("❌ ERROR DETALLADO:", err.stack);
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

iniciarDispatcher();
