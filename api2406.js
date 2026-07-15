const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken'); // Necesario para el token
const bcrypt = require('bcrypt');
const { pool } = require('./cola');


const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'clave_secreta_2026'; // Define esto aquí
const screenshotsDir = path.join(__dirname, 'screenshots');

fs.ensureDirSync(screenshotsDir);

// Configuración básica
app.use(cors({
    origin: '*', // Permite peticiones desde cualquier lugar
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(screenshotsDir));

// --- ESTE MIDDLEWARE REEMPLAZA A TU "AUTH" DE SESIÓN ---
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: "No autorizado" });

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(403).json({ error: "Token inválido" });
        req.user = decoded; // Ahora tienes el usuario en req.user.id
        next();
    });
};

// --- TUS RUTAS ---
app.post('/auth/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        const [rows] = await pool.execute('SELECT * FROM public.usuarios_act_cmu WHERE correo = ?', [correo]);
        const user = rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token: token }); 
    } catch (err) {
        res.status(500).json({ success: false, message: "Error interno" });
    }
});

// Ejemplo de ruta protegida usando el token
app.get('/api/check-session', verifyToken, (req, res) => {
    res.json({ active: true, userId: req.user.id });
});
app.get('/api/auth/me', verifyToken, (req, res) => {
    // req.user.id viene del token que ya validaste con verifyToken
    res.json({ success: true, id: req.user.id });
});



// API DE DEPURACIÓN (Corregida para leer la sesión de express-session)
app.get('/api/ver-usuario-sesion', (req, res) => {
    if (req.session && req.session.usuarioId) {
        console.log("Datos en sesión:", req.session);
        res.json({ 
            success: true, 
            id_en_sesion: req.session.usuarioId,
            rol_en_sesion: req.session.rol 
        });
    } else {
        res.json({ success: false, message: "No hay sesión activa" });
    }
});



// RUTA DE LOGOUT
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) return res.status(500).json({ success: false, message: "Error al cerrar" });
        res.clearCookie('miSessionID'); 
        res.json({ success: true, message: "Sesión cerrada correctamente" });
    });
});

//-----------------------------------------------------
//-- ----------------> FIN INICIA LA SESION <---------
//-----------------------------------------------------

 app.get(['/', '/API', '/api'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'autorecarga.html'));
});


//-----------------------------------------------------
//-- --------> PERMISO PARA MONITOR EN FRONT <---------
//-----------------------------------------------------
app.get('/monitoreo.html', verifyToken, (req, res) => {
    if (!req.session.usuarioId) {
        return res.redirect('/login.html'); // Si no tiene sesión, no ve la página
    }
    res.sendFile(path.join(__dirname, 'monitoreo.html'));
});





// --- 2. Aplicación en la ruta ---
// Fíjate que insertamos 'authMiddleware' como segundo argumento

app.post('/api/solicitar-consulta', verifyToken, async (req, res) => {   
    const userId = req.user?.id; 
    const { numero, portal, tipo } = req.body;

    // 1. VALIDACIÓN BÁSICA
    if (!numero || !userId) {
        console.warn(`⚠️ [API] Intento de tarea fallido: Faltan datos. User: ${userId}, Numero: ${numero}`);
        return res.status(400).json({ error: "Datos incompletos" });
    }
    
    console.log(`🆕 [API] Usuario ${userId} solicita tarea: ${tipo || 'RECARGA'} para el número: ${numero}`);

    try {
        const [result] = await pool.execute(
            `INSERT INTO public.cola_tareas (user_id, numero, portal, estado, tipo_tarea) VALUES (?, ?, ?, 'PENDIENTE', ?)`,
            [userId, numero, portal || 'TELCEL', tipo || 'RECARGA']
        );
        
        console.log(`✅ [API] Tarea creada exitosamente con ID: ${result.insertId}`);
        res.json({ tareaId: result.insertId, status: "Tarea creada" });
        
    } catch (error) {
        console.error(`❌ [API] Error crítico al insertar tarea:`, error);
        res.status(500).json({ error: "Error interno del servidor al crear tarea" });
    }
});


app.get('/api/estado-consolidado/:numero', verifyToken, async (req, res) => {
    try {
        const num = req.params.numero;
        const userId = req.user.id;

        // QUITAMOS EL FILTRO DE 'COMPLETADO' PARA QUE EL VIGILANTE PUEDA VER EL PROCESO
        const [rows] = await pool.execute(`
            SELECT * FROM public.cola_tareas 
            WHERE numero = ? 
            AND user_id = ? 
            ORDER BY id DESC LIMIT 1
        `, [num, userId]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Tarea no encontrada." });
        }

        // Devolvemos la tarea tal cual está (PENDIENTE, PROCESANDO, O COMPLETADO)
        res.json(rows[0]);
    } catch (err) {
        console.error("❌ Error en estado-consolidado:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get('/api/verificar-estado/:id',  verifyToken, async (req, res) => {
    try {
        console.log("🔍 Consultando ID:", req.params.id);
        
        // Usamos una consulta simple para ver qué hay realmente en la base de datos
        const [rows] = await pool.execute("SELECT estado, resultado FROM public.cola_tareas WHERE id = ?", [req.params.id]);
        
        if (rows.length > 0) {
            const registro = rows[0];
            
            // Log para debuggear en tu terminal de VS Code
            console.log("✅ Registro encontrado:", registro);

            // Si el estado está vacío o es null, le asignamos un valor por defecto para que el front no se rompa
            const estadoActual = registro.estado || 'PENDIENTE_PROCESAMIENTO';
            let resultado = registro.resultado;

            if (estadoActual === 'COMPLETADO' && resultado) {
                try { 
                    resultado = typeof resultado === 'string' ? JSON.parse(resultado) : resultado; 
                } catch (e) { 
                    console.error("❌ Error al parsear JSON:", e); 
                }
            }

            res.json({ estado: estadoActual, resultado: resultado });
        } else {
            console.warn("⚠️ No se encontró registro con ID:", req.params.id);
            res.status(404).json({ error: "No encontrada" });
        }
    } catch (error) {
        console.error("❌ Error en servidor:", error);
        res.status(500).json({ error: error.message });
    }
});




app.get('/api/obtener-resultado-final/:userId/:numero',  verifyToken,  async (req, res) => {
    try {
        const { userId, numero } = req.params;
        const [rows] = await pool.execute(
            `SELECT resultado FROM public.cola_tareas 
             WHERE user_id = ? AND numero = ? AND resultado IS NOT NULL
             ORDER BY id DESC LIMIT 3`, // Aumentamos a 3 por si hay ruido
            [userId, numero]
        );

        let resultadoUnificado = {};
        
        rows.forEach(row => {
            try {
                // Solo intentamos parsear si parece un JSON
                if (typeof row.resultado === 'string' && row.resultado.trim().startsWith('{')) {
                    let data = JSON.parse(row.resultado);
                    // Si el parseo es doble, lo volvemos a intentar
                    if (typeof data === 'string') data = JSON.parse(data);
                    
                    // Solo combinamos si es un objeto válido
                    if (typeof data === 'object' && data !== null) {
                        resultadoUnificado = { ...resultadoUnificado, ...data };
                    }
                }
            } catch (e) {
                // Si falla (ej. es un link de QR), simplemente lo ignoramos y seguimos
            }
        });

        // Solo marcamos encontrado si realmente tenemos datos de línea
        const encontrado = Object.keys(resultadoUnificado).length > 0;
        res.json({ encontrado, resultado: resultadoUnificado });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



app.get('/api/procesos',  async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT ct.*, u.nombre_completo 
            FROM public.cola_tareas ct 
            LEFT JOIN public.usuarios_act_cmu u ON ct.user_id = u.id 
            ORDER BY ct.id DESC LIMIT 50
        `);
        
        let html = `
        <style>
            body { font-family: sans-serif; margin: 10px; }
            table { width: max-content; border-collapse: collapse; }
            th { 
                background: #000; color: #fff; padding: 5px; font-size: 13px; 
                text-align: left; min-width: 150px; max-width: 150px;
            }
            td { 
                border: 1px solid #ccc; padding: 4px; height: 15px; font-size: 13px; 
                min-width: 150px; max-width: 150px; white-space: nowrap; 
                overflow: hidden; text-overflow: ellipsis; 
            }
            tr:nth-child(even) { background: #f2f2f2; }
        </style>
        <h2>Monitoreo Completo (Ancho Fijo 150px)</h2>
        <table>
            <tr>
                <th>ID tarea</th><th>Nombre Usuario</th><th>User ID</th><th>Worker ID</th><th>Ciudad</th><th>Ciudad ID</th>
                <th>Número</th><th>Portal</th><th>Estado</th><th>Resultado</th><th>Creado</th>
                <th>Actualizado</th><th>Tipo</th><th>Token</th><th>ICCID</th><th>EID</th>
                <th>IMEI</th><th>Link</th><th>Línea Reg</th><th>F. Recarga</th><th>F. Evento</th>
                <th>F. Consulta</th><th>Intentos</th><th>Correo</th><th>Folio</th><th>Estat. Act</th>
                <th>Estado Act</th><th>F. Actualización</th>
            </tr>
            ${rows.map(r => `
                <tr>
                    <td title="${r.id}">${r.id || '-'}</td>
                    <td title="${r.nombre_completo}">${r.nombre_completo || 'Desc.'}</td>
                    <td title="${r.user_id}">${r.user_id || '-'}</td>
                    <td title="${r.worker_id}">${r.worker_id || 'NULL'}</td>
                    <td title="${r.ciudad}">${r.ciudad || '-'}</td>
                    <td title="${r.ciudad_id}">${r.ciudad_id || '-'}</td>
                    <td title="${r.numero}">${r.numero || '-'}</td>
                    <td title="${r.portal}">${r.portal || '-'}</td>
                    <td title="${r.estado}">${r.estado || '-'}</td>
                    <td title="${r.resultado}">${r.resultado || '-'}</td>
                    <td title="${r.created_at}">${r.created_at || '-'}</td>
                    <td title="${r.updated_at}">${r.updated_at || '-'}</td>
                    <td title="${r.tipo_tarea}">${r.tipo_tarea || '-'}</td>
                    <td title="${r.token}">${r.token || '-'}</td>
                    <td title="${r.iccid}">${r.iccid || '-'}</td>
                    <td title="${r.eid}">${r.eid || '-'}</td>
                    <td title="${r.imei}">${r.imei || '-'}</td>
                    <td title="${r.link_final}">${r.link_final || '-'}</td>
                    <td title="${r.linea_registrada}">${r.linea_registrada || '-'}</td>
                    <td title="${r.fecha_recarga}">${r.fecha_recarga || '-'}</td>
                    <td title="${r.primer_evento}">${r.primer_evento || '-'}</td>
                    <td title="${r.fecha_consulta}">${r.fecha_consulta || '-'}</td>
                    <td title="${r.intentos}">${r.intentos || '-'}</td>
                    <td title="${r.correo}">${r.correo || '-'}</td>
                    <td title="${r.folio_act}">${r.folio_act || '-'}</td>
                    <td title="${r.estatus_act}">${r.estatus_act || '-'}</td>
                    <td title="${r.ESTADO_ACT}">${r.ESTADO_ACT || '-'}</td>
                    <td title="${r.fecha_actualizacion}">${r.fecha_actualizacion || '-'}</td>
                    
                </tr>
            `).join('')}
        </table>
        <script>setTimeout(() => location.reload(), 550000);</script>`;
        
        res.send(html);
    } catch (err) {
        res.status(500).send("Error: " + err.message);
    }
});

app.get('/api/ultimas-lineas', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; 
        console.log("Consultando tareas para user_id:", userId); // <-- MIRA LA CONSOLA DEL SERVIDOR

        const [rows] = await pool.execute(`
            SELECT * FROM public.cola_tareas 
            WHERE user_id = ? 
            AND id IN (SELECT MAX(id) FROM public.cola_tareas WHERE user_id = ? GROUP BY numero)
            ORDER BY id DESC LIMIT 10
        `, [userId, userId]);

        console.log("Registros encontrados:", rows.length); // <-- MIRA SI TRAE DATOS
        res.json(rows);
    } catch (err) {
        console.error("Error en BD:", err);
        res.status(500).json({ error: "Error en BD" });
    }
});


app.get('/api/estado-actual2/:numero', verifyToken,  async (req, res) => {
    try {
        const query = `
            SELECT * FROM public.cola_tareas 
            WHERE numero = ? 
            AND iccid IS NOT NULL 
            AND created_at >= NOW() - INTERVAL 10 MINUTE
            ORDER BY id DESC LIMIT 1`;
            
        const [rows] = await pool.execute(query, [req.params.numero]);
        
        // Si no hay nada en los últimos 10 minutos, devolvemos un objeto vacío
        res.json(rows.length > 0 ? rows[0] : {});
    } catch (err) {
        res.status(500).json({ error: "Error en la consulta" });
    }
});

// Ruta para RECARGA y SIN REGISTRO LA QUE ME HIZO BORRAR
app.post('/api/ejecutar-accion2', verifyToken,  async (req, res) => {
    const { userId, numero, tipo } = req.body;
    
    // Si el usuario presiona "RECARGA" (Botón automático)
    if (tipo === 'RECARGA') {
        const resultado = await hacerClicEnDatosLinea(page, numero, userId, tipo);
        res.json({ status: 'success', data: resultado });
    }
    
    // Si el usuario presiona "REGISTRAR BIOMÉTRICOS" (Manual)
 
});

// LLAMA A EJECUTAR ACCIONES TELCEL



// -- ENVIAMOS Y RECIBIMOS EL TOKEN
// -- ENVIAMOS Y RECIBIMOS EL TOKEN

app.post('/api/enviar-token',  verifyToken, async (req, res) => {
    const { tareaId, token } = req.body;
    
    console.log(`📡 [API] Token recibido: "${token}" para Tarea ID: ${tareaId}`);

    if (!tareaId || !token) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Tarea ID o Token faltante' 
        });
    }

    try {
        // Actualizamos el token y cambiamos el estado a 'VALIDANDO_TOKEN'
        // Esto le indica al Dispatcher que la tarea ya tiene datos listos para ser procesados
        const [result] = await pool.execute(
            "UPDATE public.cola_tareas SET token = ?, estado = 'VALIDANDO_TOKEN' WHERE id = ?", 
            [token, tareaId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ status: 'error', message: 'Tarea no encontrada' });
        }

        res.json({ 
            status: 'success', 
            message: 'Token recibido y en cola para validación' 
        });

    } catch (error) {
        console.error("❌ [API] Error SQL al recibir token:", error);
        res.status(500).json({ 
            status: 'error', 
            message: 'Error interno del servidor' 
        });
    }
});

app.post('/api/actualizar-token', verifyToken,  async (req, res) => {
    const { tareaId, nuevoToken } = req.body;
    
    if (!tareaId || !nuevoToken) {
        return res.status(400).json({ success: false, message: "Datos incompletos" });
    }

    const connection = await pool.getConnection();
    try {
        // 1. Guardamos el nuevo token
        // 2. Cambiamos el estado a 'VALIDANDO_TOKEN' para que el Dispatcher lo procese
        // 3. Limpiamos el 'resultado' (el error anterior) para empezar de cero
        await connection.execute(
            "UPDATE public.cola_tareas SET token = ?, estado = 'VALIDANDO_TOKEN', resultado = NULL WHERE id = ?",
            [nuevoToken, tareaId]
        );
        
        res.json({ success: true, message: "Token actualizado correctamente" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error al actualizar BD" });
    } finally {
        connection.release();
    }
});


// En tu archivo de rutas (ej: api.js)

app.get('/api/estado-tarea/:tareaId', verifyToken, async (req, res) => {
    try {
        const { tareaId } = req.params;
        const userId = req.user.id;

        // AGREGADO: Se incluyó 'link_final' y 'numero' en el SELECT
        const [rows] = await pool.execute(
            "SELECT estado, resultado, numero, link_final FROM public.cola_tareas WHERE id = ? AND user_id = ?", 
            [tareaId, userId]
        );

        if (rows.length > 0) {
            const tarea = rows[0];
            res.json({
                estado: tarea.estado,
                resultado: tarea.resultado,
                numero: tarea.numero,       // Ahora sí existe
                link_final: tarea.link_final // Ahora sí existe
            });
        } else {
            console.warn(`⚠️ Intento de acceso no autorizado. Usuario ${userId} intentó ver tarea ${tareaId}`);
            res.status(403).json({ error: "Tarea no encontrada o no tienes permiso." });
        }
    } catch (err) {
        console.error("❌ Error en estado-tarea:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Ruta para BIOMETRICOS

// En tu archivo de rutas (ej. app.js o routes.js)
app.post('/api/reintentar', verifyToken, async (req, res) => {
    const { tareaId } = req.body;
    console.log(`📡 [Backend] Solicitud de REINTENTO recibida para ID: ${tareaId} por Usuario: ${req.user.id}`);
    
    const connection = await pool.getConnection();
    
    try {
        const [result] = await connection.execute(
            "UPDATE public.cola_tareas SET estado = 'REINTENTAR_QR', resultado = NULL WHERE id = ? AND user_id = ?", 
            [tareaId, req.user.id] // Agregué el user_id por seguridad
        );
        
        if (result.affectedRows > 0) {
            console.log(`✅ [Backend] Base de datos actualizada: Estado cambiado a REINTENTAR_QR para ID: ${tareaId}`);
            res.json({ success: true, message: "Reintento activado" });
        } else {
            console.warn(`⚠️ [Backend] No se actualizó ninguna fila. ¿El ID es correcto o pertenece al usuario? ID: ${tareaId}`);
            res.status(404).json({ success: false, message: "Tarea no encontrada" });
        }
    } catch (err) {
        console.error(`❌ [Backend] Error grave al actualizar BD para ID ${tareaId}:`, err);
        res.status(500).json({ success: false, error: "Error interno" });
    } finally {
        connection.release();
    }
});

//-- ACTIVACION FISICA - ESIM CORREJIDO 


app.post('/api/solicitar-activacion', verifyToken, async (req, res) => {
    // 1. OBTENEMOS EL ID DESDE EL TOKEN JWT
    // El middleware 'verifyToken' debe haber guardado los datos en 'req.user'
    const userId = req.user ? req.user.id : null; 
    
    // Si no hay ID en el token, rechazamos la petición
    if (!userId) {
        console.warn("⚠️ Intento de activación sin token válido.");
        return res.status(401).json({ success: false, message: "Sesión no válida o expirada" });
    }

    const { tipo_tarea, portal, ciudad, ciudad_id, iccid, imei, correo } = req.body;
    const estadoInicial = (tipo_tarea === 'ACT_ESIM') ? 'ACT_ESIM' : 'ACT_FISICA';
    
    try {
        // 2. INSERTAMOS USANDO EL userId OBTENIDO DEL JWT
        const [result] = await pool.execute(
            `INSERT INTO public.cola_tareas (tipo_tarea, user_id, portal, ciudad, ciudad_id, iccid, imei, correo, estado) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [tipo_tarea, userId, portal || 'TELCEL', ciudad, ciudad_id, iccid, imei, correo, estadoInicial]
        );
        
        console.log(`✅ Tarea creada con ID: ${result.insertId} para el usuario: ${userId}`);
        res.json({ success: true, id: result.insertId }); 
        
    } catch (err) {
        console.error("❌ Error al insertar en BD:", err);
        res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
});

// Ruta para reintento de Paso 9 (Extracción) REVISADA

app.post('/api/recuperacion-paso-nueve/:tareaId', verifyToken, async (req, res) => {
    const { tareaId } = req.params;

    try {
        // CORRECCIÓN: Filtramos por ID Y por el ID del usuario del token
        const [result] = await pool.execute(
            `UPDATE public.cola_tareas 
             SET estado = 'ACT_ESIM_REINTENTAR', 
                 resultado = NULL 
             WHERE id = ? AND user_id = ?`, // <--- SEGURIDAD AÑADIDA
            [tareaId, req.user.id] // <--- USAMOS EL ID DEL TOKEN
        );

        if (result.affectedRows === 0) {
            // Si retorna 0 filas, o no existe, o no le pertenece al usuario
            return res.status(403).json({ error: "Tarea no encontrada o no tienes permiso." });
        }

        res.status(200).json({ status: "Proceso reiniciado" });
    } catch (err) {
        console.error("Error en API de reintento:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});



// Asegúrate de que esta ruta existe en tu servidor
// Ruta corregida: ahora usa 'pool' en lugar de 'connection'
app.get('/api/estado-tarea-ACT/:id', verifyToken, async (req, res) => {
    // Log para depuración inmediata
    console.log(`[API] Ejecutando: /api/estado-tarea-ACT/:id | ID Tarea: ${req.params.id} | Usuario Token: ${req.user.id}`);

    try {
        // CORRECCIÓN: Se agregaron 'linea_registrada' y 'fecha_recarga' al SELECT
        const [rows] = await pool.execute(
            `SELECT estado, resultado, estatus_act, numero, correo, folio_act, iccid, link_final, imei, user_id, 
                    linea_registrada, fecha_recarga 
             FROM public.cola_tareas WHERE id = ?`, 
            [req.params.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: "Tarea no encontrada" });
        }

        const tarea = rows[0];

        // 2. VALIDACIÓN ESTRICTA: 
        const idTareaEnBD = Number(tarea.user_id);
        const idUsuarioToken = Number(req.user.id);

        if (idTareaEnBD !== idUsuarioToken) {
            console.warn(`⚠️ [ACCESO DENEGADO] Usuario ${idUsuarioToken} intentó ver tarea ${req.params.id} (que pertenece al user_id ${idTareaEnBD})`);
            return res.status(403).json({ error: "Acceso denegado" });
        }

        // 3. Respondemos sin enviar el user_id al frontend (por limpieza)
        delete tarea.user_id;
        res.json(tarea);

    } catch (err) {
        console.error("Error al consultar estado-tarea:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

//-- VER QR ESIM
// Asegúrate de que esto coincida con lo que usas en el resto del archivo
 
app.post('/api/ejecutar-qr-registro/:tareaId', verifyToken, async (req, res) => {
    const { tareaId } = req.params;
    
    try {
        // 1. VALIDACIÓN DE PROPIEDAD: 
        // Verificamos que la tarea exista Y pertenezca al usuario del token (req.user.id)
        const [rows] = await pool.query(
            "SELECT id FROM public.cola_tareas WHERE id = ? AND user_id = ?", 
            [tareaId, req.user.id]
        );
        
        if (rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: "Tarea no encontrada o no tienes permiso para modificarla." 
            });
        }

        // 2. ACTUALIZACIÓN SEGURA:
        // Aseguramos que el UPDATE solo afecte si el user_id coincide
        const [result] = await pool.query(
            "UPDATE public.cola_tareas SET estado = 'ACT_ESIM_EXITOSA_QR', fecha_actualizacion = NOW() WHERE id = ? AND user_id = ?", 
            [tareaId, req.user.id]
        );

        console.log(`📌 [API] Tarea ${tareaId} marcada como ACT_ESIM_EXITOSA_QR por usuario ${req.user.id}`);
        res.json({ success: true, message: "Tarea enviada a cola de procesamiento" });

    } catch (err) {
        console.error("Error al actualizar estado:", err);
        res.status(500).json({ success: false, error: "Error interno al actualizar la tarea" });
    }
});

//-------------------------------- REVISADAS LAS DOS

app.post('/api/vincular-biometricos-act/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        // ACTUALIZACIÓN SEGURA: Filtramos por ID Y user_id
        const [result] = await pool.execute(
            "UPDATE public.cola_tareas SET estado = 'ACT_ESIM_VINCULAR' WHERE id = ? AND user_id = ?", 
            [id, req.user.id]
        );

        if (result.affectedRows === 0) {
            return res.status(403).json({ success: false, error: "Tarea no encontrada o no autorizada" });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/obtener-resultado-vincular/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        // FILTRO DE SEGURIDAD: Añadimos AND user_id = ?
        const [rows] = await pool.execute(
            "SELECT estado, resultado, numero, correo, imei, folio_act FROM public.cola_tareas WHERE id = ? AND user_id = ?",
            [id, req.user.id]
        );
        
        if (rows.length > 0) {
            res.json({ 
                estado: rows[0].estado, 
                resultado: rows[0].resultado,
                numero: rows[0].numero,
                correo: rows[0].correo,
                imei: rows[0].imei,
                folio_act: rows[0].folio_act
            });
        } else {
            // Devolvemos 404 si no existe o 403 si no pertenece al usuario
            res.status(404).json({ error: "Tarea no encontrada o acceso denegado" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// FISICA 

app.post('/api/solicitar-recarga', verifyToken, async (req, res) => {
    const { id, nuevo_estado } = req.body;
    const estadoLimpio = String(nuevo_estado || '').trim().toUpperCase();

    if (!id || !estadoLimpio) {
        return res.status(400).json({ 
            success: false, 
            error: "Datos faltantes." 
        });
    }

    try {
        // 1. VALIDACIÓN DE PROPIEDAD: 
        // Verificamos que la tarea exista Y pertenezca al usuario del token (req.user.id)
        const [rows] = await pool.execute(
            "SELECT id FROM public.cola_tareas WHERE id = ? AND user_id = ?", 
            [id, req.user.id]
        );

        if (rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: "Tarea no encontrada o no tienes permiso para modificarla." 
            });
        }

        // 2. ACTUALIZACIÓN SEGURA: 
        // Filtramos por ID y user_id para garantizar que nadie modifique lo ajeno
        const [result] = await pool.execute(
            "UPDATE public.cola_tareas SET estado = ?, fecha_actualizacion = NOW() WHERE id = ? AND user_id = ?", 
            [estadoLimpio, id, req.user.id]
        );

        res.json({ 
            success: true, 
            message: "Estado actualizado exitosamente." 
        });

    } catch (err) {
        console.error("❌ ERROR CRÍTICO EN SQL:", err.message);
        
        if (err.errno === 1265 || err.errno === 1366) {
            return res.status(400).json({ 
                success: false, 
                error: "Valor de estado inválido." 
            });
        }

        res.status(500).json({ 
            success: false, 
            error: "Error interno del servidor." 
        });
    }
});


app.listen(PORT, () => console.log(`🚨...🚀 api2406.js corriendo en http://localhost:${PORT}`));
