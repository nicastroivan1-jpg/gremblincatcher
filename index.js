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

function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Multicalidad Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador Multicalidad] Enlace recibido: ${url}`);
        
        let availableQualities = [];

        // 0. SI ES UN VIDEO DIRECTO DE INTERNET
        if (isDirectVideoUrl(url)) {
            availableQualities.push({
                quality: "Original / Directo",
                url: url,
                format: "mp4"
            });
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
                        videos.forEach((v, index) => {
                            availableQualities.push({
                                quality: v.width ? `${v.width}x${v.height}` : `Calidad ${index + 1}`,
                                url: v.url,
                                format: "mp4"
                            });
                        });
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de X:", err.message);
            }
        }

        // 2. EXTRACTOR PARA INSTAGRAM (Actualizado con API estable)
        else if (url.includes('instagram.com')) {
            try {
                console.log(`[Instagram] Consultando API de metadatos...`);
                // Usamos un endpoint proxy de alta disponibilidad para Instagram
                let cleanIgUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanIgUrl = `${urlObj.origin}${urlObj.pathname}`;
                } catch (e) {}

                const igApiUrl = `https://fantox-server-net.vercel.app/instagram?url=${encodeURIComponent(cleanIgUrl)}`;
                const responseData = await fetchJson(igApiUrl);

                if (responseData) {
                    if (responseData.videoUrl) {
                        availableQualities.push({ quality: "HD / Original", url: responseData.videoUrl, format: "mp4" });
                    }
                    if (responseData.sd) {
                        availableQualities.push({ quality: "SD (Estándar)", url: responseData.sd, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Instagram:", err.message);
            }
        }

        // 3. EXTRACTOR PARA TIKTOK
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                console.log(`[TikTok] Consultando calidades...`);
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const responseData = await fetchJson(tikApiUrl);

                if (responseData && responseData.data) {
                    const data = responseData.data;
                    if (data.hdplay) {
                        availableQualities.push({ quality: "HD (Sin marca de agua)", url: data.hdplay, format: "mp4" });
                    }
                    if (data.play) {
                        availableQualities.push({ quality: "SD (Normal)", url: data.play, format: "mp4" });
                    }
                    if (data.music) {
                        availableQualities.push({ quality: "Audio (MP3)", url: data.music, format: "mp3" });
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de TikTok:", err.message);
            }
        }

        // 4. EXTRACTOR PARA FACEBOOK
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                console.log(`[Facebook] Consultando calidades...`);
                const fbApiUrl = `https://fantox-server-net.vercel.app/facebook?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(fbApiUrl);

                if (responseData) {
                    if (responseData.hd) {
                        availableQualities.push({ quality: "HD (Alta Calidad)", url: responseData.hd, format: "mp4" });
                    }
                    if (responseData.sd) {
                        availableQualities.push({ quality: "SD (Estándar)", url: responseData.sd, format: "mp4" });
                    }
                    if (responseData.videoUrl && !availableQualities.some(q => q.url === responseData.videoUrl)) {
                        availableQualities.push({ quality: "Normal", url: responseData.videoUrl, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Facebook:", err.message);
            }
        }

        // 5. RESPALDO GENERAL PARA OTRAS WEBS
        else {
            try {
                console.log(`[Internet General] Consultando calidades...`);
                const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(generalApiUrl);

                if (responseData) {
                    if (responseData.url) {
                        availableQualities.push({ quality: "Original", url: responseData.url, format: "mp4" });
                    }
                    if (responseData.videoUrl) {
                        availableQualities.push({ quality: "Video URL", url: responseData.videoUrl, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error en extracción general:", err.message);
            }
        }

        if (availableQualities.length === 0) {
            return res.status(500).json({ error: "El Gremlin no pudo extraer ninguna calidad de este enlace." });
        }

        console.log(`¡Se encontraron ${availableQualities.length} opciones de descarga!`);

        return res.json({
            status: "success",
            originalUrl: url,
            qualities: availableQualities
        });

    } catch (error) {
        console.error(`Error interno: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo procesar la solicitud." });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server Multicalidad corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
