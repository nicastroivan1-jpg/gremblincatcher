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

// Función auxiliar para peticiones HTTP
function fetchUrl(targetUrl) {
    return new Promise((resolve, reject) => {
        const req = https.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, (res) => {
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
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado (Timeout)"));
        });
    });
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server multi-plataforma operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        let { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Cazador] Enlace recibido: ${url}`);

        // Limpiamos los parámetros basura de Twitter/X (ej: ?s=19&a=...) para que la API no falle
        if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                const urlObj = new URL(url);
                url = `${urlObj.origin}${urlObj.pathname}`;
                console.log(`[Cazador] URL limpia de X: ${url}`);
            } catch (e) {
                // Si falla el parseo, se queda con la original
            }
        }

        // Usamos una API libre que procesa múltiples redes sociales de forma robusta
        const endpoint = `https://api.vkrp.ovh/api/v2/social/download?url=${encodeURIComponent(url)}`;
        const response = await fetchUrl(endpoint);

        console.log("Respuesta de la API externa:", JSON.stringify(response));

        let directUrl = null;
        if (response && response.downloads && response.downloads.length > 0) {
            // Buscamos formato MP4
            const mp4Video = response.downloads.find(d => d.extension === 'mp4' || d.quality === 'HD' || d.quality === 'SD');
            directUrl = mp4Video ? mp4Video.url : response.downloads[0].url;
        } else if (response && response.url) {
            directUrl = response.url;
        }

        if (!directUrl) {
            return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
        }

        console.log(`¡Enlace directo obtenido con éxito!`);

        return res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error interno de extracción: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo procesar la solicitud." });
    }
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server corriendo exitosamente en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
