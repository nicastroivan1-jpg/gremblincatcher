const express = require('express');
const cors = require('cors');
const https = require('https');

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Función para hacer peticiones POST a la API pública de Cobalt
function postJson(apiUrl, postData) {
    return new Promise((resolve, reject) => {
        const dataString = JSON.stringify(postData);
        const urlObj = new URL(apiUrl);

        const options = {
            hostname: urlObj.hostname,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(dataString)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Respuesta no válida del servidor"));
                }
            });
        });

        req.on('error', (err) => reject(err));
        req.write(dataString);
        req.end();
    });
}

app.post('/api/caza', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: "Falta la URL de la presa" });
    }

    console.log(`Cazando enlace recibido: ${url}`);

    try {
        // Usamos la API de Cobalt oficial para extraer el video de forma limpia
        const apiResponse = await postJson('https://api.cobalt.tools/api/json', {
            url: url,
            vQuality: 'max'
        });

        let directUrl = null;
        
        if (apiResponse && apiResponse.status === 'redirect' || apiResponse.status === 'stream') {
            directUrl = apiResponse.url;
        } else if (apiResponse && apiResponse.picker && apiResponse.picker.length > 0) {
            directUrl = apiResponse.picker[0].url;
        } else if (apiResponse && apiResponse.url) {
            directUrl = apiResponse.url;
        }

        if (!directUrl) {
            console.error("Respuesta de Cobalt:", JSON.stringify(apiResponse));
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
