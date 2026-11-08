// 1. EXTRACTOR PARA X / TWITTER (Versión Ultra Limpia)
        else if (url.includes('x.com') || url.includes('twitter.com')) {
            try {
                let cleanUrl = url;
                try {
                    // Extraemos limpiamente el nombre de usuario y el ID del tuit (ignorando /video/1 y ?s=19)
                    const urlObj = new URL(url);
                    const pathParts = urlObj.pathname.split('/');
                    const statusIndex = pathParts.indexOf('status');
                    
                    if (statusIndex !== -1 && pathParts.length > statusIndex + 1) {
                        const username = pathParts[statusIndex - 1];
                        const statusId = pathParts[statusIndex + 1];
                        cleanUrl = `https://twitter.com/${username}/status/${statusId}`;
                    } else {
                        cleanUrl = `https://twitter.com${urlObj.pathname}`;
                    }
                } catch (e) {}

                const fxUrl = cleanUrl
                    .replace('https://twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://www.twitter.com', 'https://api.fxtwitter.com')
                    .replace('https://x.com', 'https://api.fxtwitter.com')
                    .replace('https://www.x.com', 'https://api.fxtwitter.com');
                
                console.log(`[X/Twitter Limpio] Consultando: ${fxUrl}`);
                const responseData = await fetchJson(fxUrl, 5000);

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
