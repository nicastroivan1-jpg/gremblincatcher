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

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Nativo V2 Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Nativo V2] Analizando enlace: ${url}`);

        // Limpiar parámetros basura de Twitter/X
        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                const urlObj = new URL(url);
                url = `${urlObj.origin}${urlObj.pathname}`;
            } catch (e) {}
        }

        let directUrl = null;

        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                // Usamos el servicio de respaldo nativo de vxtwitter directamente con manejo SSL seguro
                const vxUrl = url.replace('x.com', 'api.vxtwitter.com').replace('twitter.com', 'api.vxtwitter.com');
                
                console.log(`[Nativo V2] Consultando: ${vxUrl}`);
                
                const responseData = await new Promise((resolve, reject) => {
                    const reqOptions = {
                        headers: { 'User-Agent': 'Mozilla/5.0' },
                        rejectUnauthorized: false // <--- Soluciona el error de Handshake SSL
                    };

                    https.get(vxUrl, reqOptions, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error("No se pudo parsear la respuesta JSON"));
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

        console.log(`¡Enlace directo obtenido con éxito!: ${directUrl}`);

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
    console.log(`🚀 Gremlin Server V2 corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
