# nginx in front of the API: the one address Tailscale serve puts HTTPS on (docker-compose.yml),
# with the request-size limit and the headers set once. There is no web page behind it any more:
# mySleep Night is the app, the API is all the server serves.
FROM nginx:alpine
COPY web/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_PORT=80 BACKEND=api PORT=3000
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD wget -q --spider "http://127.0.0.1:${NGINX_PORT}/api/health" || exit 1
