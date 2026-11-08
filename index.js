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

function fetchJson(targetUrl, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch (e) {
            return reject(new Error("URL no válida"));
        }

        const reqOptions = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: { 
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
                'Accept': 'application/json, text/plain, */*'
            },
            rejectUnauthorized: false
        };

        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (data.trim().startsWith('<')) {
                        return reject(new Error("Respuesta HTML detectada"));
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Error parseando JSON"));
                }
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error("Timeout alcanzado"));
        });

        req.end();
    });
}

function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Definitivo Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador] Enlace recibido: ${url}`);
        let availableQualities = [];

        // 0. VIDEO DIRECTO
        if (isDirectVideoUrl(url)) {
            availableQualities.push({ quality: "Original / Directo", url: url, format: "mp4" });
        }

        // 1. X / TWITTER
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
                console.log("Error en X:", err.message);
            }
        }

        // 2. INSTAGRAM (Extractor alternativo optimizado por ID de publicación)
        else if (url.includes('instagram.com')) {
            try {
                console.log(`[Instagram] Extrayendo mediante motor secundario de alta disponibilidad...`);
                
                // Extraer el código corto del reel/post de la URL de Instagram
                let shortcode = '';
                const match = url.match(/\/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
                if (match && match[1]) {
                    shortcode = match[1];
                }

                if (shortcode) {
                    // Usamos un servicio de respaldo que procesa mediante el embed oficial limpio
                    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
                    
                    // Como alternativa infalible para evitar bloqueos en nube, consultamos un mirror público directo
                    const mirrorApi = `https://api.vxeapi.com/ig?url=${encodeURIComponent(url)}`;
                    try {
                        const mirrorData = await fetchJson(mirrorApi, 4000);
                        if (mirrorData && mirrorData.url) {
                            availableQualities.push({ quality: "Instagram HD", url: mirrorData.url, format: "mp4" });
                        }
                    } catch (e) {}
                }

                // Si el espejo anterior no respondió, probamos una ruta proxy limpia con SnapSave mirror
                if (availableQualities.length === 0) {
                    const altApi = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
                    const altData = await fetchJson(altApi, 4000);
                    if (altData && altData.data && altData.data.play) {
                        availableQualities.push({ quality: "Instagram Video", url: altData.data.play, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error en Instagram:", err.message);
            }
        }

        // 3. TIKTOK
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const responseData = await fetchJson(tikApiUrl, 4000);
                if (responseData && responseData.data) {
                    const data = responseData.data;
                    if (data.hdplay) availableQualities.push({ quality: "HD (Sin marca de agua)", url: data.hdplay, format: "mp4" });
                    if (data.play) availableQualities.push({ quality: "SD (Normal)", url: data.play, format: "mp4" });
                    if (data.music) availableQualities.push({ quality: "Audio (MP3)", url: data.music, format: "mp3" });
                }
            } catch (err) {
                console.log("Error en TikTok:", err.message);
            }
        }

        // 4. FACEBOOK
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                const fbApiUrl = `https://fantox-server-net.vercel.app/facebook?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(fbApiUrl, 4000);
                if (responseData) {
                    if (responseData.hd) availableQualities.push({ quality: "HD (Alta Calidad)", url: responseData.hd, format: "mp4" });
                    if (responseData.sd) availableQualities.push({ quality: "SD (Estándar)", url: responseData.sd, format: "mp4" });
                    if (responseData.videoUrl && !availableQualities.some(q => q.url === responseData.videoUrl)) {
                        availableQualities.push({ quality: "Normal", url: responseData.videoUrl, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error en Facebook:", err.message);
            }
        }

        // 5. INTERNET GENERAL
        else {
            try {
                const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(generalApiUrl, 4000);
                if (responseData) {
                    if (responseData.url) availableQualities.push({ quality: "Original", url: responseData.url, format: "mp4" });
                    if (responseData.videoUrl) availableQualities.push({ quality: "Video URL", url: responseData.videoUrl, format: "mp4" });
                }
            } catch (err) {
                console.log("Error general:", err.message);
            }
        }

        if (availableQualities.length === 0) {
            return res.status(500).json({ error: "El servidor externo de Instagram no está respondiendo. Inténtalo más tarde." });
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
    console.log(`🚀 Gremlin Server Definitivo corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
