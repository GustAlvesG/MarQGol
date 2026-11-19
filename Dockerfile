# MarQGol — imagem de produção (usada pelo docker-compose.prod.yml).
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4000 \
    DATA_DIR=/dados \
    TZ=America/Sao_Paulo

RUN apk add --no-cache tzdata

WORKDIR /app
COPY package.json package-lock.json ./
# Só dependências de produção (embedded-postgres, playwright etc. ficam de fora).
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Uploads dos clientes vão para o volume em /dados, nunca para a imagem.
RUN mkdir -p /dados && chown -R node:node /dados
USER node

EXPOSE 4000
CMD ["node", "server.js"]
