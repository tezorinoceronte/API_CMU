const sesiones = new Map(); // Guardaremos los navegadores abiertos aquí

async function obtenerNavegadorParaUsuario(userId) {
    // Si ya existe una sesión abierta para este userId, la reutilizamos
    if (sesiones.has(userId)) {
        console.log(`📂 Reutilizando sesión activa para: ${userId}`);
        return sesiones.get(userId);
    }

    console.log(`🚀 Creando nueva sesión para: ${userId}`);
    const browser = await puppeteer.launch({
        userDataDir: `./sesiones/usuario_${userId}`,
        headless: true, // Ponlo en false si quieres ver qué hace mientras pruebas
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    
    // Guardamos en el mapa
    const sesionData = { browser, page, lastActivity: Date.now() };
    sesiones.set(userId, sesionData);
    
    return sesionData;
}

// Agregamos un estado de "ocupado" a nuestro mapa de sesiones
const sesiones = new Map(); 

async function obtenerNavegadorParaUsuario(userId) {
    if (sesiones.has(userId)) {
        return sesiones.get(userId);
    }
    // ... (tu código de puppeteer.launch aquí) ...
    
    // Agregamos 'estaOcupado'
    const sesionData = { browser, page, lastActivity: Date.now(), estaOcupado: false };
    sesiones.set(userId, sesionData);
    return sesionData;
}
