# ── Étape de construction ──
FROM node:22-alpine AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY web/package*.json ./web/
RUN cd web && npm ci

COPY shared ./shared
COPY web ./web
# `prebuild` recopie shared/ vers web/src/data/ (référentiels du repli hors-ligne).
RUN cd web && npm run build

# ── Étape de service ──
FROM nginx:1.27-alpine

# `htpasswd`, pour la porte d'entrée de la phase de test.
RUN apk add --no-cache apache2-utils && mkdir -p /etc/nginx/acces.d

COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf

# L'image officielle nginx exécute les scripts de /docker-entrypoint.d/ avant
# de lancer le serveur : c'est là que la porte d'entrée se pose, l'image n'ayant
# pas d'entrypoint à nous. Le préfixe numérique fixe l'ordre.
COPY deploiement/acces-basique.sh /docker-entrypoint.d/40-acces-basique.sh
RUN chmod +x /docker-entrypoint.d/40-acces-basique.sh

EXPOSE 80
