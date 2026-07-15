
// 1. Pega aquí el token completo que empieza con "Bearer ..."
const tokenDePrueba = "Bearer eyJ0cmFuc2FjdGlvbklkIjoiVDAwMTA5NTk2MSIsImxlZ2FjeUlkIjoiRGVEMTYyVDdnTHM5TVdyIiwiZmxvdyI6IkFVVE9HRVNUSU9OIiwidG9rZW4iOiJCZWFyZXIgZXlKaGJHY2lPaUpJVXpJMU5pSjkuZXlKVVVrRk9VMEZEVkVsUFRrbEVJam9pVkRBd01UQTVOVGsyTVNJc0ltcDBhU0k2SW1GTFNHOUxkM2x0TjA5TlRWb3hRekl3Y0c5cGQxTlZaRjkyZW1KcU4zbGFSVmRLYldGMk0wYzBlSE1pTENKcFlYUWlPakUzT0RJMU1qWTNOekFzSW1WNGNDSTZNVGM0TWpjd01EYzNNSDAud0VuWHFNWkdGOEc5NWVHc0gzQ1h4MU5FZEpDN1R5NFVDRW1xSXVFeWt6ayJ9"; 

function verificarVidaUtilToken(fullTokenString) {
    try {
        // Limpiamos el prefijo 'Bearer ' si existe
        const token = fullTokenString.replace('Bearer ', '').trim();
        
        // El JWT tiene tres partes: Header.Payload.Signature
        // La segunda parte (Payload) es la que contiene la información de tiempo
        const payloadBase64 = token.split('.')[1];
        
        // Decodificamos el Base64 y convertimos a JSON
        const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString());

        const ahora = Math.floor(Date.now() / 1000); // Tiempo actual en segundos (Unix Timestamp)
        const exp = payload.exp; // Fecha de expiración que viene en el token
        
        const segundosRestantes = exp - ahora;
        
        console.log("---------------------------------------");
        console.log("🔍 DATOS DEL TOKEN:");
        console.log("Fecha emisión (iat):", new Date(payload.iat * 1000).toLocaleString());
        console.log("Fecha caducidad (exp):", new Date(payload.exp * 1000).toLocaleString());
        console.log("⏱️ Segundos restantes:", segundosRestantes);
        
        if (segundosRestantes > 0) {
            console.log("✅ El token está ACTIVO.");
        } else {
            console.log("❌ El token ya está CADUCADO.");
        }
        console.log("---------------------------------------");

    } catch (e) {
        console.error("❌ Error al procesar el token. Asegúrate de copiarlo completo:", e.message);
    }
}

// Ejecutamos la función
verificarVidaUtilToken(tokenDePrueba);