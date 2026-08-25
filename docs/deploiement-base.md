# Créer la base de données

Deux cibles : **CapRover** (production, serveur OncoThériaque) et **local**
(développement). Les commandes de ce document ont été exécutées et vérifiées.

## Principe : deux rôles, pas un

| Rôle | Usage | Pourquoi |
|---|---|---|
| `postgres` (superutilisateur) | migrations uniquement | `CREATE EXTENSION`, `CREATE ROLE`, fonctions `SECURITY DEFINER` |
| `mti_app` | l'API, en permanence | N'a **pas** le droit d'altérer `mti.audit` ni `mti.signature` |

C'est la raison d'être de la séparation : si l'API tourne en superutilisateur,
le journal d'audit devient réécrivable et ne vaut plus rien en inspection.

---

## A. CapRover (production)

### 1. Créer l'app PostgreSQL

Dans CapRover → **Apps** → **One-Click Apps/Databases** → `PostgreSQL`.

| Champ | Valeur |
|---|---|
| App Name | `mti-db` |
| PostgreSQL Version | `16-alpine` |
| PostgreSQL Root Password | *(mot de passe fort, à conserver)* |
| PostgreSQL Database | `mti` |

Le nom d'app détermine le nom d'hôte interne : `srv-captain--mti-db`.
Si vous choisissez un autre nom, adaptez `web/nginx.conf` et les
`DATABASE_URL` en conséquence.

### 2. Vérifier le volume persistant

Dans **mti-db → App Configs**, confirmez qu'un volume persistant est monté sur
`/var/lib/postgresql/data`. Sans lui, la base est perdue au moindre
redéploiement.

> **N'exposez pas la base sur Internet.** Laissez « HTTP Settings » désactivé
> et ne publiez pas le port 5432. L'API y accède par le réseau interne
> CapRover.

### 3. Déployer l'API

**Apps → New App** → `mti-api` → déploiement depuis ce dépôt, en indiquant
`./api/captain-definition` comme chemin du captain-definition.

Variables d'environnement (**mti-api → App Configs**) :

```
DATABASE_URL=postgresql://mti_app:MOT_DE_PASSE_APP@srv-captain--mti-db:5432/mti
NODE_ENV=production
AUTH_MODE=oidc
PORT=3000
LOG_LEVEL=info
```

> `AUTH_MODE=dev` avec `NODE_ENV=production` fait **échouer le démarrage**,
> volontairement : sans opérateurs authentifiés, la traçabilité MTI n'a pas de
> valeur. Voir §5 si le SSO n'est pas encore branché.

### 4. Appliquer le schéma

Les scripts SQL et les référentiels sont embarqués dans l'image de l'API
(`/db` et `/shared`). On les exécute donc depuis son conteneur, avec une
`DATABASE_URL` **superutilisateur** passée à la volée.

Ouvrez un terminal sur le conteneur `mti-api` (CapRover → mti-api →
**Deployment** → *Exec Terminal*, ou en SSH sur le serveur) :

```bash
# Schéma, rôles, privilèges
DATABASE_URL=postgresql://postgres:MOT_DE_PASSE_ROOT@srv-captain--mti-db:5432/mti \
  node src/migrer.js
```

Sortie attendue :

```
✓ 001_schema.sql appliqué
✓ 002_roles.sql appliqué
Migrations terminées.
```

`002_roles.sql` crée le rôle `mti_app` **sans mot de passe** — un mot de passe
n'a pas sa place dans une migration versionnée. Il faut le définir maintenant :

```bash
DATABASE_URL=postgresql://postgres:MOT_DE_PASSE_ROOT@srv-captain--mti-db:5432/mti \
MTI_APP_PASSWORD='MOT_DE_PASSE_APP' \
  node src/definir-mot-de-passe.js
```

Le script refuse un mot de passe de moins de 16 caractères et échappe la valeur
côté serveur : les apostrophes, guillemets et `$` passent sans risque.

> **Attention à l'encodage dans l'URL.** `DATABASE_URL` est une URL : si le mot
> de passe contient `@ : / ? # % &` ou un espace, il doit être encodé en
> pourcentage. Par exemple `p@ss#2026` s'écrit `p%40ss%232026`. Le plus simple
> est de générer un mot de passe sans ces caractères :
> `openssl rand -base64 32 | tr -d '/+=' | head -c 32`

Reportez `MOT_DE_PASSE_APP` dans la `DATABASE_URL` de l'app `mti-api` (§3),
puis chargez les référentiels — cette étape passe avec `mti_app` :

```bash
node src/seed.js
```

Sortie attendue :

```
✓ modèle PARCOURS_CART_AUTOLOGUE v1 — 12 processus
✓ catalogue v1 — 8 processus disponibles
✓ 4 produits de référence
```

### 5. Créer les premiers utilisateurs

`AUTH_MODE=oidc` authentifie les opérateurs mais ne les crée pas. Il faut
insérer au moins un compte pour que les saisies aient un auteur :

```sql
INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction)
VALUES ('jtournamille', 'TOURNAMILLE', 'Jean-François', 'Dr', 'pharmacien');
```

L'`identifiant` doit correspondre au login renvoyé par le SSO de
l'établissement.

### 6. Vérifier que le cloisonnement fonctionne

Le test qui compte : `mti_app` doit pouvoir écrire une saisie mais **pas**
toucher au journal d'audit.

```bash
# Doit répondre : ERROR: permission denied for table audit
psql "postgresql://mti_app:MOT_DE_PASSE_APP@srv-captain--mti-db:5432/mti" \
  -c "DELETE FROM mti.audit WHERE id = 1;"

# Doit répondre : ERROR: permission denied for table signature
psql "postgresql://mti_app:MOT_DE_PASSE_APP@srv-captain--mti-db:5432/mti" \
  -c "UPDATE mti.signature SET signe_le = now();"

# Doit fonctionner : la lecture reste autorisée
psql "postgresql://mti_app:MOT_DE_PASSE_APP@srv-captain--mti-db:5432/mti" \
  -tAc "SELECT count(*) FROM mti.audit;"
```

Si le `DELETE` réussit, l'API tourne en superutilisateur : reprenez la §3.

### 7. Sauvegardes

Une sauvegarde de volume non testée en restauration n'est pas une sauvegarde.
Mettez en place un `pg_dump` régulier **et** restaurez-le une fois sur une base
jetable pour valider la procédure :

```bash
pg_dump "postgresql://postgres:MOT_DE_PASSE_ROOT@srv-captain--mti-db:5432/mti" \
  --format=custom --file=/sauvegardes/mti-$(date +%F).dump
```

---

## B. En local (développement)

```bash
# 1. Base
docker compose up -d db

# 2. Schéma et rôles (superutilisateur)
export DATABASE_URL=postgresql://postgres:mti_dev@localhost:5432/mti
npm --prefix api install
npm --prefix api run migrer

# 3. Référentiels + utilisateur de développement
npm --prefix api run seed      # note le DEV_UTILISATEUR_ID affiché

# 4. API
export DEV_UTILISATEUR_ID=<valeur affichée>
npm --prefix api start

# 5. Vérification complète
npm --prefix api run test:e2e
```

En local, faire tourner l'API sous `postgres` est acceptable. En production,
non : voir §6.

---

## Diagnostic

| Symptôme | Cause | Correction |
|---|---|---|
| `type "statut_dossier" does not exist` | Fonction PL/pgSQL sans `SET search_path` | Corrigé depuis 296f634 — vérifier que la migration à jour est bien appliquée |
| `AUTH_MODE=dev est interdit avec NODE_ENV=production` | Garde-fou volontaire | Brancher le SSO, ou passer `NODE_ENV=development` en recette uniquement |
| `DEV_UTILISATEUR_ID non configuré` (503) | `npm run seed` pas exécuté | Lancer le seed et reporter l'identifiant |
| `permission denied for table audit` **au démarrage** | Anormal | Le trigger est `SECURITY DEFINER` : vérifier que les migrations ont tourné en superutilisateur |
| `password authentication failed for user "mti_app"` | Mot de passe du rôle non défini | Étape `ALTER ROLE` de la §4 |
| `role "mti_app" does not exist` | `002_roles.sql` non appliqué | Relancer `node src/migrer.js` |
| `a changé depuis son application` | Un fichier SQL déjà appliqué a été modifié | Ne pas modifier une migration appliquée : en créer une nouvelle |
