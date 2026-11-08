const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

// Puerto seguro provisto por Railway o respaldo local 8080
const PORT = process.env.PORT || 8080;

// Manejo de errores global para evitar que el proceso muera por SIGTERM silencioso
process.on('uncaughtException', (err) => {
    console.error('Excepción no controlada:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Promesa rechazada no controlada:', reason);
});

// Función auxiliar para peticiones HTTP
function fetchUrl(targetUrl) {
    return new Promise((resolve, reject) => {
        const req = https.get(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
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
        req.setTimeout(8000, () => {
            req.destroy();
            reject(new Error("Tiempo de espera agotado (Timeout)"));
        });
    });
}

app.get('/', (req, res) => {
    res.status(200).send('Gremlin Server blindado y operativo');
});

app.post('/api/caza', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ error: "Falta la URL de la presa" });
        }

        console.log(`[Blindado] Cazando enlace recibido: ${url}`);

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

// Inicialización limpia del servidor escuchando en 0.0.0.0
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Gremlin Server corriendo exitosamente en el puerto ${PORT}`);
});

server.on('error', (err) => {
    console.error('Error en el servidor HTTP:', err);
});
