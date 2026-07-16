


const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
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
console.log(`🔍 [DB] Intentando conectar a: ${process.env.SUPABASE_URL ? "-------API CONECTADA A DB" : "¡ERROR! URL NO ENCONTRADA"}`);

const app = express();
const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET
const screenshotsDir = path.join(__dirname, 'screenshots');

fs.ensureDirSync(screenshotsDir);

// 1. MIDDLEWARES PRIMERO1
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json()); // NECESARIO PARA LEER req.body
app.use(express.urlencoded({ extended: true }));

// 2. ARCHIVOS ESTÁTICOS DESPUÉS
app.use(express.static(path.join(__dirname, 'public')));
app.use('/screenshots', express.static(screenshotsDir));

// 3. RUTAS AL FINAL (para que ya tengan acceso al req.body procesado)
const authRoutes = require('./login'); 
app.use('/auth', authRoutes);







// --- ESTE MIDDLEWARE REEMPLAZA A TU "AUTH" DE SESIÓN ---1
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    console.log("DEBUG - Header recibido:", authHeader); // ¿Es null o llega algo?
    
    if (!authHeader) return res.status(401).json({ error: "No header" });

    const token = authHeader.split(' ')[1];
    console.log("DEBUG - Token extraído:", token); // ¿Se ve como una cadena larga de texto?

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.log("DEBUG - Error de JWT:", err.message); // AQUÍ TE DIRÁ SI ES 'invalid signature'
            return res.status(403).json({ error: "Token inválido" });
        }
        req.user = decoded;
        next();
    });
};

// --- TUS RUTAS ---
app.post('/auth/login', async (req, res) => {
    const { correo, password } = req.body;
    try {
        // CORRECCIÓN 1: Usamos $1 en lugar de ?
        const query = 'SELECT * FROM public.usuarios_act_cmu WHERE correo = $1';
        
        // CORRECCIÓN 2: Ejecutamos el query
        const result = await pool.query(query, [correo]);
        
        // CORRECCIÓN 3: Extraemos los datos de result.rows
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ success: false, message: "Credenciales incorrectas" });
        }

        const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token: token }); 
    } catch (err) {
        console.error("Error en login:", err); // Log para ver el detalle en consola
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





// --- 2. Aplicación en la ruta --- REVISADO PostgreSQL
// aqui tambien esta validar force
app.post('/api/solicitar-consulta', verifyToken, async (req, res) => {   
    const userId = req.user?.id; 
    const { numero, portal, tipo } = req.body;

    if (!numero || !userId) {
        console.warn(`⚠️ [API] Intento de tarea fallido: Faltan datos.`);
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        // CORRECCIÓN: Usamos $1, $2... y agregamos RETURNING id para obtener el ID generado
        const query = `
            INSERT INTO public.cola_tareas (user_id, numero, portal, estado, tipo_tarea) 
            VALUES ($1, $2, $3, 'PENDIENTE', $4) 
            RETURNING id
        `;
        const values = [userId, numero, portal || 'TELCEL', tipo || 'RECARGA'];
        
        const result = await pool.query(query, values);

        // En pg, el ID está en result.rows[0].id
        const tareaId = result.rows[0].id;

        console.log(`✅ [API] Tarea creada exitosamente con ID: ${tareaId}`);
        res.json({ tareaId: tareaId, status: "Tarea creada" });

    } catch (error) {
        console.error(`❌ [API] Error crítico al insertar tarea:`, error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.get('/api/estado-consolidado/:numero', verifyToken, async (req, res) => {
    try {
        const num = req.params.numero;
        const userId = req.user.id;

        // Corregido: Uso de $1, $2 y acceso a result.rows
        const result = await pool.query(`
            SELECT * FROM public.cola_tareas 
            WHERE numero = $1 
            AND user_id = $2 
            ORDER BY id DESC LIMIT 1
        `, [num, userId]);

        const rows = result.rows;

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Tarea no encontrada." });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error("❌ Error en estado-consolidado:", err.message);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});


//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.get('/api/verificar-estado/:id', verifyToken, async (req, res) => {
    try {
        console.log("🔍 Consultando ID:", req.params.id);

        const result = await pool.query(
            "SELECT estado, resultado FROM public.cola_tareas WHERE id = $1", 
            [req.params.id]
        );

        if (result.rows.length > 0) {
            const registro = result.rows[0];
            const estadoActual = registro.estado;
            let resultado = registro.resultado;

            // Intentamos parsear siempre, ya que el resultado puede ser un JSON guardado como string
            if (resultado && typeof resultado === 'string') {
                try {
                    resultado = JSON.parse(resultado);
                } catch (e) {
                    console.warn("⚠️ Resultado no es un JSON válido, se enviará como texto plano.");
                }
            }

            console.log("✅ Registro encontrado:", { estado: estadoActual, resultado });

            // Enviamos respuesta consistente. 
            // Si el estado es RECARGA_PENDIENTE_REGISTRO, el frontend ya recibirá el 'resultado'
            res.json({ 
                estado: estadoActual, 
                resultado: resultado 
            });

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
        const [rows] = await pool.query(
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


app.get('/api/procesos', async (req, res) => {
    try {
        // Corregido: Sin desestructuración, acceso a result.rows
        const result = await pool.query(`
            SELECT ct.*, u.nombre_completo 
            FROM public.cola_tareas ct 
            LEFT JOIN public.usuarios_act_cmu u ON ct.user_id = u.id 
            ORDER BY ct.id DESC LIMIT 50
        `);
        
        const rows = result.rows; // Obtenemos las filas de result.rows

        let html = `
        <style>
            body { font-family: sans-serif; margin: 10px; }
            table { width: max-content; border-collapse: collapse; }
            th { background: #000; color: #fff; padding: 5px; font-size: 13px; text-align: left; min-width: 150px; max-width: 150px; }
            td { border: 1px solid #ccc; padding: 4px; height: 15px; font-size: 13px; min-width: 150px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.get('/api/ultimas-lineas', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id; 
        
        // Corregido: Uso de $1, $2 y acceso a result.rows
        const result = await pool.query(`
            SELECT * FROM public.cola_tareas 
            WHERE user_id = $1 
            AND id IN (SELECT MAX(id) FROM public.cola_tareas WHERE user_id = $2 GROUP BY numero)
            ORDER BY id DESC LIMIT 10
        `, [userId, userId]);

        const rows = result.rows;
        console.log("Registros encontrados:", rows.length);
        res.json(rows);
    } catch (err) {
        console.error("Error en BD:", err);
        res.status(500).json({ error: "Error en BD" });
    }
});
//---------------------------------------------------------------------- > FIN REVISADO PostgreSQL


//---------------------------------------------------------------------- >  REVISADO PostgreSQL
app.post('/api/ejecutar-accion2', verifyToken, async (req, res) => {
    const { userId, numero, tipo } = req.body;

    try {
        // Si el usuario presiona "RECARGA" (Botón automático)
        if (tipo === 'RECARGA') {
            // Nota: Asegúrate de que 'page' esté disponible en el alcance
            const resultado = await hacerClicEnDatosLinea(page, numero, userId, tipo);
            res.json({ status: 'success', data: resultado });
        } else if (tipo === 'REGISTRAR_BIOMETRICOS') {
            // Lógica para manual
            res.json({ status: 'info', message: 'Acción manual iniciada' });
        } else {
            res.status(400).json({ error: 'Tipo de acción no válido' });
        }
    } catch (error) {
        console.error("❌ Error en ejecutar-accion2:", error);
        res.status(500).json({ error: 'Error al ejecutar la acción' });
    }
});
//---------------------------------------------------------------------- > FIN REVISADO PostgreSQL


// -- ENVIAMOS Y RECIBIMOS EL TOKEN
//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.post('/api/enviar-token', verifyToken, async (req, res) => {
    const { tareaId, token } = req.body;

    console.log(`📡 [API] Token recibido: "${token}" para Tarea ID: ${tareaId}`);

    if (!tareaId || !token) {
        return res.status(400).json({ 
            status: 'error', 
            message: 'Tarea ID o Token faltante' 
        });
    }

    try {
        const result = await pool.query(
            "UPDATE public.cola_tareas SET token = $1, estado = 'VALIDANDO_TOKEN' WHERE id = $2", 
            [token, tareaId]
        );

        if (result.rowCount === 0) {
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



    
//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.post('/api/actualizar-token', verifyToken, async (req, res) => {
const { tareaId, nuevoToken } = req.body;

if (!tareaId || !nuevoToken) {
    return res.status(400).json({ success: false, message: "Datos incompletos" });
}

try {
    // En pg (node-postgres), pool.query gestiona automáticamente la conexión (no necesitas getConnection/release)
    // Corregido: Uso de $1, $2 y sintaxis SQL PostgreSQL
    await pool.query(
        "UPDATE public.cola_tareas SET token = $1, estado = 'VALIDANDO_TOKEN', resultado = NULL WHERE id = $2",
        [nuevoToken, tareaId]
    );

    res.json({ success: true, message: "Token actualizado correctamente" });
} catch (err) {
    console.error("❌ Error al actualizar token:", err);
    res.status(500).json({ success: false, message: "Error al actualizar BD" });
}
});

app.get('/api/estado-tarea/:tareaId', verifyToken, async (req, res) => {
    try {
        const { tareaId } = req.params;
        const userId = req.user.id;

        // Corregido: Uso de $1, $2 y acceso a result.rows
        const result = await pool.query(
            "SELECT estado, resultado, numero, link_final FROM public.cola_tareas WHERE id = $1 AND user_id = $2", 
            [tareaId, userId]
        );

        if (result.rows.length > 0) {
            const tarea = result.rows[0];
            res.json({
                estado: tarea.estado,
                resultado: tarea.resultado,
                numero: tarea.numero,
                link_final: tarea.link_final
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



// ------------------------------------------------------------------------------------------------------> REVISADO PostgreSQL

app.post('/api/reintentar', verifyToken, async (req, res) => {
const { tareaId } = req.body;
console.log(`📡 [Backend] Solicitud de REINTENTO recibida para ID: ${tareaId} por Usuario: ${req.user.id}`);

try {
    // En pg, usamos pool.query directamente (no necesitamos getConnection/release)
    // Corregido: Uso de $1, $2 y acceso a rowCount
    const result = await pool.query(
        "UPDATE public.cola_tareas SET estado = 'REINTENTAR_QR', resultado = NULL WHERE id = $1 AND user_id = $2", 
        [tareaId, req.user.id]
    );

    // En pg, el número de filas afectadas se obtiene mediante result.rowCount
    if (result.rowCount > 0) {
        console.log(`✅ [Backend] Base de datos actualizada: Estado cambiado a REINTENTAR_QR para ID: ${tareaId}`);
        res.json({ success: true, message: "Reintento activado" });
    } else {
        console.warn(`⚠️ [Backend] No se actualizó ninguna fila. ID: ${tareaId}`);
        res.status(404).json({ success: false, message: "Tarea no encontrada o sin permisos" });
    }
} catch (err) {
    console.error(`❌ [Backend] Error grave al actualizar BD para ID ${tareaId}:`, err);
    res.status(500).json({ success: false, error: "Error interno" });
}
});
//---------------------------------------------------------------------- > fin REVISADO PostgreSQL




//-- ACTIVACION FISICA - ESIM CORREJIDO 

//---------------------------------------------------------------------- > REVISADO PostgreSQL

app.post('/api/solicitar-activacion', verifyToken, async (req, res) => {
    // 1. OBTENEMOS EL ID DESDE EL TOKEN JWT
    const userId = req.user ? req.user.id : null; 

    if (!userId) {
        console.warn("⚠️ Intento de activación sin token válido.");
        return res.status(401).json({ success: false, message: "Sesión no válida o expirada" });
    }

    const { tipo_tarea, portal, ciudad, ciudad_id, iccid, imei, correo } = req.body;
    const estadoInicial = (tipo_tarea === 'ACT_ESIM') ? 'ACT_ESIM' : 'ACT_FISICA';

    try {
        // 2. INSERTAMOS USANDO EL userId OBTENIDO DEL JWT
        // Corregido: Uso de $1-$9 y RETURNING id para obtener el ID generado
        const query = `
            INSERT INTO public.cola_tareas 
            (tipo_tarea, user_id, portal, ciudad, ciudad_id, iccid, imei, correo, estado) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
        `;
        const values = [tipo_tarea, userId, portal || 'TELCEL', ciudad, ciudad_id, iccid, imei, correo, estadoInicial];
        
        const result = await pool.query(query, values);

        // En PostgreSQL, obtenemos el ID desde result.rows[0].id
        const nuevoId = result.rows[0].id;

        console.log(`✅ Tarea creada con ID: ${nuevoId} para el usuario: ${userId}`);
        res.json({ success: true, id: nuevoId }); 

    } catch (err) {
        console.error("❌ Error al insertar en BD:", err);
        res.status(500).json({ success: false, error: "Error interno del servidor" });
    }
}); 


// Ruta para reintento de Paso 9 (Extracción) REVISADA

//---------------------------------------------------------------------- > REVISADO PostgreSQL

app.post('/api/recuperacion-paso-nueve/:tareaId', verifyToken, async (req, res) => {
    const { tareaId } = req.params;

    try {
        // Corregido: Uso de $1, $2 y acceso a result.rowCount
        const result = await pool.query(
            `UPDATE public.cola_tareas 
             SET estado = 'ACT_ESIM_REINTENTAR', 
                 resultado = NULL 
             WHERE id = $1 AND user_id = $2`, 
            [tareaId, req.user.id]
        );

        // En pg, usamos rowCount para verificar si se actualizó el registro
        if (result.rowCount === 0) {
            // Si retorna 0 filas, o no existe, o no le pertenece al usuario
            return res.status(403).json({ error: "Tarea no encontrada o no tienes permiso." });
        }

        res.status(200).json({ status: "Proceso reiniciado" });
    } catch (err) {
        console.error("Error en API de reintento:", err);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});



//---------------------------------------------------------------------- > REVISADO PostgreSQL

app.get('/api/estado-tarea-ACT/:id', verifyToken, async (req, res) => {
    // Log para depuración inmediata
    console.log(`[API] Ejecutando: /api/estado-tarea-ACT/:id | ID Tarea: ${req.params.id} | Usuario Token: ${req.user.id}`);

    try {
        // Corregido: Uso de $1 y acceso a result.rows
        const result = await pool.query(
            `SELECT estado, resultado, estatus_act, numero, correo, folio_act, iccid, link_final, imei, user_id, 
                    linea_registrada, fecha_recarga 
             FROM public.cola_tareas WHERE id = $1`, 
            [req.params.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Tarea no encontrada" });
        }

        const tarea = result.rows[0];

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
//---------------------------------------------------------------------- > REVISADO PostgreSQL

app.post('/api/ejecutar-qr-registro/:tareaId', verifyToken, async (req, res) => {
    const { tareaId } = req.params;

    try {
        // 1. VALIDACIÓN DE PROPIEDAD: 
        // Corregido: Uso de $1, $2 y result.rows
        const resultCheck = await pool.query(
            "SELECT id FROM public.cola_tareas WHERE id = $1 AND user_id = $2", 
            [tareaId, req.user.id]
        );

        if (resultCheck.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: "Tarea no encontrada o no tienes permiso para modificarla." 
            });
        }

        // 2. ACTUALIZACIÓN SEGURA:
        // Corregido: Uso de $1, $2 y result.rowCount
        const resultUpdate = await pool.query(
            "UPDATE public.cola_tareas SET estado = 'ACT_ESIM_EXITOSA_QR', fecha_actualizacion = NOW() WHERE id = $1 AND user_id = $2", 
            [tareaId, req.user.id]
        );

        console.log(`📌 [API] Tarea ${tareaId} marcada como ACT_ESIM_EXITOSA_QR por usuario ${req.user.id}`);
        res.json({ success: true, message: "Tarea enviada a cola de procesamiento" });

    } catch (err) {
        console.error("Error al actualizar estado:", err);
        res.status(500).json({ success: false, error: "Error interno al actualizar la tarea" });
    }
});



//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.post('/api/vincular-biometricos-act/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        // Corregido: Uso de $1, $2 y result.rowCount
        const result = await pool.query(
            "UPDATE public.cola_tareas SET estado = 'ACT_ESIM_VINCULAR' WHERE id = $1 AND user_id = $2", 
            [id, req.user.id]
        );

        if (result.rowCount === 0) {
            return res.status(403).json({ success: false, error: "Tarea no encontrada o no autorizada" });
        }

        res.json({ success: true });
    } catch (err) {
        console.error("❌ Error en vincular-biometricos-act:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

//---------------------------------------------------------------------- > REVISADO PostgreSQL
app.get('/api/obtener-resultado-vincular/:id', verifyToken, async (req, res) => {
    const { id } = req.params;
    try {
        // Corregido: Uso de $1, $2 y result.rows
        const result = await pool.query(
            "SELECT estado, resultado, numero, correo, imei, folio_act FROM public.cola_tareas WHERE id = $1 AND user_id = $2",
            [id, req.user.id]
        );

        if (result.rows.length > 0) {
            const tarea = result.rows[0];
            res.json({ 
                estado: tarea.estado, 
                resultado: tarea.resultado,
                numero: tarea.numero,
                correo: tarea.correo,
                imei: tarea.imei,
                folio_act: tarea.folio_act
            });
        } else {
            res.status(404).json({ error: "Tarea no encontrada o acceso denegado" });
        }
    } catch (error) {
        console.error("❌ Error en obtener-resultado-vincular:", error);
        res.status(500).json({ error: error.message });
    }
});


// FISICA 
//---------------------------------------------------------------------- > REVISADO PostgreSQL


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
        // Corregido: Uso de $1, $2 y acceso a result.rows
        const resultCheck = await pool.query(
            "SELECT id FROM public.cola_tareas WHERE id = $1 AND user_id = $2", 
            [id, req.user.id]
        );

        if (resultCheck.rows.length === 0) {
            return res.status(403).json({ 
                success: false, 
                error: "Tarea no encontrada o no tienes permiso para modificarla." 
            });
        }

        // 2. ACTUALIZACIÓN SEGURA: 
        // Corregido: Uso de $1, $2, $3
        await pool.query(
            "UPDATE public.cola_tareas SET estado = $1, fecha_actualizacion = NOW() WHERE id = $2 AND user_id = $3", 
            [estadoLimpio, id, req.user.id]
        );

        res.json({ 
            success: true, 
            message: "Estado actualizado exitosamente." 
        });

    } catch (err) {
        console.error("❌ ERROR CRÍTICO EN SQL:", err.message);

        // En PostgreSQL los errores de tipo 'invalid input value' suelen tener código '22P02'
        // Puedes ajustar esta lógica según tus necesidades de validación
        res.status(500).json({ 
            success: false, 
            error: "Error interno del servidor." 
        });
    }
});


app.listen(PORT, () => {
    console.log("................🔥🔥🔥    api2406js ON ...🔥 API  ✅");
    console.log(`🚨.....................🚀 api2406.js LISTA EN PUERTO en http://localhost:${PORT} API  ✅`);
});
const { iniciarDispatcher } = require('./dispatcher'); // Ajusta la ruta a tu archivo
iniciarDispatcher();

//const { iniciarWorker } = require('./worker');         // Ajusta la ruta a tu archivo
iniciarWorker();
