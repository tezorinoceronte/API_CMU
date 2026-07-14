// Este script decodifica la URL de Telcel y calcula cuánto tiempo le queda al token.

const urlCompleta = "https://oam.telcelinstitucional.com:5051/FacekeyLite/#/application/load?dataGestor=eyJ0cmFuc2FjdGlvbklkIjoiVDAwMTA5NTk2MSIsImxlZ2FjeUlkIjoiRGVEMTYyVDdnTHM5TVdyIiwiZmxvdyI6IkFVVE9HRVNUSU9OIiwidG9rZW4iOiJCZWFyZXIgZXlKaGJHY2lPaUpJVXpJMU5pSjkuZXlKVVVrRk9VMEZEVkVsUFRrbEVJam9pVkRBd01UQTVOVGsyTVNJc0ltcDBhU0k2SW1GTFNHOUxkM2x0TjA5TlRWb3hRekl3Y0c5cGQxTlZaRjkyZW1KcU4zbGFSVmRLYldGMk0wYzBlSE1pTENKcFlYUWlPakUzT0RJMU1qWTNOekFzSW1WNGNDSTZNVGM0TWpjd01EYzNNSDAud0VuWHFNWkdGOEc5NWVHc0gzQ1h4MU5FZEpDN1R5NFVDRW1xSXVFeWt6ayJ9";

function procesarToken() {
    try {
        // 1. Extraer el Base64 de la URL
        const urlObj = new URL(urlCompleta.replace('#/', '')); // Quitamos el # para que el parser funcione
        const dataGestorB64 = urlObj.searchParams.get("dataGestor");
        
        // 2. Decodificar el JSON principal
        const jsonPrincipal = JSON.parse(Buffer.from(dataGestorB64, 'base64').toString());
        console.log("✅ JSON Principal extraído:", jsonPrincipal.transactionId);

        // 3. Extraer el JWT del campo 'token' (quitando el prefijo 'Bearer ')
        const jwtRaw = jsonPrincipal.token.replace('Bearer ', '');
        const payloadBase64 = jwtRaw.split('.')[1]; // La parte central del JWT
        
        // 4. Decodificar el payload del JWT
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

        // 5. Calcular tiempos
        const ahora = Math.floor(Date.now() / 1000);
        const expiracion = payload.exp;
        const segundosRestantes = expiracion - ahora;

        console.log("\n--- RESULTADOS DE VALIDACIÓN ---");
        console.log("ID Transacción:", jsonPrincipal.transactionId);
        console.log("Emisión (iat):", new Date(payload.iat * 1000).toLocaleString());
        console.log("Caducidad (exp):", new Date(payload.exp * 1000).toLocaleString());
        console.log("Tiempo restante:", segundosRestantes > 0 ? `${segundosRestantes} segundos` : "TOKEN CADUCADO");
        console.log("--------------------------------\n");

    } catch (e) {
        console.error("❌ Error al procesar:", e.message);
    }
}

procesarToken();