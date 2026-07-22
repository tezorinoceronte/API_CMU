FROM node:18-bullseye-slim

# Instalar dependencias del sistema y Chromium de forma limpia
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# Configurar variables para Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "api2406.js"]
