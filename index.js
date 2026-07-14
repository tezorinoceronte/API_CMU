const puppeteer = require('puppeteer');

const CONFIG = {
    usuario: 'PNTCMU048',
    password: 'Sigma781$Alfa',
    region: '7'
};
async function iniciarSesion() {
    console.log('🚀 Iniciando navegador seguro de fondo...');
    const navegador = await puppeteer.launch({ headless: true });
    const pagina = await navegador.newPage();

    try {
        await pagina.setViewport({ width: 1280, height: 800 });

        console.log('⏳ Paso 1: Entrando a la URL principal...');
        await pagina.goto('https://www.distribuidor.telcel.com:4475/Portal-Distribuidores/app/login', {
            waitUntil: 'networkidle2'
        });

        console.log('✅ Formulario cargado en pantalla. Esperando estabilidad...');
        await new Promise(r => setTimeout(r, 4000));

        console.log('⏳ Paso 2: Seleccionando campos de forma estricta...');

        // Recuperamos los inputs de la página justo como en el código que sí los escribía
        const inputs = await pagina.$$('input');
        
        console.log(`Escribiendo usuario...`);
        // Usamos el enfoque directo que ya te ponía el usuario en pantalla
        await inputs[0].focus();
        await pagina.keyboard.type(CONFIG.usuario, { delay: 100 });

        console.log(`Escribiendo contraseña...`);
        await pagina.focus('input[type="password"]');
        await pagina.keyboard.type(CONFIG.password, { delay: 100 });

        console.log('⏳ Paso 3: Seleccionando Región...');
        await pagina.select('select', CONFIG.region);

        // Esperamos 2 segundos para asegurar que el formulario asimile los datos
        await new Promise(r => setTimeout(r, 2000));

        console.log('⏳ Paso 4: Dando clic al botón Entrar usando su ID (#myBtn)...');
        // Usamos la evaluación directa por ID para activar las funciones nativas de Telcel
        await pagina.evaluate(() => {
            const boton = document.getElementById('myBtn');
            if (boton) boton.click();
        });

        console.log('⏳ Esperando la respuesta del servidor tras el Login...');
        await new Promise(r => setTimeout(r, 12000));

        const urlFinal = pagina.url();
        console.log('\n--- 📊 RESULTADO DEL INTENTO ---');
        console.log('URL actual en la que terminó el bot:', urlFinal);

        // Tomamos la foto final para validar el acceso definitivo
        await pagina.screenshot({ path: 'evidencia_final.png' });
        console.log('📸 Foto del resultado guardada en "evidencia_final.png".');

        if (!urlFinal.includes('login')) {
            console.log('🚀 ¡LOGIN EXITOSO! El bot está dentro del sistema corporativo.');
            const cookies = await pagina.cookies();
            console.log('✅ Cookies recolectadas con éxito.');
        } else {
            console.log('❌ El portal se quedó en el login. Revisa "evidencia_final.png".');
        }

    } catch (error) {
        console.error('\n💥 Hubo un detalle durante la ejecución:', error.message);
    } finally {
        await navegador.close();
        console.log('🔒 Navegador cerrado.');
    }
}

iniciarSesion();