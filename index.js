const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

const COOKIES_PATH = process.env.COOKIES_PATH || path.join(__dirname, 'cookies.txt');
const PROXY_URL = process.env.PROXY_URL || null;

if (process.env.INSTAGRAM_COOKIES_BASE64) {
    try {
        const decoded = Buffer.from(process.env.INSTAGRAM_COOKIES_BASE64, 'base64').toString('utf-8');
        fs.writeFileSync(COOKIES_PATH, decoded);
        console.log('[Config] Cookies de Instagram cargadas desde variable de entorno.');
    } catch (e) {
        console.error('[Config] Error decodificando INSTAGRAM_COOKIES_BASE64:', e.message);
    }
}

// ==================== UTILIDADES ====================

function fetchJson(targetUrl, timeoutMs = 8000, options = {}) {
    return new Promise((resolve, reject) => {
        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch (e) {
            return reject(new Error("URL no válida"));
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                ...(options.headers || {})
            },
            rejectUnauthorized: false
        };

        const req = protocol.request(reqOptions, (res) => {
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

        if (options.body) {
            req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
        }

        req.end();
    });
}

function isDirectVideoUrl(url) {
    return url.match(/\.(mp4|m3u8|mov|webm)([\?#]|$)/i);
}

// ==================== EXTRACTOR CON YT-DLP ====================

async function extractWithYtDlp(url, platform = 'Video') {
    try {
        console.log(`[yt-dlp] Extrayendo (${platform}): ${url}`);

        const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
        
        let extraFlags = '';
        if (fs.existsSync(COOKIES_PATH)) {
            extraFlags += ` --cookies "${COOKIES_PATH}"`;
        }
        if (PROXY_URL) {
            extraFlags += ` --proxy "${PROXY_URL}"`;
        }

        const command = `yt-dlp --dump-json --no-warnings --no-playlist --no-check-certificates --user-agent "${userAgent}"${extraFlags} "${url}"`;

        const { stdout, stderr } = await execPromise(command, {
            timeout: 25000,
            maxBuffer: 1024 * 1024 * 10
        });

        if (stderr) {
            console.log(`[yt-dlp] stderr: ${stderr.substring(0, 300)}`);
        }

        const info = JSON.parse(stdout);
        const qualities = [];
        const videoTitle = info.title || info.fulltitle || info.description || null;

        if (info.formats && Array.isArray(info.formats)) {
            const videoFormats = info.formats
                .filter(f => f.vcodec !== 'none' && f.url && !f.url.includes('m3u8'))
                .sort((a, b) => (b.height || 0) - (a.height || 0));

            const seen = new Set();

            for (const format of videoFormats) {
                const height = format.height || 0;
                const qualityLabel = height ? `${height}p` : (format.format_note || 'Unknown');

                if (!seen.has(qualityLabel)) {
                    seen.add(qualityLabel);
                    qualities.push({
                        quality: `${platform} ${qualityLabel}`,
                        url: format.url,
                        format: format.ext || 'mp4',
                        filesize: format.filesize || null,
                        title: videoTitle
                    });
                }
            }
        }

        if (qualities.length === 0 && info.url) {
            qualities.push({
                quality: `${platform} Mejor disponible`,
                url: info.url,
                format: info.ext || 'mp4',
                title: videoTitle
            });
        }

        return qualities;
    } catch (error) {
        console.log(`[yt-dlp] Error (${platform}): ${error.message}`);
        return [];
    }
}

async function extractDirectMetaEmbed(url, platform = 'Instagram') {
    const qualities = [];
    try {
        console.log(`[${platform} Direct Embed] Extrayendo por embed/captioned HTML...`);
        let cleanUrl = url.split('?')[0].replace(/\/$/, '');
        const embedUrl = `${cleanUrl}/embed/captioned/`;

        const embedHtml = await new Promise((resolve, reject) => {
            https.get(embedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Sec-Fetch-Site': 'same-origin'
                }
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => resolve(body));
            }).on('error', reject);
        });

        const videoMatch = embedHtml.match(/"video_url":"([^"]+)"/) || embedHtml.match(/src="([^"]+\.mp4[^"]*)"/);
        if (videoMatch && videoMatch[1]) {
            const rawUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
            qualities.push({
                quality: `${platform} Embed HD`,
                url: rawUrl,
                format: 'mp4'
            });
        }
    } catch (e) {
        console.log(`[${platform} Embed] Falló: ${e.message}`);
    }
    return qualities;
}

async function extractInstagramOrThreadsFallback(url, platform = 'Instagram') {
    let qualities = await extractDirectMetaEmbed(url, platform);
    if (qualities.length > 0) return qualities;

    try {
        console.log(`[${platform} Fallback] Intentando vía APIs alternativas para ${url}`);
        const apiUrl = `https://api.v2.ddinstagram.com/api/info?url=${encodeURIComponent(url)}`;
        const data = await fetchJson(apiUrl, 6000);

        if (data && data.video_url) {
            qualities.push({
                quality: `${platform} HD Directo`,
                url: data.video_url,
                format: "mp4"
            });
            return qualities;
        }
    } catch (err) {
        console.log(`[${platform} Fallback Directo] Falló: ${err.message}`);
    }

    return qualities;
}

// ==================== RUTAS ====================

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server Multicalidad + yt-dlp + Instagram & Threads Operativo');
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

        // 1. Threads
        else if (url.includes('threads.net') || url.includes('threads.com')) {
            try {
                console.log(`[Threads] Procesando con yt-dlp...`);
                let qualities = await extractWithYtDlp(url, 'Threads');
                if (qualities.length > 0) availableQualities.push(...qualities);

                if (availableQualities.length === 0) {
                    console.log(`[Threads] yt-dlp falló, activando cascada de respaldos...`);
                    const fallbackResults = await extractInstagramOrThreadsFallback(url, 'Threads');
                    if (fallbackResults.length > 0) availableQualities.push(...fallbackResults);
                }
            } catch (err) {
                console.log("Error extrayendo de Threads:", err.message);
            }
        }

        // 2. Instagram
        else if (url.includes('instagram.com') || url.includes('instagr.am')) {
            try {
                let cleanIgUrl = url.includes('?') ? url.split('?')[0] : url;
                console.log(`[Instagram] Procesando con yt-dlp: ${cleanIgUrl}`);
                
                let qualities = await extractWithYtDlp(cleanIgUrl, 'Instagram');
                if (qualities.length > 0) availableQualities.push(...qualities);

                if (availableQualities.length === 0) {
                    console.log(`[Instagram] yt-dlp falló, probando respaldos alternativos...`);
                    const fallbackResults = await extractInstagramOrThreadsFallback(cleanIgUrl, 'Instagram');
                    if (fallbackResults.length > 0) availableQualities.push(...fallbackResults);
                }

                if (availableQualities.length === 0) {
                    console.log(`[Instagram] Probando Respaldo Fantox API...`);
                    const backupApi = `https://fantox-server-net.vercel.app/instagram?url=${encodeURIComponent(cleanIgUrl)}`;
                    const backupData = await fetchJson(backupApi, 6000);

                    if (backupData) {
                        if (backupData.url && !backupData.url.includes('html')) {
                            availableQualities.push({ quality: "Instagram HD", url: backupData.url, format: "mp4" });
                        }
                        if (backupData.videoUrl && !backupData.videoUrl.includes('html')) {
                            availableQualities.push({ quality: "Instagram Normal", url: backupData.videoUrl, format: "mp4" });
                        }
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Instagram:", err.message);
            }
        }

        // 3. X / Twitter
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

        // 4. TikTok
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

        // 5. Facebook
        else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                console.log(`[Facebook] Procesando con yt-dlp: ${url}`);
                const qualities = await extractWithYtDlp(url, 'Facebook');
                if (qualities.length > 0) availableQualities.push(...qualities);

                if (availableQualities.length === 0) {
                    console.log(`[Facebook] yt-dlp falló, probando respaldo Fantox...`);
                    const backupApi = `https://fantox-server-net.vercel.app/facebook?url=${encodeURIComponent(url)}`;
                    const backupData = await fetchJson(backupApi, 7000);

                    if (backupData) {
                        if (backupData.hd && !backupData.hd.includes('html')) {
                            availableQualities.push({ quality: "Facebook HD", url: backupData.hd, format: "mp4" });
                        }
                        if (backupData.sd && !backupData.sd.includes('html')) {
                            availableQualities.push({ quality: "Facebook SD", url: backupData.sd, format: "mp4" });
                        }
                    }
                }
            } catch (err) {
                console.log("Error extrayendo de Facebook:", err.message);
            }
        }

        // 6. RESPALDO GENERAL
        else {
            try {
                console.log(`[Internet General] Extrayendo con yt-dlp universal: ${url}`);
                const qualities = await extractWithYtDlp(url, 'Web');

                if (qualities.length > 0) {
                    availableQualities.push(...qualities);
                } else {
                    console.log(`[Internet General] Probando API de extracción genérica...`);
                    const generalApiUrl = `https://fantox-server-net.vercel.app/download?url=${encodeURIComponent(url)}`;
                    const responseData = await fetchJson(generalApiUrl, 6000);

                    if (responseData && responseData.url) {
                        availableQualities.push({ quality: "Original", url: responseData.url, format: "mp4" });
                    }
                }
            } catch (err) {
                console.log("Error en extracción general:", err.message);
            }
        }

        if (availableQualities.length === 0) {
            return res.status(404).json({
                status: "error",
                error: "No se pudo extraer video de este enlace. Verifica si la cuenta es privada o si el contenido fue eliminado."
            });
        }

        console.log(`¡Se encontraron ${availableQualities.length} opciones de descarga!`);

        const mejorOpcion = availableQualities[0];
        const primaryDownloadUrl = mejorOpcion.url || mejorOpcion.download_url;
        const videoFormat = mejorOpcion.format || "mp4";
        
        let rawTitle = mejorOpcion.title || `video_${Date.now()}`;
        let cleanTitle = rawTitle
            .replace(/[/\\?%*:|"<>]/g, '')
            .substring(0, 60)
            .trim();
        
        if (!cleanTitle) cleanTitle = `gremlin_caza_${Date.now()}`;
        const safeFilename = `${cleanTitle}.${videoFormat}`;

        const formattedQualities = availableQualities.map(q => ({
            quality: q.quality,
            download_url: q.url || q.download_url,
            format: q.format || "mp4",
            filesize: q.filesize || null
        }));

        return res.json({
            status: "success",
            title: cleanTitle,
            originalUrl: url,
            download_url: primaryDownloadUrl,
            filename: safeFilename,
            format: videoFormat,
            qualities: formattedQualities
        });

    } catch (error) {
        console.error(`Error no controlado en endpoint: ${error.message}`);
        return res.status(500).json({
            status: "error",
            error: "Error interno del servidor procesando la solicitud."
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
