const API_URL = '';

// --- UTILIDADES BÁSICAS ---
function controlarSpinner(mostrar) {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = mostrar ? 'flex' : 'none';
}

function resetUI() {
    const btn = document.getElementById('btnValidar');
    const loader = document.getElementById('loader');
    if (btn) btn.disabled = (document.getElementById('numInput').value.length !== 10);
    if (loader) loader.style.display = 'none';
}

function obtenerIdUsuario() {
    // Ajuste: intenta obtenerlo de una variable global o cookie si existe
    return localStorage.getItem('userId') || null;
}

// --- VALIDACIÓN INICIAL ---
const numInput = document.getElementById('numInput');
const btnValidar = document.getElementById('btnValidar');

if (numInput && btnValidar) {
    numInput.addEventListener('input', () => {
        btnValidar.disabled = (numInput.value.length !== 10);
    });
}

// --- FUNCIÓN PRINCIPAL DE CONSULTA ---
// --- FUNCIÓN PRINCIPAL DE CONSULTA (CON LOGS DE DEPURACIÓN) ---
async function validarforce() {
    const input = document.getElementById('numInput');
    const btn = document.getElementById('btnValidar');
    const alertBox = document.getElementById('alertBox');
    const loader = document.getElementById('loader');

    if (!input.value) {
        alert("Ingresa un número.");
        return;
    }

    // Preparación de UI
    btn.disabled = true;
    loader.style.display = 'block';
    alertBox.style.display = 'block';
    alertBox.innerHTML = "⏳ Enviando tarea al sistema...";

    // 1. Obtener Token y verificar URL
    const token = localStorage.getItem('token');
    const url = `${API_URL}/api/solicitar-consulta`;
    
    console.log("🔍 [DEBUG] Iniciando validarforce");
    console.log("🔍 [DEBUG] API_URL:", API_URL);
    console.log("🔍 [DEBUG] Token presente:", !!token);
    console.log("🔍 [DEBUG] Haciendo POST a:", url);

    try {
        // 2. Realizar la petición Fetch
        const res = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token 
            },
            body: JSON.stringify({ 
                numero: input.value, 
                portal: 'FORCE', 
                tipo: 'RECARGA' 
            })
        });

        console.log("🔍 [DEBUG] Estado HTTP recibido:", res.status);

        // 3. Leer respuesta cruda para depuración
        const textoRespuesta = await res.text();
        console.log("🔍 [DEBUG] Cuerpo respuesta (Raw):", textoRespuesta);

        let data;
        try {
            data = JSON.parse(textoRespuesta);
        } catch (e) {
            console.error("❌ [ERROR] No es JSON. ¿El servidor devolvió un error HTML?");
            throw new Error("Respuesta inválida del servidor. Revisa la consola.");
        }

        if (!res.ok) {
            throw new Error(data.error || `Error ${res.status}: Fallo en la solicitud.`);
        }

        // 4. Si es exitoso, iniciar polling
        console.log("✅ [DEBUG] Solicitud exitosa. ID Tarea:", data.tareaId);
        alertBox.innerHTML = "✅ Solicitud #" + data.tareaId + ". Procesando...";

        const intervalo = setInterval(async () => {
            try {
                const urlCheck = `${API_URL}/api/verificar-estado/${data.tareaId}`;
                console.log("🔍 [DEBUG] Consultando estado en:", urlCheck);
                
                const check = await fetch(urlCheck, {
                    headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
                });
                
                const resCheck = await check.json();
                console.log("🔍 [DEBUG] Estado recibido:", resCheck);

                if (resCheck.estado === 'RECARGA_PENDIENTE_REGISTRO' || resCheck.estado === 'COMPLETADO') {
                    clearInterval(intervalo);
                    procesarResultadoExitoso(resCheck.resultado);
                    resetUI();
                } else if (resCheck.estado === 'ERROR') {
                    clearInterval(intervalo);
                    alertBox.innerHTML = "❌ Error en el proceso: " + (resCheck.mensaje || "Desconocido");
                    resetUI();
                }
            } catch (err) { 
                console.error("❌ [ERROR] Polling fallido:", err); 
            }
        }, 2000);

    } catch (e) {
        console.error("❌ [ERROR] Capturado en validarforce:", e);
        alertBox.innerHTML = "❌ " + e.message;
        
        // Resetear botones solo si ocurrió un error
        btn.disabled = false;
        loader.style.display = 'none';
    }
}
function procesarResultadoExitoso(resultado) {
    if (resultado && resultado.iccid) {
        document.getElementById('panelConsulta').style.display = 'none';
        document.getElementById('panelAcciones').style.display = 'block';
        document.getElementById('iccidResult').innerText = "ICCID: " + resultado.iccid;
        document.getElementById('campoNumero').value = document.getElementById('numInput').value;
    } else {
        document.getElementById('alertBox').innerHTML = `<div style='color:orange;'>⚠️ No se obtuvo ICCID.</div>`;
    }
    resetUI();
}

// --- ACCIONES DE BOTON (RECARGA / BIOMÉTRICOS) 
// --------------------------------------------- REVISADA
async function ejecutarAccion(tipo, event) {
    const btnPresionado = event.target;
    const campoNumero = document.getElementById('campoNumero');
    const todosLosBotones = document.querySelectorAll('button');
    
    // Bloqueo de UI
    todosLosBotones.forEach(b => b.disabled = true);
    const textoOriginal = btnPresionado.innerHTML;
    btnPresionado.innerHTML = ` Procesando...`;

    try {
        const res = await fetch(`${API_URL}/api/solicitar-consulta`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token') 
            },
            body: JSON.stringify({ 
                numero: campoNumero.value, 
                portal: 'TELCEL', 
                tipo: tipo 
            })
        });
        
        const data = await res.json();

        // CORRECCIÓN AQUÍ: 
        // 1. Verificamos si la tarea se creó (usando tareaId)
        // 2. Pasamos tareaId a los vigilantes, SIN IMPORTAR EL TIPO
        if (res.ok && (data.success || data.tareaId)) {
            console.log("Tarea iniciada con ID:", data.tareaId);
            
            // TODOS los procesos deben monitorearse por su ID de tarea
            if (tipo === 'BIOMETRICOS') {
                activarVigilante(data.tareaId);
            } else {
                // CORRECCIÓN: Antes enviabas el número, ahora envías el ID
                vigilanteRecarga(data.tareaId); 
            }
        } else {
            alert("❌ Error: " + (data.error || "No se pudo procesar la solicitud"));
        }

    } catch (error) {
        console.error("Error crítico:", error);
        alert("❌ Error de conexión con el servidor.");
    } finally {
        todosLosBotones.forEach(b => b.disabled = false);
        btnPresionado.innerHTML = textoOriginal;
    }
}

// --- VIGILANTES DE ESTADO --- REVISADA// --- VIGILANTE DE RECARGAS ---

// --- ------------------>ESTE ES VIGILANTE DE 1ER CONSULTA<--------------------


// --- VIGILANTE DE RECARGAS FINAL ---
function vigilanteRecarga(tareaId, btnElement) {
    const divRes = document.getElementById('resultadoAccion');
    const todosLosBotones = document.querySelectorAll('button');
    
    if (!divRes) return;
    
    // 1. Bloqueo de UI (Procesando...)
    todosLosBotones.forEach(b => b.disabled = true);
    if (btnElement) {
        btnElement.dataset.originalText = btnElement.innerHTML;
        btnElement.innerHTML = "⌛ Procesando...";
    }
    
    divRes.style.display = 'block';
    divRes.innerHTML = `<p>⌛ Consultando estado de tarea #${tareaId}...</p>`;
    
    if (window.timerRecarga) clearInterval(window.timerRecarga);
    
    window.timerRecarga = setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}/api/estado-tarea-ACT/${tareaId}`, {
                headers: { 
                    'Authorization': 'Bearer ' + localStorage.getItem('token'),
                    'Content-Type': 'application/json'
                }
            });

            const data = await res.json();

            // Seguimos esperando
            if (data.estado === 'PENDIENTE' || data.estado === 'PROCESANDO') {
                divRes.innerHTML = `<p>⌛ Procesando estado: <b>${data.estado}</b>...</p>`;
                return; 
            }

            // --- FINALIZACIÓN ---
            clearInterval(window.timerRecarga);
            todosLosBotones.forEach(b => b.disabled = false);
            if (btnElement) btnElement.innerHTML = btnElement.dataset.originalText;
            
            if (data.estado === 'ERROR') {
                divRes.innerHTML = `<p style='color:red'>❌ Error: ${data.resultado || 'Desconocido'}</p>`;
                return;
            }

            if (data.estado === 'COMPLETADO') {
    
                // --- DEBUG CRÍTICO ---
    
    console.log("DEBUG: Objeto completo recibido:", data);
    console.log("DEBUG: linea_registrada es:", data.linea_registrada);
    console.log("DEBUG: fecha_recarga es:", data.fecha_recarga);
    
    // ---------------------

    const esErrorSistema = (data.linea_registrada === null && data.fecha_recarga === null);
    
    divRes.innerHTML = `
        <div class="resultado-exito" style="border: 2px solid red; padding: 10px;">
            <h3>DEBUG DE DATOS</h3>
            <p>Raw Linea: ${data.linea_registrada}</p>
            <p>Raw Fecha: ${data.fecha_recarga}</p>
            <hr>
            <h3>RESULTADO</h3>
            <p>${esErrorSistema ? "⚠️ Error: Inconsistencia detectada en BD." : "Datos procesados correctamente."}</p>
        </div>`;
}
        } catch (err) { 
            console.error("Error en el vigilante:", err);
            todosLosBotones.forEach(b => b.disabled = false);
        }
    }, 2000);
}
//-- Función auxiliar 1: Se ejecuta cuando Línea=SI y Fecha=NO

async function Recarga_aux1(numero) {
    console.log(`🚀 Ejecutando Recarga_aux1 para: ${numero}`);
    alert(`Ejecutando proceso automático: Recarga_aux1 para ${numero}`);
}


//-- Función auxiliar 2: Se ejecuta cuando Línea=NO y Fecha=NO

async function Recarga_aux2(numero) {
    console.log(`🚀 Ejecutando Recarga_aux2 para: ${numero}`);
    alert(`Ejecutando proceso automático: Recarga_aux2 para ${numero}`);
}
//---------------------------------->INICIA BIOMETRICOS<----------------
//---------------------------------->INICIA BIOMETRICOS<----------------
//---------------------------------->INICIA BIOMETRICOS<----------------
//---------------------------------->INICIA BIOMETRICOS<----------------
//---------------------------------->INICIA BIOMETRICOS<----------------



let vigilanteToken = null;
let estadoUltimoFormulario = null;
let ultimoMensajeError = null;

function activarVigilante(tareaId) {
    // 1. Bloqueo inicial de UI
    const botones = document.querySelectorAll('button');
    botones.forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
    });

    const divRes = document.getElementById('resultadoAccion');
    divRes.style.display = 'block';
    divRes.innerHTML = `
        <div class="loader-container">
            <div class="spinner-pro"></div>
            <p class="loader-text">Iniciando validación...</p>
        </div>
    `;

    if (vigilanteToken) clearInterval(vigilanteToken);

    vigilanteToken = setInterval(async () => {
        try {
            const checkRes = await fetch(`${API_URL}/api/estado-tarea/${tareaId}?t=${Date.now()}`, {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
            });

            if (!checkRes.ok) return;

            const data = await checkRes.json();
            const item = Array.isArray(data) ? data[0] : data;
            
            console.log("Vigilante Debug - Estado actual:", item.estado);

            // A. FALLO EN LA EXTRACCIÓN DEL QR (Requiere reintento técnico)
            if (item.estado === 'FALLO_EXTRACCION') {
                if (estadoUltimoFormulario !== 'FALLO_EXTRACCION') {
                    mostrarErrorReintento(tareaId, item.resultado || "Error al extraer QR.");
                    estadoUltimoFormulario = 'FALLO_EXTRACCION';
                }
            } 
            // B. ESPERA DE TOKEN (Token inicial o Fallo de Token previo)
            else if (item.estado === 'ESPERANDO_USER' || item.estado === 'FALLO_TOKEN') {
                const mensaje = item.estado === 'FALLO_TOKEN' ? (item.resultado || "Token incorrecto.") : "";
                if (estadoUltimoFormulario !== item.estado || !document.getElementById('inputToken')) {
                    mostrarFormularioToken(tareaId, mensaje);
                    estadoUltimoFormulario = item.estado;
                }
            }
            // C. VALIDANDO TOKEN (Feedback de espera)
            else if (item.estado === 'VALIDANDO_TOKEN') {
                if (estadoUltimoFormulario !== 'VALIDANDO_TOKEN') {
                    document.getElementById('resultadoAccion-token').innerHTML = `
                    <div class="popup-overlay"><div class="card" style="padding:20px; text-align:center;">
                        <div class="spinner-pro"></div><p><b>Validando token...</b></p>
                    </div></div>`;
                    estadoUltimoFormulario = 'VALIDANDO_TOKEN';
                }
            }
           // D. GENERANDO QR (El Worker está trabajando en la extracción)
else if (item.estado === 'GENERANDO_QR') {
    if (estadoUltimoFormulario !== 'GENERANDO_QR') {
        document.getElementById('resultadoAccion-token').innerHTML = `
        <div class="popup-overlay">
            <div class="card" style="padding:20px; text-align:center; border: 2px solid #27ae60;">
                <p><b>Token verificado correctamente.</b></p>
                <p>El sistema está listo. Presiona el botón para generar el QR de vinculación.</p>
                <button onclick="confirmarGeneracion('${tareaId}')" 
                        style="background: #27ae60; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">
                    ✅ CONTINUAR Y GENERAR QR
                </button>
            </div>
        </div>`;
        estadoUltimoFormulario = 'GENERANDO_QR';
    }
}
// E. FALLO EN LA EXTRACCIÓN DEL QR (El Worker falló, el usuario debe reintentar)
else if (item.estado === 'FALLO_EXTRACCION') {
    if (estadoUltimoFormulario !== 'FALLO_EXTRACCION') {
        mostrarErrorReintento(tareaId, item.resultado || "Error al extraer QR.");
        estadoUltimoFormulario = 'FALLO_EXTRACCION';
    }
}
// F. ENVIANDO QR (Éxito)
else if (item.estado === 'ENVIANDO_QR') {
    detenerVigilante();
    estadoUltimoFormulario = 'ENVIANDO_QR';
    renderizarQR(item); // Tu función existente
}
// G. ESTADO DE ERROR (Error desconocido o fuera de servicio)
else if (item.estado === 'ERROR') {
    if (estadoUltimoFormulario !== 'ERROR') {
        document.getElementById('resultadoAccion-token').innerHTML = `
        <div class="popup-overlay">
            <div class="card" style="padding:20px; text-align:center; border: 2px solid #e74c3c;">
                <h3 style="color: #e74c3c;">⚠️ ERROR DESCONOCIDO</h3>
                <p>INTENTE EN 5 MINUTOS...</p>
                <button onclick="window.location.reload()" 
                        style="background: #e74c3c; color: white; padding: 10px 20px; border: none; border-radius: 5px; cursor: pointer; margin-top: 10px;">
                    RECARGAR PÁGINA
                </button>
            </div>
        </div>`;
        estadoUltimoFormulario = 'ERROR';
    }
}



            
        } catch (err) {
            console.error("Error en vigilancia:", err);
        }
    }, 2000);
}

async function confirmarGeneracion(tareaId) {
    // Feedback visual
    document.getElementById('resultadoAccion-token').innerHTML = `
    <div class="popup-overlay">
        <div class="card" style="padding:20px; text-align:center;">
            <div class="spinner-pro"></div>
            <p>Generando QR...</p>
        </div>
    </div>`;

    try {
        // Enviamos al servidor para que el Worker cambie de estado a 'PROCESANDO' 
        // y ejecute la función manejarQR
        const res = await fetch(`${API_URL}/api/reintentar`,{
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token') 
            },
            body: JSON.stringify({ tareaId })
        });

        if (!res.ok) throw new Error("Error al iniciar la generación");
        
    } catch (error) {
        console.error("Error:", error);
        alert("No se pudo iniciar la generación, intenta de nuevo.");
    }
}




// --- FUNCIONES DE TOKEN Y UI --- REVISADO
function mostrarFormularioToken(tareaId, mensajeError = "") {
    const divRes = document.getElementById('resultadoAccion-token');
    divRes.style.display = 'block';
    
    // Si hay error, el borde es rojo. Si no, verde.
    const borderColor = mensajeError ? '#ff4d4d' : '#40e0b8';
    const htmlError = mensajeError ? `<p style="color:red; font-weight:bold;">❌ ${mensajeError}</p>` : "";

    // IMPORTANTE: El ID 'boxToken' debe ser reemplazado completamente
    divRes.innerHTML = `
    <div class="popup-overlay">
        <div id="boxToken" class="card" style="border: 2px solid ${borderColor}; padding: 15px;">
            <p>✅ <b>SMS Enviado.</b>  Ingresa el código:</p>
            ${htmlError}
            <input type="text" id="inputToken" placeholder="🔐 000000">
            <button onclick="enviarToken('${tareaId}')">🔑 Enviar Token</button>
        </div>
    </div>
    `;
}


async function reintentarAccion(tareaId) {
    // Feedback visual inmediato
    document.getElementById('resultadoAccion-token').innerHTML = `
    <div class="popup-overlay">
        <div class="card" style="padding: 20px;">
            <div class="spinner-pro"></div>
            <p>Solicitando nuevo intento...</p>
        </div>
    </div>`;

    try {
        // Asegúrate de que este endpoint /api/reintentar en tu back 
        // realice el cambio de estado en la BD a 'REINTENTAR_QR'
        const res = await fetch(`${API_URL}/api/reintentar`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token') 
            },
            body: JSON.stringify({ tareaId })
        });

        if (!res.ok) throw new Error("Error al solicitar reintento");
        
        // No cerramos el vigilante, él detectará el cambio de estado a 'GENERANDO_QR'
    } catch (error) {
        console.error("Error en reintento:", error);
        alert("Error de conexión. Inténtalo de nuevo.");
    }
}

function mostrarErrorReintento(tareaId, mensajeError) {
    const divRes = document.getElementById('resultadoAccion-token');
    divRes.style.display = 'block';
    divRes.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(5px); display: flex; justify-content: center; align-items: center; z-index: 9999;">
        <div class="card" style="border: 2px solid #ff4d4d; padding: 15px; text-align: center; background: white; border-radius: 10px;">
            <p style="color:red; font-weight:bold;"> ✅ ERROR: ¡El token SÍ es válido!</p>
            <strong>FALLO EN SERVIDOR...</strong> 
            <br> Reintente en 30 segundos. <br><br>
            Si el problema persiste <strong>Comunícatec*</strong><BR> con tu Asesor de Ventas <br>
            <br> ⚠️ o reinicie la consulta en 5 minutos...
            <br><br>
            <button onclick="reintentarAccion('${tareaId}')" style="background-color: #197fecd5; color: white; padding: 10px; border: none; cursor: pointer; border-radius: 5px;">
              ✅ PRESIONE PARA REINTENTAR
            </button><BR><BR>
        </div>
    </div>`;
}

async function enviarToken(tareaId) {
    const token = document.getElementById('inputToken')?.value;
    const authToken = localStorage.getItem('token');

    // 1. Validaciones previas
    if (!token) {
        alert("Por favor, ingresa el código.");
        return;
    }

    // 2. Feedback visual (Tu estilo original)
    document.getElementById('boxToken').parentElement.innerHTML = `
    <div style="
        position: fixed; 
        top: 0; left: 0; width: 100%; height: 100%; 
        background: rgba(0,0,0,0.4); 
        backdrop-filter: blur(5px); 
        display: flex; 
        justify-content: center; 
        align-items: center; 
        z-index: 9999;">
        
        <div class="card" style="border: 2px solid #40e0b8; padding: 15px; background: white; border-radius: 10px;">
             <div class="spinner-pro"></div>
        <p> Enviando SMS token... Preparando Vinculación...</p>
        </div>
    </div>`;

    // 3. Petición al servidor con autenticación
    try {
        const res = await fetch(`${API_URL}/api/enviar-token`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken 
            },
            body: JSON.stringify({ tareaId, token })
        });
        
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
            throw new Error(data.message || "Error al enviar el token");
        }

        // 4. Éxito
        document.getElementById('resultadoAccion-token').innerHTML = "<p>Token enviado con éxito.</p>";

    } catch (error) {
        console.error("Error en la petición de token:", error);
        alert("Error: " + error.message);
        // Opcional: podrías recargar el formulario aquí si falla
    }
}


function detenerVigilante() {
    if (vigilanteToken) { 
        clearInterval(vigilanteToken); 
        vigilanteToken = null; 
    }
}

function renderizarQR(item) {
    const contenedor = document.getElementById('resultadoAccion-token');
    if (!contenedor) return;

                const linkExtraido = item.link_final || "NO_DATA";
                const linkLimpio = linkExtraido.replace(/&amp;/g, '&');
                const numeroMostrado = item.numero || "Sin número";

    // 2. Insertar el HTML
    contenedor.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); backdrop-filter: blur(5px); display: flex; justify-content: center; align-items: center; z-index: 9999;">
        <div id="boxToken" class="card" style="border: 5px solid #0d0b4d; padding: 20px; background: white; border-radius: 10px; max-width: 90%; width: 360px; text-align: center;">
            <img src="logo.png" alt="Logo" style="width:40%; margin-bottom: 1px;"><br>
            <p style="color: #0d0b4d; font-weight: bold; margin-bottom: 1px;">✅ Vinculación Express lista.</p>
<h3>Número:${numeroMostrado}</h3>
            <div id="qrcode" style="margin: 10px auto; display: flex; justify-content: center;"></div>
            
            <p style="font-size: 13px;">Recuerda tener a la mano tu<br> Identificación Oficial Vigente para su escaneo.</p>

            <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 15px; align-items: center;">
                <a href="${linkLimpio}" target="_blank" style="padding: 12px; width: 80%; background: #0d0b4d; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-weight: bold;">
                    📱 CONTINUAR AQUÍ
                </a>
                
                <div style="display: flex; width: 85%; gap: 10px;">
                    
                    <a href="/API" style="flex: 1; padding: 12px; background: #45728e; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        ❌ CERRAR
                    </a>
                </div>
            </div>

            <div style="margin-top: 15px; font-size: 16px; background: #f8f9fa; padding: 8px; border: 1px solid #ddd; text-align: center;">
                <H1>🚨📩</H1><H4><p style="margin: 0 0 5px 0;">2. RECIBIRA UN SMS<br> CONFIRMANDO SU REGISTRO </p></H4>
                <H4><p style="margin: 0 0 5px 0;">3. SOLICITA TU RECARGA UNA VEZ CONFIRMADO</p></H4>
            </div>
        </div>
    </div>`;


    // -- > AQUI ESTA EL BOTON PARA PEDIR LA RECARGA <button onclick="ejecutarAccion('RECARGA', event)" style="flex: 1; padding: 12px; background: #33566b; color: white; border: none; border-radius: 5px; font-weight: bold; cursor: pointer;"> 
    // 🔄 RECARGAR   </button>

    // 3. Generar el QR después de que el elemento exista en el DOM
    if (typeof QRCode !== 'undefined') {
        new QRCode(document.getElementById("qrcode"), {
            text: linkLimpio,
            width: 200,
            height: 200,
            colorDark: "#000000",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.L
        });
    } else {
        console.error("Librería QRCode no cargada.");
    }
}

//---------------------------------->TERMINA BIOMETRICOS<----------------
//---------------------------------->TERMINA BIOMETRICOS<----------------
//---------------------------------->TERMINA BIOMETRICOS<----------------
//---------------------------------->TERMINA BIOMETRICOS<----------------
//---------------------------------->TERMINA BIOMETRICOS<----------------




//------------------------------------------------
//------------------------------------------------ REVISADA
//------------------------------------------------
let promesaUsuario = null;
let ID_USUARIO_ACTUAL = null;
//-- parte de validarforce

async function cargarIdUsuario() {
    try {
        const token = localStorage.getItem('token');
        if (!token) throw new Error("Token no encontrado en localStorage");

        const res = await fetch(`${API_URL}api/auth/me`, { 
            headers: { 'Authorization': 'Bearer ' + token }
        });

        // IMPORTANTE: Aquí está el truco para ver qué pasó
        if (!res.ok) {
            const errorText = await res.text(); // Capturamos el error real del servidor
            throw new Error(`Servidor respondió con ${res.status}: ${errorText}`);
        }

        const data = await res.json();
        if (data.success) return data.id;
        
        throw new Error("Respuesta no exitosa: " + JSON.stringify(data));
        
    } catch (e) {
        // Ahora sí verás el motivo real en la consola
        console.error("❌ [cargarIdUsuario] Fallo al obtener ID:", e.message);
        return null; 
    }
cargarIdUsuario();

function obtenerIdUsuario() {
    return ID_USUARIO_ACTUAL;
}

let pollerActivo = null;


// REVISADO 
async function inicializar_sistema() {
    try {
        const respuesta = await fetch('ciudades.js');
        const texto = await respuesta.text();
        const jsonText = texto.replace(/module\.exports\s*=\s*/, '').replace(/;/g, '').trim();
        window.datos_ciudades_sistema = new Function('return ' + jsonText)();
    } catch (e) {
        window.datos_ciudades_sistema = { "ACAPULCO DE JUAREZ, GRO": "7127032000" };
    }
    const lista = document.getElementById('lista_ciudades_mexico');
    if (lista) {
        Object.keys(window.datos_ciudades_sistema).forEach(ciudad => {
            const opt = document.createElement('option'); opt.value = ciudad; lista.appendChild(opt);
        });
    }
}
//-- REVISADO
function mostrarLoader(msg) {
    const contenedor = document.getElementById('contenedor_campos_dinamicos');
    if (contenedor) {
        contenedor.innerHTML = `<div style="display: flex; justify-content: center;">
            <div class="loader_sipner_act_individual_container">
                <div class="loader_sipner_act_individual_outer"></div>
                <div class="loader_sipner_act_individual_inner"></div>
            </div>
        </div>
        <h3>${msg}</h3><div class="loader-radial"></div></div>`;
    }
    const botones = document.getElementById('area_botones_modal');
    if (botones) botones.style.display = 'none';
}


//-- REVISADO
function cerrar_modal() {
    if (pollerActivo) {
        clearInterval(pollerActivo);
        pollerActivo = null;
    }
    document.getElementById('overlay_activador_comunicatec').style.display = 'none';
    document.getElementById('modal_activador_chip').style.display = 'none';
}
//-- REVISADO
function abrir_modal_activacion(tipo) {
    document.getElementById('overlay_activador_comunicatec').style.display = 'block';
    document.getElementById('modal_activador_chip').style.display = 'block';
    document.getElementById('area_botones_modal').style.display = 'block';
    const cont = document.getElementById('contenedor_campos_dinamicos');
    const tit = document.getElementById('titulo_modal_proceso');
    if (tipo === 'FISICA') {
        tit.innerText = "Activando SIM Física";
        cont.innerHTML = '<input type="text" id="input_iccid_chip" placeholder="ICCID (19 dígitos)" style="width:100%;">';
    } else {
        tit.innerText = "Activación eSIM";
        cont.innerHTML = '<input type="text" id="input_imei_esim" placeholder="IMEI" style="width:100%;"><br><br><input type="email" id="input_correo_cliente" placeholder="Correo" style="width:100%;">';
    }
}


//-- REVISADO
// Función auxiliar para extraer el ID del token localmente (sin bucles)
function obtenerIdDelToken() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(window.atob(base64));
        return payload.id;
    } catch (e) {
        console.error("Error al decodificar token:", e);
        return null;
    }
}

async function ejecutar_envio_tarea() {
    // 1. Verificación de sesión INMEDIATA y LOCAL
    const userId = obtenerIdDelToken();
    
    if (!userId) {
        alert("Sesión no detectada. Redirigiendo a inicio de sesión...");
        window.location.href = '/login.html';
        return;
    }

    // 2. Validación de campos
    const ciudadNombre = document.getElementById('input_ciudad_usuario').value;
    const ciudadId = window.datos_ciudades_sistema ? window.datos_ciudades_sistema[ciudadNombre] : null;
    
    if (!ciudadId) {
        alert("Ciudad inválida o no seleccionada");
        return;
    }

    // 3. Preparación del payload
    // Nota: Ya no necesitamos enviar userId en el cuerpo si tu backend lo saca del token,
    // pero lo dejamos por compatibilidad si tu API lo requiere.
    const datos_payload = {
        tipo_tarea: document.getElementById('titulo_modal_proceso').innerText.includes('Física') ? 'ACT_FISICA' : 'ACT_ESIM',
        portal: 'TELCEL',
        ciudad: ciudadNombre || null,
        ciudad_id: ciudadId || null,
        iccid: document.getElementById('input_iccid_chip')?.value || null,
        imei: document.getElementById('input_imei_esim')?.value || null,
        correo: document.getElementById('input_correo_cliente')?.value || null
    };
 
    // 4. Envío a la API
    mostrarLoader("<br><br><br> Iniciando activación...<br>NO CIERRE ESTA VENTANA<br><br><br><br><br>");
    
    try {
        const respuesta = await fetch('/api/solicitar-activacion', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token')
            },
            body: JSON.stringify(datos_payload)
        });
        
        const data = await respuesta.json();
        
        if (data.success) {
            if(datos_payload.tipo_tarea === 'ACT_FISICA') {
                ESTADO_ACT_FISICA(data.id);
            } else {
                verificarEstadoTarea(data.id);
            }
        } else {
            if(typeof cerrarLoader === 'function') cerrarLoader(); 
            alert("Error en el sistema: " + (data.error || "Error desconocido"));
            cerrar_modal();
        }
    } catch (e) {
        if(typeof cerrarLoader === 'function') cerrarLoader();
        console.error("Error al conectar con la API:", e);
        alert("Error crítico de conexión. Por favor, intenta de nuevo.");
        cerrar_modal();
    }
}



//---->falta

async function ejecutar_envio_tarea() {
    // 1. Verificación de sesión INMEDIATA y LOCAL
    // Ya no usamos cargarIdUsuario() ni variables globales para evitar bucles.
    const userId = obtenerIdDelToken();
    
    if (!userId) {
        alert("Sesión no detectada. Redirigiendo a inicio de sesión...");
        window.location.href = '/login.html';
        return;
    }

    // 2. Validación de campos
    const ciudadNombre = document.getElementById('input_ciudad_usuario').value;
    const ciudadId = window.datos_ciudades_sistema ? window.datos_ciudades_sistema[ciudadNombre] : null;
    
    if (!ciudadId) {
        alert("Ciudad inválida o no seleccionada");
        return;
    }

    // 3. Preparación del payload
    const datos_payload = {
        tipo_tarea: document.getElementById('titulo_modal_proceso').innerText.includes('Física') ? 'ACT_FISICA' : 'ACT_ESIM',
        portal: 'TELCEL',
        ciudad: ciudadNombre || null,
        ciudad_id: ciudadId || null,
        iccid: document.getElementById('input_iccid_chip')?.value || null,
        imei: document.getElementById('input_imei_esim')?.value || null,
        correo: document.getElementById('input_correo_cliente')?.value || null
        // Ya no es necesario enviar userId aquí si tu backend lo extrae del token,
        // pero si tu API lo requiere obligatoriamente, puedes agregarlo:
        // userId: userId 
    };
 
    // 4. aqui el mensaje dinamico 
    mostrarLoader("<br><br><br>No cierre esta ventana<br><br>Seleccionando producto...<br><br><br>");
    
    try {
        const respuesta = await fetch('/api/solicitar-activacion', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token') 
            },
            body: JSON.stringify(datos_payload)
        });
        
        const data = await respuesta.json();
        
        if (data.success) {
            if(datos_payload.tipo_tarea === 'ACT_FISICA') {
                ESTADO_ACT_FISICA(data.id);
            } else {
                verificarEstadoTarea(data.id);
            }
        } else {
            if(typeof cerrarLoader === 'function') cerrarLoader(); 
            alert("Error en el sistema: " + (data.error || "Error desconocido"));
            cerrar_modal();
        }
    } catch (e) {
        if(typeof cerrarLoader === 'function') cerrarLoader();
        console.error("Error al conectar con la API:", e);
        alert("Error crítico de conexión. Por favor, intenta de nuevo.");
        cerrar_modal();
    }
}


// --------------------------->  FISICA ACTIVACION MANUAL<---------------------
// --------------------------->  FISICA ACTIVACION MANUAL<---------------------
// --------------------------->  FISICA ACTIVACION MANUAL<---------------------

function ESTADO_ACT_FISICA(tareaId) {
    if (pollerActivo) clearInterval(pollerActivo);
    const contenedor = document.getElementById('contenedor_campos_dinamicos');
    
    pollerActivo = setInterval(async () => {
        try {
            // CORRECCIÓN: Se añade el header Authorization con el token JWT
            const res = await fetch(`/api/estado-tarea-ACT/${tareaId}?t=${Date.now()}`, {
                headers: { 
                    'Authorization': 'Bearer ' + localStorage.getItem('token') 
                }
            });
            
            const data = await res.json();

            // --- NUEVA LÓGICA DE DETECCIÓN DE ERROR ---
            const esError = data.estado === 'ERROR' || JSON.stringify(data).toUpperCase().includes('ERROR');
            
            if (esError) {
                clearInterval(pollerActivo);
                contenedor.innerHTML = `
                    <div style="padding: 20px; text-align: center; border: 2px solid #dc3545; border-radius: 8px;">
                        <h3 style="color: #dc3545;">⚠️ Error detectado</h3>
                        <p>${data.resultado || 'Ocurrió un error en el proceso'}</p>
                        <button id="btn_reiniciar_proceso" style="padding: 10px 20px; background: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer;">
                            REINICIAR PROCESO
                        </button>
                    </div>`;
                document.getElementById('btn_reiniciar_proceso').onclick = () => location.reload();
                return;
            }

            if (['ACT_ESIM_EXITOSA_QR_1', 'PROCESANDO_ESIM'].includes(data.estado)) {
                contenedor.innerHTML = `<h3>Procesando Vinculación...</h3><div class="loader-radial"></div>`;
            }
            
            
            else if (data.estado === 'ACT_FISICA_EXITOSA_QR') {
                contenedor.innerHTML = `<h3>Preparando Número para SIM</h3><div class="loader-radial"></div>
                                        <button id="btn_ejecutar_recarga" style="padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 5px; cursor: pointer;">Configurar SIM</button>`;
                document.getElementById('btn_ejecutar_recarga').onclick = () => solicitarRecargaManual(tareaId);
            } 
            
            
            else if (data.estado === 'COMPLETADO') {
                contenedor.innerHTML = `<h3>Vinculación lista</h3>
                                        <button id="btn_vincular_ahora" style="padding: 10px 20px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">CONTINUAR</button>`;
                document.getElementById('btn_vincular_ahora').onclick = () => enviarVinculacionDirecta(tareaId);
            } 
            
            
            else if (data.estado === 'ENVIANDO_QR') {
                clearInterval(pollerActivo);
                const tieneLink = data.link_final && data.link_final.length > 5;
                contenedor.innerHTML = `<div><h3>🎉 Listo para vinculación Express</h3>
                                        <p>Número: ${data.numero || 'N/A'}</p>
                                        <button id="btn_abrir_link" style="padding: 12px; background: ${tieneLink ? '#59e319' : '#6c757d'}; color: white;">
                                            ${tieneLink ? '🔗 CLIC AQUÍ PARA VINCULAR' : '⚠️ Link no disponible'}
                                        </button>
                                         <div style="text-align: left; background: #e8f5e9; padding: 15px; border-radius: 8px; border: 1px solid #c8e6c9;">
                                        <h3 style="color: #2e7d32; margin-top: 0;">✅ Activación Exitosa</h3>
                                        <p><strong>Número:</strong> ${data.numero || 'No recibido'}</p>
                                        <p><strong>Correo:</strong> ${data.correo || 'No recibido'}</p>
                                        <p><strong>IMEI:</strong> ${data.imei || 'No recibido'}</p>
                                        <p><strong>Folio:</strong> ${data.folio_act || 'No recibido'}</p>
                                    </div></div>`;
                if (tieneLink) document.getElementById('btn_abrir_link').onclick = () => window.open(data.link_final, '_blank');
            } 
            
            
            else if (data.estado === 'FALLO_EXTRACCION') {
                contenedor.innerHTML = `<p style="color:red;">⚠️ Error: No se pudo extraer el QR.</p>
                                        <button id="btn_reintentar_qr">Reintentar Extracción QR</button>`;
                document.getElementById('btn_reintentar_qr').onclick = () => enviarVinculacionDirecta(tareaId);
            } 
            
            else if (data.estado === 'REINTENTANDO_EXTRACCION') {
                contenedor.innerHTML = `
                    <div style="text-align: center; padding: 20px;">
                        <h3 style="color: #ff9800;">⚠️ Estatus: No Completado, Reintente.</h3>
                        <p>La operación no finalizó correctamente. Puede intentar nuevamente.</p>
                        <button id="btn_reintentar_manual" style="padding: 10px 25px; background: #ff9800; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px;">
                            REINTENTAR AHORA
                        </button>
                    </div>`;
                document.getElementById('btn_reintentar_manual').onclick = () => solicitarRecargaManual(tareaId);
            
            }


            
            
            else if (data.estado?.includes('FALLO')) {
                clearInterval(pollerActivo);
                contenedor.innerHTML = `<p style="color:red;">Error: <strong>USE OTRO SIM</strong> Y REINICIE EL PROCESO</p>`;
            }
        } catch (e) { 
            console.error("Error en poller:", e); 
        }
    }, 2000);
}


//-- SOLICITAR RECARGA - REVISADO
async function solicitarRecargaManual(tareaId) {
    const contenedor = document.getElementById('contenedor_campos_dinamicos');
    
    try {
        const res = await fetch('/api/solicitar-recarga', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('token') // <--- AGREGADO
            },
            body: JSON.stringify({ id: tareaId, nuevo_estado: 'ACT_FISICA_RECARGA' })
        });
        
        const data = await res.json();
        if (data.success) {
            contenedor.innerHTML = `
            <div style="display: flex; justify-content: center;">
                <div class="loader_sipner_act_individual_container">
                    <div class="loader_sipner_act_individual_outer"></div>
                    <div class="loader_sipner_act_individual_inner"></div>
                </div>
            </div><br><br><br>
            <p style="color: blue;"><h4>Mejorando Experiencia de vinculacion.</h4></p>`;
        } else {
            alert("Error: " + data.error);
        }
    } catch (e) {
        console.error("Error en recarga manual:", e);
        alert("Error al conectar con el servidor");
    }
}
// ---------------------------> FIN FISICA ACTIVACION MANUAL<---------------------
// ---------------------------> FIN FISICA ACTIVACION MANUAL<---------------------
// ---------------------------> FIN FISICA ACTIVACION MANUAL<---------------------



// --- CORRECCIÓN EN ENVIAR_VINCULACION_DIRECTA ---

async function enviarVinculacionDirecta(tareaId) {
    const contenedor = document.getElementById('contenedor_campos_dinamicos');
    // Indicador visual inmediato
    contenedor.innerHTML = `<div class="loader-radial"></div><p style="color: blue;">Procesando vinculación...</p>`;
    
    try {
        const res = await fetch('/api/solicitar-recarga', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                // CORRECCIÓN: Se añade el token JWT para autenticar la petición
                'Authorization': 'Bearer ' + localStorage.getItem('token') 
            },
            body: JSON.stringify({ id: tareaId, nuevo_estado: 'ACT_ESIM_EXITOSA_QR_1' })
        });
        
        const data = await res.json();
        
        if (!data.success) {
            contenedor.innerHTML = `<p style="color:red;">Error: ${data.error || 'No se pudo completar'}</p>`;
        } else {
            // Opcional: podrías mostrar un mensaje de éxito o recargar el estado
            contenedor.innerHTML = `<p style="color:green;">Vinculación procesada correctamente.</p>`;
        }
    } catch (e) {
        console.error("Error al conectar con la API:", e);
        alert("Error de conexión con el servidor");
        contenedor.innerHTML = `<p style="color:red;">Error de red. Intenta nuevamente.</p>`;
    }
}

//------------------------------------------------------------------------------------------------------------------------------

//---------------------------------------------------FUNCIONES VERIFICADOR------------------------------------------------------

//------------------------------------------------------------------------------------------------------------------------------
//-- REVISADO esim

function verificarEstadoTarea(tareaId) {
    if (pollerActivo) clearInterval(pollerActivo);
    
    pollerActivo = setInterval(async () => {
        try {
            const res = await fetch(`/api/estado-tarea-ACT/${tareaId}?t=${Date.now()}`, {
                method: 'GET', 
                headers: { 
                    'Authorization': 'Bearer ' + localStorage.getItem('token'),
                    'Content-Type': 'application/json'
                }
            });

            // 1. CONTROL DE SEGURIDAD: Si no está OK, detenemos el poller
            if (!res.ok) {
                console.warn(`⚠️ Vigilante detenido: Servidor respondió con estado ${res.status}`);
                clearInterval(pollerActivo);
                // Opcional: mostrar un mensaje al usuario
                const contenedor = document.getElementById('contenedor_campos_dinamicos');
                if (contenedor) contenedor.innerHTML = `<p style="color:red;">Error de acceso: ${res.statusText}</p>`;
                return;
            }

            const data = await res.json();
            const contenedor = document.getElementById('contenedor_campos_dinamicos');
            if (!contenedor) return;

            // 2. LÓGICA DE ESTADOS
            if (data.estado === 'ACT_ESIM_VINCULAR_LISTA') {
                clearInterval(pollerActivo);
                contenedor.innerHTML = contenedor.innerHTML = `
            <div style="text-align: left; height:450px; background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 5px solid #2e7d32;">
                 <h3>✅ eSIM enviado a su correo.</h3>
                 Siga las instrucciones para instalar, revise su bandeja de entrada o spam. 
                 <br><br><b> Al finalizar registre su linea y realize una recarga de $100. <b>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
                    <p><strong>Número:</strong> ${data.numero || 'N/A'}</p><br>
                    <p><strong>Folio:</strong> ${data.folio_act || 'N/A'}</p><br>
                    <p><strong>Estatus:</strong> ${data.estatus_act || 'N/A'}</p><br>
              
                    <p><strong>IMEI:</strong> ${data.imei || 'N/A'}</p>

                       <div style="text-align:center; margin-top: 5px;">
              <strong></strong><br>
            </div>
                </div>
                <img src="logo.png" alt="Logo" style="width:50%; auto; margin-bottom: 1px;"><br>
            </div>
            <br>
              <div style="display: flex; width: 85%; gap: 10px;">
                    
                    <a href="/API" style="flex: 1; padding: 12px; background: #45728e; color: white; text-align: center; text-decoration: none; border-radius: 5px; font-weight: bold;">
                        ❌ CERRAR
                    </a>
                </div>
         `;
            } else if (data.estado === 'PROCESANDO_ESIM' && data.estatus_act === 'ACT_ESIM_VINCULAR_LISTA') {
    // Para evitar duplicar botones, solo renderizamos si no existe el botón
    if (!document.getElementById('btn-ver-qr')) {
        clearInterval(pollerActivo); // Detenemos el poller principal al obtener QR
        let contador = 30;
        
        contenedor.innerHTML = `
            <div style="text-align: left; height:400px; background: #e8f5e9; padding: 15px; border-radius: 8px; border-left: 5px solid #2e7d32;">
                 <h3>✅ eSIM enviado.</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 14px;">
                    <p><strong>Número:</strong> ${data.numero || 'N/A'}</p><br>
                    <p><strong>Folio:</strong> ${data.folio_act || 'N/A'}</p><br>
                    <p><strong>Estatus:</strong> ${data.estatus_act || 'N/A'}</p><br>
              
                    <p><strong>IMEI:</strong> ${data.imei || 'N/A'}</p>

                       <div style="text-align:center; margin-top: 5px;">
              <strong>eSIM ENVIADO A SU CORREO </strong><br>
            </div>
                </div>
                <img src="logo.png" alt="Logo" style="width:25%; auto; margin-bottom: 1px;"><br>
            </div>
         `;

                    const btn = document.getElementById('btn-ver-qr');
                    const cuenta = setInterval(() => {
                        contador--;
                        if(contador > 0) {
                            btn.innerText = `Ver QR (${contador}s)`;
                        } else {
                            clearInterval(cuenta);
                            btn.innerText = "Ver QR";
                            btn.disabled = false;
                            btn.onclick = () => { btn.disabled = true; dispararProcesoQR(tareaId); };
                        }
                    }, 1000);
                }

            } else if (data.estado === 'ACT_ESIM_REINTENTAR') {
                contenedor.innerHTML = `
                  <div style="display: flex; justify-content: center;">
                <div class="loader_sipner_act_individual_container">
                    <div class="loader_sipner_act_individual_outer"></div>
                    <div class="loader_sipner_act_individual_inner"></div>
                </div>
            </div><br><br><br>
                
                <h3>Ya casi esta listo...</h3><div class="loader-radial"></div>`;
            
            } else if (data.estado === 'ACT_ESIM_FALLO' || data.estado === 'ACT_ESIM_FALLO_EXTRACCION') {
    clearInterval(pollerActivo);

    // 1. Renderizamos el botón
    contenedor.innerHTML = `
        <h3> Configurar eSIM </h3>
        <img src="img/esim.png" alt="SIM CARD"><br>Amigo sin limite<br><br> 
    
        <button id="btn-reintento-custom" style="padding: 10px 20px; cursor: pointer;">Continuar</button>
    `;

    const btn = document.getElementById('btn-reintento-custom');

    // 2. Definimos la acción con control de doble clic
    btn.onclick = async () => {
        // Deshabilitar botón inmediatamente para evitar peticiones múltiples
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.innerText = 'Procesando...';

        try {
            // Ejecutar la tarea manual
            await ejecutarTareaManual(tareaId);
            
            // Opcional: Feedback de éxito
            btn.innerText = 'Procesando...';
        } catch (error) {
            // En caso de error, volvemos a habilitar el botón para que pueda intentar de nuevo
            console.error("Error en la ejecución manual:", error);
            alert("Hubo un error al intentar continuar. Por favor, intenta de nuevo.");
            
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.innerText = 'Continuar';
        }
    };


            } else if (data.estado === 'ERROR') {
                clearInterval(pollerActivo);
                contenedor.innerHTML = `<div style="background: #ffebee; padding: 15px;"><h3>❌ Error</h3><p>${data.resultado}</p></div>`;
            }
        } catch (e) {
            console.error("Error crítico en el poller:", e);
            clearInterval(pollerActivo); // Detener ante errores de red o JSON inválido
        }
    }, 2000);
}







// REVISADO



async function ejecutarTareaManual(id) {
    try {
        const res = await fetch(`/api/recuperacion-paso-nueve/${id}`, { 
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + localStorage.getItem('token') // <--- AGREGADO
            }
        });
        
        if (res.ok) {
            verificarEstadoTarea(id);
        } else {
            alert("No se pudo ejecutar la tarea manual.");
        }
    } catch (e) {
        console.error("Error en ejecución manual:", e);
    }
}
// REVISADO
async function dispararProcesoQR(tareaId) {
    try {
        const res = await fetch(`/api/ejecutar-qr-registro/${tareaId}`, { 
            method: 'POST',
            headers: { 
                'Authorization': 'Bearer ' + localStorage.getItem('token') // <--- AGREGADO
            }
        });
        
        const data = await res.json();
        if (data.success) {
            alert("QR validado");
        } else {
            alert("Error: " + (data.error || "No se pudo validar el QR"));
        }
    } catch (e) {
        console.error("Error al disparar proceso QR:", e);
        alert("Error de conexión");
    }
}

inicializar_sistema();
