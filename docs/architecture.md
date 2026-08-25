# Architecture — Module MTI

## Ce que fait le logiciel

Suivi du parcours complet d'un médicament de thérapie innovante (MTI), de la
réception du matériel de leucaphérèse jusqu'au suivi post-administration, avec
la traçabilité exigée par les BPP.

Le parcours de référence (`shared/parcours-cart-v1.json`) compte 12 processus
chronologiques, dont 5 réalisés par le fabricant. Le premier — la réception —
porte 24 points de contrôle répartis en 6 sections. Des processus
complémentaires peuvent être ajoutés en cours de parcours depuis un catalogue
(`shared/catalogue-processus-v1.json`).

## Pile technique

| Couche | Choix | Pourquoi |
|---|---|---|
| Front | Vue 3 + Vite + Pinia | La duplication de lignes et le double contrôle deviennent déclaratifs |
| API | Fastify + `pg` | Pas d'ORM : sur un logiciel soumis aux BPP, le SQL doit rester lisible |
| Base | PostgreSQL 16 | Triggers d'audit, contraintes d'intégrité, `jsonb` pour les modèles versionnés |
| Déploiement | CapRover | Trois apps : `mti-db` (one-click), `mti-api`, `mti-web` |

Les maquettes d'origine sont conservées à l'identique dans `docs/reference/`.
Le CSS du front est repris **verbatim** de `scenario_mti_dialog_v9.html` : le
rendu visuel validé par les utilisateurs n'a pas changé.

## Les cinq décisions structurantes

### 1. Le parcours est anonyme par défaut

`dossier.patient_id` est `NULL` jusqu'à la mise en fabrication (processus n°5,
`indexIdentificationPatient: 4`). Avant cette étape, seule une **préallocation**
explicite fait apparaître une identité.

Ce n'est pas qu'une règle d'affichage : c'est ce qui limite l'exposition des
données de santé sur la majorité du parcours.

### 2. Les données identifiantes sont isolées

Toute l'identité patient tient dans une seule table, `mti.patient_identite`
(nom, prénom, initiales, date de naissance). Le reste du schéma ne référence
qu'un identifiant opaque via `mti.patient`.

Conséquence pratique : cette table est la seule qui déclenche l'obligation
d'hébergement HDS (art. L1111-8 CSP). Elle peut être chiffrée, externalisée,
ou laissée vide — l'identité étant alors résolue à la volée depuis le SIH —
sans toucher au reste du modèle. `db/002_roles.sql` contient le `REVOKE` prêt
à l'emploi pour interdire toute persistance d'identité.

> **Arbitrage à trancher avant mise en service.** Un hébergement par un tiers
> (serveur OncoThériaque / Computer Engineering) relève de la certification
> HDS. L'exemption ne joue que si l'établissement héberge ses propres données.
> Trois issues : déploiement on-premise chez chaque établissement (CapRover
> reste valable), pseudonymisation stricte (le `REVOKE` ci-dessus), ou
> hébergeur certifié.

### 3. Le journal d'audit est inaltérable depuis l'application

`mti.audit` est alimenté par trigger sur les tables sensibles (dossier,
processus, saisies, pièces jointes, signatures, identités, utilisateurs,
modèles). Chaque événement porte l'ancienne et la nouvelle valeur en `jsonb`,
plus l'auteur.

L'auteur vient de `current_setting('mti.utilisateur_id')`, positionné par
`api/src/db.js:transaction()` — **point de passage obligatoire de toute
écriture**. Une écriture hors de cette fonction produirait un événement sans
auteur, donc inexploitable en inspection.

Le rôle applicatif `mti_app` n'a **pas** les droits `UPDATE`/`DELETE` sur
`mti.audit` : même une faille dans l'API ne permet pas de réécrire la
traçabilité. Le trigger `tracer_audit()` est `SECURITY DEFINER`, il écrit donc
malgré cette révocation.

> Ces fonctions déclarent `SET search_path = mti, pg_temp`. Sans cela, le corps
> s'exécute avec le `search_path` de l'appelant et les références aux types du
> schéma échouent dès qu'un client se connecte sans l'avoir positionné — c'est
> exactement le cas de l'API. Pour une fonction `SECURITY DEFINER`, c'est en
> plus une protection contre le détournement de `search_path`.

### 4. Un dossier validé est figé

- Trigger `saisie_lecture_seule` : plus aucun `INSERT`/`UPDATE`/`DELETE` de
  saisie sur un dossier au statut `valide`. Toute correction passe par une
  nouvelle version du dossier.
- Trigger `dossier_pas_de_devalidation` : un dossier validé ne revient pas en
  arrière.
- Contrainte `dossier_valide_coherent` : pas de validation sans conclusion de
  conformité **et** signataire **et** horodatage.

### 5. Les modèles sont versionnés et figés dans le dossier

`mti.modele_parcours` porte `(code, version, definition jsonb)` avec une seule
version active par code. À la création d'un dossier, la définition de chaque
processus est **recopiée** dans `mti.dossier_processus.definition`.

Un dossier validé en 2026 reste donc relisible à l'identique après évolution
de la checklist — exigence de fond, pas confort de développement.

## Ce que la migration Vue apporte concrètement

Les maquettes clonaient des nœuds du DOM et suffixaient les attributs `name`
des radios (`_ex{i}`, `_cuve{i}`, `_op2_{uid}`), avec des attributs
`data-generated-dup` / `data-generated-op2` pour retrouver et supprimer les
copies à chaque changement.

Ici, une saisie est identifiée par une clé de données :

```
`${idxProcessus}|${idxSection}|${idxPoint}|${exemplaire}|${role}`
```

et la duplication est un `computed`. Ce qui disparaît :

- `applyNExemplaires()` et son nettoyage de copies → `v-for` sur `nbCopies()`
- `addOp2Rows()` / `removeOp2Rows()` → `v-if` sur `op2Ouvert(cle)`
- le bouton « Appliquer » après « n exemplaires » → réactivité
- un `setInterval` par minuteur, jamais nettoyé lors d'un re-rendu → **une**
  horloge dans le store alimente tous les affichages

## Le hors-ligne n'est pas une option

La réception d'un CAR-T est un acte sous contrainte de temps (autonomie du
dry shipper LN₂). Si le réseau tombe au mauvais moment, on ne peut pas bloquer
l'acte.

Les référentiels sont donc embarqués dans le bundle : sans API, le front
bascule sur `src/data/*.json`, affiche un bandeau « Mode hors-ligne » et reste
saisissable. **La persistance différée des saisies reste à faire** (voir
Reste à faire).

## L'authentification est un prérequis, pas une évolution

Le double contrôle pharmacien et la signature électronique exigent deux
identités **authentifiées** distinctes. Deux champs texte libres ne valent pas
signature.

`api/src/auth.js` refuse de démarrer avec `AUTH_MODE=dev` et
`NODE_ENV=production`. Le branchement du SSO de l'établissement
(`AUTH_MODE=oidc`) est un préalable à toute mise en service.

## Déploiement CapRover

Trois apps :

| App | Source | Notes |
|---|---|---|
| `mti-db` | One-click app PostgreSQL 16 | Volume persistant + **sauvegardes testées en restauration** |
| `mti-api` | Ce dépôt, `./api/captain-definition` | Variables : cf. `.env.example` |
| `mti-web` | Ce dépôt, `./web/captain-definition` | nginx sert le bundle et relaie `/api/` vers `srv-captain--mti-api:3000` |

Mise en service de la base :

```bash
npm --prefix api run migrer   # applique db/*.sql, une fois chacun, empreinte vérifiée
npm --prefix api run seed     # charge les référentiels shared/ + produits de référence
```

`migrer.js` refuse d'appliquer un fichier SQL modifié après coup : une
migration appliquée ne se modifie pas, on en crée une nouvelle. C'est du
change control, pas de la rigidité.

Réserves connues sur CapRover : nœud unique, donc pas de haute disponibilité ;
et une sauvegarde de volume non testée en restauration n'est pas une
sauvegarde.

## Vérifications

```bash
# Invariants du schéma (14 tests) — se lance avec un search_path par défaut,
# comme un vrai client, pour ne pas masquer les références non qualifiées.
psql -d mti -v ON_ERROR_STOP=1 -f db/tests/test_invariants.sql

# API de bout en bout (10 groupes)
npm --prefix api run test:e2e

# Parcours dans un vrai navigateur (14 groupes)
npm --prefix web run test:navigateur
```

## Reste à faire

Par ordre de dépendance :

1. **Trancher l'arbitrage HDS** — conditionne le mode de déploiement.
2. **Brancher le SSO** (`AUTH_MODE=oidc`) — préalable à la signature
   électronique et au double contrôle réel.
3. **Persistance différée hors-ligne** — file d'attente locale et
   synchronisation ; aujourd'hui le front lit hors-ligne mais n'écrit pas.
4. **Connecteur SIH** pour la recherche patient — remplacer la source de
   `api/src/routes/patients.js` sans changer le contrat de l'API.
5. **Signature électronique** — `mti.signature` existe (avec empreinte
   SHA-256 du contenu signé), l'IHM et le geste de signature restent à faire.
6. **Pièces jointes** — `mti.piece_jointe` existe ; reste le stockage
   (volume CapRover ou objet S3) et l'envoi depuis le front.
7. **Export PDF** de la fiche complétée.
8. **Entrées automatiques PHARMA® / CHIMIO®** — points de type `auto`,
   déclenchés à la validation.
