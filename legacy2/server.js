const express = require('express');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Jimp = require('jimp'); 
const jsQR = require('jsqr');
const fs = require('fs');

puppeteer.use(StealthPlugin());
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname))); 

const CONFIG = {
    usuario: 'PNTCMU04L18',
    password: 'Sigma781$Alfa',
    region: '7' 
};

// MAPA DE SESIONES: Aquí guardaremos la página de cada vendedor
const sesiones = new Map();

/**
 * 🔒 FUNCIÓN: Obtiene o crea una sesión aislada para cada userId
 */
async function getSesion(userId) {
    if (sesiones.has(userId)) {
        const sesion = sesiones.get(userId);
        if (sesion.page && !sesion.page.isClosed()) return sesion.page;
    }

    console.log(`🔒 [Bot] Iniciando sesión nueva para usuario: ${userId}`);
    const browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
    });
    
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login', { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 4000));

    // Login con credenciales maestras
    await page.type('input[type="text"]', CONFIG.usuario, { delay: 100 });
    await page.type('input[type="password"]', CONFIG.password, { delay: 100 });
    await page.select('select', CONFIG.region);
    await page.evaluate(() => document.getElementById('myBtn')?.click());
    
    await new Promise(r => setTimeout(r, 12000));
    
    sesiones.set(userId, { browser, page });
    return page;
}

// 📱 MÓDULO 1: REGISTRO DE LÍNEA
app.post('/api/registro-linea', async (req, res) => {
    const { numero, userId } = req.body;
    try {
        const page = await getSesion(userId);
        
        await page.evaluate(() => {
            const elementos = Array.from(document.querySelectorAll('.ui-menuitem-text'));
            const objetivo = elementos.find(el => el.textContent.includes('Registro de clientes BES'));
            objetivo?.closest('a')?.click();
        });

        await new Promise(r => setTimeout(r, 3000));
        await page.evaluate((num) => {
            const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
            const visibleInput = inputs.find(i => i.offsetParent !== null);
            if (visibleInput) {
                visibleInput.value = num;
                visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
            document.querySelector('button.ui-button')?.click();
        }, numero);

        res.json({ status: 'success', message: "Procesando..." });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// 🔑 MÓDULO 2: VALIDAR TOKEN + LECTOR QR
app.post('/api/confirmar-token', async (req, res) => {
    const { token, userId } = req.body;
    const page = sesiones.get(userId)?.page;

    if (!page) return res.status(412).json({ status: 'error', message: 'Sesión expirada.' });

    try {
        await page.waitForSelector('#formRegistro\\:token', { timeout: 6000 });
        await page.type('#formRegistro\\:token', token, { delay: 150 });
        await page.click('#formRegistro\\:j_id_2y');

        await page.waitForSelector('#modalABE', { visible: true, timeout: 20000 });
        await new Promise(r => setTimeout(r, 20000));

        const nombreImagen = `qr_${userId}_${Date.now()}.png`;
        const rutaImagen = path.join(__dirname, nombreImagen);
        await page.$eval('#modalABE', (el) => el.screenshot()).then(data => fs.writeFileSync(rutaImagen, data));

        // Lector QR
        const imagenCargada = await Jimp.read(rutaImagen);
        const qr = jsQR(new Uint8ClampedArray(imagenCargada.bitmap.data), imagenCargada.bitmap.width, imagenCargada.bitmap.height);

        res.json({ 
            status: 'success', 
            qrUrl: `/${nombreImagen}`, 
            directUrl: qr?.data || null 
        });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(PORT, () => console.log(`🚀 Servidor listo para 300+ usuarios en puerto ${PORT}`));
