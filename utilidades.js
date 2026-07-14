// utilidades.js
const Jimp = require('jimp');
const jsQR = require('jsqr');

async function obtenerUrlDeBase64(base64String) {
    try {
        const base64Clean = base64String.split(',')[1];
        const buffer = Buffer.from(base64Clean, 'base64');
        const image = await Jimp.read(buffer);
        const qr = jsQR(image.bitmap.data, image.bitmap.width, image.bitmap.height);
        return qr ? qr.data : null;
    } catch (e) {
        return null;
    }
}

module.exports = { obtenerUrlDeBase64 };