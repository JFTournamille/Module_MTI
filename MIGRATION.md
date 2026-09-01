# MIGRATION.md — reprendre le déploiement sur une autre infrastructure

Ce fichier existe pour qu'un transfert d'hébergement n'oblige personne à
redécouvrir la configuration par tâtonnement. Il décrit **ce qu'il faut
reporter**, dans quel ordre, et ce qui casse si on l'oublie.

> **Le dépôt est public.** Aucune valeur de secret ne figure ici — seulement
> les noms de variables, leur rôle, et l'endroit où lire la valeur en service
> (CapRover → App Configs de l'app concernée). Un secret recopié ici serait
> conservé par l'historique Git même après suppression du fichier, et devrait
> alors être **changé**, pas seulement effacé.

---

## 1. Ce qui tourne aujourd'hui

Trois apps CapRover sur un serveur d'hébergement provisoire :

| App | Rôle | Image |
|---|---|---|
| `mti-db` | PostgreSQL 16, one-click app | image officielle |
| `mti-api` | Fastify, port 3000 | `api/Dockerfile` |
| `mti-web` | nginx servant le bundle Vite, relais `/api` | `web/Dockerfile` |

Une quatrième forme existe et est celle réellement utilisée en démonstration :
l'**image combinée** (`Dockerfile` + `deploiement/entrypoint.sh` +
`deploiement/nginx-mono.conf`), nginx et l'API Node dans le même conteneur.
Si l'un des deux processus meurt, le conteneur s'arrête — c'est voulu : sinon
nginx répondrait 502 avec une API morte et l'orchestrateur croirait
l'application en bonne santé.

`captain-definition` à la racine pointe l'image combinée ;
`api/captain-definition` et `web/captain-definition` pointent les images
séparées. **Le choix se fait par le `captain-definition` déployé**, pas par une
variable.

---

## 2. Variables d'environnement à repositionner

Lire les valeurs en service dans CapRover → App Configs. Aucune n'est
reproduite ici.

### Indispensables

| Variable | Rôle | Ce qui se passe si elle manque |
|---|---|---|
| `DATABASE_URL` | connexion applicative, **rôle `mti_app`** | `entrypoint.sh` refuse de démarrer |
| `AUTH_MODE` | `dev` \| `oidc` | défaut `dev` |
| `NODE_ENV` | `development` \| `production` | — |
| `PORT` | port d'écoute de l'API (3000) | défaut 3000 |

**Piège à connaître** : `api/src/auth.js` **refuse** `AUTH_MODE=dev` avec
`NODE_ENV=production`. L'instance de démonstration tourne donc en
`NODE_ENV=development`, et toute protection conditionnée à `NODE_ENV` y serait
inopérante. C'est la raison d'être de `DISCRETION` (§2.3).

La chaîne de connexion a cette forme — le mot de passe se lit dans App
Configs, jamais ici :

```
postgresql://mti_app:<MOT_DE_PASSE>@srv-captain--mti-db:5432/mti
```

`srv-captain--mti-db` est le nom de service interne CapRover. **Sur une autre
plateforme il change** : c'est la première valeur à reprendre. Le nom n'est pas
exposé au navigateur (le front n'appelle que des chemins relatifs), mais il
trahit le PaaS dans les logs et les messages d'erreur bruts — d'où `DISCRETION`.

Ne jamais mettre le rôle `postgres` dans `DATABASE_URL` : `mti_app` est
délibérément privé des droits `UPDATE`/`DELETE` sur `mti.audit`, et n'est pas
propriétaire des tables. C'est tout l'intérêt du cloisonnement.

### En mode `dev` uniquement

| Variable | Rôle |
|---|---|
| `DEV_UTILISATEUR_IDENTIFIANT` | opérateur fixe, résolu par identifiant |
| `DEV_UTILISATEUR_ID`, `DEV_UTILISATEUR_NOM` | variantes historiques, à ne pas utiliser |

### Discrétion (phase de test)

| Variable | Rôle |
|---|---|
| `DISCRETION` | `oui` masque le message brut PostgreSQL, la signature du cadriciel en 404, et le détail de `/api/sante`. Actif d'office si `NODE_ENV=production`. |
| `DIAGNOSTIC_JETON` | rend le détail de `/api/sante` à `?detail=<jeton>`. Sans jeton renseigné, le détail devient inaccessible quand `DISCRETION` est actif — l'état sommaire reste public, c'est ce qui permet de vérifier un déploiement. |

### Installation et jeu de démonstration — **temporaires, à retirer**

Ces variables existent parce que la plateforme n'offre pas d'accès shell.
Elles sont **opt-in et à supprimer après usage**.

| Variable | Rôle | À retirer |
|---|---|---|
| `DATABASE_URL_ADMIN` ou `ADMIN_HOTE`/`ADMIN_PORT`/`ADMIN_UTILISATEUR`/`ADMIN_MOT_DE_PASSE`/`ADMIN_BASE` | installe la base au démarrage (`api/src/installer.js`) | **oui, aussitôt après installation** |
| `MTI_APP_PASSWORD` | mot de passe donné à `mti_app` lors de l'installation ; doit être **identique** à celui de `DATABASE_URL` | **oui** |
| `SEED_DEMO=oui` | insère le jeu de démonstration au démarrage | oui, après insertion |
| `PURGER_DEMO=oui` | supprime le jeu de démonstration | oui, après purge |

Laisser en permanence un compte superutilisateur dans la configuration de
l'application **annule le cloisonnement du journal d'audit**, qui est la raison
d'être du rôle restreint. `entrypoint.sh` le rappelle dans les logs.

### Divers

`LOG_LEVEL` (défaut `info`), `DB_POOL_MAX` (défaut 10), `HOST`.

### Ce qui n'est **pas** une variable de build

`API_URL` n'est lue que par le proxy de développement (`web/vite.config.js`) et
par le harnais de tests. Le front ne contient **aucune** variable `VITE_*` ni
`import.meta.env`, et n'appelle que des chemins relatifs (`/api/...`).

**Conséquence : un changement de domaine ne demande aucun rebuild du front.**
C'est le piège habituel de ce genre de pile ; il est écarté ici, et il faut
qu'il le reste — n'introduire aucune URL absolue paramétrée au build.

---

## 3. Base de données

### Ce qu'il faut migrer

Tout le schéma `mti`. Le contenu qui ne se régénère pas :

- `mti.audit` — **journal append-only**. Aucun `UPDATE`/`DELETE` possible
  depuis l'application, et c'est volontaire. À transférer tel quel : un
  journal tronqué n'a aucune valeur réglementaire.
- `mti.dossier`, `dossier_processus`, `saisie`, `piece_jointe` — les dossiers
  et leurs preuves.
- `mti.piece_jointe.contenu` — **les photos vivent en base**, en `bytea`, parce
  que le conteneur est éphémère. Elles partent donc avec le dump ; prévoir le
  volume (plafond 8 MiB par pièce).
- `mti.modele_parcours` — les versions de parcours publiées depuis l'écran
  Configuration. **Celles-ci n'existent que là** : elles ne sont pas dans le
  dépôt. Les perdre rendrait illisibles les dossiers qui les référencent.
- `mti.utilisateur`, `patient`, `produit`, `service` — référentiels.

### Ce qui se régénère

- Le schéma : `node api/src/installer.js` puis `node api/src/migrer.js`.
- Les référentiels du dépôt : `node api/src/seed.js`.
- Le jeu de démonstration : `node api/src/seed-demo.js` (`--regenerer`,
  `--supprimer`).

### Séquences

`mti.dossier_reference_seq` alimente le `DEFAULT` de `dossier.reference`
(`MTI-000001`, …). Un `pg_dump` la reprend ; une reconstruction manuelle des
tables ne le fait pas. Après une reprise partielle, recaler :

```sql
SELECT setval('mti.dossier_reference_seq',
  coalesce(max(substring(reference from '^MTI-([0-9]{6,})$')::bigint), 0))
FROM mti.dossier;
```

Sinon les prochaines créations tournent en boucle sur des numéros déjà pris
(la fonction les saute, mais inutilement).

### Migrations

`api/src/migrer.js` vérifie l'**empreinte SHA-256** de chaque fichier appliqué
et refuse un fichier altéré. Ne jamais modifier une migration appliquée : en
créer une nouvelle. Après migration, vérifier le compte attendu :

```
GET /api/sante  →  base.migrationsAppliquees
```

Au moment d'écrire ces lignes : **12**.

### Volumes persistants

Seul `mti-db` a un volume à migrer (le répertoire de données PostgreSQL).
`mti-api` et `mti-web` sont sans état — **y compris pour les photos**, qui sont
en base précisément pour cela. Ne pas créer de volume de fichiers joints : ce
serait perdre la propriété qui rend le conteneur remplaçable.

---

## 4. Domaine, DNS et certificat

À faire côté dashboard, pas dans le code.

1. Enregistrement DNS **A** : `<sous-domaine>` → IP du serveur.
   Préférer un A record à un CNAME : un CNAME laisse apparaître le domaine
   réel dans la résolution DNS.
2. CapRover → app → HTTP Settings → *Connect New Domain*.
3. **Enable HTTPS** sur ce domaine → certificat Let's Encrypt **dédié**.
   Ne pas mutualiser : les entrées SAN d'un certificat sont lisibles en deux
   clics depuis le navigateur.
4. Rediriger tous les domaines vers le nouveau, pour que l'ancienne URL ne
   serve plus l'application directement.

Rien à rebuilder (§2, dernier point). Le certificat est à **régénérer** sur la
nouvelle infrastructure : il est lié au domaine et à l'IP qui répond au défi
ACME, pas à l'application.

---

## 5. Points d'attention relevés pendant l'audit

- **Aucune URL absolue dans le front, aucune variable de build.** Acquis
  fragile : la première `VITE_API_URL` introduite figerait le domaine dans le
  bundle et rendrait tout changement de domaine dépendant d'un rebuild.
- **Aucun cookie applicatif.** L'authentification `dev` résout un opérateur
  fixe ; en `oidc` c'est le jeton porté par la requête. Rien ne porte donc
  d'attribut `domain`. À vérifier de nouveau le jour où une session sera posée.
- **Aucun appel sortant depuis le navigateur.** Pas d'API tierce consommée
  côté client, donc pas de relais serveur à construire (§3 du brief de
  masquage). À reprendre si le module se met à consommer une API externe : le
  domaine apparaîtrait dans l'onglet Réseau quel que soit le domaine de façade.
- **Aucune sourcemap publiée** (`build.sourcemap` non activé dans
  `web/vite.config.js`, aucun `*.map` dans `web/dist/`).
- **`/api/sante` est le seul point de diagnostic exposé**, et son détail est
  réduit quand `DISCRETION` est actif. Il n'y a pas de `/debug` ni
  d'équivalent.
- **Le nom du serveur d'hébergement figure dans quatre commentaires de
  documentation** (`CLAUDE.md` ×2, `docs/architecture.md`,
  `docs/deploiement-base.md`). Le dépôt étant public, c'est une fuite plus
  parlante qu'un en-tête HTTP. À neutraliser si l'hébergement doit rester
  discret.
- **Le nom de service interne `srv-captain--mti-db`** figure dans
  `.env.example`, `docker-compose.yml` et la documentation. Non exposé au
  navigateur, mais à reprendre pour la nouvelle plateforme.
- **Le module ne produit pour l'instant ni export de fichier ni courriel.**
  Les deux sont des porteurs de métadonnées et de liens absolus : contrôler
  l'auteur, le producteur, les pieds de page et le `Message-ID` le jour où
  l'un des deux arrive.
- **Le mot de passe `mti_app` a été exposé une fois dans les logs CapRover**
  lors d'une installation au démarrage. Il doit être **changé**, pas seulement
  masqué, et les variables `ADMIN_*` / `MTI_APP_PASSWORD` retirées de la
  configuration de l'app.

---

## 6. Ordre d'exécution d'un transfert

1. `pg_dump` de la base source (schéma `mti` complet, contenu inclus).
2. Créer la nouvelle base et le rôle `mti_app` — via `installer.js`, avec les
   variables `ADMIN_*` **temporaires**.
3. `pg_restore`, puis recaler la séquence (§3).
4. Retirer `ADMIN_*` et `MTI_APP_PASSWORD` de la configuration, redéployer.
5. Reporter les variables du §2, avec un **nouveau** mot de passe `mti_app`.
6. Vérifier `GET /api/sante` : `migrationsAppliquees`, `cloisonnementAudit:
   "verifie"`.
7. DNS, domaine, certificat dédié (§4).
8. Rediriger l'ancien domaine, puis vérifier qu'il ne sert plus l'application.
9. Purger le jeu de démonstration avant toute mise en service réelle
   (`PURGER_DEMO=oui`, puis retirer la variable) : un dossier fictif est
   indiscernable d'un dossier réel dans le tableau de bord.
