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

// Función fetchJson con Timeout estricto de 5 segundos para evitar bloqueos
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
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                'Accept': 'application/json, text/plain, */*'
            },
            rejectUnauthorized: false
        };

        const req = https.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("No se pudo parsear la respuesta JSON"));
                }
            });
        });

        req.on('error', err => reject(err));
        
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado (Timeout)"));
        });

        req.end();
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

        // 2. EXTRACTOR PARA INSTAGRAM (Optimizado con un proxy de alta velocidad)
        else if (url.includes('instagram.com')) {
            try {
                let cleanIgUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanIgUrl = `${urlObj.origin}${urlObj.pathname}`;
                } catch (e) {}

                console.log(`[Instagram] Consultando motor optimizado...`);
                
                // Usamos un servicio de respaldo altamente veloz especializado en redes
                const igApiUrl = `https://co.wuk.sh/api/json`;
                // Como wuk.sh a veces falla por DNS, implementamos un try con fetch directo a un endpoint alternativo de SnapSave/Cobalt
                
                const postData = JSON.stringify({ url: cleanIgUrl });
                
                const directIgRes = await new Promise((resolve, reject) => {
                    const reqOpts = {
                        hostname: 'api.cobalt.tools',
                        path: '/api/json',
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'Origin': 'https://cobalt.tools',
                            'Referer': 'https://cobalt.tools/',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                        }
                    };

                    const req = https.request(reqOpts, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => {
                            try {
                                resolve(JSON.parse(data));
                            } catch (e) {
                                reject(new Error("Error parseando Cobalt para IG"));
                            }
                        });
                    });

                    req.on('error', reject);
                    req.setTimeout(5000, () => { req.destroy(); reject(new Error("Timeout IG")); });
                    req.write(postData);
                    req.end();
                });

                if (directIgRes) {
                    if (directIgRes.status === 'redirect' || directIgRes.status === 'stream' || directIgRes.status === 'success') {
                        availableQualities.push({ quality: "HD / Original", url: directIgRes.url, format: "mp4" });
                    } else if (directIgRes.picker && directIgRes.picker.length > 0) {
                        directIgRes.picker.forEach((p, idx) => {
                            availableQualities.push({ quality: `Calidad ${idx + 1}`, url: p.url, format: "mp4" });
                        });
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
