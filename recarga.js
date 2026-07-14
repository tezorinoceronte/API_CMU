const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

let browser = null;
let page = null;

async function setupPage() {
    if (!browser) {
        browser = await puppeteer.launch({ headless: "new" });
        page = await browser.newPage();
    }
    // Navegamos al portal
    await page.goto('https://force.mmoviles.com/login', { waitUntil: 'networkidle2' });
}

app.post('/api/validar-numero', async (req, res) => {
    const { numero } = req.body;
    try {
        await setupPage();
        
        // 1. Limpiar y escribir
        await page.evaluate((sel) => document.querySelector(sel).value = '', '#iccid_info');
        await page.type('#iccid_info', numero);
        
        // 2. Clic en botón buscar
        await page.click('#button_info');
        
        // 3. ESPERA INTELIGENTE (La versión rápida)
        const resultado = await page.evaluate(() => {
            return new Promise((resolve) => {
                // Función para extraer lo que haya
                const extraer = () => ({
                    iccid: document.getElementById('iccid_response')?.value || null,
                    alerta: document.querySelector('.alert-content')?.innerText || null
                });

                // Si ya cargó algo inmediatamente, lo regresamos
                const actual = extraer();
                if (actual.iccid || actual.alerta) return resolve(actual);

                // Si no, observamos cambios
                const observer = new MutationObserver(() => {
                    const datos = extraer();
                    if (datos.iccid || datos.alerta) {
                        observer.disconnect();
                        resolve(datos);
                    }
                });
                observer.observe(document.body, { childList: true, subtree: true });

                // Timeout de seguridad de 3 segundos
                setTimeout(() => {
                    observer.disconnect();
                    resolve(extraer());
                }, 3000);
            });
        });

        // 4. Captura
        const screenshot = await page.screenshot({ encoding: 'base64' });
        
        res.json({ 
            status: 'success', 
            image: screenshot, 
            alerta: resultado.alerta,
            iccid: resultado.iccid 
        });
    } catch (error) {
        console.error("Error:", error);
        browser = null; // Reiniciar navegador si falla
        res.status(500).json({ status: 'error', message: error.message });
    }
});






app.listen(3001, () => console.log("Servidor corriendo en http://localhost:3001"));