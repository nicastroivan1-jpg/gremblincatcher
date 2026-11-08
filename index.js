// ... (mantén el mismo inicio de tu index.js con express, cors, etc.)

        // 1. EXTRACTOR PARA X / TWITTER (Versión Mejorada y Robusta)
        else if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                let cleanUrl = url;
                try {
                    const urlObj = new URL(url);
                    cleanUrl = `https://twitter.com${urlObj.pathname}`;
                } catch (e) {}

                // Usamos la API pública de fxtwitter que es muy estable
                const fxUrl = cleanUrl
                    .replace('https://twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://www.twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://x.com', 'https://api.fxtwitter.com')
                    .replace('https://www.x.com', 'https://api.fxtwitter.com');
                
                console.log(`[X/Twitter] Consultando: ${fxUrl}`);
                const responseData = await fetchJson(fxUrl, 5000);

                // Verificamos múltiples estructuras posibles que devuelve fxtwitter
                let mediaList = null;
                if (responseData && responseData.tweet) {
                    if (responseData.tweet.media && responseData.tweet.media.videos) {
                        mediaList = responseData.tweet.media.videos;
                    } else if (responseData.tweet.videos) {
                        mediaList = responseData.tweet.videos;
                    }
                }

                if (mediaList && mediaList.length > 0) {
                    mediaList.forEach((v, index) => {
                        // Algunas respuestas usan 'url', otras 'fallback_url' o 'direct_url'
                        const videoUrl = v.url || v.fallback_url || v.direct_url;
                        if (videoUrl) {
                            availableQualities.push({
                                quality: v.width ? `${v.width}x${v.height} (HD)` : `Calidad X ${index + 1}`,
                                url: videoUrl,
                                format: "mp4"
                            });
                        }
                    });
                }
            } catch (err) {
                console.log("Error extrayendo de X:", err.message);
            }
        }
