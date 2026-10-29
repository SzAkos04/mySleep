# Build the app from frontend/ alone (CI builds this image, so an import from outside it fails there
# first), then serve it with nginx, which also proxies /api: one origin, as passkeys require.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# a build that fails its tests never reaches the server
RUN npm test
ARG APP_BUILD=""
RUN APP_BUILD="$APP_BUILD" npm run build

FROM nginx:alpine
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
ENV NGINX_PORT=80 BACKEND=api PORT=3000
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD wget -q --spider "http://127.0.0.1:${NGINX_PORT}/" || exit 1
