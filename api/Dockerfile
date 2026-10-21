FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data
EXPOSE 3000
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD wget -q --spider "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server.js"]
