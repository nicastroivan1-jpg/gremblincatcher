const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

app.post('/api/caza', (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    // Usamos Python directamente para ejecutar yt-dlp como módulo
    const command = `python3 -m yt_dlp -g --format "best[ext=mp4]/best" "${url}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error de extracción: ${error.message}`);
            return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
        }

        const directUrl = stdout.trim().split('\n')[0];

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
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
