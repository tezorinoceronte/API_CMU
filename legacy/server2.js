const express = require('express');
const { connect } = require('puppeteer-real-browser');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const sesionesActivas = {};
const TTL = 10 * 60 * 1000; // 10 minutos de inactividad

// Lógica de limpieza automática (esta es la fórmula que pediste)
setInterval(() => {
    const ahora = Date.now();
    for (const id in sesionesActivas) {
        if (ahora - sesionesActivas[id].ultimaActividad > TTL) {
            console.log(`🧹 Cerrando sesión inactiva: ${id}`);
            sesionesActivas[id].browser.close().catch(() => {});
            delete sesionesActivas[id];
        }
    }
}, 60 * 1000); // Revisa cada minuto

app.post('/api/login', async (req, res) => {
    const { usuario, password, region } = req.body;
    const sessionId = `sess_${Date.now()}`;
    
    try {
        const { browser, page } = await connect({ headless: false, turnstile: true });
        await page.goto('https://www.distribuidor.telcel.com/Portal-Distribuidores/');
        
        // SELECTORES VALIDADOS
        await page.waitForSelector('#j_username');
        await page.type('#j_username', usuario);
        await page.type('#pwd', password);
        await page.select('#cmbRegiones', region);
        await page.click('button[type="submit"]');
        
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        
        // Guardamos la sesión con el timestamp actual
        sesionesActivas[sessionId] = { browser, page, ultimaActividad: Date.now() };
        
        res.json({ status: 'success', sessionId });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e.message });
    }
});

// Endpoint para mantener la sesión viva si el usuario sigue operando
app.post('/api/mantener-sesion', (req, res) => {
    const { sessionId } = req.body;
    if (sesionesActivas[sessionId]) {
        sesionesActivas[sessionId].ultimaActividad = Date.now();
        res.json({ status: 'ok' });
    } else {
        res.status(404).json({ status: 'error', message: 'Sesión no encontrada' });
    }
});

app.listen(10001, () => console.log('🚀 Servidor activo con limpieza automática'));
