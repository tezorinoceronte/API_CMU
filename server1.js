// --- 1. CONFIGURACIÓN E IMPORTS ---
const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const cors = require('cors');
const fs = require('fs-extra');
const kill = require('tree-kill');
const { pool } = require('./cola'); // ¡IMPORTANTE: Asegúrate de tener este archivo!

puppeteer.use(StealthPlugin());
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['POST', 'GET'] }));
app.use(express.json());
app.use('/screenshots', express.static(path.join(__dirname, 'screenshots')));
app.use('/public', express.static(path.join(__dirname, 'public'))); // Mueve tu front aquí

const sesiones = new Map();

// --- 2. FUNCIONES DE SISTEMA ---
async function cerrarSesionSegura(userId) {
    if (!sesiones.has(userId)) return;
    const sesion = sesiones.get(userId);
    console.log(`💀 [System] Cerrando sesión: ${userId}`);
    try {
        if (sesion.browser) {
            const pid = sesion.browser.process().pid;
            await sesion.browser.close().catch(() => {});
            if (pid) kill(pid, 'SIGKILL'); 
        }
    } catch (e) {
        console.error(`❌ Error cerrando navegador:`, e);
    } finally {
        sesiones.delete(userId);
    }
}


async function obtenerSesionCompleta(userId) {
    const sessionPath = path.join(__dirname, 'tmp', 'sessions', userId);

    // 1. Verificación en memoria
    if (sesiones.has(userId)) {
        const sesion = sesiones.get(userId);
        if (sesion.browser && sesion.browser.process() !== null) {
            return sesion.pageForce;
        }
        sesiones.delete(userId);
    }

    // 2. LANZAMIENTO SEGURO
    const browser = await puppeteer.launch({ 
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        userDataDir: sessionPath 
    });

    const pageForce = await browser.newPage();
    
    // --- AQUÍ APLICAMOS LA OPTIMIZACIÓN (MOVIDO A SU LUGAR) ---
    await pageForce.setRequestInterception(true);
    pageForce.on('request', (req) => {
        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
            req.abort();
        } else {
            req.continue();
        }
    });

    await pageForce.setViewport({ width: 1480, height: 800 });

    await pageForce.goto('https://force.mmoviles.com/login', { waitUntil: 'networkidle2', timeout: 60000 });

    sesiones.set(userId, { browser, pageForce, ultimaActividad: Date.now() });
    return pageForce;
}

// --- 3. RUTAS (ENDPOINTS) ---
app.post('/api/solicitar-consulta', async (req, res) => {
    const { userId, numero } = req.body;
    const [result] = await pool.execute(
        "INSERT INTO cola_tareas (user_id, numero, portal, estado) VALUES (?, ?, 'FORCE', 'PENDIENTE')",
        [userId, numero]
    );
    res.json({ tareaId: result.insertId });
});

app.get('/api/verificar-estado', async (req, res) => {
    const { id } = req.query;
    const [rows] = await pool.execute("SELECT * FROM cola_tareas WHERE id = ?", [id]);
    if (rows.length > 0) {
        const tarea = rows[0];
        res.json({ 
            estado: tarea.estado, 
            resultado: tarea.resultado ? JSON.parse(tarea.resultado) : null 
        });
    }
});

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`));

async function tomarScreenshot(page, userId, paso) {
    try {
        const rutaImagen = path.join(screenshotsDir, `${userId}_${paso}.png`);
        await page.screenshot({ path: rutaImagen, fullPage: true });
        console.log(`📸 [Monitor] Screenshot '${paso}' guardado para: ${userId}`);
    } catch (error) {
        console.error("❌ Error al guardar screenshot:", error);
    }
}




async function ejecutarLoginTelcel(page, userId, usuario, password, region) {
    console.log(`🔑 [Bot] Iniciando autenticación en Telcel...`);
    
    // 1. Navegación inicial
    await page.goto('https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login', { 
        waitUntil: 'networkidle2', 
        timeout: 15000 
    });

    // 2. Ejecutar acciones
    await page.type('input[type="text"]', usuario, { delay: 100 });
    await page.type('input[type="password"]', password, { delay: 100 });
    await page.select('select', region);
    
    // Hacemos clic
    await page.evaluate(() => document.getElementById('myBtn')?.click());
    
    // 3. VALIDACIÓN ESTRICTA
    try {
        // Esperamos a que la URL YA NO sea la de login (éxito) 
        // O a que aparezca un elemento que solo existe adentro (ej: un botón de salida o un menú)
        await page.waitForFunction(
            () => !window.location.href.includes('login'), 
            { timeout: 15000 }
        );
        
        console.log(`✅ [Bot] Login exitoso para ${userId}.`);
        
        // OPCIONAL: Breve espera para que los scripts del portal terminen de cargar
        await new Promise(r => setTimeout(r, 2000));
        
    } catch (e) {
        // Si falló, lanzamos un error que detendrá el flujo
        throw new Error(`❌ El login no tuvo éxito. El bot sigue atrapado en: ${page.url()}`);
    }
}

async function hacerClicEnDatosLinea(page, userId, numero) {
    console.log("🚀 Consultando datos de la linea para:", numero);
    await tomarScreenshot(page, userId, 'inicio_consulta');

    // 1. Verificación de Autonomía
    const urlActual = page.url();
    if (urlActual.includes('login')) {
        console.log("🔑 [Autonomía] Sesión no detectada. Re-logueando...");
        await ejecutarLoginTelcel(page, userId, usuario, password, region);
        await new Promise(r => setTimeout(r, 3000));
    }

    if (!numero) throw new Error("No se proporcionó un número.");

    // 2. Menú "Tramites Prepago BES"
    const header = await page.evaluateHandle(() => {
        return Array.from(document.querySelectorAll('h3')).find(h => h.textContent.includes("Tramites Prepago BES"));
    });
    
    if (header) {
        await header.click();
        await new Promise(r => setTimeout(r, 2000));
    }

    // 3. Clic "Datos de la Línea"
    const clicked = await page.evaluate(() => {
        const target = Array.from(document.querySelectorAll('a')).find(a => a.textContent?.includes('Datos de la Línea'));
        if (target) { target.click(); return true; }
        return false;
    });
    if (!clicked) throw new Error("No se pudo hacer clic en 'Datos de la Línea'");
    await new Promise(r => setTimeout(r, 4000));
 await tomarScreenshot(page, userId, 'recarga1_despues_de_buscar');
    // 4. Selección "Línea Telefonica" (Selector robusto)
    const triggerSelector = '#formDatosCliente\\:j_id_21 .ui-selectonemenu-trigger';
    await page.waitForSelector(triggerSelector, { visible: true });
    await page.click(triggerSelector);
    await page.waitForSelector('#formDatosCliente\\:j_id_21_items', { visible: true });
     await tomarScreenshot(page, userId, 'recarga1_despues_de_escribir1');
    await page.click('li[data-label="Línea Telefonica"]');
    await new Promise(r => setTimeout(r, 3000));
 await tomarScreenshot(page, userId, 'recarga1_despues_de_escribir');
    // 5. INYECCIÓN DEL NÚMERO (Corregido y reforzado)
    const selectorInput = '#formDatosCliente\\:displayLinea2 input[type="text"]';
     await tomarScreenshot(page, userId, 'recarga1_despues_de_escribir1');
    await page.waitForSelector(selectorInput, { visible: true });
     await tomarScreenshot(page, userId, 'recarga1_despues_de_numero');
    // Ejecución forzada en el DOM
    await page.evaluate((sel, num) => {
        const input = document.querySelector(sel);
        input.value = '';
        input.focus();
        input.value = num;
        // Disparar eventos necesarios para JSF/PrimeFaces
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
    }, selectorInput, String(numero));

    // Refuerzo: Escribir caracteres si lo anterior no bastó
    await page.click(selectorInput);
    await page.type(selectorInput, String(numero), { delay: 100 });
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 2000));

    // 6. Clic Validar
    const selectorBoton = '#formDatosCliente\\:displayLinea3 button[id*="j_id_"]';
    await page.waitForSelector(selectorBoton, { visible: true });
    await page.click(selectorBoton);
    await new Promise(r => setTimeout(r, 4000));

    // 7. Análisis de Resultados
    const resultados = await page.evaluate(() => {
        const getVal = (labelId) => {
            const label = document.querySelector(`label[for="${labelId}"]`);
            if (!label) return "N/A";
            const td = label.parentElement.nextElementSibling;
            return td ? td.innerText.trim() : "N/A";
        };
        return {
            fecha: getVal('formDatosCliente:acordion:fechaActivacion'),
            registrado: getVal('formDatosCliente:acordion:tagClienteAutenticado'),
            estatus: getVal('formDatosCliente:acordion:estatus'),
            fechaPrimerEvento: getVal('formDatosCliente:acordion:primerEvento')
        };
    });

    // 8. Lógica de Respuesta
    let respuesta = { fecha: resultados.fecha, registrado: resultados.registrado, mensaje: "", tipoAccion: "" };

    if (resultados.estatus === "ACTIVO" && resultados.registrado === "SI") {
        await recarga1(page, numero, userId);
        respuesta.mensaje = "Línea ACTIVA y Registrada. Recarga 1 aplicada.";
        respuesta.tipoAccion = "YA_TIENE_SALDO";
    } else if (resultados.registrado === "SI" && resultados.fechaPrimerEvento === "No Info") {
        await recarga1(page, numero, userId);
        respuesta.mensaje = "Registro correcto. Se envió recarga de activación.";
        respuesta.tipoAccion = "RECARGA_ENVIADA";
    } else if (resultados.registrado === "NO") {
        await recarga2(page, numero, userId);
        respuesta.mensaje = "⚠️ LÍNEA SIN REGISTRO. Se envió Recarga 2.";
        respuesta.tipoAccion = "PENDIENTE_REGISTRO";
    } else {
        respuesta.mensaje = "Estado no reconocido.";
        respuesta.tipoAccion = "SIN_ACCION";
    }

    return { status: 'success', data: respuesta };
}


app.post('/api/ejecutar-accion', async (req, res) => {
    const { userId, numero, tipo } = req.body;
   

// VALIDACIÓN CRÍTICA: ¿El número llegó vacío?
    if (!numero || numero.trim() === '') {
        return res.status(400).json({ status: 'error', message: "El número de línea no fue recibido por el servidor." });
    }

    console.log(`📥 [API] Recibido número: ${numero} para el usuario ${userId}`);

    try {
     const sesion = await verificarSesion(userId); 
        
        // 2. Si verificarSesion ya te devuelve una página lista, úsala.
        // Si necesitas una NUEVA página, extráela del browser que está en 'sesion'
        const page = sesion; // Asumiendo que verificarSesion devuelve la page
        
        // 3. Guardamos el número en la "mochila" de la página
        page.datosPendientes = numero;
        await ejecutarLoginTelcel(page, userId, usuario, password, region);
        
        let resultado = { status: 'success', message: 'Acción realizada' };

        if (tipo === 'RECARGA') {
            // Capturamos el resultado del análisis
            resultado = await hacerClicEnDatosLinea(page, userId, numero);
        } else {
            // ... otros casos
        }
        
        // Enviamos el mensaje procesado al frontend
        return res.json({ 
    status: 'success', 
    message: resultado.data.mensaje, // Para el alert o notificaciones
    data: resultado.data             // Para que el frontend pinte la tabla
});


async function ejecutarRecarga(page, userId) {
    try {
        console.log(`⚡ [API] Ejecutando acción de Recarga...`);
        await page.evaluate(() => {
            const btn = document.querySelector('#button_charge');
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 2000));
        
        return "Recarga enviada";
    } catch (error) {
        console.error(`❌ [API] Error en Recarga:`, error);
        return "Error al enviar recarga";
    }
}




    } catch (error) {
        return res.status(500).json({ status: 'error', message: error.message });
    }
});





async function recarga1(page, numero, userId) {
    console.log(`⚡ [Recarga1] Iniciando proceso para: ${numero}`);

    try {
        // 1. Navegación
        await page.goto('https://force.mmoviles.com/public/autorecarga', { waitUntil: 'networkidle2' });

        // 2. Campo de número
        const selectorInput = '#telefono_info';
        await page.waitForSelector(selectorInput, { visible: true, timeout: 15000 });
        
        await page.evaluate((sel, num) => {
            const input = document.querySelector(sel);
            input.value = num;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, selectorInput, numero);

        // 3. Buscar
        await page.click('#button_info');
        await tomarScreenshot(page, userId, 'recarga1_despues_de_buscar');

        // 4. NUEVO: Esperar y hacer clic en Recargar
        // Damos tiempo a que el portal responda a la búsqueda
        console.log("🖱️ [Recarga1] Esperando botón Recargar...");
        const selectorRecargar = '#button_charge';
        
        // Esperamos hasta 10 segundos a que el botón aparezca y sea clickeable
        await page.waitForSelector(selectorRecargar, { visible: true, timeout: 10000 });
        
        // Clic en Recargar
        await page.click(selectorRecargar);
        
        // 5. Captura final tras el clic en Recargar
        await new Promise(r => setTimeout(r, 2000)); // Esperar respuesta del servidor
        await tomarScreenshot(page, userId, 'recarga1_final_recargado');

        console.log(`✅ [Recarga1] Proceso de recarga finalizado para ${numero}`);
        return true;

    } catch (error) {
        console.error(`❌ [Recarga1] Error:`, error);
        await tomarScreenshot(page, userId, 'recarga1_error_final');
        throw new Error("No se pudo completar la recarga1: " + error.message);
    }
}



async function recarga2(page, numero) {
    console.log(`⚡ Ejecutando recarga2 para: ${numero}`);
    // Aquí iría tu lógica de Puppeteer para hacer clic en el botón de recarga
    // Ejemplo: await page.click('#botonRecarga');
    return true;
}




// 📱 MÓDULO: REGISTRO DE LÍNEA

app.post('/api/registro-linea', async (req, res) => {
   const { numero, userId } = req.body;
    console.log(`[DEBUG] 1. Solicitud recibida para registro: ${numero} (User: ${userId})`);
    sesiones.get(userId).ultimaActividad = Date.now();
    try {        const page = await obtenerSesionCompleta(userId);
        
        // CORRECCIÓN: Hazlo solo una vez con la estructura correcta
        sesiones.set(userId, { 
            pageForce: page, 
            ultimaActividad: Date.now() 
        });
        
        console.log(`✅ [DEBUG] Sesión guardada correctamente en el Map para: ${userId}`);console.log(`[DEBUG] Sesión guardada en el Map para el usuario: ${userId}`); // guarda sesion para token y qr
        
        await ejecutarLoginTelcel(page, userId, usuario, password, region);
        
        // 3. Ahora que el login está garantizado, procedemos con tu lógica de registro
        console.log(`🚀 Iniciando Registro de Línea para: ${numero}`);
        if (!page) {
            console.log(`[DEBUG] 2. ERROR CRÍTICO: La sesión devuelta es null/undefined.`);
            return res.status(500).json({ status: 'error', message: 'Sesión no encontrada' });
        }
        console.log(`[DEBUG] 2. Sesión recuperada correctamente.`);

        // Agregamos un log de página para verificar si la página está viva
        const urlActual = await page.url();
        console.log(`[DEBUG] 3. El navegador está en: ${urlActual}`);

        // 1. Clic en el menú
        console.log(`[DEBUG] 4. Intentando buscar menú...`);
        await page.evaluate(() => {
            const elementos = Array.from(document.querySelectorAll('.ui-menuitem-text, a'));
            const objetivo = elementos.find(el => el.textContent && el.textContent.includes('Registro de clientes BES'));
            if (objetivo) {
                console.log("[DEBUG] 5. Menú encontrado, haciendo clic...");
                objetivo.scrollIntoView();
                objetivo.click();
            } else {
                console.log("[DEBUG] 5. ERROR: No se encontró el menú en el DOM actual.");
            }
        });

        await new Promise(r => setTimeout(r, 3000));
        await tomarScreenshot(page, userId, 'tras_clic_menu_registro');

        // 2. Ingreso del número y clic en botón (Validar)
        const operacionExitosa = await page.evaluate((num) => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            const visibleInput = inputs.find(i => i.offsetParent !== null && !i.disabled);
            
            if (visibleInput) {
                visibleInput.value = num;
                visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
                visibleInput.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Clic en el botón. Asegúrate de que el selector sea el correcto.
                // Si el botón no se llama .ui-button, cámbialo por el selector real.
                document.querySelector('button.ui-button')?.click();
                return true;
            }
            return false;
        }, numero);

        if (!operacionExitosa) throw new Error("No se encontró el campo de texto para ingresar el número.");

        await new Promise(r => setTimeout(r, 2000));
        await tomarScreenshot(page, userId, 'tras_clic_validar_registro');
        
        // 3. Respuesta de Éxito indicando que se espera Token
        res.json({ 
            status: 'success', 
            data: { 
                mensaje: "Número enviado. Por favor, ingresa el token recibido.",
                requiereToken: true 
            } 
        });
        
    } catch (error) {
        console.error("❌ Error en registro:", error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});


const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));


app.post('/api/confirmar-token', async (req, res) => {
    const { token, userId } = req.body;
    const sesion = sesiones.get(userId);
    const paginaGlobal = sesion?.pageForce;

    if (!paginaGlobal || paginaGlobal.isClosed()) {
        return res.status(412).json({ status: 'error', message: 'Sesión expirada.' });
    }

    // Configuración SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    try {
        // 1. Ingreso de Token
        send({ message: "Ingresando Token...", percent: 25 });
        await sleep(1000);
        await paginaGlobal.waitForSelector('#formRegistro\\:token', { timeout: 10000 });
        await paginaGlobal.evaluate(() => document.getElementById('formRegistro:token').value = '');
        await paginaGlobal.keyboard.type(token, { delay: 150 });
        await paginaGlobal.click('#formRegistro\\:j_id_2y');

        // 2. Esperar el Modal
        send({ message: "Confirmando en servidor...", percent: 50 });
        await paginaGlobal.screenshot({ path: path.join(screenshotsDir, `${userId}_error_modal.png`) });
        sesiones.get(userId).ultimaActividad = Date.now();

        await paginaGlobal.waitForSelector('#modalABE', { visible: true, timeout: 20000 });

        // 3. PAUSA ESTABLE CON LATIDO (Para evitar Network Error)
        send({ message: "Generando QR (esto puede tomar un momento)...", percent: 70 });
        
        for (let i = 0; i < 50; i++) {
            await sleep(1000);
            if (i % 10 === 0 && i > 0) {
                send({ message: `Aún trabajando... (${50 - i}s restantes)`, percent: 70 + (i / 5) });
            }
        }

        // 4. Captura
        if (paginaGlobal.isClosed()) throw new Error("La sesión se perdió durante la espera.");
        
        send({ message: "Capturando pantalla...", percent: 85 });
        const nombreImagen = `${userId}_qr.png`;
        const rutaImagen = path.join(screenshotsDir, nombreImagen);
        
        const elementoModal = await paginaGlobal.$('#modalABE');
        if (!elementoModal) throw new Error("No se encontró el modal del QR.");
        
        await elementoModal.screenshot({ path: rutaImagen });

        // 5. Lector QR
        send({ message: "Procesando código QR...", percent: 95 });
        const imagenCargada = await Jimp.read(rutaImagen);
        const { width, height, data } = imagenCargada.bitmap;
        const codigoQr = jsQR(data, width, height);

        // Respuesta final
        send({
            message: "¡Completado!",
            percent: 100,
            status: 'success',
            qrUrl: `/screenshots/${nombreImagen}`,
            directUrl: codigoQr ? codigoQr.data : "No detectado"
        });
        res.end();

    } catch (error) {
        console.error("❌ Error en confirmar-token:", error);
        // Enviamos el error al cliente antes de cerrar
        send({ status: 'error', message: error.message });
        res.end();
    }
});



app.listen(PORT, () => console.log(`Servidor activo en puerto ${PORT}`));
// Limpiador automático: Ejecuta cada 10 minutos

