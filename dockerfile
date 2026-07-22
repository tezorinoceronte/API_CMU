FROM node:18-bullseye-slim

# 1. Definir directorio de trabajo primero
WORKDIR /app

# 2. Instalar dependencias del sistema y Chromium nativo
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    chromium \
    && rm -rf /var/lib/apt/lists/*

# 3. Configurar variables para que Puppeteer use el Chromium del sistema
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 4. Copiar package.json e instalar dependencias de Node
COPY package*.json ./
RUN npm install

# 5. Copiar el resto del código fuente
COPY . .

# 6. Comando de arranque
CMD ["node", "api2406.js"]
