#!/bin/sh
#
# Porte d'entrée de la phase de test : une authentification HTTP basique
# devant TOUTE l'application, API comprise.
#
# Pourquoi devant nginx et pas dans l'application : ce n'est pas la même
# question. `AUTH_MODE` répond à « qui signe cette saisie » — l'identité tracée
# dans le journal d'audit, qui viendra du SSO de l'établissement. Cette porte
# répond à « qui a le droit d'ouvrir la page », le temps qu'une adresse circule
# par courriel auprès de testeurs. Un seul couple identifiant/mot de passe,
# partagé : aucune valeur comme preuve d'identité, seulement comme filtre.
#
# Appelé par l'entrypoint de l'image combinée, et par le mécanisme
# /docker-entrypoint.d/ de l'image nginx dans la topologie en deux apps.
# D'où `#!/bin/sh` : cette dernière n'embarque pas bash.

set -u

REPERTOIRE=/etc/nginx/acces.d
CONF="$REPERTOIRE/basique.conf"
MOTS_DE_PASSE=/etc/nginx/.acces-htpasswd

journal() { echo "[acces] $*"; }

mkdir -p "$REPERTOIRE"

# Une configuration antérieure ne doit pas survivre au retrait des variables :
# sans cette purge, retirer ACCES_MOT_DE_PASSE de la configuration laisserait
# la porte en place, verrouillée sur un mot de passe qu'on croyait supprimé.
rm -f "$CONF" "$MOTS_DE_PASSE"

if [ -z "${ACCES_UTILISATEUR:-}" ] && [ -z "${ACCES_MOT_DE_PASSE:-}" ]; then
  journal "ACCES_UTILISATEUR et ACCES_MOT_DE_PASSE non renseignés : aucune porte."
  journal "  L'application est ouverte à qui connaît l'adresse."
  exit 0
fi

# Fermer plutôt qu'entrouvrir : quelqu'un qui a renseigné une des deux
# variables voulait une porte. Démarrer sans, silencieusement, exposerait
# l'application en laissant croire le contraire.
if [ -z "${ACCES_UTILISATEUR:-}" ] || [ -z "${ACCES_MOT_DE_PASSE:-}" ]; then
  journal "✗ ACCES_UTILISATEUR et ACCES_MOT_DE_PASSE vont par paire."
  journal "  L'une sans l'autre n'ouvre rien. Renseigner les deux, ou retirer"
  journal "  les deux pour laisser l'application ouverte."
  exit 1
fi

# -m (apr1) plutôt que -B (bcrypt) : apr1 est implémenté par nginx lui-même,
# là où bcrypt dépend du crypt() de la libc — musl le gère, mais rien ne
# garantit qu'il le gérera dans l'image de demain. Le mot de passe est salé,
# il n'apparaît en clair nulle part dans le conteneur.
if ! htpasswd -bmc "$MOTS_DE_PASSE" "$ACCES_UTILISATEUR" "$ACCES_MOT_DE_PASSE" >/dev/null 2>&1; then
  journal "✗ génération du fichier de mots de passe en échec — arrêt."
  exit 1
fi

# Le fichier est lu par les *workers* nginx à chaque requête, et ceux-ci
# tournent sous l'utilisateur `nginx`, pas root : un 600 appartenant à root
# produirait un 403 sur toutes les pages.
chmod 640 "$MOTS_DE_PASSE"
chown root:nginx "$MOTS_DE_PASSE" 2>/dev/null || chmod 644 "$MOTS_DE_PASSE"

cat > "$CONF" <<'CONF_NGINX'
# Écrit au démarrage par deploiement/acces-basique.sh. Ne pas modifier :
# le fichier est réécrit à chaque démarrage du conteneur.
auth_basic "Module MTI — phase de test";
auth_basic_user_file /etc/nginx/.acces-htpasswd;
CONF_NGINX

journal "porte d'entrée active : identifiant et mot de passe demandés avant"
journal "  toute page, API comprise."
