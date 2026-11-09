const express = require('express');
const cors = require('cors');
const https = require('https');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

// ==================== UTILIDADES ====================

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

// ==================== EXTRACTOR CON YT-DLP ====================

async function extractWithYtDlp(url) {
    try {
        console.log(`[yt-dlp] Extrayendo: ${url}`);

        const command = `yt-dlp --dump-json --no-warnings --no-playlist --no-check-certificates "${url}"`;

        const { stdout, stderr } = await execPromise(command, {
            timeout: 25000,
            maxBuffer: 1024 * 1024 * 8 // 8MB
        });

        if (stderr) {
            console.log(`[yt-dlp] stderr: ${stderr.substring(0, 300)}`);
        }

        const info = JSON.parse(stdout);
        const qualities = [];

        if (info.formats && Array.isArray(info.formats)) {
            // Ordenamos por calidad (altura)
            const videoFormats = info.formats
                .filter(f => f.vcodec !== 'none' && f.url && !f.url.includes('m3u8'))
                .sort((a, b) => (b.height || 0) - (a.height || 0));

            const seen = new Set();

            for (const format of videoFormats) {
                const height = format.height || 0;
                const qualityLabel = height ? `${height}p` : (format.format_note || 'Unknown');

                // Evitar duplicados de la misma resolución
                if (!seen.has(qualityLabel)) {
                    seen.add(qualityLabel);
                    qualities.push({
                        quality: `Facebook ${qualityLabel}`,
                        url: format.url,
                        format: format.ext || 'mp4',
                        filesize: format.filesize || null
                    });
                }
            }
        }

        // Fallback: si no encontró formats, usar el url principal
        if (qualities.length === 0 && info.url) {
            qualities.push({
                quality: "Facebook Mejor disponible",
                url: info.url,
                format: info.ext || 'mp4'
            });
        }

        // Si todavía no hay nada, intentar con el thumbnail o info básica
        if (qualities.length === 0 && info.requested_formats) {
            for (const f of info.requested_formats) {
                if (f.url) {
                    qualities.push({
                        quality: f.height ? `Facebook ${f.height}p` : "Facebook",
                        url: f.url,
                        format: f.ext || 'mp4'
                    });
                }
            }
        }

        return qualities;
    } catch (error) {
        console.log(`[yt-dlp] Error: ${error.message}`);
        return [];
    }
}

// ==================== RUTAS ====================

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Multicalidad + yt-dlp Operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        url = url.trim();
        console.log(`[Cazador Multicalidad] Enlace recibido: ${url}`);

        let availableQualities = [];

        // 0. Video directo
        if (isDirectVideoUrl(url)) {
            availableQualities.push({
                quality: "Original / Directo",
                url: url,
                format: "mp4"
            });
        }

        // 1. X / Twitter
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

                console.log(`[X/Twitter] Consultando: ${fxUrl}`);
                const responseData = await fetchJson(fxUrl, 6000);

                let mediaList = null;
                if (responseData?.tweet?.media?.videos) {
                    mediaList = responseData.tweet.media.videos;
                } else if (responseData?.tweet?.videos) {
                    mediaList = responseData.tweet.videos;
                }

                if (mediaList && mediaList.length > 0) {
                    mediaList.forEach((v, index) => {
                        const videoUrl = v.url || v.fallback_url || v.direct_url;
                        if (videoUrl) {
                            availableQualities.push({
                                quality: v.width ? `${v.width}x${v.height}` : `Calidad X ${index + 1}`,
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

        // 2. TikTok
        else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) {
            try {
                console.log(`[TikTok] Consultando calidades...`);
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const responseData = await fetchJson(tikApiUrl, 7000);

                if (responseData?.data) {
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

        // 3. Facebook (con yt-dlp)
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                console.log(`[Facebook] Procesando con yt-dlp: ${url}`);
                const qualities = await extractWithYtDlp(url);

                if (qualities.length > 0) {
                    availableQualities.push(...qualities);
                    console.log(`[Facebook] Se encontraron ${qualities.length} calidades`);
                } else {
                    console.log(`[Facebook] yt-dlp no encontró calidades`);
                }
            } catch (err) {
                console.log("Error extrayendo de Facebook:", err.message);
            }
        }

        // 4. Respaldo general
        else {
            try {
                console.log(`[Internet General] Consultando...`);
                const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                const responseData = await fetchJson(generalApiUrl, 6000);

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

        // Respuesta final
        if (availableQualities.length === 0) {
            return res.status(500).json({
                error: "El Gremlin no pudo extraer ninguna calidad de este enlace."
            });
        }

        console.log(`¡Se encontraron ${availableQualities.length} opciones de descarga!`);

        return res.json({
            status: "success",
            originalUrl: url,
            qualities: availableQualities
        });

    } catch (error) {
        console.error(`Error interno: ${error.message}`);
        return res.status(500).json({
            error: "El Gremlin no pudo procesar la solicitud."
        });
    }
});

// ==================== INICIO DEL SERVIDOR ====================

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server Multicalidad + yt-dlp corriendo en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Excepción no controlada:', err);
});

process.on('unhandledRejection', (reason) => {
    console.error('Promesa rechazada no controlada:', reason);
});
