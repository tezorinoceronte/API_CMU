const Jimp = require('jimp');
const jsQR = require('jsqr');
// PEGA TU CADENA COMPLETA AQUÍ (Asegúrate de incluir las comillas)
const base64Data = ""
async function verificarQR() {
    try {
        console.log("🔍 Iniciando lectura de QR...");
        
        // Extraer la parte después de la coma
        const base64Clean = base64Data.split(',')[1];
        if (!base64Clean) throw new Error("Formato Base64 inválido.");

        const buffer = Buffer.from(base64Clean, 'base64');
        
        // Jimp procesa el buffer de imagen
        const image = await Jimp.read(buffer);
        
        // jsQR procesa los píxeles
        const qr = jsQR(image.bitmap.data, image.bitmap.width, image.bitmap.height);
        
        if (qr) {
            console.log("✅ ¡QR VÁLIDO!");
            console.log("📍 Contenido extraído:", qr.data);
        } else {
            console.log("❌ No se pudo leer el QR. (¿Está borroso o incompleto?)");
        }
    } catch (e) {
        console.error("❌ Error:", e.message);
    }
}

verificarQR();
