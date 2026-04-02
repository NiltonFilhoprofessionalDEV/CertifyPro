# CertifyPro — Node 20 + dependências nativas do canvas (Cairo/Pango)
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .
RUN node scripts/build.js

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server/index.js"]
