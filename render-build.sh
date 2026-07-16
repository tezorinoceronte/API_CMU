#!/usr/bin/env bash
# Salir inmediatamente si hay un error
set -o errexit

# Instalar dependencias de Node.js
npm install

# Instalar dependencias necesarias para que Chrome/Puppeteer funcione en Linux
apt-get update && apt-get install -y \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2
