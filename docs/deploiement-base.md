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

### 4. Installer la base — une seule commande

Les scripts SQL et les référentiels sont embarqués dans l'image de l'API
(`/db` et `/shared`). L'installateur s'exécute donc depuis son conteneur.

> **`psql` et `bash` ne sont pas présents dans l'image `node:22-alpine`.**
> L'installateur est écrit en Node pour cette raison : n'attendez pas de
> pouvoir lancer `psql` dans ce conteneur.

Ouvrez un terminal sur le conteneur `mti-api` (CapRover → mti-api →
**Deployment** → *Exec Terminal*, ou en SSH sur le serveur), puis :

```bash
DATABASE_URL_ADMIN=postgresql://postgres:MOT_DE_PASSE_ROOT@srv-captain--mti-db:5432/mti \
  node src/installer.js
```

L'installateur enchaîne, en s'arrêtant à la première anomalie :

1. connexion et **contrôle des droits superutilisateur** (refuse sinon) ;
2. migrations `db/*.sql` ;
3. mot de passe de `mti_app` — généré en `base64url`, donc **sans caractère à
   encoder dans une URL** (ou fourni via `MTI_APP_PASSWORD`) ;
4. référentiels, catalogue et produits de référence ;
5. **test de cloisonnement** : `mti_app` doit être incapable d'effacer ou de
   modifier une trace d'audit, ou de modifier une signature posée, tout en
   pouvant les lire ;
6. inventaire de ce qui est installé, et alertes de configuration.

Il termine en affichant la `DATABASE_URL` à reporter dans les variables de
l'app `mti-api` :

```
✓ Cloisonnement du journal d'audit vérifié.
✓ Base opérationnelle.

À reporter dans les variables d'environnement de l'app mti-api :

  DATABASE_URL=postgresql://mti_app:...@srv-captain--mti-db:5432/mti
  NODE_ENV=production
  AUTH_MODE=oidc
```

**Le mot de passe généré n'est affiché qu'une fois** : conservez-le dans votre
gestionnaire de secrets avant de fermer le terminal.

#### Réexécution

L'installateur est relançable, mais il **refuse de faire tourner le mot de
passe en silence** : l'app `mti-api` porte l'ancien dans sa configuration et
cesserait de fonctionner sans que rien ne l'indique.

```bash
# Poursuivre avec le mot de passe existant
MTI_APP_PASSWORD='...' node src/installer.js

# Vérifier sans rien installer
MTI_APP_PASSWORD='...' node src/installer.js --verifier

# Définir un nouveau mot de passe, volontairement
node src/installer.js --nouveau-mot-de-passe
```

> Dans PostgreSQL, un rôle appartient au **cluster**, pas à une base. Si vous
> installez une seconde base sur la même instance (une recette, par exemple),
> `mti_app` existe déjà et son mot de passe est commun aux deux : un
> `--nouveau-mot-de-passe` doit alors être reporté dans **toutes** les apps qui
> utilisent cette instance.

### 5. Créer les premiers utilisateurs

`AUTH_MODE=oidc` authentifie les opérateurs mais ne les crée pas. Sans compte,
les saisies n'auront pas d'auteur — l'installateur le signale.

```sql
INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction)
VALUES ('jtournamille', 'TOURNAMILLE', 'Jean-François', 'Dr', 'pharmacien');
```

L'`identifiant` doit correspondre au login renvoyé par le SSO de
l'établissement.

### 6. Désactiver le compte de développement

Si le seed a tourné sans `NODE_ENV=production`, un compte `mdurand` a été créé.
Il n'est pas authentifié : en production, il permettrait d'attribuer des
saisies à un opérateur inexistant. L'installateur le signale et **sort en
erreur** tant qu'il est actif.

```sql
UPDATE mti.utilisateur SET actif = false WHERE identifiant = 'mdurand';
```

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
npm --prefix api install

# 2. Installation complète (schéma, rôles, référentiels, vérifications)
DATABASE_URL_ADMIN=postgresql://postgres:mti_dev@localhost:5432/mti \
  npm --prefix api run installer

# 3. API — reporter la DATABASE_URL affichée, et l'identifiant du compte de
#    développement créé par le seed
export DATABASE_URL='<valeur affichée>'
export DEV_UTILISATEUR_ID=$(psql "$DATABASE_URL" -tAc \
  "select id from mti.utilisateur where identifiant='mdurand'")
npm --prefix api start

# 4. Vérification complète
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
| `Ce compte n'est pas superutilisateur` | `DATABASE_URL_ADMIN` pointe sur `mti_app` | Utiliser le compte root de la base |
| `mti_app a déjà un mot de passe` | Réexécution, ou rôle déjà créé par une autre base du cluster | Fournir `MTI_APP_PASSWORD`, ou `--nouveau-mot-de-passe` |
| `défaut(s) de cloisonnement` | L'API tourne en superutilisateur, ou `002_roles.sql` n'a pas été appliqué | Reprendre la §4 ; ne pas mettre en service |
| `psql: not found` dans le conteneur | Image `node:22-alpine` sans client Postgres | Utiliser `node src/installer.js --verifier` |
