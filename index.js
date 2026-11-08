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

// Función POST segura para APIs de extracción avanzadas
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
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Content-Length': Buffer.byteLength(dataString),
                ...customHeaders
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    if (data.trim().startsWith('<')) {
                        return reject(new Error("El servidor devolvió HTML (Bloqueo de seguridad)"));
                    }
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Respuesta no válida del servidor externo"));
                }
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(8000, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado"));
        });

        req.write(dataString);
        req.end();
    });
}

function fetchJson(targetUrl, timeoutMs = 6000) {
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
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
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("Timeout")); });
        req.end();
    });
}

function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Multicalidad Operativo V5');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador Multicalidad] Enlace recibido: ${url}`);
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

        // 2. INSTAGRAM (Con motor espejo dual altamente optimizado)
        else if (url.includes('instagram.com')) {
            try {
                let cleanIgUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanIgUrl = `${urlObj.origin}${urlObj.pathname}`;
                } catch (e) {}

                console.log(`[Instagram] Consultando motor primario v2...`);
                
                // Intento con API espejo pública de alta velocidad para IG
                try {
                    const igApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(cleanIgUrl)}`;
                    const responseData = await fetchJson(igApiUrl, 5000);
                    if (responseData && responseData.data) {
                        if (responseData.data.play) {
                            availableQualities.push({ quality: "Instagram HD", url: responseData.data.play, format: "mp4" });
                        }
                    }
                } catch (e) {
                    console.log("Motor primario IG falló, intentando respaldo...");
                }

                // Intento de respaldo secundario si el primario no devolvió nada
                if (availableQualities.length === 0) {
                    const backupUrl = `https://fantox-server-net.vercel.app/instagram?url=${encodeURIComponent(cleanIgUrl)}`;
                    const backupData = await fetchJson(backupUrl, 5000);
                    if (backupData) {
                        if (backupData.videoUrl) availableQualities.push({ quality: "HD / Original", url: backupData.videoUrl, format: "mp4" });
                        if (backupData.sd) availableQualities.push({ quality: "SD (Estándar)", url: backupData.sd, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Instagram:", err.message);
            }
        }

        // 3. TIKTOK
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const responseData = await fetchJson(tikApiUrl);
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
                const responseData = await fetchJson(fbApiUrl);
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
                const responseData = await fetchJson(generalApiUrl);
                if (responseData) {
                    if (responseData.url) availableQualities.push({ quality: "Original", url: responseData.url, format: "mp4" });
                    if (responseData.videoUrl) availableQualities.push({ quality: "Video URL", url: responseData.videoUrl, format: "mp4" });
                }
            } catch (err) {
                console.log("Error general:", err.message);
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
    console.log(`🚀 Gremlin Server Multicalidad V5 corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
