/**
 * esimController.js
 * Automatización del proceso de activación de eSIM para Telcel.
 */

// Helper para interactuar con SelectOneMenu de PrimeFaces
async function seleccionarOpcionPrimeFaces(page, menuSelector, opcionTexto) {
    await page.click(`${menuSelector} .ui-selectonemenu-trigger`);
    await page.waitForSelector('.ui-selectonemenu-panel', { visible: true });
    
    await page.evaluate((texto) => {
        const opciones = Array.from(document.querySelectorAll('.ui-selectonemenu-item'));
        const opcion = opciones.find(el => el.textContent.trim() === texto);
        if (opcion) opcion.click();
        else throw new Error(`Opción "${texto}" no encontrada.`);
    }, opcionTexto);
    
    await new Promise(r => setTimeout(r, 1000));
}

// Función para extraer el QR en base64
async function obtenerBase64QR(page) {
    const qrSelector = 'img.img-fluid.qr';
    await page.waitForSelector(qrSelector, { visible: true });
    
    return await page.evaluate((selector) => {
        const img = document.querySelector(selector);
        return img ? img.getAttribute('src') : null;
    }, qrSelector);
}

// Función central de activación
async function activarESIM(page, datos) {
    console.log(`🚀 Iniciando proceso para IMEI: ${datos.imei}`);

    // 1. Llenado de formularios
    await page.type('#formActivacionInd\\:accordion\\:email', datos.email);
    await page.type('#formActivacionInd\\:accordion\\:imei', datos.imei);

    // 2. Selección de menús
    await seleccionarOpcionPrimeFaces(page, '#formActivacionInd\\:accordion\\:cmbCiudad', datos.ciudad);
    await seleccionarOpcionPrimeFaces(page, '#formActivacionInd\\:accordion\\:esquemaCobro', 'Amigo Chip Express Sin Limite');

    // 3. Flujo de activación
    await page.click('#formActivacionInd\\:btnActivacion');
    await page.waitForSelector('#formActivacionInd\\:btnContinuarOferta', { visible: true });
    await page.click('#formActivacionInd\\:btnContinuarOferta');

    // Manejo de popup EID
    const avisoEID = await page.$('.ui-growl-title');
    if (avisoEID) {
        await page.click('#formActivacionInd\\:btnContinuarOferta');
    }

    // 4. Esperar y actualizar estatus
    await page.waitForSelector('#formCapUsu\\:j_id_3p', { visible: true });
    await page.click('#formCapUsu\\:j_id_3p');

    await page.waitForFunction(() => {
        const el = document.querySelector('#formCapUsu\\:ordenExt');
        return el && el.textContent.trim() === 'completed';
    }, { timeout: 60000 });

    // 5. Finalización
    await page.click('#formCapUsu\\:btnVerQR');
    return await obtenerBase64QR(page);
}

module.exports = { activarESIM };