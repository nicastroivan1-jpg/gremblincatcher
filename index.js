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

// ==================== UTILIDADES ====================

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

// ==================== EXTRACTOR PRINCIPAL (MEJORADO) ====================

async function extractWithYtDlp(url, platform = 'Video', userCookies = null) {
    let tempCookiesPath = null;

    try {
        console.log(`[yt-dlp] Extrayendo (${platform}): ${url}`);

        const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
        let extraFlags = '';

        // 1. Prioridad: cookies que envió el usuario desde la app
        if (userCookies && typeof userCookies === 'string' && userCookies.length > 30) {
            tempCookiesPath = path.join('/tmp', `ig_cookies_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);

            let cookiesContent = userCookies;

            // Si no es formato Netscape, lo convertimos
            if (!userCookies.includes('# Netscape') && !userCookies.includes('\t')) {
                const lines = ['# Netscape HTTP Cookie File'];
                const pairs = userCookies.split(';').map(c => c.trim()).filter(Boolean);

                for (const pair of pairs) {
                    const eqIndex = pair.indexOf('=');
                    if (eqIndex === -1) continue;

                    const name = pair.substring(0, eqIndex).trim();
                    const value = pair.substring(eqIndex + 1).trim();

                    if (!name) continue;

                    lines.push(`.instagram.com\tTRUE\t/\tTRUE\t1893456000\t${name}\t${value}`);
                    lines.push(`instagram.com\tTRUE\t/\tTRUE\t1893456000\t${name}\t${value}`);
                }
                cookiesContent = lines.join('\n');
            }

            fs.writeFileSync(tempCookiesPath, cookiesContent);
            extraFlags += ` --cookies "${tempCookiesPath}"`;
            console.log(`[yt-dlp] Usando cookies del usuario`);
        }
        // 2. Fallback: cookies globales del servidor
        else if (fs.existsSync(COOKIES_PATH)) {
            extraFlags += ` --cookies "${COOKIES_PATH}"`;
            console.log(`[yt-dlp] Usando cookies globales`);
        } else {
            console.log(`[yt-dlp] Sin cookies disponibles`);
        }

        if (PROXY_URL) {
            extraFlags += ` --proxy "${PROXY_URL}"`;
        }

        const command = `yt-dlp --dump-json --no-warnings --no-playlist --no-check-certificates --force-ipv4 \
--format "(bestvideo[vcodec!=none][acodec!=none]/best[acodec!=none]/best)" \
--user-agent "${userAgent}" \
--add-header "Accept-Language:es-ES,es;q=0.9,en;q=0.8" \
--add-header "Referer:https://www.instagram.com/" \
${extraFlags} "${url}"`;

        const { stdout, stderr } = await execPromise(command, {
            timeout: 40000,
            maxBuffer: 1024 * 1024 * 15
        });

        if (stderr) {
            console.log(`[yt-dlp] stderr: ${stderr.substring(0, 450)}`);

            if (
                stderr.includes("isn't available to everyone") ||
                stderr.includes("can't be seen by certain audiences") ||
                stderr.includes("login required") ||
                stderr.includes("empty media response") ||
                stderr.includes("Requested content is not available")
            ) {
                console.log(`[yt-dlp] Contenido restringido o requiere login`);
                return [];
            }
        }

        const info = JSON.parse(stdout);
        const qualities = [];
        const videoTitle = info.title || info.fulltitle || info.description || null;

        if (info.formats && Array.isArray(info.formats)) {
            const videoFormats = info.formats
                .filter(f => f.vcodec && f.vcodec !== 'none' && f.url && !f.url.includes('m3u8'))
                .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0));

            const seen = new Set();

            for (const format of videoFormats) {
                const height = format.height || 0;
                const hasAudio = format.acodec && format.acodec !== 'none';
                const qualityLabel = height
                    ? `${height}p ${hasAudio ? '(con Audio)' : '(sin Audio)'}`
                    : (format.format_note || 'HD');

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

        // Fallback si no se encontraron formatos separados
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
    } finally {
        // Limpiar archivo temporal de cookies
        if (tempCookiesPath && fs.existsSync(tempCookiesPath)) {
            try {
                fs.unlinkSync(tempCookiesPath);
            } catch (e) {}
        }
    }
}

// ==================== FALLBACKS ====================

async function extractDirectMetaEmbed(url, platform = 'Instagram') {
    const qualities = [];
    try {
        console.log(`[${platform} Embed] Intentando embed...`);
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
    } catch (e) {
        console.log(`[${platform} Embed] Falló: ${e.message}`);
    }
    return qualities;
}

async function extractInstagramApiInfo(url) {
    const qualities = [];
    try {
        const match = url.match(/(?:reel|p|reels)\/([A-Za-z0-9_-]+)/);
        if (!match) return qualities;

        const shortcode = match[1];
        console.log(`[Instagram GraphQL] Shortcode: ${shortcode}`);

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
    } catch (err) {
        console.log(`[Instagram GraphQL] Falló: ${err.message}`);
    }
    return qualities;
}

async function extractInstagramOrThreadsFallback(url, platform = 'Instagram') {
    let qualities = await extractInstagramApiInfo(url);
    if (qualities.length > 0) return qualities;

    qualities = await extractDirectMetaEmbed(url, platform);
    if (qualities.length > 0) return qualities;

    try {
        console.log(`[${platform}] Intentando InDown...`);
        const cleanUrl = url.split('?')[0];
        const res = await fetchJson(`https://api.v2.indown.io/download?url=${encodeURIComponent(cleanUrl)}`, 7000);

        if (res?.data?.length > 0) {
            res.data.forEach((item, idx) =>
