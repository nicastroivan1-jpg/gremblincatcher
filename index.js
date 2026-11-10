const express = require('express');
const cors = require('cors');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(cors());

const PORT = process.env.PORT || 8080;
const COOKIES_PATH = process.env.COOKIES_PATH || path.join(__dirname, 'cookies.txt');
const PROXY_URL = process.env.PROXY_URL || null;

// Servir estáticos de descargas procesadas localmente por FFmpeg
const DOWNLOADS_DIR = path.join('/tmp', 'gremlin_downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}
app.use('/downloads', express.static(DOWNLOADS_DIR));

// Cargar cookies globales desde variable de entorno (opcional)
if (process.env.INSTAGRAM_COOKIES_BASE64) {
    try {
        const decoded = Buffer.from(process.env.INSTAGRAM_COOKIES_BASE64, 'base64').toString('utf-8');
        fs.writeFileSync(COOKIES_PATH, decoded);
        console.log('[Config] Cookies globales de Instagram cargadas desde variable de entorno.');
    } catch (e) {
        console.error('[Config] Error decodificando INSTAGRAM_COOKIES_BASE64:', e.message);
    }
}

// ==================== UTILIDADES DE RED ====================

function fetchJson(targetUrl, timeoutMs = 8000, options = {}, redirectCount = 0) {
    return new Promise((resolve, reject) => {
        if (redirectCount > 5) return reject(new Error("Demasiadas redirecciones"));

        let urlObj;
        try {
            urlObj = new URL(targetUrl);
        } catch (e) {
            return reject(new Error("URL no válida"));
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;

        const browserHeaders = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            ...(options.headers || {})
        };

        const reqOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: browserHeaders,
            rejectUnauthorized: false
        };

        const req = protocol.request(reqOptions, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    redirectUrl = new URL(redirectUrl, targetUrl).toString();
                }
                return resolve(fetchJson(redirectUrl, timeoutMs, options, redirectCount + 1));
            }

            let chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                let buffer = Buffer.concat(chunks);
                const encoding = res.headers['content-encoding'];

                const decompress = (buf, cb) => {
                    if (encoding === 'gzip') return zlib.gunzip(buf, cb);
                    if (encoding === 'deflate') return zlib.inflate(buf, cb);
                    if (encoding === 'br') return zlib.brotliDecompress(buf, cb);
                    return cb(null, buf);
                };

                decompress(buffer, (err, decompressed) => {
                    if (err) return reject(new Error("Error descomprimiendo respuesta"));

                    const textData = decompressed.toString('utf-8');
                    try {
                        if (textData.trim().startsWith('<')) {
                            return reject(new Error("Respuesta HTML detectada"));
                        }
                        resolve(JSON.parse(textData));
                    } catch (e) {
                        reject(new Error("Error parseando JSON"));
                    }
                });
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

// Limpiar archivos locales con más de 30 minutos de antigüedad
function cleanOldFiles() {
    try {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        const now = Date.now();
        files.forEach(file => {
            const filePath = path.join(DOWNLOADS_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > 30 * 60 * 1000) {
                fs.unlinkSync(filePath);
            }
        });
    } catch (e) {}
}

// ==================== PROCESADOR DE DESCARGA CON FFMPEG REAL ====================

async function downloadAndMergeWithYtDlp(url, hostHeaderUrl, userCookies = null) {
    let tempCookiesPath = null;
    const fileId = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const outputTemplate = path.join(DOWNLOADS_DIR, `${fileId}.%(ext)s`);

    try {
        console.log(`[FFmpeg Server Engine] Procesando y uniendo streams para: ${url}`);
        cleanOldFiles();

        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        let extraFlags = '';

        if (userCookies && typeof userCookies === 'string' && userCookies.length > 30) {
            tempCookiesPath = path.join('/tmp', `ig_cookies_${Date.now()}.txt`);
            let cookiesContent = userCookies;

            if (!userCookies.includes('# Netscape') && !userCookies.includes('\t')) {
                const lines = ['# Netscape HTTP Cookie File'];
                const pairs = userCookies.split(';').map(c => c.trim()).filter(Boolean);

                for (const pair of pairs) {
                    const eqIndex = pair.indexOf('=');
                    if (eqIndex === -1) continue;

                    const name = pair.substring(0, eqIndex).trim();
                    const value = pair.substring(eqIndex + 1).trim();
                    if (!name) continue;
                    lines.push(`.facebook.com\tTRUE\t/\tTRUE\t1893456000\t${name}\t${value}`);
                }
                cookiesContent = lines.join('\n');
            }

            fs.writeFileSync(tempCookiesPath, cookiesContent);
            extraFlags += ` --cookies "${tempCookiesPath}"`;
        } else if (fs.existsSync(COOKIES_PATH)) {
            extraFlags += ` --cookies "${COOKIES_PATH}"`;
        }

        if (PROXY_URL) {
            extraFlags += ` --proxy "${PROXY_URL}"`;
        }

        // Descarga física local uniendo vídeo HD + audio mediante FFmpeg
        const command = `yt-dlp --no-warnings --no-playlist --no-check-certificates --force-ipv4 \
-f "bv*+ba/b" \
--merge-output-format mp4 \
-o "${outputTemplate}" \
--user-agent "${userAgent}" \
--add-header "Accept-Language:es-ES,es;q=0.9,en;q=0.8" \
${extraFlags} "${url}"`;

        await execPromise(command, { timeout: 120000, maxBuffer: 1024 * 1024 * 50 });

        const finalFile = path.join(DOWNLOADS_DIR, `${fileId}.mp4`);
        if (fs.existsSync(finalFile)) {
            const publicUrl = `${hostHeaderUrl}/downloads/${fileId}.mp4`;
            console.log(`[FFmpeg Server Engine] Archivo procesado exitosamente: ${publicUrl}`);
            return [{
                quality: "Facebook HD 1080p (Audio Incrustado Server)",
                url: publicUrl,
                format: "mp4"
            }];
        }
    } catch (e) {
        console.log(`[FFmpeg Server Engine] Falló la descarga física: ${e.message}`);
    } finally {
        if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
            try { fs.unlinkSync(tempCookiesPath); } catch (e) {}
        }
    }
    return [];
}

// ==================== EXTRACTOR PRINCIPAL (MODO LIGERO) ====================

async function extractWithYtDlp(url, platform = 'Video', userCookies = null) {
    let tempCookiesPath = null;

    try {
        console.log(`[yt-dlp] Extrayendo JSON (${platform}): ${url}`);

        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        let extraFlags = '';

        if (userCookies && typeof userCookies === 'string' && userCookies.length > 30) {
            tempCookiesPath = path.join('/tmp', `ig_cookies_${Date.now()}.txt`);
            fs.writeFileSync(tempCookiesPath, userCookies);
            extraFlags += ` --cookies "${tempCookiesPath}"`;
        } else if (fs.existsSync(COOKIES_PATH)) {
            extraFlags += ` --cookies "${COOKIES_PATH}"`;
        }

        if (PROXY_URL) extraFlags += ` --proxy "${PROXY_URL}"`;

        const command = `yt-dlp --dump-json --no-warnings --no-playlist --no-check-certificates --force-ipv4 \
-f "best[acodec!=none]/best" \
--user-agent "${userAgent}" \
--add-header "Accept-Language:es-ES,es;q=0.9,en;q=0.8" \
${extraFlags} "${url}"`;

        const { stdout, stderr } = await execPromise(command, {
            timeout: 45000,
            maxBuffer: 1024 * 1024 * 20
        });

        if (stderr && (stderr.includes("login required") || stderr.includes("empty media response"))) {
            return [];
        }

        const info = JSON.parse(stdout);
        const qualities = [];
        const videoTitle = info.title || info.fulltitle || info.description || null;

        if (info.formats && Array.isArray(info.formats)) {
            const videoFormats = info.formats
                .filter(f => f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none' && f.url && !f.url.includes('m3u8'))
                .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));

            const seen = new Set();

            for (const format of videoFormats) {
                const height = format.height || 0;
                const qualityLabel = height ? `${height}p SD/HD (con Audio)` : 'HD (con Audio)';

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
                quality: `${platform} Disponible (con Audio)`,
                url: info.url,
                format: info.ext || 'mp4',
                title: videoTitle
            });
        }

        return qualities;
    } catch (error) {
        console.log(`[yt-dlp JSON] Error (${platform}): ${error.message}`);
        return [];
    } finally {
        if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
            try { fs.unlinkSync(tempCookiesPath); } catch (e) {}
        }
    }
}

// ==================== FALLBACKS INSTAGRAM & THREADS ====================

async function extractDirectMetaEmbed(url, platform = 'Instagram') {
    const qualities = [];
    try {
        let cleanUrl = url.split('?')[0].replace(/\/$/, '');
        const embedUrl = `${cleanUrl}/embed/captioned/`;

        const embedHtml = await new Promise((resolve, reject) => {
            https.get(embedUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            }, (res) => {
                let body = '';
                res.on('data', c => body += c);
                res.on('end', () => resolve(body));
            }).on('error', reject);
        });

        const videoMatch = embedHtml.match(/"video_url":"([^"]+)"/) ||
                           embedHtml.match(/src="([^"]+\.mp4[^"]*)"/) ||
                           embedHtml.match(/<video[^>]+src="([^"]+)"/);

        if (videoMatch && videoMatch[1]) {
            const rawUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
            qualities.push({
                quality: `${platform} Embed HD`,
                url: rawUrl,
                format: 'mp4'
            });
        }
    } catch (e) {}
    return qualities;
}

async function extractInstagramApiInfo(url) {
    const qualities = [];
    try {
        const match = url.match(/(?:reel|p|reels)\/([A-Za-z0-9_-]+)/);
        if (!match) return qualities;

        const shortcode = match[1];
        const apiUrl = `https://www.instagram.com/graphql/query/?query_hash=b3055318a4540f425865946d3a9d0411&variables=${encodeURIComponent(JSON.stringify({ shortcode }))}`;

        const data = await fetchJson(apiUrl, 8000, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'X-IG-App-ID': '936619743392459'
            }
        });

        const media = data?.data?.shortcode_media;
        if (media && media.is_video && media.video_url) {
            qualities.push({
                quality: "Instagram GraphQL HD",
                url: media.video_url,
                format: "mp4",
                title: media.edge_media_to_caption?.edges?.[0]?.node?.text || null
            });
        }
    } catch (err) {}
    return qualities;
}

async function extractInstagramOrThreadsFallback(url, platform = 'Instagram') {
    let qualities = await extractInstagramApiInfo(url);
    if (qualities.length > 0) return qualities;

    qualities = await extractDirectMetaEmbed(url, platform);
    if (qualities.length > 0) return qualities;

    try {
        const cleanUrl = url.split('?')[0];
        const res = await fetchJson(`https://api.v2.indown.io/download?url=${encodeURIComponent(cleanUrl)}`, 7000);

        if (res?.data?.length > 0) {
            res.data.forEach((item, idx) => {
                if (item.url) {
                    qualities.push({
                        quality: `${platform} HD ${idx + 1}`,
                        url: item.url,
                        format: "mp4"
                    });
                }
            });
        }
    } catch (err) {}

    return qualities;
}

// ==================== RUTAS ====================

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server v2.6 — FFmpeg Real Download Engine');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url, cookies } = req.body;

        if (!url || typeof url !== 'string') {
            return res.status(400).json({ status: "error", error: "Falta la URL de la presa" });
        }

        url = url.trim();
        const hostHeaderUrl = `${req.protocol}://${req.get('host')}`;
        console.log(`[Cazador] Enlace recibido: ${url}`);

        let availableQualities = [];

        if (isDirectVideoUrl(url)) {
            availableQualities.push({ quality: "Original / Directo", url: url, format: "mp4" });
        } else if (url.includes('threads.net') || url.includes('threads.com')) {
            try {
                let qualities = await extractWithYtDlp(url, 'Threads', cookies);
                if (qualities.length > 0) availableQualities.push(...qualities);

                if (availableQualities.length === 0) {
                    const fallback = await extractInstagramOrThreadsFallback(url, 'Threads');
                    if (fallback.length > 0) availableQualities.push(...fallback);
                }
            } catch (err) {}
        } else if (url.includes('instagram.com') || url.includes('instagr.am')) {
            try {
                const cleanIgUrl = url.includes('?') ? url.split('?')[0] : url;

                let qualities = await extractWithYtDlp(cleanIgUrl, 'Instagram', cookies);
                if (qualities.length > 0) availableQualities.push(...qualities);

                if (availableQualities.length === 0) {
                    const fallback = await extractInstagramOrThreadsFallback(cleanIgUrl, 'Instagram');
                    if (fallback.length > 0) availableQualities.push(...fallback);
                }
            } catch (err) {}
        } else if (url.includes('x.com') || url.includes('twitter.com')) {
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
                    }
                } catch (e) {}

                const fxUrl = cleanUrl
                    .replace('https://twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://www.twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://x.com', 'https://api.fxtwitter.com')
                    .replace('https://www.x.com', 'https://api.fxtwitter.com');

                try {
                    const data = await fetchJson(fxUrl, 8000);
                    const mediaList = data?.tweet?.media?.videos || data?.tweet?.videos || [];

                    mediaList.forEach((v, i) => {
                        const videoUrl = v.url || v.fallback_url || v.direct_url;
                        if (videoUrl) {
                            availableQualities.push({
                                quality: v.width ? `${v.width}x${v.height}` : `X ${i + 1}`,
                                url: videoUrl,
                                format: "mp4"
                            });
                        }
                    });
                } catch (e) {
                    const qualities = await extractWithYtDlp(url, 'Twitter');
                    if (qualities.length > 0) availableQualities.push(...qualities);
                }
            } catch (err) {}
        } else if (url.includes('tiktok.com') || url.includes('vm.tiktok.com') || url.includes('vt.tiktok.com')) {
            try {
                const tikApiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
                const data = await fetchJson(tikApiUrl, 8000);

                if (data?.data) {
                    if (data.data.hdplay) availableQualities.push({ quality: "HD (Sin marca)", url: data.data.hdplay, format: "mp4" });
                    if (data.data.play) availableQualities.push({ quality: "SD", url: data.data.play, format: "mp4" });
                    if (data.data.music) availableQualities.push({ quality: "Audio MP3", url: data.data.music, format: "mp3" });
                }

                if (availableQualities.length === 0) {
                    const qualities = await extractWithYtDlp(url, 'TikTok');
                    if (qualities.length > 0) availableQualities.push(...qualities);
                }
            } catch (err) {}
        } else if (url.includes('facebook.com') || url.includes('fb.watch') || url.includes('fb.me')) {
            try {
                // 1. Probar descarga física completa uniendo HD + audio vía FFmpeg en servidor
                let mergedResult = await downloadAndMergeWithYtDlp(url, hostHeaderUrl, cookies);
                if (mergedResult.length > 0) {
                    availableQualities.push(...mergedResult);
                } else {
                    // 2. Si la descarga física falla, usar selector ligero con audio garantizado
                    const qualities = await extractWithYtDlp(url, 'Facebook', cookies);
                    if (qualities.length > 0) availableQualities.push(...qualities);
                }
            } catch (err) {
                console.log("Error Facebook:", err.message);
            }
        } else {
            try {
                const qualities = await extractWithYtDlp(url, 'Web');
                if (qualities.length > 0) availableQualities.push(...qualities);
            } catch (err) {}
        }

        if (availableQualities.length === 0) {
            return res.status(404).json({
                status: "error",
                error: "No se pudo extraer el video. Puede estar restringido, ser privado o requerir inicio de sesión."
            });
        }

        const best = availableQualities[0];
        const downloadUrl = best.url || best.download_url;
        const format = best.format || "mp4";

        let rawTitle = best.title || `gremlin_${Date.now()}`;
        let cleanTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '').substring(0, 55).trim();
        if (!cleanTitle) cleanTitle = `gremlin_caza_${Date.now()}`;

        const filename = `${cleanTitle}.${format}`;

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
            download_url: downloadUrl,
            filename: filename,
            format: format,
            qualities: formattedQualities
        });

    } catch (error) {
        console.error(`Error no controlado: ${error.message}`);
        return res.status(500).json({ status: "error", error: "Error interno del servidor" });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server v2.6 (FFmpeg Real Download Engine) corriendo en puerto ${PORT}`);
});
