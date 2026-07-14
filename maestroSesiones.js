const puppeteer = require('puppeteer');
const sesiones = new Map(); 

async function obtenerNavegadorParaUsuario(userId) {
    if (sesiones.has(userId)) return sesiones.get(userId);
    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    const sesionData = { browser, pageForce: page };
    sesiones.set(userId, sesionData);
    return sesionData;
}

module.exports = { sesiones, obtenerNavegadorParaUsuario };