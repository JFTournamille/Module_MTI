# Image combinée : le front (nginx, port 80) et l'API (Node, port 3000 interne)
# dans un seul conteneur, pour un déploiement en une seule app CapRover.
#
# Pour la topologie en deux apps, utiliser api/Dockerfile et web/Dockerfile.

# ── Étape 1 : construction du front ──────────────────────────────────────────
FROM node:22-alpine AS build-web
# playwright (devDependency, tests navigateur) n'a plus de script
# d'installation depuis la 1.39, mais la variable protège d'une régression :
# un téléchargement de navigateurs ferait échouer ou traîner le build.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /src
COPY web/package*.json ./web/
RUN cd web && npm ci
COPY shared ./shared
COPY web ./web
# `prebuild` recopie shared/ vers web/src/data/ (référentiels du repli hors-ligne).
RUN cd web && npm run build

# ── Étape 2 : dépendances de production de l'API ─────────────────────────────
FROM node:22-alpine AS build-api
WORKDIR /src
COPY api/package*.json ./
RUN npm ci --omit=dev

# ── Image finale ─────────────────────────────────────────────────────────────
FROM node:22-alpine

# bash : `wait -n` de l'entrypoint n'existe pas dans l'ash de BusyBox.
# tini : en PID 1, il transmet les signaux et récupère les processus orphelins.
# apache2-utils : `htpasswd`, pour la porte d'entrée de la phase de test.
RUN apk add --no-cache nginx bash tini apache2-utils \
 && mkdir -p /run/nginx /etc/nginx/acces.d

WORKDIR /app
COPY --from=build-api /src/node_modules ./node_modules
COPY api/package.json ./
COPY api/src ./src

# Les scripts SQL et les référentiels sont embarqués : l'installateur
# (`node src/installer.js`) doit être exécutable depuis le conteneur déployé.
# migrer.js résout ../../db depuis /app/src, soit /db.
COPY db /db
COPY shared /shared

# Front construit.
COPY --from=build-web /src/web/dist /usr/share/nginx/html

# Le paquet nginx d'Alpine lit /etc/nginx/http.d/, pas conf.d/ — contrairement
# à l'image officielle nginx:alpine.
COPY deploiement/nginx-mono.conf /etc/nginx/http.d/default.conf
COPY deploiement/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY deploiement/acces-basique.sh /usr/local/bin/acces-basique.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/acces-basique.sh

ENV NODE_ENV=production
ENV PORT=3000
# nginx relaie depuis le même conteneur : l'API n'écoute que sur la boucle
# locale, elle n'est donc pas joignable depuis le réseau de l'orchestrateur.
ENV HOST=127.0.0.1
EXPOSE 80

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/usr/local/bin/entrypoint.sh"]
