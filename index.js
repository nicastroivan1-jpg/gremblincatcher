const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

process.on('uncaughtException', (err) => {
    console.error('Excepción no controlada:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada no controlada:', reason);
});

// Función avanzada para peticiones HTTP con soporte de cabeceras personalizadas
function postJson(apiUrl, postData, customHeaders = {}) {
    return new Promise((resolve, reject) => {
        const dataString = JSON.stringify(postData);
        let urlObj;
        try {
            urlObj = new URL(apiUrl);
        } catch (e) {
            return reject(new Error("URL de API no válida"));
        }

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Length': Buffer.byteLength(dataString),
                ...customHeaders
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Respuesta no válida del servidor externo"));
                }
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(12000, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado"));
        });

        req.write(dataString);
        req.end();
    });
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server robusto operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador] Enlace recibido: ${url}`);

        // Limpiamos los parámetros basura de Twitter/X
        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                const urlObj = new URL(url);
                url = `${urlObj.origin}${urlObj.pathname}`;
                console.log(`[Cazador] URL limpia de X: ${url}`);
            } catch (e) {}
        }

        let directUrl = null;

        // Intento 1: Cobalt con cabeceras simulando un navegador web legítimo
        try {
            console.log("[Cazador] Intentando con Cobalt...");
            const apiResponse = await postJson('https://api.cobalt.tools/api/json', {
                url: url,
                vQuality: 'max'
            }, {
                'Origin': 'https://cobalt.tools',
                'Referer': 'https://cobalt.tools/'
            });

            console.log("Respuesta de Cobalt:", JSON.stringify(apiResponse));

            if (apiResponse) {
                if (apiResponse.status === 'redirect' || apiResponse.status === 'stream' || apiResponse.status === 'success') {
                    directUrl = apiResponse.url;
                } else if (apiResponse.picker && apiResponse.picker.length > 0) {
                    directUrl = apiResponse.picker[0].url;
                } else if (apiResponse.url) {
                    directUrl = apiResponse.url;
                }
            }
        } catch (cobaltError) {
            console.log("Cobalt falló, intentando con API secundaria...", cobaltError.message);
        }

        // Intento 2: Respaldo automático mediante otra API pública si Cobalt no devolvió enlace
        if (!directUrl) {
            try {
                console.log("[Cazador] Intentando método de respaldo...");
                // Usamos un endpoint alternativo directo
                const backupData = await postJson('https://co.wuk.sh/api/json', {
                    url: url,
                    vCodec: 'h264',
                    vQuality: 'max'
                });
                if (backupData && backupData.url) {
                    directUrl = backupData.url;
                }
            } catch (backupError) {
                console.log("Respaldo también falló:", backupError.message);
            }
        }

        if (!directUrl) {
            return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
        }

        console.log(`¡Enlace directo obtenido con éxito!: ${directUrl}`);

        return res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error interno de extracción: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo procesar la solicitud." });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server corriendo exitosamente en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
