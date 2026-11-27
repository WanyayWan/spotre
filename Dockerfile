FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=4533 \
    MUSIC_DIR=/music \
    DATA_DIR=/data \
    WEB_DIR=/app/web

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY web /app/web

VOLUME ["/music", "/data"]
EXPOSE 4533
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4533/api/info >/dev/null || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
