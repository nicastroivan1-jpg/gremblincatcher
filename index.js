const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 8080;

app.get('/', (req, res) => {
    res.send('¡El servidor de Gremlin está activo y operando con yt-dlp!');
});

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Usamos la librería interna para extraer el enlace de video de forma nativa
        const output = await ytdlp(url, {
            getStatic: true,
            format: 'best[ext=mp4]/best',
            noWarnings: true,
            print: 'url'
        });

        const directUrl = output.toString().trim().split('\n')[0];

        if (!directUrl) {
            return res.status(500).json({ error: "No se pudo obtener un enlace directo válido." });
        }

        console.log(`¡Enlace directo obtenido con éxito!`);

        res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error de extracción interno: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor corriendo y escuchando en el puerto ${PORT}`);
});
