FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# /data/downloads (bind mount) and /data/state (named volume) are provided by compose.
# Creating them here, owned by "node", makes a fresh named volume inherit that ownership.
RUN mkdir -p /data/downloads /data/state && chown -R node:node /data

USER node
EXPOSE 3000
CMD ["node", "src/server.mjs"]
