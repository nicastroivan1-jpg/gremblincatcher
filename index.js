const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Función auxiliar para obtener datos mediante una petición HTTP limpia
function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Respuesta no válida del servicio externo"));
                }
            });
        }).on('error', (err) => reject(err));
    });
}

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Usamos una API pública de extracción directa compatible con redes sociales (como Cobalt/Kitsune o similares integradas)
        // O simulamos la respuesta para asegurarnos de que la app reciba el enlace de video de prueba
        
        // Petición a un servicio web público gratuito que procesa enlaces multimedia sin instalar yt-dlp en Railway
        const apiURL = `https://co.wuk.sh/api/json?url=${encodeURIComponent(url)}&vCodec=h264&vQuality=max`;
        
        const responseData = await fetchJson(apiURL);

        let directUrl = null;
        if (responseData && responseData.url) {
            directUrl = responseData.url;
        } else if (responseData && responseData.picker && responseData.picker.length > 0) {
            directUrl = responseData.picker[0].url;
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

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
