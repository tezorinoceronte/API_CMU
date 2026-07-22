FROM node:18-bullseye-slim

# 1. Ajuste de dependencias (necesarias para Chromium en Debian)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    libxss1 \
    && rm -rf /var/lib/apt/lists/*

# 2. Variable de entorno crucial
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# 3. Importante: Asegúrate de que el comando de inicio sea tu archivo principal
# Si tu archivo principal es api2406.js, cámbialo aquí
CMD ["node", "api2406.js"]
