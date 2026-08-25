# ── Étape de construction ──
FROM node:22-alpine AS build

WORKDIR /app
COPY web/package*.json ./web/
RUN cd web && npm ci

COPY shared ./shared
COPY web ./web
# `prebuild` recopie shared/ vers web/src/data/ (référentiels du repli hors-ligne).
RUN cd web && npm run build

# ── Étape de service ──
FROM nginx:1.27-alpine

COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
