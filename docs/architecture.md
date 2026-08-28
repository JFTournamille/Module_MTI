# Architecture — Module MTI

## Ce que fait le logiciel

Suivi du parcours complet d'un médicament de thérapie innovante (MTI), de la
réception du matériel de leucaphérèse jusqu'au suivi post-administration, avec
la traçabilité exigée par les BPP.

Le parcours de référence est `shared/parcours-cart-v2.json` : 16 processus
chronologiques, dont 5 réalisés par le fabricant. La v2 ajoute les quatre
processus amont arrêtés en réunion du 26 juin 2026 — demande d'accès, commande
MTI, aphérèse, rattachement — et reprend les douze de la v1 sans en modifier un
seul point. La v1 reste en base, hors service : les dossiers ouverts sous elle
gardent leur définition figée. Le premier — la réception —
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

`scenario_mti_dialog_v12.html` est la maquette fonctionnelle de référence pour
les évolutions V5 arrêtées en réunion du 26 juin 2026 (voir plus bas). Elle
reprend la palette de la v11 sans y toucher — seule l'échelle typographique a
été relevée, via les variables `--fs-*`. Fichier autonome, ouvrable directement
dans un navigateur.

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

### 5 bis. L'avancement d'un processus

`dossier_processus.etat` (`a_venir` → `en_cours` → `valide`) commande la lecture
seule côté front. Valider un processus par `POST /api/processus/:id/etat` ouvre
**le suivant encore à venir** — pas `ordre + 1`, pour qu'un processus ajouté
depuis le catalogue ou déjà ouvert ne fasse pas sauter un cran au parcours.

Un processus peut aussi être ouvert explicitement, sans attendre celui qui le
précède : c'est ce qui permettra de traiter l'indépendance chronologique
demandée en réunion (certains processus se réalisent sans attendre les autres).

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

En ligne, en revanche, la saisie est désormais persistée : l'onglet Scénario
travaille sur un **dossier**, et sans dossier ouvert il affiche un état vide
plutôt qu'un formulaire qui n'enregistrerait rien. Trois gestes écrivent :
`PATCH /api/dossiers/:id` pour l'en-tête, `PUT /api/processus/:id/saisies` pour
les points, `POST /api/dossiers/:id/valider` pour figer. Changer de processus
enregistre celui qu'on quitte — une saisie ne doit pas disparaître sans que
l'opérateur puisse le savoir. Un processus ajouté depuis le catalogue est créé
côté serveur (`POST /api/dossiers/:id/processus`) : sans cela ses saisies
n'auraient aucun `dossier_processus` où atterrir, et l'enregistrement échouait
en silence.

## L'authentification est un prérequis, pas une évolution

Le double contrôle pharmacien et la signature électronique exigent deux
identités **authentifiées** distinctes. Deux champs texte libres ne valent pas
signature.

`api/src/auth.js` refuse de démarrer avec `AUTH_MODE=dev` et
`NODE_ENV=production`. Le branchement du SSO de l'établissement
(`AUTH_MODE=oidc`) est un préalable à toute mise en service.

### L'opérateur en mode démonstration

Faute de fournisseur d'identité, `AUTH_MODE=dev` permet de **choisir
l'opérateur connecté dans l'interface** : un sélecteur dans l'en-tête, alimenté
par les comptes actifs, et l'identité retenue est transmise à chaque requête
par l'en-tête `x-mti-operateur`. C'est ce qui rend une démonstration crédible —
la colonne « Opérateur » suit le choix, et l'audit enregistre bien l'opérateur
désigné comme auteur.

**Laisser le client choisir son identité est une usurpation.** C'est sans
conséquence en démonstration, où il n'y a pas d'identité à usurper, et
inacceptable dès qu'un dossier réel est en jeu. Trois garde-fous, tous
nécessaires et tous vérifiés par la suite de tests :

1. `auth.js` ne lit `x-mti-operateur` que si `mode === 'dev'`. En `oidc`,
   l'en-tête est ignoré.
2. `verifierConfigurationAuth` refuse `dev` avec `NODE_ENV=production` : le
   serveur ne démarre pas.
3. Un compte désactivé cesse aussitôt d'être désignable — la résolution n'est
   pas mémorisée, contrairement à l'opérateur par défaut.

L'interface porte en permanence un bandeau rappelant que la double validation
et la signature électronique **n'ont pas de valeur probante dans cet état**.
Une démonstration ne doit pas pouvoir passer pour une mise en service.

Réciproquement, `AUTH_MODE=oidc` sans fournisseur d'identité branché rend
l'application **entièrement muette** : toutes les routes applicatives répondent
501, seul `/api/sante` reste ouvert — c'est le seul moyen de diagnostiquer une
instance dans cet état. Le message d'erreur nomme donc la variable et le
remède, et pas seulement le symptôme : le texte du serveur parle du SSO, ce qui
est exact mais envoie chercher du côté de l'intégration ou d'une base vide
alors que la cause est une ligne d'`App Configs`. Le complément est posé dans
`web/src/api.js` (`messageErreur`), c'est-à-dire là où l'exploitant lit
réellement le message. Éprouvé par `npm --prefix api run test:oidc`.

### L'aphérèse est un jalon, plus un processus

Le parcours v2 portait un processus « Aphérèse / leucaphérèse » à cinq points de
contrôle, et la commande portait en plus un point « Date d'aphérèse ». La v3
retire le processus, la v4 le point de la commande : à ce stade du projet,
l'aphérèse n'est **qu'une date, facultative**, et deux endroits pour la saisir
n'auraient rien dit sur lequel fait foi. Elle vit donc en jalon d'en-tête du dossier
(`apherese_faite` / `date_apherese`), comme la prescription, avec la même
contrainte de base : une date sans jalon posé est refusée
(`dossier_date_apherese_exige_jalon`), l'inverse est permis — le jalon peut
précéder la date connue.

Conséquence à ne pas perdre de vue : **le rang d'un processus n'est pas un
identifiant**. Retirer l'aphérèse a décalé douze processus d'un cran et fait
passer `indexIdentificationPatient` de 8 à 7. Tout ce qui désigne un processus
le fait désormais par son `code` — le seed de démonstration comme le calcul de
`indexIdentificationPatient` à la publication d'une version, qui est recalculé
d'après `MISE_EN_FABRICATION` plutôt que recopié.

### En-tête du dossier : information importante, IPP et numéros patient

Trois champs ajoutés par la migration `008`, tous en en-tête parce que c'est là
qu'ils servent :

- **`information_importante`** — une ligne libre, toujours visible, qui passe en
  alerte visuelle dès qu'elle est renseignée. Distincte de
  `dossier.commentaire`, qui documente le dossier sans être mis en avant :
  celle-ci s'adresse à quiconque ouvre le dossier (« conteneur consigné, litige
  transporteur ouvert »).
- **`patient_identite.ipp`** — l'identifiant permanent du patient dans le SIH.
  Le porter ne contredit pas la règle « pas de référentiel patients » : c'est
  précisément ce qui dispense d'en constituer un, puisqu'il rend le dossier de
  référence retrouvable.
- **`patient_identite.identifiants`** — les numéros complémentaires, **libellé
  compris**. Un JSONB `[{"libelle":…,"valeur":…}]` plutôt que des colonnes
  `numero_1` / `numero_2` : le libellé est modifiable par l'utilisateur et
  diffère d'un établissement à l'autre (n° de séjour, d'essai clinique, de
  protocole). Deux colonnes auraient figé un nombre arbitraire et laissé le
  libellé sans place. Libellés par défaut « N° patient 1 », « N° patient 2 ».

La forme du JSONB est vérifiée **en base**, par une fonction `IMMUTABLE` appelée
depuis un `CHECK` — PostgreSQL refuse une sous-requête dans un `CHECK`, et
parcourir un tableau JSONB en exige une. Le `coalesce` de cette fonction n'est
pas cosmétique : `e -> 'libelle'` sur une clé absente rend `NULL`,
`jsonb_typeof(NULL)` rend `NULL`, et `NULL <> 'string'` vaut `NULL` — pas `TRUE`.
Sans lui, un objet sans libellé passait. Éprouvé par le TEST 17 des invariants.

### L'onglet Configuration publie une version, il ne modifie rien

Paramétrer un processus ou un point de contrôle **ne modifie jamais le modèle en
place** : chaque enregistrement publie `version + 1` et la met en service.
Il n'y a délibérément **pas** de route de modification.

La raison n'est pas la prudence. `dossier_processus.definition` porte une copie
de la définition, figée à la création du dossier : modifier le modèle actif ne
toucherait de toute façon pas aux dossiers ouverts, mais ferait perdre la trace
de ce qui a été appliqué à quel dossier. Or une exigence BPP veut que ce qui a
été contrôlé reste relisible **tel qu'il a été prescrit au moment du contrôle**.
Les versions précédentes restent donc en base et consultables
(`GET /api/modeles/:code/versions/:version`).

Le bandeau de l'onglet affiche le nombre de dossiers ouverts sous la version en
service. Sans ce chiffre, « publier » a l'air d'une modification rétroactive —
ce qu'il n'est justement pas.

L'écran refuse les combinaisons que le serveur refusera : un seuil ne s'offre que
sur un point de type `valeur` (posé sur un oui/non il ne déclencherait jamais
rien, et l'utilisateur croirait son alarme armée), un n° de série suppose
plusieurs exemplaires, un point ne se rattache qu'à un kit de sa section. Les
mêmes règles sont revalidées côté serveur : une définition acceptée puis
illisible à l'ouverture d'un dossier serait bien pire qu'un refus, elle ne se
manifesterait qu'au moment de la saisie, dossier par dossier.

### Les jalons calendaires sont typés

Le type de point `date` (migration `006`) porte les jalons de la commande MTI :
date d'aphérèse, de lymphodéplétion, de réception prévue. En texte libre ils
seraient inexploitables — impossible de trier, de comparer, ni de signaler une
réception prévue dépassée. La valeur vit dans `saisie.valeur_texte` au format
ISO ; le type du point dit déjà comment la lire, une colonne de plus ne se
justifiait pas.

`api/src/seed.js` charge **tous** les `shared/parcours-*.json` et n'active que
la version la plus haute par code, après avoir désactivé les autres : la base
n'admet qu'une version active par code (`modele_parcours_actif_unique`), et une
version retirée du service doit rester en base, sinon les dossiers qui la
référencent deviendraient illisibles.

### Kits, exemplaires, n° de série, commentaires

Quatre évolutions de points, demandées en réunion, portées par le référentiel
(`jsonb`) pour trois d'entre elles et par deux colonnes pour la dernière.

| Demande | Où elle vit | Pourquoi là |
|---|---|---|
| Regroupement par **kit** | `section.kits[]` + `point.kit` | C'est une propriété du modèle, pas de la saisie |
| **Exemplaires par point** (`point.exemplaires`) | Modèle | Trois tubes CD4 et deux tubes CD8 ne se comptent pas ensemble, et surtout pas avec les exemplaires du produit |
| **Double validation** (`point.doubleValidation`) | Modèle | Le point est soumis ou non à contresignature, indépendamment du dossier |
| **N° de série** et **commentaire** | `saisie.numero_serie`, `saisie.commentaire` (migration `007`) | C'est l'opérateur qui les renseigne, pour un exemplaire donné |

Le n° de série vient **en complément** du n° de lot, jamais à sa place : un lot
couvre plusieurs exemplaires, le n° de série en identifie un seul. La clé unique
de `mti.saisie` portant déjà l'exemplaire, aucune structure supplémentaire n'a
été nécessaire.

Le commentaire répond à ce qu'un type de point ne peut pas exprimer : ce qui
explique un écart ou une réserve ne rentre pas dans une case à cocher. Sans lui,
cette information partait dans le commentaire global du dossier, où elle perdait
le lien avec la ligne concernée.

### La double validation est une contresignature de processus

Ce n'est **pas** une seconde saisie ligne à ligne — le double contrôle
Op.1/Op.2 existe déjà pour ça. C'est une validation **globale** du processus par
une 2ᵉ personne identifiée, avec rappel des points concernés : c'est cette liste
qui donne son sens au geste.

Elle vit dans `mti.signature`, où elle a sa place : le rôle `verificateur`
existe, la table est auditée, et `mti_app` n'a ni `UPDATE` ni `DELETE` dessus —
une contresignature posée ne se retire pas. L'empreinte SHA-256 porte sur le
processus **et la liste exacte des points contresignés** : si la définition
changeait, l'empreinte ne correspondrait plus, ce qui est le but.

Contresigner par le même opérateur que celui qui saisit est refusé : tout
l'objet du double contrôle est qu'un second regard s'exerce.

> **Sans valeur probante en l'état.** Le geste se limite à un choix nominatif
> tant que l'authentification réelle n'est pas branchée. Deux identités
> authentifiées distinctes sont un prérequis, pas une évolution.

### Prescription : un jalon, pas un référentiel

`mti.dossier.prescription_faite` (migration `005`) répond à un besoin simple —
jalonner le parcours — sans que ce module porte la moindre donnée de
prescription. La raison est la même que pour les patients : la source de vérité
est le logiciel de prescription (Pharma®/CHIMIO®).

Rattacher une prescription **identifiée** — sa référence, son protocole, son
prescripteur — suppose de décider où elle vit et qui en répond. **Cette décision
est reportée**, et le booléen ne la préempte pas : il n'introduit aucune
structure à défaire ensuite.

`false` signifie « pas encore réalisée », pas « inconnue » : c'est l'état de
départ de tout dossier, et il n'y a pas de tiers état à distinguer. Le jalon
s'enregistre au clic, sans attendre un « Enregistrer » — un changement d'onglet
le perdrait — et son passage est tracé avec son auteur, comme le reste.

### Les filtres du tableau de bord sont côté serveur

Chaque en-tête de colonne porte son filtre — n° de dossier, produit, n° de lot,
patient, prescription, étape en cours, statut. Tous partent au **serveur**, et
c'est le point à ne pas retoucher : la liste est plafonnée à 200 lignes, et
filtrer une liste déjà tronquée cacherait **sans le dire** les dossiers
correspondants situés au-delà du plafond. Un filtre qui ment par omission est
pire que pas de filtre.

Deux conséquences :

- La liste des étapes proposées est lue des **dossiers**, pas du modèle actif
  (`GET /api/dossiers/etapes`). Un dossier ouvert sous une version précédente
  porte des processus que le modèle ne connaît plus — l'aphérèse en est
  l'exemple — et une liste tirée du modèle actif les rendrait infiltrables.
- Les champs texte passent par un chargement différé de 300 ms. Un appel par
  frappe était déjà limite avec une seule zone de recherche ; avec quatre champs
  de filtre, c'était intenable.

Quand un filtre est posé, le bandeau le dit : les compteurs des tuiles portent
sur ce qui est affiché, et un total qui ne correspond pas à l'écran est
trompeur.

### Le tableau de bord est le point d'entrée

L'application ouvre sur la liste des dossiers, pas sur un formulaire vide :
recherche libre (référence, lot, produit, nom de patient), filtre par produit,
tuiles de comptage, et démarrage d'un scénario avec son produit et son n° de lot
en un seul appel — un dossier créé sans son produit parce qu'un second appel a
échoué serait une incohérence gratuite. Un clic sur une ligne ouvre le dossier
dans l'onglet Scénario. Les dossiers terminés restent listés et consultables :
ils sont figés, pas effacés.

Deux règles d'affichage sont calculées **côté serveur**, pour ne pas être
dupliquées dans le front où elles finiraient par diverger : « en attente
d'allocation » (absence de patient sur un dossier ouvert) et « Parcours clos »
(dossier validé). L'anonymat vaut dans la liste comme ailleurs — aucun objet
patient n'est renvoyé tant que le dossier n'en porte pas, alors que la recherche
porte bien sur le nom, parce que c'est l'usage réel.

### Comptes et profils

L'onglet *Utilisateurs* gère les comptes : création, correction d'état civil,
attribution d'un profil, activation. Trois règles s'y appliquent, qui découlent
de la traçabilité plutôt que de l'ergonomie :

- **Aucune suppression.** Un utilisateur est l'auteur de saisies, de signatures
  et d'événements d'audit. L'effacer priverait la traçabilité de son auteur.
  Un compte se désactive ; il conserve ce qu'il a signé.
- **L'identifiant est immuable** après création. C'est la clé du compte et le
  lien avec le fournisseur d'identité : le changer réaffecterait à quelqu'un
  d'autre des saisies déjà signées.
- **Le dernier compte actif ne peut pas être désactivé**, ni un opérateur
  se désactiver lui-même. Sans compte actif, plus aucune écriture ne peut être
  tracée, donc plus aucune écriture n'est possible.

`mti.utilisateur.profil` (migration `004`) porte un axe de droits distinct de
`fonction`, qui reste un intitulé libre et descriptif. **Ce profil ne
conditionne rien à ce stade** : le rendre agissant suppose d'abord une
authentification réelle. En `AUTH_MODE=dev` l'opérateur est fixe — un contrôle
de droits n'y aurait aucune valeur. Le champ est renseignable et tracé, pour que
les profils soient déjà attribués le jour où le SSO est branché.

## Déploiement CapRover

Trois apps :

| App | Source | Notes |
|---|---|---|
| `mti-db` | One-click app PostgreSQL 16 | Volume persistant + **sauvegardes testées en restauration** |
| `mti-api` | Ce dépôt, `./api/captain-definition` | Variables : cf. `.env.example` |
| `mti-web` | Ce dépôt, `./web/captain-definition` | nginx sert le bundle et relaie `/api/` vers `srv-captain--mti-api:3000` |

Procédure détaillée, commandes vérifiées et diagnostic :
[deploiement-base.md](deploiement-base.md). En résumé :

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

## Le jeu de démonstration

`api/src/seed-demo.js` pose dix dossiers, dix patients et dix comptes — de quoi
montrer l'application peuplée sans avoir à saisir un parcours en séance.

```bash
SEED_DEMO=oui npm --prefix api run seed:demo         # insertion
npm --prefix api run seed:demo:purge                 # retrait
```

Les dix dossiers ne sont pas dix fois le même : ils s'étalent du premier
processus au parcours clos, trois sont sans patient (dont un arrivé jusqu'à la
réception — l'anonymat n'est pas qu'un état transitoire du début de parcours),
un porte une alarme de seuil, trois sont contresignés, deux sont clos dont un
non conforme. Un jeu où tout est conforme n'apprend rien ; un jeu où tout est
en alarme non plus.

Trois propriétés valent d'être notées, parce qu'elles ne vont pas de soi :

- **La chronologie tient.** Un processus par jour, saisies datées sur le jour de
  leur processus, clôture du dossier après son dernier processus. Sans ça, le
  tableau de bord affichait une dernière activité postérieure à la validation.
- **L'insertion est idempotente.** Un dossier, un compte ou un patient déjà
  présent est laissé tel quel : le seed se relance sans rien détruire.
- **La purge ne casse pas la traçabilité.** Un compte qui figure au journal
  d'audit est **désactivé, pas effacé**. `mti.audit` survit à la purge — il
  n'est pas effaçable, par construction — et ne porte aucune clé étrangère vers
  `utilisateur` : effacer un compte qui y figure ne casse rien à l'insertion,
  mais laisse des centaines de traces dont l'auteur n'est plus qu'un UUID que
  rien ne résout. C'est exactement ce que le journal est censé empêcher.

`/api/sante` et l'installateur comptent les trois natures séparément et
refusent de conclure « ok » tant qu'il en reste une. Un dossier fictif est le
plus trompeur des trois : rien ne le distingue d'un dossier réel dans le
tableau de bord.

## Vérifications

```bash
# Invariants du schéma (17 tests) — se lance avec un search_path par défaut,
# comme un vrai client, pour ne pas masquer les références non qualifiées.
psql -d mti -v ON_ERROR_STOP=1 -f db/tests/test_invariants.sql

# API de bout en bout
npm --prefix api run test:e2e

# Jeu de démonstration : insertion, idempotence, purge
npm --prefix api run test:demo

# Onglet Configuration : publier une version sans toucher aux dossiers ouverts
npm --prefix api run test:config

# Ce que fait l'application en AUTH_MODE=oidc sans SSO branché
# (démarrer le serveur avec AUTH_MODE=oidc au préalable)
npm --prefix api run test:oidc

# Parcours dans un vrai navigateur
npm --prefix web run test:navigateur
```

## Évolutions V5 — réunion du 26 juin 2026

Ces points sont des **exigences fonctionnelles**, pas des pistes : ils sont
maquettés dans `docs/reference/scenario_mti_dialog_v12.html` et restent à
porter dans le front Vue et le schéma.

### Ce qui est arrêté

| Sujet | Décision | Impact modèle |
|---|---|---|
| Périmètre | Le module reste **intégré à Chimio**, pas distinct — à réétudier sans présupposer la réponse | — |
| Rattachement | Aux trois entités **patient, prescription, produit**, dès que la maturité du dossier le permet : préallocation ou mise en fabrication | `dossier.prescription_id` à ajouter |
| Processus commande | Circuit de commande **dédié MTI**, distinct du circuit standard, avec dates d'aphérèse, de lymphodéplétion et de réception prévue | nouveaux processus en amont de la réception |
| Double validation | Un point de contrôle se réalise à **1 (défaut) ou 2 personnes**. La 2ᵉ personne valide le processus **globalement**, avec identification nominative et rappel des points concernés | `point.double_validation`, signature de processus |
| Kits | Regroupement logique d'étapes par **kit** (ex. 1 boîte = 3 tubes CD4 + 2 tubes CD8) | `section.kits[]`, `point.kit` |
| Exemplaires | Une case à cocher déclenche l'enregistrement d'un **n° de série par exemplaire**, en complément du n° de lot | `point.numero_serie`, `saisie.numero_serie` |
| Commentaires | **Texte libre par ligne**, restitué en bulle (tooltip) | `saisie.commentaire` |
| Chronologie | Certains processus sont **indépendants** : réalisables sans attendre la validation du précédent | `processus.independant` |
| Workflow fabrication | **Décongélation** et **réception des poches** sortent du workflow de fabrication et deviennent des processus de premier niveau — la réception des poches ne doit pas être enfouie | réordonnancement du parcours |
| Tableau de bord | Liste des scénarii, consultation **par patient et par produit**, dossiers terminés restant consultables, démarrage d'un scénario | vue de liste + recherche |

### Points encore ouverts

1. **Module distinct ou intégré à Chimio** — à étudier, sans présupposer la réponse.
2. **Planning de réception** — gardé en vue pour la phase 2 ; la maquette n'expose
   que la réservation d'un créneau.
3. **Menu Activité** — appel aux check-lists MTI quand elles s'intercalent à des
   étapes déjà codées dans Chimio ; l'articulation reste à spécifier.
4. **Double validation réelle** — la maquette se limite à un choix nominatif.
   Le geste suppose deux identités authentifiées distinctes, donc le SSO
   (voir *L'authentification est un prérequis*).

Prochaine réunion : 7 septembre 2026.

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
