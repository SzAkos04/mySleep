# The tests run first, in their own stage; the image takes server.js from that stage, so a server
# that fails its tests is never built (BuildKit skips a stage nothing copies from).
FROM node:22-alpine AS test
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server.js ./
COPY test/ ./test/
RUN npm test

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=test /app/server.js ./
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server.js"]
