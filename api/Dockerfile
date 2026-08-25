FROM node:22-alpine

WORKDIR /app

# Les dépendances d'abord : le cache de couche survit aux changements de code.
COPY api/package*.json ./
RUN npm ci --omit=dev

COPY api/src ./src
COPY api/tests ./tests
# Les scripts SQL et les référentiels sont embarqués : `npm run migrer` et
# `npm run seed` doivent être exécutables depuis le conteneur déployé.
COPY db /db
COPY shared /shared

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Arrêt propre : Fastify ferme ses connexions sur SIGTERM (cf. src/server.js).
# `node` comme PID 1 reçoit bien le signal, contrairement à `npm start`.
CMD ["node", "src/server.js"]
