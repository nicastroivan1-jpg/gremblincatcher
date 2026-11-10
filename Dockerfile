FROM node:20-slim

# Instalar yt-dlp + ffmpeg + dependencias
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && pip3 install --break-system-packages -U yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 8080

CMD ["node", "index.js"]
RUN apt-get update && apt-get install -y ffmpeg
