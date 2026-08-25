#!/usr/bin/env bash
#
# Point d'entrée de l'image combinée : nginx (port 80) et l'API Node
# (port 3000, interne au conteneur) dans le même conteneur.
#
# Règle de fond : si l'un des deux processus s'arrête, LE CONTENEUR S'ARRÊTE.
# Sans cela, nginx continuerait de répondre 502 avec une API morte, et
# l'orchestrateur croirait l'application en bonne santé.

# Pas de `set -e` : les codes de retour sont gérés explicitement ci-dessous.
set -uo pipefail

PID_NODE=""
PID_NGINX=""

journal() { echo "[entrypoint] $*"; }

# Arrêt propre demandé par l'orchestrateur (SIGTERM au redéploiement).
arret_propre() {
  journal "signal d'arrêt reçu — arrêt des processus"
  [ -n "$PID_NODE" ]  && kill -TERM "$PID_NODE"  2>/dev/null
  [ -n "$PID_NGINX" ] && kill -TERM "$PID_NGINX" 2>/dev/null
  wait
  journal "arrêt terminé"
  exit 0
}
trap arret_propre TERM INT

if [ -z "${DATABASE_URL:-}" ]; then
  journal "✗ DATABASE_URL n'est pas défini — l'API ne pourra pas joindre la base."
  journal "  Renseigner la variable dans App Configs, puis redéployer."
  exit 1
fi

# ── Installation de la base au démarrage ─────────────────────────────────────
#
# Prévu pour les plateformes sans accès shell : en renseignant
# DATABASE_URL_ADMIN dans la configuration de l'app, le conteneur installe la
# base à son démarrage et journalise le résultat dans les logs de l'app.
#
# C'est volontairement OPT-IN et à retirer ensuite : laisser en permanence un
# compte superutilisateur dans la configuration de l'application annulerait le
# cloisonnement du journal d'audit, qui est toute la raison d'être du rôle
# mti_app restreint.
if [ -n "${DATABASE_URL_ADMIN:-}" ]; then
  journal "─────────────────────────────────────────────────────────────"
  journal "DATABASE_URL_ADMIN présent : installation de la base au démarrage"

  if [ -z "${MTI_APP_PASSWORD:-}" ]; then
    journal "✗ MTI_APP_PASSWORD est requis avec DATABASE_URL_ADMIN."
    journal "  Sans lui, un mot de passe serait généré et n'apparaîtrait que dans"
    journal "  ces logs. Choisissez-le vous-même et utilisez la MÊME valeur dans"
    journal "  DATABASE_URL, pour n'avoir qu'un seul déploiement à faire."
    exit 1
  fi

  node /app/src/installer.js
  code_installation=$?

  case "$code_installation" in
    0)
      journal "✓ base installée et cloisonnement vérifié"
      ;;
    2)
      journal "⚠ base installée, mais un point de configuration reste à corriger"
      journal "  (voir ci-dessus). Le démarrage continue."
      ;;
    *)
      journal "✗ installation en échec (code $code_installation) — arrêt."
      journal "  Rien ne doit démarrer sur une base dont le cloisonnement n'est"
      journal "  pas vérifié."
      exit 1
      ;;
  esac

  journal "─────────────────────────────────────────────────────────────"
  journal "⚠ RETIRER MAINTENANT DATABASE_URL_ADMIN de la configuration de l'app,"
  journal "  puis redéployer. Un compte superutilisateur laissé dans la"
  journal "  configuration annule le cloisonnement du journal d'audit."
  journal "─────────────────────────────────────────────────────────────"
fi

journal "démarrage de l'API Node sur 127.0.0.1:3000"
node /app/src/server.js &
PID_NODE=$!

journal "démarrage de nginx sur 0.0.0.0:80"
nginx -g 'daemon off;' &
PID_NGINX=$!

# `wait -n` rend la main dès que L'UN des deux enfants se termine.
wait -n
code=$?

if [ -n "$PID_NODE" ] && ! kill -0 "$PID_NODE" 2>/dev/null; then
  journal "✗ l'API Node s'est arrêtée (code $code)"
else
  journal "✗ nginx s'est arrêté (code $code)"
fi

journal "arrêt du conteneur pour que l'orchestrateur le relance"
[ -n "$PID_NODE" ]  && kill -TERM "$PID_NODE"  2>/dev/null
[ -n "$PID_NGINX" ] && kill -TERM "$PID_NGINX" 2>/dev/null
wait
exit 1
