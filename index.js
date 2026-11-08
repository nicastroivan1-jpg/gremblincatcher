const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');

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
    res.status(200).send('Gremlin Server V3 Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Nativo V3] Analizando enlace: ${url}`);

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
                // Usamos fxtwitter con un endpoint JSON limpio y seguro
                const fxUrl = url.replace('x.com', 'api.fxtwitter.com').replace('twitter.com', 'api.fxtwitter.com');
                
                console.log(`[Nativo V3] Consultando API limpia: ${fxUrl}`);
                
                const responseData = await new Promise((resolve, reject) => {
                    const reqOptions = {
                        headers: { 
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            'Accept': 'application/json'
                        },
                        rejectUnauthorized: false
                    };

                    https.get(fxUrl, reqOptions, (res) => {
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

                // Analizamos la respuesta de fxtwitter
                if (responseData && responseData.tweet) {
                    const tweet = responseData.tweet;
                    if (tweet.media && tweet.media.videos && tweet.media.videos.length > 0) {
                        // Buscamos la mejor calidad de video disponible
                        directUrl = tweet.media.videos[0].url;
                    } else if (tweet.media && tweet.media.mosaic && tweet.media.mosaic.formats) {
                        directUrl = tweet.media.mosaic.formats.mp4;
                    }
                }
            } catch (err) {
                console.log("Error en extracción con fxtwitter:", err.message);
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
    console.log(`🚀 Gremlin Server V3 corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
