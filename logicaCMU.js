console.log(`📡... Este es un mensaje a AthanosMK`);
const { Pool } = require('pg');

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
console.log(`🔍 [DB] Intentando conectar a: ${process.env.DATABASE_URL ? "-------- BD logicaCMU CONFIGURADA" : "¡ERROR! URL NO ENCONTRADA"}`);

const fs = require('fs-extra');
const path = require('path');
const Jimp = require('jimp');
const jsQR = require('jsqr');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { obtenerUrlDeBase64 } = require('./utilidades'); 
puppeteer.use(StealthPlugin());
const sesiones = new Map();
const configData = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const TIEMPO_EXPIRACION = 4 * 60 * 1000; // 10 minutos en milisegundos

const config = {
    useProxy: true, // Ponlo en true si vas a usar el proxy
    proxyConfig: {
        host: process.env.PROXY_HOST,
        port: process.env.PROXY_PORT,
        user: process.env.PROXY_USER,
        pass: process.env.PROXY_PASS
    }
};

const possiblePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chromium',
    '/snap/bin/chromium'
];

let chromiumPath = possiblePaths.find(p => p && fs.existsSync(p));
console.log(`--------------------------------------🧭 Chromium ejecutable detectado en: ${chromiumPath || "NO ENCONTRADO --🧭--🧭"}`);

async function obtenerSesionCompleta(userId, url) {
    const ahora = Date.now();
    const userDataDir = path.join(__dirname, 'tmp', 'sessions', String(userId));

    // 1. LIMPIEZA DE SEGURIDAD (SingletonLock)
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        try {
            fs.unlinkSync(lockFile);
            console.log("🔓 Bloqueo 'SingletonLock' eliminado.");
        } catch (e) {
            console.log("⚠️ No se pudo borrar el bloqueo, pero intentaremos continuar.");
        }
    }

    // 2. VERIFICACIÓN DE SESIÓN EXISTENTE
    if (sesiones.has(userId)) {
        const sesion = sesiones.get(userId);
        const inactivo = (ahora - sesion.lastUsed) > TIEMPO_EXPIRACION;
        const estaVivo = sesion.browser?.process() !== null &&
                         sesion.pageForce && !sesion.pageForce.isClosed();

        if (estaVivo && !inactivo) {
            console.log(`✅ Sesión activa recuperada para: ${userId}`);
            sesion.lastUsed = ahora;
            await sesion.pageForce.bringToFront();
            return sesion.pageForce;
        } else {
            console.log(`🧹 Cerrando sesión obsoleta de: ${userId} | browser.process()=${sesion.browser?.process() !== null} | pageForce cerrada=${sesion.pageForce?.isClosed()} | inactivo=${inactivo}`);
            if (sesion.browser) await sesion.browser.close().catch(() => {});
            sesiones.delete(userId);
        }
    }

    // 3. LANZAMIENTO DEL NAVEGADOR
    console.log(`🚀 Lanzando nuevo navegador para: ${userId}`);
    const launchArgs = [
        '--no-sandbox',
        '--start-maximized',
        '--disable-dev-shm-usage' // clave en Render: evita errores de memoria compartida
    ];

    if (config.useProxy) {
        launchArgs.push(`--proxy-server=http://${config.proxyConfig.host}:${config.proxyConfig.port}`);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        executablePath: chromiumPath, // necesario en Render: usa el Chromium instalado en el Docker
        args: launchArgs,
        userDataDir: userDataDir
    });

    const pageForce = await browser.newPage();

    if (config.useProxy && config.proxyConfig.user) {
        await pageForce.authenticate({
            username: config.proxyConfig.user,
            password: config.proxyConfig.pass
        });
    }

    await pageForce.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');

    try {
        console.log(`🌐 Intentando conectar a: ${url}`);
        await pageForce.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    } catch (error) {
        console.log(`⚠️ Timeout o corte de red detectado: ${error.message}`);
        await pageForce.reload({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
    }

    // Verificación de IP
    try {
        const ip = await pageForce.evaluate(async () => {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        });
        console.log(`🌍 El bot está navegando desde la IP: ${ip}`);
    } catch (e) {
        console.log("⚠️ No se pudo verificar la IP a través del proxy.");
    }

    sesiones.set(userId, { browser, pageForce, lastUsed: ahora });
    return pageForce;
}




async function manejarRecargas(tarea, connection) {
    console.log(`🔄 [Recarga][ID: ${tarea.id}] Iniciando proceso de recarga para número: ${tarea.numero} | Portal: ${tarea.portal}`);
    
    try {
        const url = (tarea.portal === 'FORCE') ? 'https://force.mmoviles.com/login' : 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        
        console.log(`🌐 [Recarga][ID: ${tarea.id}] Obteniendo sesión en ${tarea.portal}...`);
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        const formatearFecha = (fecha) => {
            if (!fecha || fecha === 'No Info') return null;
            const partes = fecha.split('-');
            if (partes.length !== 3) return null;
            return `${partes[2]}-${partes[1]}-${partes[0]}`;
        };

        if (tarea.portal === 'FORCE') {
            console.log(`🚀 [Recarga][ID: ${tarea.id}] Ejecutando lógica FORCE...`);
            const resultado = await validarForce(page, tarea.numero, tarea.user_id, tarea.id);
            const nuevoEstado = (resultado && resultado.tipo === 'COMPLETADO') ? 'COMPLETADO' : 'RECARGA_PENDIENTE_REGISTRO';
            
            console.log(`💾 [Recarga][ID: ${tarea.id}] Actualizando BD a estado: ${nuevoEstado}`);
            await connection.query(`
                UPDATE public.cola_tareas 
                SET estado = $1, iccid = $2, linea_registrada = $3, fecha_recarga = $4, primer_evento = $5, resultado = $6 
                WHERE id = $7`, 
                [
                    nuevoEstado, 
                    resultado.iccid || null, 
                    resultado.registrado || null, 
                    formatearFecha(resultado.fechaActivacion), 
                    resultado.primerEvento || null, 
                    JSON.stringify(resultado), 
                    tarea.id
                ]
            );
            console.log(`✅ [Recarga][ID: ${tarea.id}] Proceso FORCE finalizado exitosamente.`);
        } else {
            console.log(`🚀 [Recarga][ID: ${tarea.id}] Ejecutando lógica TELCEL...`);
            await ejecutarLoginTelcel(page, tarea.user_id);
            
            console.log(`🔍 [Recarga][ID: ${tarea.id}] Navegando a datos de línea...`);
            const resultado = await hacerClicEnDatosLinea(page, tarea.user_id, tarea.numero);
            
            console.log(`💾 [Recarga][ID: ${tarea.id}] Actualizando BD a COMPLETADO...`);
            await connection.query(`
                UPDATE public.cola_tareas SET estado = 'COMPLETADO', resultado = $1 WHERE id = $2`, 
                [JSON.stringify(resultado), tarea.id]
            );
            console.log(`✅ [Recarga][ID: ${tarea.id}] Proceso TELCEL finalizado exitosamente.`);
        }
    } catch (e) {
        console.error(`❌ [Recarga][ID: ${tarea.id}] Error grave durante la ejecución:`, e.message);
        if (tarea && tarea.id) {
            console.log(`💾 [Recarga][ID: ${tarea.id}] Reportando error a BD...`);
            await connection.query(
                "UPDATE public.cola_tareas SET estado = 'ERROR', resultado = $1 WHERE id = $2", 
                [e.message.substring(0, 255), tarea.id]
            );
        }
    }
}
//-- VALIDA FORCE ----------------> LA PRIMER CONSULTA 

async function validarForce(page, numero, userId, tareaId) {
    console.log(`🚀 Iniciando proceso para número: ${numero} (Tarea: ${tareaId})`);

    try {
        // Evitamos recargas innecesarias si ya estamos posicionados en el portal
        const urlActual = page.url();
        if (!urlActual.includes('force.mmoviles.com')) {
            await page.goto('https://force.mmoviles.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
        } else {
            console.log("✅ Ya nos encontramos en el portal Force, continuando...");
        }

        // Escribir número
        await page.waitForSelector('#iccid_info', { visible: true, timeout: 15000 });
        await page.evaluate(() => document.querySelector('#iccid_info').value = '');
        await page.type('#iccid_info', String(numero), { delay: 50 });
        console.log("✅ Número escrito.");

        // Clic al botón Buscar
        await page.click('#button_info');
        console.log("🔍 Clic en Buscar, esperando resultados...");

        // Esperar resultados dinámicos
        await page.waitForFunction(
            () => {
                const el = document.querySelector('#iccid_response');
                return el && el.value !== "";
            },
            { timeout: 20000 }
        );

        // Extraer valores
        const resultados = await page.evaluate(() => {
            return {
                iccid: document.querySelector('#iccid_response')?.value || 'N/A',
                numero: document.querySelector('#numero_response')?.value || 'N/A',
                tipo: 'COMPLETADO'
            };
        });

        console.log("✨ Resultados obtenidos:", resultados);

        // Actualizar Base de Datos (Corregido a pool.query y parámetros $1, $2 para Postgres)
        await pool.query(
            "UPDATE public.cola_tareas SET estado = 'COMPLETADO', resultado = $1 WHERE id = $2", 
            [JSON.stringify(resultados), tareaId]
        );

        return resultados;

    } catch (error) {
        console.error("❌ Error en validarForce:", error.message);
        
        if (tareaId) {
            await pool.query(
                "UPDATE public.cola_tareas SET estado = 'ERROR', resultado = $1 WHERE id = $2", 
                [error.message.substring(0, 255), tareaId]
            );
        }
        throw error;
    }
}
// 1. HERRAMIENTA TELCEL (Requiere Login)
//-------------------------------------------------------------->> REVISADO PostgreSQL
async function ejecutarLoginTelcel(page, userId, tarea, connection) {
    console.log(`🔍 [Bot] Verificando estado de sesión para: ${userId}...`);

    try {
        await page.goto('https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login', { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });

        const yaLogueado = await page.evaluate(() => {
            return !!document.querySelector('.ui-menuitem-text') || !!document.querySelector('a[href*="logout"]');
        });

        if (yaLogueado) {
            console.log(`✅ Sesión ya activa para ${userId}.`);
            return;
        }

        console.log(`🔑 [Bot] Iniciando autenticación en Telcel...`);
        
        await page.waitForSelector('input[type="text"]', { timeout: 10000 });
        await page.type('input[type="text"]', configData.TELCEL_USER, { delay: 100 });
        await page.type('input[type="password"]', configData.TELCEL_PASS, { delay: 100 });
        await page.select('select', configData.REGION);
        await page.evaluate(() => document.getElementById('myBtn')?.click());

        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
        
        if (page.url().includes('login')) {
            throw new Error("Login Telcel fallido: Credenciales incorrectas o portal bloqueado.");
        }
        
        console.log(`🎉 [Bot] Login exitoso para ${userId}.`);

    } catch (e) {
        console.error(`❌ [ERROR CRÍTICO] Fallo en Login para usuario ${userId}:`, e.message);

        // CORRECCIÓN PostgreSQL: Uso de $1, $2 y .query()
        if (connection && tarea) {
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                ['ERROR', e.message.substring(0, 255), tarea.id]
            );
        }
        
        // Re-lanzamos el error para que el Worker sepa que debe detenerse
        throw e; 
    }
}
//-------------------------------------------------------------->> FIN REVISADO PostgreSQL



// 2. HERRAMIENTA FORCE (Acceso Libre/Sesión)

async function accederForce(page) {
    console.log(`🌐 [Bot] Accediendo a Force...`);
    // Como no ocupa claves, simplemente navegamos. 
    // Si la sesión ya existe en el userDataDir, el sitio te dejará pasar.
    await page.goto('https://force.mmoviles.com/login', { waitUntil: 'networkidle2' });
    
}

// LOGICA 

//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarBiometricos(tarea, connection) {
    console.log(`🚨 [Manejador] REGISTRANDO BIOMETRICOS: ${tarea.id} | Número: ${tarea.numero}`);
    
    try {
        const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        await ejecutarLoginTelcel(page, tarea.user_id, tarea, connection);
        
        // CORRECCIÓN: Pasar los argumentos individuales correctamente
        const res = await registrarLinea(page, tarea.numero, tarea.user_id, tarea.id);
        
        if (res?.requiereToken) {
            console.log(`✅ [Manejador] Tarea ${tarea.id} enviada a ESPERANDO_USER`);
        }
    } catch (e) {
        console.error(`❌ [Manejador] ERROR EN TAREA ${tarea.id}:`, e.message);
        
        // CORRECCIÓN PostgreSQL: Uso de $1, $2 y .query()
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['ERROR', e.message.substring(0, 255), tarea.id]
        );
    }
}
//-------------------------------------------------------------->> FIN REVISADO PostgreSQL

//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarBiometricos2(tarea, connection, estadoActual) {
    try {
        // Aseguramos que la URL esté definida
        const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';

        if (estadoActual === 'CONSULTA_ICCID') {
            const page = await obtenerSesionCompleta(tarea.user_id, url);
            const res = await registrarLinea(page, tarea.numero, tarea.user_id, tarea.id);
            if (res?.requiereToken) {
                // CORRECCIÓN PostgreSQL: Uso de $1
                await connection.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['ESPERANDO_USER', tarea.id]);
            }
            return;
        }

        if (estadoActual === 'VALIDANDO_TOKEN' || estadoActual === 'FALLO_TOKEN') {
            const page = await obtenerSesionCompleta(tarea.user_id, url);
            await manejarToken(page, tarea, connection);
            return;
        }

        if (['GENERANDO_QR', 'REINTENTAR_QR'].includes(estadoActual)) {
            const page = await obtenerSesionCompleta(tarea.user_id, url);
            await manejarQR(page, tarea, connection);
            return;
        }

    } catch (err) {
        console.error("Error crítico en manejarBiometricos2:", err);
        // CORRECCIÓN PostgreSQL: Uso de $1, $2
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['FALLO_TOKEN', err.message, tarea.id]
        );
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL



// -- ACTIVAR SIM ESIM --
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarACT_ESIM(tarea, connection) {
    console.log(`🛠 [Manejador] Iniciando activación NUEVA para tarea ID: ${tarea.id}`);
    try {
        const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        await ejecutarLoginTelcel(page, tarea.user_id, tarea, connection); 
        
        const exitoActivacion = await activarESIM(page, tarea);
        
        if (exitoActivacion === true) {
            // BLOQUE ESPECÍFICO DE EXTRACCIÓN
            try {
                await procederExtraccion(page, tarea, connection);
            } catch (errExtraccion) {
                // AQUÍ SOLO CAE SI FALLA PROCEDEREXTRACCION
                console.error(`❌ [Manejador] Error específico en extracción ID ${tarea.id}:`, errExtraccion.message);
                
                // CORRECCIÓN PostgreSQL: Uso de $1, $2 y .query()
                await connection.query(
                    "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                    ['ACT_ESIM_FALLO', errExtraccion.message.substring(0, 255), tarea.id]
                );
                return; // Terminamos aquí porque ya marcamos el fallo
            }
        } else {
            throw new Error("La función activarESIM falló en la ejecución.");
        }

    } catch (e) {
        // ERROR GENERAL (Login o Activación)
        console.error(`❌ [Manejador] Error en activación ID ${tarea.id}:`, e.message);
        
        // CORRECCIÓN PostgreSQL: Uso de .query() y acceso a result.rows
        const result = await connection.query("SELECT estado FROM public.cola_tareas WHERE id = $1", [tarea.id]);
        
        if (result.rows.length > 0 && result.rows[0].estado !== 'ERROR') {
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                ['ACT_ESIM_FALLO', e.message.substring(0, 255), tarea.id]
            );
        }
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL

//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarACT_ESIM_REINTENTO(tarea, connection) {
    console.log(`🔄 [Manejador] Modo REINTENTO: Extracción para ID: ${tarea.id}`);
    try {
        const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        // PASO CLAVE: Solo llamamos al login si la página NO está logueada
        const yaLogueado = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text'));
        if (!yaLogueado) {
            await ejecutarLoginTelcel(page, tarea.user_id, tarea, connection);
        } else {
            console.log("✅ Sesión ya detectada en reintento, saltando login...");
        }
        
        await procederExtraccion(page, tarea, connection);
    } catch (e) {
        console.error(`❌ [Manejador] Error en reintento ID ${tarea.id}:`, e.message);
        // CORRECCIÓN: Uso de $1, $2 y .query()
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['ACT_ESIM_FALLO', e.message, tarea.id]
        );
    }
}

async function procederExtraccion(page, tarea, connection) {
    // Marcamos inicialmente como procesando
    // CORRECCIÓN: Uso de $1, $2 y .query()
    await connection.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['PROCESANDO_ESIM', tarea.id]);
    
    try {
        const datos = await ejecutarExtraccionManual(page, tarea.user_id);
        
        const folio = datos.folio || null;
        const iccid = datos.iccid || null;
        const numero = datos.numero || null;
        const imei = datos.imei || null;
        const correo = datos.correo || null;
        const estadoAct = datos.estadoAct || null; 
        const estatusAct = datos.estatus_act || null; 
        
        const estadoLimpio = (estadoAct || "").toLowerCase();
        const esCompletado = estadoLimpio.includes("completado") || estadoLimpio.includes("completed");
        
        const nuevoEstado = esCompletado ? 'ACT_ESIM_VINCULAR_LISTA' : 'ACT_ESIM_VINCULAR_LISTA';

        // CORRECCIÓN: Enumeración de $1 a $10 y uso de .query()
        await connection.query(
            `UPDATE public.cola_tareas 
             SET estado = $1, 
                 ESTADO_ACT = $2, 
                 folio_act = $3, 
                 estatus_act = $4, 
                 iccid = $5, 
                 numero = $6, 
                 resultado = $7, 
                 imei = $8, 
                 correo = $9 
             WHERE id = $10`, 
            [
                nuevoEstado, 
                estadoAct, 
                folio, 
                estatusAct, 
                iccid, 
                numero, 
                esCompletado ? 'EXITO' : 'PENDIENTE', 
                imei, 
                correo, 
                tarea.id
            ]
        );

        console.log(`✅ [Ejecución única] Tarea ${tarea.id} finalizada con estado: ${nuevoEstado}`);
    } catch (err) {
        console.error(`❌ [Error en ejecución única] ID ${tarea.id}:`, err.message);
        // CORRECCIÓN: Uso de $1, $2, $3 y .query()
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['FALLO_EXTRACCION', err.message, tarea.id]
        );
        throw err; 
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL



async function manejarACT_ESIM_EXITOSA_QR(tarea, connection) {
    console.log(`📸 [Manejador] Ejecutando inabiliatodo ?? secuencia QR para ID: ${tarea.id}`);
        //try {
        // --- CORRECCIÓN: ASEGURAR QUE EL DIRECTORIO EXISTA ---
      //  const dir = 'public/screenshot';
    //    if (!fs.existsSync(dir)) {
      //      fs.mkdirSync(dir, { recursive: true });
     //       console.log(`📁 [Manejador] Directorio creado: ${dir}`);
      //  }
//
      //  const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        //const page = await obtenerSesionCompleta(tarea.user_id, url);

        // Llamamos a la función de secuencia
        //const resultado // = await ejecutar_ACT_ESIM_EXITOSA_QR(page, tarea);

      //  if (resultado.success) {
        //    await connection.execute(
         //       "UPDATE public.cola_tareas SET estado = 'ACT_ESIM_EXITOSA_QR', resultado = ? WHERE id = ?", 
         //       ['QR_CAPTURA_EXITOSA', tarea.id]
         //   );
         //   console.log(`✅ [Manejador] Tarea ${tarea.id} finalizada con éxito.`);
      //  }
 //   } catch (e) {
  //      console.error(`❌ [Manejador] Error en ACT_ESIM_EXITOSA_QR ID ${tarea.id}:`, e.message);
        
        // --- RESPALDO: USAR LA FUNCIÓN tomarCaptura() DEFINIDA EN TUS MÓDULOS ---
      //  try {
     //       await tomarCaptura(page, `error_secuencia_${tarea.id}.png`);
      //  } catch (err) {
      //      console.error("No se pudo guardar la captura de error:", err.message);
      //  }

      //  await connection.execute("UPDATE public.cola_tareas SET estado = 'ACT_ESIM_FALLO', resultado = ? WHERE id = ?", [e.message, tarea.id]);
   // }
return; }

//--
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function analizarYEjecutarAccion(page, numero, userId, tipo) {
    // 1. Siempre verificamos el estado en Telcel primero
    // Nota: Asegúrate de que esta función maneje sus propios errores
    const estadoLinea = await hacerClicEnDatosLinea(page, userId, numero);
    
    // 2. Lógica de decisión según lo que nos dijo Telcel
    if (estadoLinea.registrado === "NO") {
        // ESCENARIO A: No registrado -> Enviar Recarga 2
        await recarga2(page, numero, userId);
        return { 
            mensaje: "Recarga 2 enviada (sin registro).", 
            registrado: "NO",
            fecha: "N/A" 
        };
    } else {
        // ESCENARIO B: Registrado -> Enviar Recarga 1
        await recarga1(page, numero, userId);
        return { 
            mensaje: "Recarga 1 enviada.", 
            registrado: "SI",
            fecha: estadoLinea.fechaRecarga || "No disponible" 
        };
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL


// 2. ANALISIS Y ACCIONES

const esperarAleatorio = (min, max) => new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1) + min)));

async function hacerClicEnDatosLinea(page, userId, numero) {
    // 1. VERIFICACIÓN DE SESIÓN
    const estaEnElPortal = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text')); 
    if (!estaEnElPortal) {
        await ejecutarLoginTelcel(page, userId);
    }

    // 2. NAVEGACIÓN MENÚ (EVITANDO REDUNDANCIA)
    const menuDesplegado = await page.evaluate(() => {
        const header = Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes("Tramites Prepago BES"));
        return header && !header.parentElement.classList.contains('ui-helper-hidden');
    });

    if (!menuDesplegado) {
        const header = await page.evaluateHandle(() => Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes("Tramites Prepago BES")));
        if (header) { 
            await header.click(); 
            await esperarAleatorio(1000, 3000); 
        }
    }

    const clicked = await page.evaluate(() => {
        const target = Array.from(document.querySelectorAll('a')).find(a => a.textContent?.includes('Datos de la Línea'));
        if (target) { target.click(); return true; }
        return false;
    });
    if (!clicked) throw new Error("No se pudo hacer clic en 'Datos de la Línea'");
    await esperarAleatorio(1000, 3000);

    // 3. SELECCIÓN Y BÚSQUEDA
    await page.waitForSelector('#formDatosCliente\\:j_id_21 .ui-selectonemenu-trigger', { visible: true });
    await page.click('#formDatosCliente\\:j_id_21 .ui-selectonemenu-trigger');
    await esperarAleatorio(500, 1500);
    await page.click('li[data-label="Línea Telefonica"]');
    await esperarAleatorio(1000, 3000);

    // 4. INYECCIÓN HUMANA DEL NÚMERO
    const selectorInput = '#formDatosCliente\\:displayLinea2 input[type="text"]';
    await page.click(selectorInput, { clickCount: 3 }); 
    await page.keyboard.press('Backspace');     
    
    const numeroLimpio = String(numero).slice(-10);
    // ESCRITURA ALEATORIA TIPO HUMANO
    for (const char of numeroLimpio) {
        await page.type(selectorInput, char, { delay: Math.floor(Math.random() * 100) + 50 });
    }
    
    console.log(`✅ Número inyectado (10 dígitos): ${numeroLimpio}`);
    await page.keyboard.press('Enter');
    await esperarAleatorio(1000, 2000);
    await page.click('#formDatosCliente\\:displayLinea3 button[id*="j_id_"]');

    await esperarAleatorio(1000, 3000);

    // 5. EXTRACCIÓN DE RESULTADOS
    console.log("🔍 Intentando extraer datos de la tabla...");
    
    try {
        await page.waitForSelector('#formDatosCliente\\:acordion\\:panelDetalle', { timeout: 10000 });
        
        const datos = await page.evaluate(() => {
            const tabla = document.querySelector('#formDatosCliente\\:acordion\\:panelDetalle');
            if (!tabla) return null;

            const getValByLabel = (textoLabel) => {
                const labels = Array.from(tabla.querySelectorAll('label'));
                const targetLabel = labels.find(l => l.innerText.includes(textoLabel));
                if (!targetLabel) return "N/A";
                const tr = targetLabel.closest('tr');
                const span = tr.querySelector('span[style*="font-weight:bold"]');
                return span ? span.innerText.trim() : "N/A";
            };

            return {
                estatus: getValByLabel('Estatus:'),
                registrado: getValByLabel('Cliente registrado:'),
                fechaActivacion: getValByLabel('Fecha Activación:'),
                fechaPrimerEvento: getValByLabel('Fecha de Primer Evento:'),
                fechaExpiracion: getValByLabel('Fecha Expiración de Tiempo Aire:')
            };
        });

        if (!datos) {
            console.error("❌ La tabla existe pero no se pudieron extraer los datos.");
            return null;
        }

        console.log("✅ Datos extraídos correctamente:", datos);
        return datos;

    } catch (error) {
        console.error("❌ Error esperando la tabla o extrayendo datos:", error.message);
        return null;
    }
}
// FIN ANALISIS TELCEL 


// --- RECARGAS ---//-------------------------------------------------------------->> REVISADO PostgreSQL


async function ejecutarRecarga(page) {
    const btn = await page.evaluate(() => { const b = document.querySelector('#button_charge'); if(b) b.click(); return !!b; });
    if (!btn) throw new Error("Botón de recarga no encontrado");
    return "Recarga enviada";
}

async function recarga1(page, numero, userId) {
    await page.goto('https://force.mmoviles.com/public/autorecarga', { waitUntil: 'networkidle2' });
    await page.type('#telefono_info', String(numero));
    await page.click('#button_info');
    await page.waitForSelector('#button_charge', { visible: true });
    await page.click('#button_charge');
    return { success: true };
}

async function recarga2(page, numero, userId) { return { success: true }; }

// --- REGISTRO Y QR ---

async function registrarLinea(page, numero, userId, tareaId) {
    console.log(`🔐 Iniciando registro (Usuario: ${userId})...`);
    
    const estaEnElPortal = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text')); 
    if (!estaEnElPortal) {
        await ejecutarLoginTelcel(page, userId);
    }

    //------- SELECCIONAR DEL MENU 
    const header = await page.evaluateHandle(() => Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes("Tramites Prepago BES")));
    if (header) { 
        await header.click(); 
        await new Promise(r => setTimeout(r, 1500)); 
    }

    const clicked = await page.evaluate(() => {
        const target = Array.from(document.querySelectorAll('a')).find(a => a.textContent?.includes('Registro de clientes BES'));
        if (target) { target.click(); return true; }
        return false;
    });
    if (!clicked) throw new Error("No se pudo hacer clic en 'Registro de clientes BES'");
    await new Promise(r => setTimeout(r, 100));
    
    //------- INYECTAMOS EL NUMERO
    await page.waitForSelector('#formRegistro\\:linea', { visible: true, timeout: 10000 });
    await page.click('#formRegistro\\:linea');
    await page.keyboard.press('Backspace'); 
    await new Promise(r => setTimeout(r, 1000));
    await page.type('#formRegistro\\:linea', numero, { delay: 300 });

    await page.evaluate(() => {
        const input = document.getElementById('formRegistro:linea');
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    await page.waitForSelector('#formRegistro\\:j_id_2k', { visible: true });
    await page.click('#formRegistro\\:j_id_2k');

    console.log('✅ Número inyectado y botón Validar presionado.');

    // --- CORRECCIÓN PostgreSQL ---
    // Cambiamos pool.execute por pool.query y el marcador '?' por '$1' y '$2'
    await pool.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['ESPERANDO_USER', tareaId]);
    console.log("✅ SMS enviado. Estado actualizado a ESPERANDO_USER en DB...");

    return { requiereToken: true }; 
}
//-------------------------------------------------------------->> REVISADO PostgreSQL

//-- 2. INTENTAR EXTRAER QR

async function intentarExtraerQR(page, tareaId) {
    console.log("🔍 [BOT] Localizando el iframe y gestionando modal...");
    
    try {
        await page.waitForSelector('#modalABE', { visible: true, timeout: 20000 });
        const iframeElement = await page.waitForSelector('iframe', { timeout: 15000 });
        const frame = await iframeElement.contentFrame();
        
        if (!frame) throw new Error("No se pudo acceder al iframe");

        // BUSCAMOS SI APARECE EL MODAL DE SEGUIMIENTO CON EL BOTON CONSULTAR
        const botonConsultar = await frame.$('button.qr-validate-status-modal__action');
        // ESTE APARECE SI ESPERAS MUCHO TIEMPO ANTES DE TOMAR SCREEN
        if (botonConsultar) {
            console.log("🔘 [BOT] Botón CONSULTAR detectado, haciendo clic...");
            // HACEMOS CLIC EN EL BOTON PARA QUE EL SISTEMA AVANCE
            await botonConsultar.click();
            
            // ESPERAMOS 3 SEGUNDOS EXACTOS DESPUES DE DAR CLIC
            console.log("⏳ [BOT] Esperando 3 segundos para que el portal procese...");
            await new Promise(resolve => setTimeout(resolve, 3000));
        }

        const qrData = await frame.evaluate(() => {
            const img = document.querySelector('img.img-fluid.qr');
            return img ? img.getAttribute('src') : null;
        });

        if (!qrData) {
            console.error("❌ QR no encontrado en el DOM del iframe.");
            return null; 
        }

        return qrData; 

    } catch (e) {
        console.error("❌ Error inesperado en extracción:", e.message);
        return null; 
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarQR(page, tarea, connection) {
    console.log("📸 [INICIO] Extrayendo y decodificando QR para tarea:", tarea.id);
    
    // 1. Extraemos el Base64 (El "crudo")
    const qrData = await intentarExtraerQR(page, tarea.id);
    
    if (qrData) {
        // 2. Decodificamos el link (La "materia prima" útil)
        const linkFinal = await obtenerUrlDeBase64(qrData);
        
        if (linkFinal) {
            console.log("🔗 [ÉXITO] Link decodificado:", linkFinal);
            
            // 3. Guardamos SOLAMENTE el link. 
            // CORRECCIÓN PG: Uso de $1, $2 y .query()
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2, link_final = $3 WHERE id = $4", 
                ['ENVIANDO_QR', 'PROCESADO', linkFinal, tarea.id]
            );
            console.log("💾 [FINALIZADO] Link guardado exitosamente en BD.");
        } else {
            console.error("❌ [ERROR] La imagen se obtuvo pero no se pudo decodificar.");
            // CORRECCIÓN PG: Uso de $1, $2, $3 y .query()
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                ['FALLO_EXTRACCION', 'Error al decodificar QR', tarea.id]
            );
        }
    } else {
        console.error("❌ [ERROR] No se pudo obtener la imagen QR del navegador.");
        // CORRECCIÓN PG: Uso de $1, $2, $3 y .query()
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['FALLO_EXTRACCION', 'No se obtuvo imagen', tarea.id]
        );
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL

//-- 3. CAPTURA DE PANTALLA

async function tomarCaptura(page, nombreArchivo) {
    try {
        // Aseguramos que la ruta sea absoluta desde la raíz del proyecto
        const dir = path.join(process.cwd(), 'debug_screenshots');
        
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        const rutaCompleta = path.join(dir, nombreArchivo);
        
        // REGLA DE ORO: Esperar un momento a que el navegador termine de pintar
        await new Promise(resolve => setTimeout(resolve, 500)); 
        
        await page.screenshot({ 
            path: rutaCompleta, 
            fullPage: true,
            omitBackground: true 
        });
        
        console.log(`📸 [SUCCESS] Captura guardada en: ${rutaCompleta}`);
    } catch (err) {
        // MUY IMPORTANTE: Si esto falla, veremos el error real en la consola
        console.error(`❌ [ERROR] Captura fallida (${nombreArchivo}):`, err.message);
    }
}


//-------------------------------------------------------------->> REVISADO PostgreSQL


// Asegúrate de pasar la conexión como parámetro
async function reintentarExtraccion(tareaId, connection) {
    try {
        // CORRECCIÓN PG: Uso de $1 y .query()
        const query = "UPDATE public.cola_tareas SET estado = $1 WHERE id = $2";
        await connection.query(query, ['REINTENTAR_QR', tareaId]);
        console.log("✅ Orden de reintento enviada a la base de datos.");
    } catch (err) {
        console.error("Error al enviar orden de reintento:", err);
    }
}

//--- AQUI ESTA EL VOLANTE DE CADA FUNCION TOKEN + QR
async function manejarInicioSesion(page, tarea) {
    console.log("🔑 Ejecutando Login...");
    // Aquí llamas a tu función de login existente
    await ejecutarLoginTelcel(page, tarea.user_id);
    
    // Si el login fue exitoso, el Dispatcher debería pasar el estado a VALIDANDO_TOKEN
    // CORRECCIÓN PG: Uso de $1, $2 y pool.query()
    await pool.query("UPDATE public.cola_tareas SET estado = $1 WHERE id = $2", ['VALIDANDO_TOKEN', tarea.id]);
    return true;
}
//-------------------------------------------------------------->> REVISADO PostgreSQL

// --- MANEJAR TOKEN ---

//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarToken(page, tarea, connection) {
    console.log("🎟️ Procesando Token...");
    const res = await inyectarTokenYValidar(page, tarea.id, tarea.numero);

    if (res.error) {
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3",
            ['FALLO_TOKEN', res.error, tarea.id]
        );
        return false;
    }

    await connection.query(
        "UPDATE public.cola_tareas SET estado = $1 WHERE id = $2",
        ['GENERANDO_QR', tarea.id]
    );
    return true;
}

async function inyectarTokenYValidar(page, tareaId, numero) {
    console.log(`🔑 [TOKEN][ID: ${tareaId}] Iniciando inyección de token para número: ${numero}...`);

    try {
        // 1. Obtener token fresco (Sintaxis PG)
        const res = await pool.query("SELECT token FROM public.cola_tareas WHERE id = $1", [tareaId]);
        const token = res.rows[0]?.token;

        if (!token) {
            console.warn(`⚠️ [TOKEN][ID: ${tareaId}] Token no encontrado en BD.`);
            return { error: "Token no encontrado en BD." };
        }

        const selectorToken = 'input[id*="token"]';
        const selectorBoton = '#formRegistro\\:j_id_2y';

        // 2. Limpiar input e inyectar valor
        console.log(`⌨️ [TOKEN][ID: ${tareaId}] Inyectando token en el formulario...`);
        await page.evaluate((sel, val) => {
            const input = document.querySelector(sel);
            if (input) {
                input.value = "";
                input.value = val;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                input.dispatchEvent(new Event('blur', { bubbles: true }));
            }
        }, selectorToken, token);

        // 3. NUEVO: esperar a que el botón esté disponible antes de hacer clic
        console.log(`⏳ [TOKEN][ID: ${tareaId}] Esperando a que el botón de validar esté disponible...`);
        await page.waitForSelector(selectorBoton, { visible: true, timeout: 15000 });

        // 4. Clic al botón
        console.log(`🖱️ [TOKEN][ID: ${tareaId}] Clic en botón de validar...`);
        await page.click(selectorBoton);

        console.log(`⏳ [TOKEN][ID: ${tareaId}] Esperando respuesta de validación...`);
        await new Promise(r => setTimeout(r, 5000));

        // 5. Verificar error en pantalla
        const mensajeError = await page.evaluate(() => {
            const el = document.querySelector('span[style*="color: red"]');
            return el ? el.innerText.trim() : null;
        });

        if (mensajeError) {
            console.error(`❌ [TOKEN][ID: ${tareaId}] Error detectado: ${mensajeError}`);
            await pool.query("UPDATE public.cola_tareas SET token = NULL WHERE id = $1", [tareaId]);
            return { error: mensajeError };
        }

        console.log(`✅ [TOKEN][ID: ${tareaId}] Token validado exitosamente.`);
        return { success: true };

    } catch (error) {
        console.error(`🚨 [TOKEN][ID: ${tareaId}] Error crítico en inyección:`, error.message);

        await pool.query(
            "UPDATE public.cola_tareas SET estado = 'ERROR', resultado = $1 WHERE id = $2",
            [error.message.substring(0, 255), tareaId]
        );

        throw error;
    }
}

//-------------------------------------------------------------->> REVISADO PostgreSQL
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarQR_SMS(page, tarea, connection) {
    console.log(`📸 [INICIO] Extracción QR para Tarea ID: ${tarea.id} | User: ${tarea.user_id}`);
    try {
        // 1. ESPERAR EL MODAL POR SU ID REAL: #modalABE
        console.log("🔍 [BOT] Esperando #modalABE...");
        await page.waitForSelector('#modalABE', { visible: true, timeout: 20000 });

        // 2. ACCEDER AL IFRAME DENTRO DEL MODAL
        const iframeElement = await page.waitForSelector('#modalABE iframe', { timeout: 15000 });
        const frame = await iframeElement.contentFrame();
        if (!frame) throw new Error("No se pudo acceder al contenido del iframe dentro de #modalABE");

        // 3. EXTRAER LA IMAGEN DIRECTAMENTE
        const qrData = await frame.evaluate(() => {
            const img = document.querySelector('img.img-fluid.qr');
            return img ? img.getAttribute('src') : null;
        });
        if (!qrData) throw new Error("No se encontró la imagen img.img-fluid.qr dentro del iframe");

        // 4. PROCESAR EL BASE64
        const linkFinal = await obtenerUrlDeBase64(qrData);
        if (linkFinal) {
            console.log("🔗 [ÉXITO] Link decodificado:", linkFinal);

            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2, link_final = $3, fecha_actualizacion = NOW() WHERE id = $4 AND user_id = $5",
                ['ENVIANDO_QR', 'PROCESADO', linkFinal, tarea.id, tarea.user_id]
            );
        } else {
            throw new Error("Fallo en la decodificación del QR");
        }
    } catch (e) {
        console.error(`❌ [ERROR] Tarea ${tarea.id}: ${e.message}`);

        // CORRECCIÓN: estado = 'FALLO_EXTRACCION' (no 'REINTENTAR_QR') para que
        // el frontend muestre el botón de reintento al usuario, en vez de que
        // el worker reintente solo en bucle. Se agregó también el 4to parámetro
        // que faltaba en la consulta.
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2, fecha_actualizacion = NOW() WHERE id = $3 AND user_id = $4",
            ['FALLO_EXTRACCION', e.message.substring(0, 255), tarea.id, tarea.user_id]
        );
    }
}

//-------------------------------------------------------------->> REVISADO PostgreSQL

//----------------------------------------------------------------------------------------------------------
//-------------------------------------------FUNCIONES ACTIVAR eSIM-----------------------------------------
//----------------------------------------------------------------------------------------------------------




//-------------------------------------------------------------->> REVISADO PostgreSQL


async function activarESIM(page, tarea, connection) {
    const { ciudad, correo, imei } = tarea;
    
    if (!ciudad || !correo || !imei) {
        console.error("❌ [BOT] Error: Faltan datos en la tarea (Ciudad, Correo o IMEI).");
        return false;
    }

    console.log("🤖 [BOT] Iniciando activación para:", tarea.numero, "Ciudad:", ciudad);

    try {
        // 1. NAVEGACIÓN AL MENÚ
        await page.waitForSelector('.ui-menuitem-text', { timeout: 15000 });
        const exitoMenu = await page.evaluate(() => {
            const headers = Array.from(document.querySelectorAll('h3'));
            const menuHeader = headers.find(h => h.textContent.includes("Tramites Prepago BES"));
            if (!menuHeader) return false;
            menuHeader.click();
            const links = Array.from(document.querySelectorAll('.ui-menuitem-text'));
            const target = links.find(el => el.textContent.includes('Activación Individual BES'));
            if (target) target.parentElement.click();
            return true;
        });

        if (!exitoMenu) throw new Error("No se pudo navegar al menú.");
        await new Promise(r => setTimeout(r, 1500));

        // 2. SELECCIÓN CHIP
        await page.waitForSelector('label[for="formActivacionInd:acordion:tipoProducto:1"]', { timeout: 15000 });
        await page.evaluate(() => document.querySelector('label[for="formActivacionInd:acordion:tipoProducto:1"]').click());

        // 3. SELECCIÓN ESIM
        await page.waitForSelector('table[id="formActivacionInd:acordion:tipoSIM"]', { timeout: 10000 });
        await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('table[id="formActivacionInd:acordion:tipoSIM"] label'));
            const labelESIM = labels.find(l => l.textContent.includes('eSIM'));
            if (labelESIM) labelESIM.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        // 4. SELECCIÓN ESQUEMA DE COBRO
        await page.evaluate(() => document.querySelector('label[id="formActivacionInd:acordion:esquemaCobro_label"]').click());
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => document.querySelector('li[id="formActivacionInd:acordion:esquemaCobro_2"]').click());
        await new Promise(r => setTimeout(r, 1000));

        // 5. SELECCIÓN CIUDAD
        await page.evaluate((c) => {
            document.querySelector('div[id="formActivacionInd:acordion:cmbCiudad"] .ui-selectonemenu-trigger').click();
        }, ciudad);
        await new Promise(r => setTimeout(r, 1500));
        await page.evaluate((c) => {
            const op = Array.from(document.querySelectorAll('li[data-label]')).find(o => o.getAttribute('data-label') === c);
            if (op) op.click();
        }, ciudad);
        await new Promise(r => setTimeout(r, 1000));

        // 6. INGRESO DE DATOS
        console.log(`🤖 [BOT] Ingresando: Correo ${correo} | IMEI ${imei}`);
        await page.evaluate((c, i) => {
            const escribir = (id, valor) => {
                const el = document.getElementById(id);
                if (el) {
                    el.focus();
                    el.value = valor;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            };
            escribir('formActivacionInd:acordion:email', c);
            escribir('formActivacionInd:acordion:imei', i);
        }, correo, imei);

        await new Promise(r => setTimeout(r, 1000));

        // 7. CLIC EN BOTÓN "SIGUIENTE"
        console.log("🤖 [BOT] Ejecutando clic en botón 'Siguiente'...");
        const selectorBoton = '#formActivacionInd\\:btnContinuarOferta'; 
        for (let i = 0; i < 2; i++) {
            await page.evaluate((sel) => {
                const btn = document.querySelector(sel);
                if (btn) {
                    btn.scrollIntoView();
                    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    btn.click(); 
                }
            }, selectorBoton);
            await new Promise(r => setTimeout(r, 2000));
        }

        // 8. SELECCIÓN DE PLAN Y CONFIRMACIÓN
        await page.waitForSelector('#formActivacionInd\\:acordion\\:cmbPlanComercial_label', { visible: true, timeout: 15000 });
        
        await page.evaluate(() => {
            document.querySelector('label[id="formActivacionInd:acordion:cmbPlanComercial_label"]')?.click();
            document.getElementById('formActivacionInd:acordion:cmbPlanComercial_2')?.click();
            document.getElementById('formActivacionInd:btnActivar')?.click();
        });

        await page.waitForSelector('#formActivacionInd\\:btnActivar2', { visible: true, timeout: 10000 });
        await new Promise(r => setTimeout(r, 2000));
        
        await page.evaluate(() => {
            document.getElementById('formActivacionInd:btnActivar2')?.click();
        });
        
        return true;

    } catch (e) {
        console.error(`❌ [BOT ERROR] Tarea ${tarea.id} falló en: ${e.message}`);
        if (connection) {
            // CORRECCIÓN PG: Uso de $1, $2 y .query()
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
                ['ERROR', e.message.substring(0, 255), tarea.id]
            );
        }
        return false;
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL



async function ejecutar_ACT_ESIM_EXITOSA_QR(page, tarea) {
    console.log(`🚀 [BOT] Iniciando secuencia de QR y Registro para ID: ${tarea.id}`);

    try {
        // -- 1. PRESIONAR BOTÓN VER QR --
        await page.waitForSelector('#formCapUsu\\:btnVerQR', { visible: true });
        await page.click('#formCapUsu\\:btnVerQR');

        // -- 2. CAPTURAR Y GUARDAR SCREENSHOT --
        await page.waitForSelector('#modalQR', { visible: true, timeout: 10000 });
        await new Promise(r => setTimeout(r, 2000)); 
        
        const nombreArchivo = `public/screenshots/${tarea.id}_${tarea.user_id}.png`;
        const modalElement = await page.$('#modalQR');
        await modalElement.screenshot({ path: nombreArchivo });
        await new Promise(r => setTimeout(r, 2000));
        console.log(`📸 [BOT] Screenshot guardado: ${nombreArchivo}`);

        // -- 3. CERRAR MODAL --
const botonCerrarEncontrado = await page.evaluate((modal) => {
            // Buscamos botones solo dentro del contexto del modal
            const botones = Array.from(modal.querySelectorAll('button'));
            const btn = botones.find(b => b.innerText.trim() === 'Cerrar');
            
            if (btn) {
                btn.click();
                return true;
            }
            return false;
        }, modalElement);

        if (botonCerrarEncontrado) {
            console.log("✅ [BOT] Botón 'Cerrar' presionado dentro del modal.");
        } else {
            console.warn("⚠️ [BOT] No se encontró el botón 'Cerrar' dentro del modal.");
        }
        
        await new Promise(r => setTimeout(r, 1500));


        await new Promise(r => setTimeout(r, 1500)); // Espera a que cierre
        console.log("✅ [BOT] Botón 'Cerrar' presionado.");

        // -- 4. PRESIONAR BOTÓN REGISTRAR CLIENTE --
        await page.waitForSelector('#formCapUsu\\:j_id_3q', { visible: true, timeout: 10000 });
        await page.click('#formCapUsu\\:j_id_3q');
        console.log("✅ [BOT] Botón 'Registrar Cliente' presionado.");
        
        await new Promise(r => setTimeout(r, 4000)); // Tiempo para que cargue el form de validación

        // -- 5. PRESIONAR BOTÓN VALIDAR --
        await page.waitForSelector('#formRegistro\\:j_id_2k', { visible: true, timeout: 15000 });
        await page.click('#formRegistro\\:j_id_2k');
        console.log("✅ [BOT] Botón 'Validar' presionado correctamente.");

        return { success: true, path: nombreArchivo };

    } catch (e) {
        console.error(`❌ [BOT] Error en secuencia QR/Registro: ${e.message}`);
        await tomarCaptura(page, `error_secuencia_${tarea.id}.png`);
        throw new Error("Fallo en secuencia de registro: " + e.message);
    }
}


async function ejecutarExtraccionManual(page, userId) {
    console.log("🤖 [BOT] Iniciando proceso de extracción manual...");

    // 1. VERIFICACIÓN DE SESIÓN
    const estaEnElPortal = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text')); 
    if (!estaEnElPortal) {
        console.log("⚠️ Sesión no detectada, ejecutando login...");
        await ejecutarLoginTelcel(page, userId);
    }

    // 2. NAVEGACIÓN
    const menuNavegado = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const target = links.find(a => a.textContent?.includes('Estatus de Orden'));
        if (target) { target.click(); return true; }
        return false;
    });

    if (menuNavegado) await new Promise(r => setTimeout(r, 3000));

    // 3. EXTRACCIÓN Y VALIDACIÓN DE DIÁLOGO
    try {
        const selectorActualizar = '#formCapUsu\\:j_id_3p';
        await page.waitForSelector(selectorActualizar, { visible: true, timeout: 20000 });

        console.log("🤖 [BOT] Actualizando estatus...");
        await page.evaluate((sel) => document.querySelector(sel)?.click(), selectorActualizar);

        await new Promise(r => setTimeout(r, 4000)); 

        // Unificamos la extracción de datos y la detección del diálogo
        const resultado = await page.evaluate(() => {
            const titulo = document.getElementById('formCapUsu:mydlgRegistrarCliente_title');
            const boton = document.getElementById('formCapUsu:btnRegistrarCliente');
            
            return {
                folio: document.getElementById('formCapUsu:folio')?.textContent?.trim() || null,
                iccid: document.getElementById('formCapUsu:iccid')?.textContent?.trim() || null,
                numero: document.getElementById('formCapUsu:telefono')?.textContent?.trim() || null,
                estadoAct: document.getElementById('formCapUsu:ordenExt')?.textContent?.trim() || null,
                // Si el diálogo existe, el estatus será 'EXITOSO', de lo contrario 'PENDIENTE'
                estatus_act: (titulo && boton) ? 'EXITOSO' : 'PENDIENTE',
                dialogoDetectado: !!(titulo && boton)
            };
        });

        if (resultado.dialogoDetectado) {
            console.log("✅ [BOT] Registro detectado (EXITOSO).");
        } else if (!resultado.folio) {
            throw new Error("Datos no encontrados.");
        }
        
        console.log("✅ Extracción finalizada:", resultado);
        return resultado;

    } catch (e) {
       
        throw new Error("Fallo en extracción: " + e.message);
    }
}

//------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------
//------------------------------------------------------------------------------------------ FIN FUNCIONES eSIM ----------
//------------------------------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------------------------
//-------------------------------------------------------------------------------------------ON FUNCIONES SIM FISICA------
//------------------------------------------------------------------------------------------------------------------------


//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarACT_FISICO(tarea, connection, estadoActual) {
    console.log(`🛠 [Manejador] Iniciando activación FÍSICA para tarea ID: ${tarea.id}`);
    try {
        const url = (tarea.portal === 'FORCE') 
            ? 'https://force.mmoviles.com/login' 
            : 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        // CORRECCIÓN: Forzamos el login igual que en ESIM. 
        // Si ya está logueado, esta función detecta que no es necesario y sigue.
        await ejecutarLoginTelcel(page, tarea.user_id); 
        
        console.log(`🚀 Ejecutando activación física en portal: ${tarea.portal} para ID: ${tarea.user_id}`);
        
        const exito = await activarFisica(page, tarea); 
        
        if (exito) {
            // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, user_id = $2 WHERE id = $3", 
                ['ACT_FISICA_EXITOSA_QR', tarea.user_id, tarea.id]
            );
        } else {
            throw new Error("La función activarFisica retornó falso.");
        }
    } catch (e) {
        console.error(`❌ [Manejador] Error general en activación física ID ${tarea.id}:`, e.message);
        // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['ERROR', e.message.substring(0, 255), tarea.id]
        );
    }
}


//-------------------------------------------------------------->> REVISADO PostgreSQL
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function activarFisica(page, tarea, connection) {
    console.log("🤖 [Bot] Iniciando Activación Individual para:", tarea.numero);

    try {
        // 1. --- VERIFICACIÓN DE SESIÓN ---
        const estaEnElPortal = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text')); 
        if (!estaEnElPortal) {
            await ejecutarLoginTelcel(page, tarea.user_id, tarea, connection);
        }

        // 2. --- NAVEGACIÓN AL MENÚ ---
        const menuHeader = await page.evaluateHandle(() => Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes("Tramites Prepago BES")));
        if (!menuHeader) throw new Error("No se encontró el menú 'Tramites Prepago BES'.");
        await menuHeader.click();
        await new Promise(r => setTimeout(r, 2000));

        // 3. --- CLIC EN ACTIVACIÓN INDIVIDUAL ---
        const exitoMenu = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('.ui-menuitem-text'));
            const target = links.find(el => el.textContent && el.textContent.includes('Activación Individual BES'));
            if (target) { target.parentElement.click(); return true; }
            return false;
        });
        if (!exitoMenu) throw new Error("No se pudo hacer clic en 'Activación Individual BES'.");
        await new Promise(r => setTimeout(r, 4000));

        // 4. --- SELECCIÓN CHIP ---
        console.log("🤖 [Bot] Paso 1: Seleccionando CHIP...");
        await page.waitForSelector('label[for="formActivacionInd:acordion:tipoProducto:1"]', { timeout: 15000 })
            .catch(() => { throw new Error("Paso 1: No se encontró el selector de CHIP."); });
        await page.evaluate(() => document.querySelector('label[for="formActivacionInd:acordion:tipoProducto:1"]').click());
        await new Promise(r => setTimeout(r, 3000));

        // 5. SELECCIÓN ESQUEMA DE COBRO
        console.log("🤖 [Bot] Paso 2: Seleccionando Esquema...");
        await page.evaluate(() => {
            const label = document.querySelector('label[id="formActivacionInd:acordion:esquemaCobro_label"]');
            if (!label) throw new Error("No se encontró el label de esquema de cobro.");
            label.click();
        });
        await new Promise(r => setTimeout(r, 1000));
        await page.evaluate(() => {
            const item = document.getElementById('formActivacionInd:acordion:esquemaCobro_2');
            if (!item) throw new Error("No se encontró la opción de esquema de cobro.");
            item.click();
        });
        await new Promise(r => setTimeout(r, 1500));

        // 6. SELECCIÓN CIUDAD
        console.log("🤖 [Bot] Paso 3: Seleccionando Ciudad:", tarea.ciudad);
        await page.evaluate((ciudad) => {
            const trigger = document.querySelector('div[id="formActivacionInd:acordion:cmbCiudad"] .ui-selectonemenu-trigger');
            if (!trigger) throw new Error("No se encontró el selector de ciudad.");
            trigger.click();
        }, tarea.ciudad);
        await new Promise(r => setTimeout(r, 1500));
        
        const exitoCiudad = await page.evaluate((c) => {
            const op = Array.from(document.querySelectorAll('li[data-label]')).find(o => o.getAttribute('data-label') === c);
            if (op) { op.click(); return true; }
            return false;
        }, tarea.ciudad);
        if (!exitoCiudad) throw new Error(`No se pudo seleccionar la ciudad: ${tarea.ciudad}`);
        await new Promise(r => setTimeout(r, 1500));
        
        // 7. INGRESO DE ICCID
        console.log(`🤖 [BOT] Ingresando ICCID: ${tarea.iccid}`);
        const exitoIccid = await page.evaluate((iccid) => {
            const el = document.getElementById('formActivacionInd:acordion:iccidDeur');
            if (!el) return false;
            el.value = iccid;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }, tarea.iccid);
        if (!exitoIccid) throw new Error("No se encontró el campo ICCID.");

        // 8. CLIC EN BOTÓN "SIGUIENTE"
        await page.click('#formActivacionInd\\:btnContinuarOferta').catch(() => { throw new Error("No se pudo presionar 'Siguiente'."); });
        await new Promise(r => setTimeout(r, 3000));

        // 9. SELECCIÓN DE PLAN Y CONFIRMACIÓN
        await page.waitForSelector('#formActivacionInd\\:acordion\\:cmbPlanComercial_label', { visible: true, timeout: 15000 })
            .catch(() => { throw new Error("No se cargó el plan comercial."); });
        
        await page.evaluate(() => {
            document.querySelector('label[id="formActivacionInd:acordion:cmbPlanComercial_label"]')?.click();
            document.getElementById('formActivacionInd:acordion:cmbPlanComercial_1')?.click();
            document.getElementById('formActivacionInd:btnActivar')?.click();
        });

        // 10. CONFIRMACIÓN FINAL
        await page.waitForSelector('#formActivacionInd\\:btnActivar2', { visible: true, timeout: 10000 })
            .catch(() => { throw new Error("No apareció el botón de confirmación final."); });
        await page.click('#formActivacionInd\\:btnActivar2');
            
        return true; 

    } catch (e) {
        console.error(`❌ [BOT ERROR] Tarea ${tarea.id} falló en: ${e.message}`);
        if (connection) {
            // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2, $3
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, estatus_act = $2, resultado = $3 WHERE id = $4", 
                ['ERROR', 'ERROR', e.message.substring(0, 255), tarea.id]
            );
        }
        return false;
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL



//-------------------------------------------------------------->> REVISADO PostgreSQL


async function manejarQR_ACT(page, tarea, connection) {
    console.log(`📸 [INICIO] Extracción QR para Tarea ID: ${tarea.id} | User: ${tarea.user_id}`);

    try {
        // 1. ESPERAR EL MODAL POR SU ID REAL: #modalABE
        console.log("🔍 [BOT] Esperando #modalABE...");
        await page.waitForSelector('#modalABE', { visible: true, timeout: 20000 });

        // 2. ACCEDER AL IFRAME DENTRO DEL MODAL
        const iframeElement = await page.waitForSelector('#modalABE iframe', { timeout: 15000 });
        const frame = await iframeElement.contentFrame();

        if (!frame) throw new Error("No se pudo acceder al contenido del iframe dentro de #modalABE");

        // 3. EXTRAER LA IMAGEN DIRECTAMENTE
        const qrData = await frame.evaluate(() => {
            const img = document.querySelector('img.img-fluid.qr');
            return img ? img.getAttribute('src') : null;
        });

        if (!qrData) throw new Error("No se encontró la imagen img.img-fluid.qr dentro del iframe");

        // 4. PROCESAR EL BASE64
        const linkFinal = await obtenerUrlDeBase64(qrData);

        if (linkFinal) {
            console.log("🔗 [ÉXITO] Link decodificado:", linkFinal);
            
            // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2, $3, $4, $5
            await connection.query(
                "UPDATE public.cola_tareas SET estado = $1, resultado = $2, link_final = $3, fecha_actualizacion = NOW() WHERE id = $4 AND user_id = $5",
                ['ENVIANDO_QR', 'PROCESADO', linkFinal, tarea.id, tarea.user_id]
            );
        } else {
            throw new Error("Fallo en la decodificación del QR");
        }

    } catch (e) {
        console.error(`❌ [ERROR] Tarea ${tarea.id}: ${e.message}`);
        
        // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2, $3, $4
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2, fecha_actualizacion = NOW() WHERE id = $3 AND user_id = $4",
            ['FALLO_EXTRACCION', e.message.substring(0, 255), tarea.id, tarea.user_id]
        );
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL

//-------------------------------------------------------------->> REVISADO PostgreSQL

               
async function manejarACT_FISICA_REINTENTO(tarea, connection) {
    console.log(`🔄 [Manejador] Iniciando REINTENTO para ID: ${tarea.id} (Estado: ${tarea.estado})`);
    try {
        const url = 'https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login';
        const page = await obtenerSesionCompleta(tarea.user_id, url);
        
        // Login defensivo
        const yaLogueado = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text'));
        if (!yaLogueado) {
            await ejecutarLoginTelcel(page, tarea.user_id);
        }
        
        // Ejecutamos la extracción
        await procederExtraccion_FISICA(page, tarea, connection);
        
    } catch (e) {
        console.error(`❌ [Manejador] Error en reintento ID ${tarea.id}:`, e.message);
        // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['ACT_FISICA_FALLO', e.message, tarea.id]
        );
    }
}

async function procederExtraccion_FISICA(page, tarea, connection) {
    console.log(`🔍 [Extracción] Intentando extraer datos para ID: ${tarea.id}`);
    
    try {
        const datos = await ejecutarExtraccionManual_FISICA(page, tarea.user_id);
        const esCompletado = datos.estatus_act === 'EXITOSO';
        
        // Si es completado, finalizamos. Si no, marcamos para REINTENTO
        const nuevoEstado = esCompletado ? 'COMPLETADO' : 'REINTENTANDO_EXTRACCION';

        // CORRECCIÓN PG: Uso de .query() y marcadores $1 al $9
        await connection.query(
            `UPDATE public.cola_tareas 
             SET estado = $1, 
                 ESTADO_ACT = $2, 
                 folio_act = $3, 
                 estatus_act = $4, 
                 iccid = $5, 
                 numero = $6, 
                 resultado = $7 
             WHERE id = $8 AND user_id = $9`,
            [
                nuevoEstado, 
                datos.estadoAct, 
                datos.folio, 
                datos.estatus_act, 
                datos.iccid, 
                datos.numero, 
                esCompletado ? 'EXITO' : 'REINTENTANDO_EXTRACCION', 
                tarea.id,
                tarea.user_id
            ]
        );
        console.log(`✅ [Extracción] Tarea ${tarea.id} marcada como: ${nuevoEstado}`);
    } catch (errExtraccion) {
        console.error(`❌ [Error en extracción] ID ${tarea.id}:`, errExtraccion.message);
        // CORRECCIÓN PG: Uso de .query() y marcadores $1, $2
        await connection.query(
            "UPDATE public.cola_tareas SET estado = $1, resultado = $2 WHERE id = $3", 
            ['ERROR', errExtraccion.message, tarea.id]
        );
        throw errExtraccion;
    }
}
//-------------------------------------------------------------->> REVISADO PostgreSQL


async function ejecutarExtraccionManual_FISICA(page, userId) {
    console.log(`🤖 [BOT] Iniciando extracción manual para ID: ${userId}`);

    try {
        // 1. VERIFICACIÓN DE SESIÓN
        const estaEnElPortal = await page.evaluate(() => !!document.querySelector('.ui-menuitem-text')); 
        if (!estaEnElPortal) await ejecutarLoginTelcel(page, userId);

        // 2. ACTUALIZACIÓN
        const selectorActualizar = '#formCapUsu\\:j_id_3p';
        await page.waitForSelector(selectorActualizar, { visible: true, timeout: 20000 });
        await page.click(selectorActualizar);
        await new Promise(r => setTimeout(r, 5000));

        // 3. EXTRACCIÓN DE DATOS (Primero obtenemos la info)
        const resultado = await page.evaluate(() => {
            const getVal = (id) => document.getElementById(id)?.textContent?.trim() || null;
            return {
                folio: getVal('formCapUsu:folio'),
                iccid: getVal('formCapUsu:iccid'),
                numero: getVal('formCapUsu:telefono'),
                estadoAct: getVal('formCapUsu:ordenExt'),
                dialogoVisible: !!document.getElementById('formCapUsu:btnRegistrarCliente')
            };
        });

        console.log("📊 [BOT] Datos extraídos:", resultado);

        // 4. INTERACCIÓN (Solo si el estatus es completado y hay diálogo)
        const estadoLimpio = resultado.estadoAct?.toLowerCase();
        if ((estadoLimpio === 'completed' || estadoLimpio === 'completado') && resultado.dialogoVisible) {
            
            console.log("👉 [BOT] Orden completada. Iniciando secuencia de clics...");

            // Clic en Registrar (usamos click() de puppeteer, es más efectivo)
            await page.click('#formCapUsu\\:btnRegistrarCliente');
            await new Promise(r => setTimeout(r, 3000)); // Espera a que cargue la ventana de validación

            // Clic en Validar
            const selectorValidar = '#formRegistro\\:j_id_2k';
            await page.waitForSelector(selectorValidar, { visible: true, timeout: 10000 });
            await page.click(selectorValidar);
            
            console.log("✅ [BOT] Clic en Validar ejecutado.");
            await new Promise(r => setTimeout(r, 3000)); // Espera final para que el sistema procese
            
            resultado.estatus_act = 'EXITOSO';
            resultado.accion = 'REGISTRO_Y_VALIDACION_COMPLETADOS';
        } else {
            resultado.estatus_act = 'PENDIENTE';
            resultado.accion = 'NINGUNA';
        }

        console.log("✅ [BOT] Extracción finalizada:", JSON.stringify(resultado));
        return resultado;

    } catch (e) {
        console.error("❌ [BOT] Error crítico:", e.message);
                throw e;
    }
}

async function limpiarSesionesInactivas() {
    const ahora = Date.now();
    const MARGEN_SEGURIDAD = 120 * 1000; 
    
    for (const [userId, sesion] of sesiones.entries()) {
        try {
            // 1. Cierre total si la sesión ha expirado
            if (ahora - sesion.lastUsed > TIEMPO_EXPIRACION) {
                console.log(`🧹 Cerrando navegador inactivo: ${userId}`);
                if (sesion.browser) await sesion.browser.close().catch(() => {});
                sesiones.delete(userId);
                continue;
            }

            // 2. Limpieza de pestañas extras
            // Verificamos si el browser existe y el proceso sigue vivo
            if (sesion.browser && sesion.browser.process() != null && (ahora - sesion.lastUsed) > MARGEN_SEGURIDAD) {
                try {
                    const pages = await sesion.browser.pages();
                    
                    if (pages.length > 1) {
                        console.log(`🧹 Limpiando ${pages.length - 1} pestañas huérfanas de: ${userId}`);
                        for (let i = 1; i < pages.length; i++) {
                            // Cerramos solo de la índice 1 en adelante
                            await pages[i].close().catch(() => {});
                        }
                    }
                } catch (browserError) {
                    // Si falla al obtener páginas, es probable que el browser haya muerto
                    console.log(`⚠️ Browser de ${userId} no responde, eliminando referencia.`);
                    sesiones.delete(userId);
                }
            }
        } catch (err) {
            console.error(`❌ Error general al limpiar ${userId}:`, err.message);
            sesiones.delete(userId);
        }
    }
}
console.log(`AthanosMK- ...📡- logicaCMU recibio el mensaje`);
module.exports = {
    obtenerSesionCompleta,
    ejecutarLoginTelcel,
    hacerClicEnDatosLinea,
    ejecutarRecarga,
    recarga2,
    manejarRecargas,
    manejarBiometricos,
    validarForce,
    registrarLinea,
    inyectarTokenYValidar,
    tomarCaptura,
    intentarExtraerQR,
    manejarInicioSesion,
    manejarToken,
    manejarQR,
    manejarQR_SMS,
    manejarQR_ACT,// <--- AQUI ESMPIEZA ACTIVAR FISICA
    manejarACT_FISICO, 
    activarFisica,
    manejarACT_FISICA_REINTENTO, 
    manejarACT_ESIM,
    manejarACT_ESIM_REINTENTO, 
    activarESIM, 
    ejecutarExtraccionManual,
    ejecutar_ACT_ESIM_EXITOSA_QR,
    limpiarSesionesInactivas,
    ejecutarExtraccionManual_FISICA
}
