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

// Función para descargar el HTML de una página simulando ser un navegador móvil legítimo
function fetchHtml(targetUrl) {
    return new Promise((resolve, reject) => {
        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch (e) {
            return reject(new Error("URL no válida"));
        }

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                // Simulamos un navegador móvil (Safari en iPhone) para que X devuelva el HTML limpio
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve(data);
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(12000, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado"));
        });

        req.end();
    });
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server - Extractor Nativo Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Nativo] Analizando enlace: ${url}`);

        // Limpiar parámetros basura de Twitter/X
        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                const urlObj = new URL(url);
                url = `${urlObj.origin}${urlObj.pathname}`;
            } catch (e) {}
        }

        let directUrl = null;

        // Si es de X/Twitter, leemos el HTML directamente para buscar el video
        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                // Twitter usa un dominio alternativo para previsualizaciones móviles limpias (vxtwitter o fxtwitter)
                // Esto nos permite obtener el JSON o video de forma directa y nativa sin bloqueos de Cloudflare.
                const vxUrl = url.replace('x.com', 'api.vxtwitter.com').replace('twitter.com', 'api.vxtwitter.com');
                
                console.log(`[Nativo] Consultando metadatos limpios: ${vxUrl}`);
                
                const responseData = await new Promise((resolve, reject) => {
                    https.get(vxUrl, { headers: { 'User-Agent': 'GremlinBot/1.0' } }, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error("No se pudo parsear la respuesta"));
                            }
                        });
                    }).on('error', reject);
                });

                if (responseData && responseData.media_extended && responseData.media_extended.length > 0) {
                    const videoMedia = responseData.media_extended.find(m => m.type === 'video' || m.type === 'gif');
                    if (videoMedia && videoMedia.url) {
                        directUrl = videoMedia.url;
                    }
                } else if (responseData && responseData.video_url) {
                    directUrl = responseData.video_url;
                }
            } catch (err) {
                console.log("Error en extracción nativa de X:", err.message);
            }
        }

        if (!directUrl) {
            return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
        }

        console.log(`¡Enlace directo obtenido de forma nativa!: ${directUrl}`);

        return res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error interno: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo procesar la solicitud." });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server Nativo corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
