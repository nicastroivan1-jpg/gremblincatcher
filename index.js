const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

// Función para peticiones HTTP nativas sin dependencias extrañas
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("No se pudo parsear la respuesta"));
                }
            });
        }).on('error', err => reject(err));
    });
}

app.get('/', (req, res) => {
    res.send('Gremlin Server funcionando al 100%');
});

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Usamos una API pública de respaldo de alta disponibilidad
        const endpoint = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const response = await fetchUrl(endpoint);

        let directUrl = null;
        if (response && response.data) {
            directUrl = response.data.play || response.data.url;
        }

        // Respaldo secundario si el primero no trae la URL
        if (!directUrl) {
            const fallbackEndpoint = `https://api.delivtub.com/api/v1/video?url=${encodeURIComponent(url)}`;
            const fallbackResponse = await fetchUrl(fallbackEndpoint);
            if (fallbackResponse && fallbackResponse.data && fallbackResponse.data.downloads) {
                directUrl = fallbackResponse.data.downloads[0].url;
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
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
