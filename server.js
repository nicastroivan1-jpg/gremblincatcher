const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-exec'); // Usamos la librería integrada

const app = express();
app.use(express.json());
app.use(cors());

// Puerto dinámico (Render asigna uno automáticamente, o usa el 3000 en local)
const PORT = process.env.PORT || 3000;

// Endpoint principal que consumirá tu app de Android
app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Ejecutamos yt-dlp usando la librería para obtener el enlace directo (-g)
        const output = await ytdlp(url, {
            getStatic: true, // Equivalente a la bandera -g
            format: 'best[ext=mp4]/best',
            noWarnings: true,
            print: 'url'
        });

        // La salida puede venir con saltos de línea si separa flujos, tomamos la primera línea limpia
        const directUrl = output.toString().trim().split('\n')[0];

        if (!directUrl) {
            return res.status(500).json({ error: "No se pudo obtener un enlace directo válido." });
        }

        console.log(`¡Enlace directo obtenido con éxito!`);

        // Devolvemos la URL limpia en formato JSON a tu app de Android
        res.json({
            status: "success",
            originalUrl: url,
            downloadUrl: directUrl,
            format: "mp4"
        });

    } catch (error) {
        console.error(`Error de extracción: ${error.message}`);
        return res.status(500).json({ error: "El Gremlin no pudo extraer el enlace de esta plataforma." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor privado de Gremlincatcher corriendo en el puerto ${PORT}`);
});