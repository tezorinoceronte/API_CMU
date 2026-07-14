const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: process.env.DB_HOST,      // Aquí leerá la variable que pusiste en Render
  user: process.env.DB_USER,      // Aquí leerá el usuario de Hospedando
  password: process.env.DB_PASSWORD, // Aquí leerá tu contraseña
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306
});
const { limpiarSesionesInactivas } = require('./logicaCMU');

async function iniciarDispatcher() {
    console.log("🚀 Dispatcher inteligente iniciado (Capacidad: 3 tareas/worker)...");
    const MAX_CONCURRENTES_POR_WORKER = 3;
    const NUM_WORKERS = 10;

    while (true) {
        try {
            await limpiarSesionesInactivas();
            const connection = await pool.getConnection();

            // 1. Obtener la carga actual de cada worker
            const [carga] = await connection.execute(
                "SELECT worker_id, COUNT(*) as activas FROM cola_tareas WHERE estado IN ('PROCESANDO', 'PROCESANDO_ESIM') GROUP BY worker_id"
            );
            
            const mapaCarga = carga.reduce((acc, row) => {
                acc[row.worker_id] = row.activas;
                return acc;
            }, {});

            // 2. Buscar tareas pendientes o listas para ser retomadas
            // CORRECCIÓN: Aquí incluimos 'PENDIENTE' y los estados iniciales de tus tareas específicas
            const [tareas] = await connection.execute(
                `SELECT id FROM cola_tareas 
                 WHERE worker_id IS NULL 
                 AND estado IN ('PENDIENTE', 'ACT_ESIM', 'ACT_FISICA', 'REINTENTAR_QR', 'ACT_ESIM_REINTENTAR', 'ACT_FISICA_RECARGA', 'ACT_FISICA_FALLO') 
                 LIMIT 10`
            );

            for (const tarea of tareas) {
                let asignado = false;
                for (let i = 1; i <= NUM_WORKERS; i++) {
                    const idWorker = `WORKER_${i.toString().padStart(2, '0')}`;
                    const ocupacion = mapaCarga[idWorker] || 0;

                    if (ocupacion < MAX_CONCURRENTES_POR_WORKER) {
                        await connection.execute(
                            "UPDATE cola_tareas SET estado = 'ASIGNADO', worker_id = ?, fecha_actualizacion = NOW() WHERE id = ?", 
                            [idWorker, tarea.id]
                        );
                        mapaCarga[idWorker] = ocupacion + 1;
                        console.log(`✅ Tarea ${tarea.id} -> ${idWorker} (Ocupación: ${mapaCarga[idWorker]})`);
                        asignado = true;
                        break;
                    }
                }
                if (!asignado) console.warn("⚠️ Todos los workers están al máximo de su capacidad.");
            }
            connection.release();
        } catch (err) { 
            console.error("❌ Error en Dispatcher:", err); 
        }
        await new Promise(r => setTimeout(r, 2000));
    }
}

iniciarDispatcher();
