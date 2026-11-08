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

// Función genérica segura para peticiones HTTPS con soporte JSON
function fetchJson(targetUrl) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*'
            },
            rejectUnauthorized: false
        };

        https.get(targetUrl, reqOptions, (res) => {
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
}

// Función auxiliar para verificar si una URL es un archivo de video directo
function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Todoterreno Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador] Enlace recibido: ${url}`);
        let directUrl = null;

        // 0. SI YA ES UN VIDEO DIRECTO DE INTERNET
        if (isDirectVideoUrl(url)) {
            directUrl = url;
        }

        // 1. EXTRACTOR PARA X / TWITTER
        else if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                let cleanUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanUrl = `https://twitter.com${urlObj.pathname}`;
                } catch (e) {}

                const fxUrl = cleanUrl
                    .replace('https://twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://www.twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://x.com', 'https://api.fxtwitter.com')
                    .replace('https://www.x.com', 'https://api.fxtwitter.com');
                
                console.log(`[X/Twitter] Consultando: ${fxUrl}`);
                const responseData = await fetchJson(fxUrl);

                if (responseData && responseData.tweet && responseData.tweet.media) {
                    const videos = responseData.tweet.media.videos;
                    if (videos && videos.length > 0) {
                        directUrl = videos[0].url;
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de X:", err.message);
            }
        }

        // 2. EXTRACTOR PARA INSTAGRAM (Reels / Posts)
        else if (url.includes('instagram.com')) {
            try {
                let cleanIgUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanIgUrl = `${urlObj.origin}${urlObj.pathname}`;
                } catch (e) {}

                const igApiUrl = cleanIgUrl.replace('instagram.com', 'api.ddinstagram.com');
                
                console.log(`[Instagram] Consultando: ${igApiUrl}`);
                const responseData = await fetchJson(igApiUrl);

                if (responseData) {
                    if (responseData.video_url) {
                        directUrl = responseData.video_url;
                    } else if (responseData.media && responseData.media.length > 0) {
                        directUrl = responseData.media[0].url;
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Instagram:", err.message);
            }
        }

        // 3. EXTRACTOR PARA TIKTOK
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                console.log(`[TikTok] Consultando API pública de respaldo...`);
                // Usamos la API pública robusta y limpia de TikWM para TikTok
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(tikApiUrl);

                if (responseData && responseData.data) {
                    directUrl = responseData.data.play || responseData.data.url;
                }
            } catch (err) {
                console.log("Error extrayendo de TikTok:", err.message);
            }
        }

        // 4. EXTRACTOR PARA FACEBOOK (Reels / Videos públicos)
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                console.log(`[Facebook] Consultando metadatos...`);
                // Endpoint espejo público optimizado para extracción web general de FB
                const fbApiUrl = `https://fantox-server-net.vercel.app/facebook?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(fbApiUrl);

                if (responseData && responseData.videoUrl) {
                    directUrl = responseData.videoUrl;
                } else if (responseData && responseData.hd) {
                    directUrl = responseData.hd;
                } else if (responseData && responseData.sd) {
                    directUrl = responseData.sd;
                }
            } catch (err) {
                console.log("Error extrayendo de Facebook:", err.message);
            }
        }

        // 5. RESPALDO GENERAL PARA CUALQUIER OTRA PÁGINA DE INTERNET
        else {
            try {
                console.log(`[Internet General] Intentando extracción genérica...`);
                const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(generalApiUrl);

                if (responseData && responseData.url) {
                    directUrl = responseData.url;
                } else if (responseData && responseData.videoUrl) {
                    directUrl = responseData.videoUrl;
                }
            } catch (err) {
                console.log("Error en extracción general:", err.message);
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
    console.log(`🚀 Gremlin Server Todoterreno corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
