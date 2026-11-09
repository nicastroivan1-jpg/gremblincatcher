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

function fetchJson(targetUrl, timeoutMs = 5000) {
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
        
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error("Timeout de red alcanzado"));
        });

        req.end();
    });
}

function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Multicalidad Definitivo Operativo');
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
                    const pathParts = urlObj.pathname.split('/');
                    const statusIndex = pathParts.indexOf('status');
                    
                    if (statusIndex !== -1 && pathParts.length > statusIndex + 1) {
                        const username = pathParts[statusIndex - 1];
                        const statusId = pathParts[statusIndex + 1];
                        cleanUrl = `https://twitter.com/${username}/status/${statusId}`;
                    } else {
                        cleanUrl = `https://twitter.com${urlObj.pathname}`;
                    }
                } catch (e) {}

                const fxUrl = cleanUrl
                    .replace('https://twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://www.twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://x.com', 'https://api.fxtwitter.com')
                    .replace('https://www.x.com', 'https://api.fxtwitter.com');
                
                console.log(`[X/Twitter Limpio] Consultando: ${fxUrl}`);
                const responseData = await fetchJson(fxUrl, 5000);

                let mediaList = null;
                if (responseData && responseData.tweet) {
                    if (responseData.tweet.media && responseData.tweet.media.videos) {
                        mediaList = responseData.tweet.media.videos;
                    } else if (responseData.tweet.videos) {
                        mediaList = responseData.tweet.videos;
                    }
                }

                if (mediaList && mediaList.length > 0) {
                    mediaList.forEach((v, index) => {
                        const videoUrl = v.url || v.fallback_url || v.direct_url;
                        if (videoUrl) {
                            availableQualities.push({
                                quality: v.width ? `${v.width}x${v.height} (HD)` : `Calidad X ${index + 1}`,
                                url: videoUrl,
                                format: "mp4"
                            });
                        }
                    });
                }
            } catch (err) {
                console.log("Error extrayendo de X:", err.message);
            }
        }

        // 2. EXTRACTOR PARA TIKTOK
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                console.log(`[TikTok] Consultando calidades...`);
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const responseData = await fetchJson(tikApiUrl, 5000);

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

        // 3. EXTRACTOR PARA FACEBOOK (Optimizado y Limpio)
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                console.log(`[Facebook] Procesando enlace de la app: ${url}`);

                const backupApiUrl = `https://fantox-server-net.vercel.app/facebook?url=${encodeURIComponent(url)}`;
                let backupData = await fetchJson(backupApiUrl, 8000);

                if (backupData) {
                    if (backupData.hd) {
                        availableQualities.push({ quality: "Facebook HD", url: backupData.hd, format: "mp4" });
                    }
                    if (backupData.sd) {
                        availableQualities.push({ quality: "Facebook SD", url: backupData.sd, format: "mp4" });
                    }
                    if (backupData.videoUrl && !availableQualities.some(q => q.url === backupData.videoUrl)) {
                        availableQualities.push({ quality: "Facebook Normal", url: backupData.videoUrl, format: "mp4" });
                    }
                }

                if (availableQualities.length === 0) {
                    console.log(`[Facebook] Probando motor espejo secundario...`);
                    const mirrorApi = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
                    const mirrorData = await fetchJson(mirrorApi, 5000);

                    if (mirrorData && mirrorData.data) {
                        const data = mirrorData.data;
                        if (data.hdplay) {
                            availableQualities.push({ quality: "Facebook HD", url: data.hdplay, format: "mp4" });
                        }
                        if (data.play) {
                            availableQualities.push({ quality: "Facebook SD", url: data.play, format: "mp4" });
                        }
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Facebook:", err.message);
            }
        }

        // 4. RESPALDO GENERAL PARA OTRAS WEBS
        else {
            try {
                console.log(`[Internet General] Consultando calidades...`);
                const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(generalApiUrl, 5000);

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
