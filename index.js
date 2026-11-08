const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

// Función genérica para peticiones GET/POST seguras
function makeRequest(url, method = 'GET', postData = null) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const dataString = postData ? JSON.stringify(postData) : '';

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                ...(postData && {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(dataString)
                })
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("La respuesta no es un JSON válido"));
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (postData) req.write(dataString);
        req.end();
    });
}

app.get('/', (req, res) => {
    res.send('¡El servidor de Gremlin está activo!');
});

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Usamos una API alternativa pública sumamente estable para redes sociales
        const apiUrl = `https://api.delivtub.com/api/v1/video?url=${encodeURIComponent(url)}`;
        const apiResponse = await makeRequest(apiUrl);

        let directUrl = null;

        if (apiResponse && apiResponse.data && apiResponse.data.downloads) {
            // Buscamos la mejor calidad de video disponible (mp4)
            const downloads = apiResponse.data.downloads;
            const bestVideo = downloads.find(d => d.extension === 'mp4') || downloads[0];
            if (bestVideo && bestVideo.url) {
                directUrl = bestVideo.url;
            }
        }

        if (!directUrl) {
            // Intentamos un método de respaldo por si acaso
            console.log("Intentando método de respaldo...");
            const fallbackResponse = await makeRequest(`https://co.wuk.sh/api/json`, 'POST', { url: url });
            if (fallbackResponse && fallbackResponse.url) {
                directUrl = fallbackResponse.url;
            }
        }

        if (!directUrl) {
            return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
        }

        console.log(`¡Enlace directo obtenido con éxito!`);

        res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error de extracción: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo procesar la solicitud." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo y escuchando en el puerto ${PORT}`);
});
