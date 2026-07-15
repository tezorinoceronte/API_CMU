const axios = require('axios');

const API_URL = process.env.API_URL || "https://soymuybonita.com/app/api/api_db.php";

async function ejecutarQuery(sql) {
    console.log("DEBUG: Conectando a:", API_URL);
    try {
        const response = await axios.post(API_URL, 
            { sql: sql }, // Cuerpo de la petición
            {             // Configuración (aquí van los headers)
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            }
        );
        return response.data;
    } catch (error) {
        // Mejoramos el log para ver por qué falla
        if (error.response) {
            console.error("❌ Error en la conexión (Status):", error.response.status);
            console.error("❌ Detalle:", error.response.data);
        } else {
            console.error("❌ Error en la conexión:", error.message);
        }
        throw error;
    }
}

const { limpiarSesionesInactivas } = require('./logicaCMU');

async function iniciarDispatcher() {
    console.log("🚀 Dispatcher inteligente iniciado (vía Puente PHP)...");
    const MAX_CONCURRENTES_POR_WORKER = 3;
    const NUM_WORKERS = 10;

    while (true) {
        try {
            await limpiarSesionesInactivas();
            
            // 1. Obtener la carga actual usando el puente
            const carga = await ejecutarQuery(
                "SELECT worker_id, COUNT(*) as activas FROM cola_tareas WHERE estado IN ('PROCESANDO', 'PROCESANDO_ESIM') GROUP BY worker_id"
            );
            
            const mapaCarga = (carga || []).reduce((acc, row) => {
                acc[row.worker_id] = row.activas;
                return acc;
            }, {});

            // 2. Buscar tareas pendientes usando el puente
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
                            // 3. Actualizar estado usando el puente
                            await ejecutarQuery(
                                `UPDATE cola_tareas SET estado = 'ASIGNADO', worker_id = '${idWorker}', fecha_actualizacion = NOW() WHERE id = ${tarea.id}`
                            );
                            mapaCarga[idWorker] = ocupacion + 1;
                            console.log(`✅ Tarea ${tarea.id} -> ${idWorker} (Ocupación: ${mapaCarga[idWorker]})`);
                            asignado = true;
                            break;
                        }
                    }
                    if (!asignado) console.warn("⚠️ Todos los workers están al máximo de su capacidad.");
                }
            }
        } catch (err) { 
            console.error("❌ Error en Dispatcher:", err.message); 
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

iniciarDispatcher();
