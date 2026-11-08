const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

// Función para peticiones HTTP nativas
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
    res.send('Gremlin Server v2.0 - Funcionando limpio');
});

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`[v2.0] Cazando enlace recibido: ${url}`);

    try {
        // Usamos una ruta directa y estable que no depende de dominios caídos
        const endpoint = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
        const response = await fetchUrl(endpoint);

        let directUrl = null;
        if (response && response.data) {
            directUrl = response.data.play || response.data.url;
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
    console.log(`🚀 Servidor v2.0 corriendo y escuchando en el puerto ${PORT}`);
});
