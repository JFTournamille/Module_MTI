# Améliorations demandées — triage

Demandes du 7 septembre 2026, confrontées au code en service. Trois catégories :
**déjà fait**, **à décider avant d'écrire une ligne**, **à faire** — avec pour
chacune ce qu'elle coûte réellement.

L'ordre des sections suit la demande, pas la priorité. La priorité proposée est
en fin de document.

---

## 0. Ce qui est déjà en place

À vérifier dans l'application avant de le redemander.

| Demande | État |
|---|---|
| §4 « pour le second opérateur, sélection de son nom dans une liste » | **fait** — `BlocContresignature.vue` propose un `<select>` des comptes actifs, l'opérateur courant exclu de sa propre contresignature |
| §2 « afficher les éléments bloquants au moment de la validation » | **fait en partie** — la barre de pied affiche « Validation bloquée : … ». Ce qui manque : les blocages **des étapes antérieures**, aujourd'hui non calculés |
| §1 « numéro d'ordonnancier » | **la colonne existe en base** (`dossier.numero_ordonnancier`), elle n'est ni saisie ni affichée |

---

## 1. Ce qui doit être décidé avant d'être écrit

### 1.1 Déclôturer, dévalider — **tranché : on clôt seulement** ✔ fait

**Demandes concernées** : §1 « possibilité de déclôturer une ligne », §4
« profils avancés autorisés à clôturer un parcours, à le dévalider ».

Le module tient une règle qui n'est pas une préférence technique : **un dossier
validé est en lecture seule, toute correction passe par une nouvelle version,
jamais par un `UPDATE`**. Elle existe parce qu'un dossier validé est une preuve :
il porte le nom du pharmacien qui a validé, à une heure donnée. Repasser son
statut à « en cours » par un `UPDATE` effacerait ce que quelqu'un a signé.

Un `UPDATE` sur `dossier.statut` est donc exclu. Deux formes acceptables :

- **Reprise par nouvelle version** — le dossier validé reste intact et lisible ;
  une nouvelle version reprend son contenu et redevient modifiable. C'est ce que
  fait déjà le module pour les modèles de parcours. Le lien entre les deux
  versions se lit dans le journal d'audit.
- **Annulation motivée** — le statut passe à `annule` (valeur qui existe déjà
  dans `statut_dossier`), avec un motif obligatoire et l'auteur tracé. Le dossier
  ne redevient pas modifiable ; il cesse d'attendre quelque chose.

Le second couvre §1 « clôture manuelle en cas d'avortement d'un parcours ». Le
premier couvre §10 « reprise éventuelle, par exemple au niveau de la
prescription ».

**Décision du 7 septembre 2026 : uniquement le clore.**
**Révisée le 15 septembre 2026 : un profil avancé doit pouvoir déclôturer.**
La demande « possibilité de déclôturer une ligne » du §1 est donc rétablie, et
livrée — voir « Réouverture » plus bas.

**Implémenté** (migration `013_cloture_dossier.sql`, route
`POST /api/dossiers/:id/clore`) :

- le motif est obligatoire, non blanc, avec son auteur et sa date — la base le
  tient (`dossier_clos_coherent`), pas seulement l'API ;
- un dossier clos est **figé** exactement comme un dossier validé : en-tête,
  saisies, photos, signatures, ajout de processus, validation, tout est refusé
  en 409. Le gel passe par un `estFige()` unique — huit gardes dispersées
  auraient divergé, et la clôture n'aurait gelé que ce à quoi on aurait pensé ;
- les processus non validés passent à `annule` ; ceux déjà validés ne bougent
  pas, ils ont été faits et par quelqu'un ;
- un dossier **validé** ne se clôt pas : il est allé au bout, le clore
  effacerait la conclusion du pharmacien ;
- `conformite` reste `NULL` : un parcours inachevé n'est ni conforme ni non
  conforme, et « non conforme » sur un décès patient serait un contresens qui
  remonterait au tableau de bord ;
- le tableau de bord porte la colonne de statut (« Clos — parcours avorté »),
  **le motif sous l'étape** — sans lui, « clos » renvoie à ouvrir le dossier,
  ce que le tableau de bord est censé éviter — un filtre `clos`, et la ligne
  sort des vues « en cours » et « en attente » ;
- la clôture est tracée dans `mti.audit` avec son auteur et le statut avant /
  après.

**Réouverture** (migration `016_decloture.sql`, route
`POST /api/dossiers/:id/declore`) :

- réservée aux profils **pharmacien** et **administrateur** — ni le préparateur
  ni l'IDE : rouvrir un parcours arrêté est une décision sur la conduite du
  traitement, pas un geste d'exécution. Le profil « qualité » en est écarté
  aussi : il constate et documente les déviations, il ne décide pas de
  reprendre un traitement. La liste se change à un seul endroit
  (`PROFILS_DECLOTURE`), et c'est **le serveur** qui refuse (403) — le bouton
  masqué à l'écran ne protège rien ;
- le motif de réouverture est obligatoire, comme celui de la clôture ;
- **la clôture n'est pas effacée.** Les colonnes de `dossier` ne portent que la
  clôture en vigueur et sont vidées à la réouverture ; l'historique vit dans
  `mti.cloture`, un épisode par arrêt, avec motif, auteur et date **des deux
  gestes**. Un parcours peut être clos, rouvert, reclos : chaque épisode laisse
  sa ligne. C'est ce qu'une inspection viendrait chercher — combien de fois,
  par qui, pourquoi — et c'est exactement ce qu'un simple retour de statut
  aurait perdu ;
- les processus annulés par la clôture redeviennent « à venir » et le premier
  reprend la main ; **ceux déjà validés ne bougent pas** — les rouvrir
  effacerait leur validation et son auteur ;
- un dossier **validé** ne se rouvre pas : il n'est pas clos, il est allé au
  bout, et le rouvrir défairait la conclusion signée du pharmacien.

### 1.2 Validation automatique — **tranché : automatique si tout est vert** ✔ fait

**Demandes concernées** : §2 « si l'ensemble du processus est conforme, cocher
automatiquement Conforme et valider automatiquement le processus », §8 « rendre
les coches de conformité automatiques si tout est coché correctement ».

Une réserve à porter à votre attention, sur votre terrain plutôt que sur le mien.

Ce que le module sait constater, c'est que **tous les points obligatoires sont
renseignés et qu'aucun n'est hors seuil**. Ce n'est pas la même chose que
« le processus est conforme » : la conformité d'une réception de CAR-T est un
jugement pharmaceutique — l'état du conteneur, la cohérence du lot avec la
commande, ce que dit le certificat du fabricant. Le double contrôle pharmacien
à réception est une exigence réglementaire, et ce qu'elle exige est **un geste**,
pas un état calculé. Cocher « Conforme » à la place du pharmacien parce que les
cases sont remplies, c'est produire une signature que personne n'a donnée.

Ce que je propose à la place, qui répond au besoin réel — ne pas cliquer dix
fois — sans fabriquer de signature :

- quand tout est renseigné et rien hors seuil, la coche « Conforme » est
  **préposée** (proposée, visiblement, avec la mention de ce qui a été
  constaté) et le bouton **s'active** ;
- il reste **un** geste : valider. Un seul clic au lieu de dix, mais un clic.
- si quelque chose est hors seuil ou manquant, la coche n'est pas préposée et le
  bouton dit ce qui manque.

Cela couvre aussi §2 « remplacer les multiples actions de validation par un seul
bouton Valider », qui est le vrai besoin derrière la demande.

**Décision du 7 septembre 2026 : conformité automatique, à la condition que
toutes les coches soient vertes.** Réserve levée par la décision ; elle reste
consignée ci-dessus parce qu'elle explique la forme retenue.

**Implémenté** (migrations `014_conformite_automatique.sql` et
`015_coches_attendues.sql`) avec deux garde-fous qui portent toute la valeur de
l'automatisme :

1. **C'est le serveur qui constate.** La route de validation ne reçoit plus une
   conformité à enregistrer mais `conformite: 'auto'` — une *demande de
   constat* — et interroge `mti.coches_non_vertes()`. Un client ne peut pas
   affirmer « tout est vert », il peut seulement le demander : une page
   périmée, un bogue d'affichage ou une requête forgée ne signeront donc pas
   « conforme » sur un relevé hors seuil.
2. **La machine confirme le vert, elle ne prononce jamais une
   non-conformité.** Tout vert → `conforme`, marqué
   `conformite_automatique = true`. Une coche rouge → refus 422 avec le détail
   de ce qui est rouge, jamais un basculement en `non_conforme` : ce serait
   prononcer un jugement que personne n'a porté. La base tient l'asymétrie
   (`dossier_auto_jamais_non_conforme`).

Trois façons pour une coche de ne pas être verte : relevé hors seuil, réponse
« non », point obligatoire non renseigné — **ou jamais saisi**.

> **Défaut corrigé en cours de route, et il était grave.** La première version
> de la fonction ne regardait que les lignes de `saisie` existantes. Un dossier
> où personne n'a rien saisi n'a aucune ligne, donc rien de rouge, donc « tout
> vert » : la conformité automatique se serait posée sur un parcours que
> personne n'a parcouru. La fonction compare désormais aux points obligatoires
> de la **définition figée** du processus. Un dossier vierge compte 54 coches
> attendues, aucune verte.

Une conformité automatique est marquée comme telle et se distingue donc dans le
journal d'audit d'une conclusion signée à la main — ce qui permet à une
inspection de faire la différence.

**Couvre aussi le §8** : la zone du pied de page nomme désormais le processus
qu'elle évalue (« Réception — conforme », « 3 coche(s) non verte(s) ») au lieu
d'un « Conformité : » qui ne disait pas de quoi, et met le constat en évidence
quand il est acquis. Le bouton annonce ce qu'il va faire : « Valider —
conforme (auto) ».

**Corrigé au passage** : les points de type `liste` n'étaient jamais comptés
incomplets côté écran, alors que la route de validation les refuse — le bouton
s'armait et la validation répondait 422 sans que rien ne l'ait annoncé. Les
points `photo` sont inclus dans le constat de vert, ce que le contrôle de
complétude historique ignorait.

### 1.3 Les deux boutons « Valider »

**Demande** : §2 « clarifier la différence entre Valider ce processus et
Valider ».

Confirmé, l'ambiguïté est réelle : l'écran porte « Valider ce processus »
(un processus du parcours) et « ✓ Valider » (le dossier entier). Deux portées
très différentes, deux libellés presque identiques, côte à côte.

Proposition : **« Valider ce processus »** et **« Clore le dossier »**, ce
dernier séparé visuellement et confirmé par une fenêtre qui rappelle son effet
(lecture seule définitive). **À valider par vous** — c'est du vocabulaire
métier, il doit être le vôtre.

### 1.4 Le numéro d'ordonnancier — **tranché : saisie manuelle** ✔ fait

**Demande** : §1 « numéro d'ordonnancier à partir de la mise en fabrication ».

Deux points à trancher :

1. **« Mise en fabrication » n'existe plus.** Le processus a été renommé
   **Préparation** à votre demande, et ce qui relevait du fabricant est reporté
   dans Commande. Le numéro doit-il être attribué à l'ouverture de
   **Préparation** ?
2. Un numéro d'ordonnancier est une inscription **nominative** au registre.
   L'attribuer impose donc que le patient soit rattaché — ce qui est cohérent :
   Préparation est en aval de Rattachement dans le parcours. Mais il faut le
   dire, parce que cela ferme la porte à un ordonnancier sur dossier anonyme.

**Décision du 7 septembre 2026 : le numéro est transmis par CHIMIO au moment de
la préparation, et saisi à la main pour l'instant.** Donc **pas de séquence côté
base** : le registre reste celui de CHIMIO, et deux séries parallèles auraient
divergé au premier écart.

**Implémenté** : le champ est saisissable dans l'en-tête du dossier (la colonne
`dossier.numero_ordonnancier` et la route `PATCH` l'acceptaient déjà), et une
colonne « N° ordonn. » figure au tableau de bord.

Le champ n'apparaît qu'à partir du processus qui identifie le patient — une
inscription au registre est nominative, elle n'a pas de sens sur un dossier
anonyme. C'est un garde-fou d'écran, pas un refus de l'API : la saisie reste
« autorisée pour l'instant », comme demandé.

---

## 2. Ce qui est à faire, par coût

### 2.1 Petit — front seul, pas de migration

| Demande | Note |
|---|---|
| §8 surbrillance de la ligne du tableau de bord au retour | mémoriser la référence du dernier dossier ouvert |
| §1 colonne « N° d'ordonnancier » | la colonne existe en base ; reste l'affichage et la saisie |
| §1 colonne « statut clos / non clos » | dépend de la décision 1.1 |
| §2 un seul bouton « Valider » par processus | dépend de la décision 1.2 |
| §8 mise en valeur des coches de conformité | et clarifier que l'évaluation porte sur **le processus en cours**, pas sur le dossier |
| §4 superposer l'affichage du 2ᵉ opérateur à celui du 1ᵉʳ au dépliage | |
| §4 proposer au 2ᵉ opérateur de contresigner tous les points en suspens, ou de revenir au détail | |

### 2.2 Moyen — une migration, un référentiel ou une route

| Demande | Ce que ça implique |
|---|---|
| §3 **dissocier fichiers téléversés et photos**, accepter le PDF | ✔ **fait** — voir ci-dessous |
| §3 nombre d'exemplaires porté par **le processus en cours** | `dossier.nb_exemplaires` existe déjà mais vaut pour le dossier entier. Il faut le porter sur `dossier_processus`, et retirer `multi` de la fiche de contrôle. Les dossiers ouverts gardent leur définition figée : prévoir la reprise. |
| §3 date et heure automatiques à la première coche d'une ligne | `saisie.saisi_le` existe ; ce qui manque est de le figer à la première coche et de le laisser modifiable en fin de parcours — donc de distinguer « horodatage constaté » et « horodatage corrigé », les deux tracés |
| §4 **codification des profils utilisateurs** + profils de test | l'onglet Codifications existe et accueillera la table ; les droits qu'un profil ouvre (clore, reprendre) dépendent de 1.1 |
| §5 onglet **Audit trail** | `mti_app` a le `SELECT` sur `mti.audit`, donc lisible sans changer les droits. Attention : l'audit contient des identités patient — l'onglet doit être réservé aux profils qui y ont droit |
| §5 processus **indépendants chronologiquement** (conciliation médicamenteuse) | aujourd'hui le parcours est une chaîne ; il faut un processus hors chaîne, ouvrable à tout moment |
| §5 **liaison chronologique explicite** entre deux processus | aujourd'hui l'ordre est implicite (le rang). Le rendre explicite par `code` du prédécesseur, jamais par rang — retirer l'aphérèse en v3 a déjà décalé douze processus |
| §8 export **PDF** et **XLS**, l'impression depuis le document exporté | voir la réserve ci-dessous |

> **Réserve sur les exports.** Le module ne produit aujourd'hui aucun fichier, et
> `MIGRATION.md` le note comme un acquis : un PDF porte des métadonnées (auteur,
> producteur, application) et un XLS aussi. Il faudra les contrôler à la
> génération, sinon l'export dit ce que le masquage du domaine cherche à taire.
> Le module produira par ailleurs des documents **nominatifs** : leur sortie doit
> être tracée dans l'audit, pas seulement permise.

### 2.3 Gros — chantiers à part entière

**§7 Emplacements de stockage.** Un référentiel configurable (cuve → étage →
cassette : 50 × 10 = 500 emplacements pour une seule cuve), l'occupation et la
libération, et la colonne au tableau de bord. Le principe « un produit = un lieu »
se tient par une **contrainte d'unicité en base sur les emplacements occupés** —
pas par une vérification côté navigateur : deux réceptions simultanées prendraient
la même cassette. C'est le point technique qui décide de la qualité du module.

**§6 Règles de configuration et alertes.** Stocker des règles dans le modèle de
parcours, les évaluer, et poser le résultat dans une colonne du tableau de bord
(§1 « colonne des alertes déclenchées »). Votre exemple — prescription C1J1 le 10
septembre, réception annoncée le 11 — est une règle de **cohérence de dates entre
deux processus**, ce qui suppose que les dates soient comparables et typées. À
cadrer : combien de formes de règles, et évaluées quand (à la saisie, à
l'ouverture du tableau de bord, en tâche de fond).

**§1 Tableau de bord paramétrable.** Vues personnalisées, toutes les étapes
cochées par défaut. Suppose de stocker les vues par utilisateur.

**§5 Onglet Statistiques.** À cadrer : quels indicateurs, sur quelle période, pour
qui. Sans réponse, ce serait un onglet de graphiques que personne ne lit.

**§5 Traitement en quarantaine.** Un état du produit qui n'existe pas encore.
À cadrer avec le circuit réel : qui met en quarantaine, qui en sort, et ce qui
est interdit pendant.

---

## 3. Ce qui n'est pas du code

**§9 Articulation avec CHIMIO web et CHIMIO lourd.** À quel moment la
prescription dans CHIMIO web devient obligatoire, et où se fait la bascule vers
la préparation. Ce sont des décisions d'organisation : elles se prennent avec
l'équipe, puis le module les applique. Le module porte déjà « prescription
réalisée », qui impose le rattachement patient — c'est le point d'accroche.

**§10 Ce que « parcours clos » veut dire.** À écrire avant d'être codé, parce que
la réponse détermine 1.1.

---

## 3 bis. §3 — fichiers téléversés dissociés des photos ✔ fait

Migrations `017` (type `fichier`, seule dans son fichier — contrainte
PostgreSQL sur `ALTER TYPE ... ADD VALUE`), `018` (plafond porté de 8 à
20 Mio) et `019` (un point `fichier` sans document n'est pas une coche verte).

**Le modèle portait trois documents déclarés comme photos** : le certificat de
conformité (CoA), l'accusé de commande, le compte rendu de RCP. On les
archivait par une image faute de pouvoir joindre un PDF. Le parcours CAR-T
passe en **v6** avec ces trois points en type `fichier` ; les sept vrais points
photo — état du conteneur, aspect de la poche, jauge d'azote, étiquetage —
restent des photos.

Ce qui sépare réellement les deux :

- **les formats acceptés**, tenus par le serveur et par genre de point : un PDF
  déposé sur un point photo est refusé en 415 ;
- **le rendu** : une photo se regarde en vignette, un document se lit par son
  nom, son poids et son auteur. Un point `fichier` n'a ni vignette ni caméra —
  on ne photographie pas un PDF ;
- **la recompression** : les photos sont réduites à 1600 px avant l'envoi, un
  document est transmis **tel quel**. Recompresser un certificat signé
  produirait un document qui n'est plus celui du fabricant.

Deux points de sécurité traités avec :

- **`image/svg+xml` et `text/html` sont refusés dans les deux genres.** Ils
  portent du script, et le contenu est servi depuis l'origine de
  l'application : un SVG déposé en pièce jointe s'exécuterait avec les droits
  de la page qui l'affiche.
- **Un document se télécharge, il ne s'ouvre pas dans la page**
  (`Content-Disposition: attachment` + `nosniff`). Un PDF servi en ligne
  s'ouvrirait dans le visualiseur du navigateur à l'origine de l'application,
  et un PDF peut porter du script. Les images restent affichées en place.

> **Défaut rattrapé avant le push, et il aurait été bloquant.** La route de
> configuration tenait sa PROPRE liste de types, qui ignorait `fichier` : le
> parcours en service en contenant trois, **toute republication depuis l'écran
> Configuration aurait été refusée**. C'est la deuxième divergence de ces
> listes (`liste` avait eu le même sort). Une vérification part désormais de
> l'enum de la base et éprouve chaque valeur contre la route de création.

---

# Demandes du 17 septembre 2026

## A. Livré et vérifié

| Demande | État |
|---|---|
| L'opérateur connecté remonte dans le bandeau général | ✔ il vivait dans l'en-tête du DOSSIER, donc absent du tableau de bord, de la configuration et des codifications — partout où l'on travaille sans dossier ouvert. Or c'est ce nom qui signera la prochaine saisie. Il est maintenant dans la barre de titre, présente sur tous les onglets. |
| « Enregistrer » → « Laisser en attente » | ✔ le mot laissait croire à un geste terminal, alors que le processus reste ouvert et reprenable. Le geste terminal est « Valider ce processus », juste à côté. |
| Duplication d'un point par n exemplaires | ✔ **migration 020** — le compte appartient désormais au PROCESSUS, pas au dossier |
| Unités de **secours**, gérées comme les exemplaires mais identifiées comme telles | ✔ **migration 022** — `dossier_processus.nb_secours` et `saisie.secours` |

**Sur les exemplaires**, ce qui manquait n'était pas la duplication — elle
fonctionnait déjà — mais l'endroit où le compte se règle. `dossier.nb_exemplaires`
valait pour les onze processus à la fois, alors que ce qui se compte change
d'un processus à l'autre : deux cuves à la réception, une poche à la
préparation. Il fallait donc prendre le maximum et cocher « sans objet »
ailleurs, ce qu'une fiche de traçabilité ne doit pas contenir.

Le compte est porté par `dossier_processus.nb_exemplaires`, réglé dans
l'en-tête du processus. **Réduire le compte efface les saisies des exemplaires
retirés** : les garder laisserait en base des relevés que plus personne ne peut
relire, et un dossier validé en porterait la trace sans les montrer.

**Sur les unités de secours**, la solution facile aurait été de les numéroter
à la suite : trois exemplaires, deux secours → exemplaires 1 à 5, les deux
derniers « étant » les secours. Elle était piégée. Le compte d'exemplaires se
règle à la main et change ; passer de 3 à 2 aurait fait du relevé
« secours n°1 » un relevé « exemplaire n°3 ». Sur une fiche de traçabilité, une
ligne qui change de sens après coup n'est pas un défaut d'affichage, c'est une
preuve falsifiée.

Les secours ont donc **leur propre numérotation** (S1/2, S2/2 à l'écran) et un
marqueur figé en base à la saisie. Un relevé sait pour toujours s'il porte sur
une unité de secours, quoi qu'on fasse ensuite aux comptes — et chaque série
n'efface que ses propres lignes. Seuls les points `multi` en portent : les trois
tubes d'un kit décrivent un contenu figé, pas des unités dont on prévoirait une
réserve.

Côté conformité, une asymétrie voulue. Ne **pas** avoir contrôlé une unité de
secours est le cas normal — l'exiger rendrait tout dossier rouge dès qu'on
prévoit une réserve. Mais un secours **contrôlé** hors seuil ou répondu « non »
compte : il porte sur une unité bien présente au dossier. La machine cesse alors
de constater le vert et rend la main au pharmacien, qui dira si la réserve pèse
ici. Elle ne prononce toujours rien elle-même.

## B. Les quatre chantiers — **tous livrés le 18 septembre**

| Chantier | État |
|---|---|
| B.1 exports PDF et XLS | ✔ **migrations 027** — document réglementaire, filigrane serveur, édition tracée |
| B.2 emplacements de stockage | ✔ **migrations 024–026** — unicité tenue en base, réservation à la saisie, expiration |
| B.3 cohérence de dates | ✔ **migration 023** — la règle alerte, elle n'interdit pas |
| B.4 statistiques d'activité | ✔ **migration 028** — quantitatives, agrégées en base |

Ce qui suit décrit ce que chacun demandait, et ce qui a été retenu. Les
réserves qui restent ouvertes sont signalées comme telles.



### B.1 Exports tolérants aux informations partielles

Les deux boutons d'export **n'ont jamais rien fait** — aucun gestionnaire. Ils
sont désarmés depuis le 15 septembre, précisément pour ne pas promettre ce qui
n'existe pas. La demande est donc : **les écrire**, et qu'ils produisent un
document même sur un dossier incomplet.

« Tolérant aux informations partielles » est la contrainte structurante : un
export n'est pas une validation. Il ne doit rien exiger, rien bloquer, et
**dire ce qui manque plutôt que de le taire** — un PDF qui laisse une case vide
sans le signaler ferait croire à un contrôle non fait plutôt qu'à un contrôle
non exporté.

**Tranché le 18 septembre : document réglementaire, avec filigrane
provisoire.** En-tête établissement, pagination, signatures, et mention
« document non validé » en filigrane tant que le dossier ne l'est pas.

Ce choix couvre les deux usages d'un seul gabarit : on peut éditer à tout
moment, et le document dit lui-même s'il fait foi. C'est aussi celui qui
engage — une fois produit, il peut être présenté à un inspecteur. Ce que cela
impose, et qu'il ne faudra pas rogner :

- le **filigrane est porté par le serveur**, jamais par le navigateur. C'est le
  même raisonnement que la conformité automatique : une page périmée pourrait
  produire un document sans filigrane sur un dossier qui n'est plus validé ;
- les **signatures** sont celles que la base connaît (auteur et date de chaque
  saisie, auteur et date de la validation), pas un champ libre. Un PDF qui
  laisserait saisir un signataire ne prouverait rien ;
- un dossier **clos** ou **en quarantaine** doit le dire sur le document, au
  même titre que « non validé » — sortir un PDF d'apparence ordinaire d'un
  parcours arrêté en chemin serait exactement l'erreur que la distinction
  « validé / clos » a servi à corriger.

> Réserve déjà notée : un PDF et un XLS portent des métadonnées (auteur,
> producteur, application) qu'il faudra contrôler à la génération — sinon
> l'export dit ce que le masquage du domaine cherche à taire. Et ces documents
> seront **nominatifs** : leur sortie doit être tracée dans l'audit, pas
> seulement permise.

> À ne pas oublier à l'écriture : **les unités de secours doivent se lire comme
> telles dans l'export**, comme elles se lisent à l'écran (S1/2). Un tableau qui
> les ramènerait à des exemplaires de plus reproduirait exactement la confusion
> que la colonne `saisie.secours` a été créée pour empêcher.

### B.2 Emplacements de stockage configurables

Votre exemple : une cuve, des étages A à J, des emplacements 1 à 20 — soit
200 emplacements par cuve.

Ce qui décide de la qualité du module ici est **une contrainte d'unicité en
base sur les emplacements occupés**, pas une vérification côté navigateur :
deux réceptions simultanées prendraient la même cassette. Le reste — le
référentiel, l'occupation, la libération, la colonne au tableau de bord — en
découle.

Le lien avec un point de contrôle est la vraie nouveauté par rapport au §7
initial : un point de type `emplacement` qui propose les emplacements libres et
**réserve** celui qu'on choisit.

**Tranché le 18 septembre : réservation dès la saisie, avec expiration.**

La réservation prend effet à l'instant où l'opérateur choisit la place, parce
que c'est au moment du geste physique que deux réceptions simultanées risquent
de prendre la même cassette — attendre la validation laisserait la fenêtre de
collision ouverte pendant tout le processus. Et elle se relâche
automatiquement si le processus reste ouvert trop longtemps, pour qu'un dossier
abandonné ne gèle pas une place dans une cuve qui n'en a que 200.

Les deux points à régler quand on l'écrira, parce qu'ils décident de la
qualité du résultat :

- **le délai d'expiration**, à arrêter avec vous. Ma proposition : le laisser
  en référentiel plutôt qu'en dur, et l'amorcer haut (24 h) — une place reprise
  sous les pieds d'un opérateur est plus grave qu'une place gelée une journée,
  et on ne saura qu'à l'usage ;
- **ce que voit l'opérateur dont la réservation a expiré**. Le silence est le
  mauvais réflexe : il choisirait une place, partirait la remplir, et
  découvrirait le conflit à la validation. Il faut que l'écran le dise au
  moment où la place lui échappe.

La contrainte d'unicité reste **en base** : c'est elle qui arbitre, pas
l'affichage des places libres, qui ne peut être qu'un instantané.

### B.3 Cohérence entre deux dates

Exemple à porter : « la date de ce point ne peut pas être antérieure à la date
de ce point-là ». L'alerte doit se déclencher **à la saisie de l'une comme de
l'autre**, et dire la cause.

C'est la forme la plus simple et la plus utile du moteur de règles du §6, et
c'est par là qu'il faut le commencer : une règle qui compare deux points
nommés par leur `code` (jamais par leur rang — retirer l'aphérèse a déjà décalé
douze processus). Le résultat alimente ensuite la colonne d'alertes du tableau
de bord demandée au §1.

**Tranché le 18 septembre : la règle ALERTE, elle n'interdit pas.** La ligne
se signale, la cause est dite, la saisie passe quand même, et l'incohérence
remonte à la colonne d'alertes du tableau de bord.

C'est cohérent avec tout le reste du module — la quarantaine signale sans
interdire, la machine ne prononce jamais une non-conformité — et c'est le choix
le plus sûr pour la donnée elle-même : une date peut être légitimement étrange,
et un opérateur empêché d'enregistrer un fait réel saisira une fausse date
plausible. Une date fausse et muette est pire qu'une date vraie et signalée.

Point de vigilance : la règle vit dans la **définition figée** du parcours,
donc un dossier ouvert garde les règles de sa version. C'est voulu, mais il
faut le savoir — corriger une règle ne corrigera pas les dossiers en cours.

### B.4 Quarantaine et statistiques

**Quarantaine** — ✔ **fait dans le périmètre arrêté le 17 septembre : « une
grosse mention suffit ».** Migration 021. Filigrane sur tout l'écran (position
fixe, il suit le défilement ; `pointer-events: none`, il ne gêne pas), mention
portant le motif, signalement au tableau de bord **sans changer le statut** du
dossier — le confondre avec un statut ferait disparaître un traitement douteux
des vues où il faut justement le voir.

**Elle SIGNALE, elle n'INTERDIT rien**, et un test le vérifie explicitement :
s'il échoue un jour, c'est que le périmètre a changé, et ce sera visible plutôt
que subi. Ce qui fera la valeur de la fonction reste à écrire — un MTI en
quarantaine ne devrait pas pouvoir être administré — quand le circuit réel
sera arrêté. La colonne est posée pour que ce blocage n'ait plus qu'à s'y
accrocher.

Asymétrie volontaire : **poser** est ouvert à tous — quiconque constate un
doute doit pouvoir le signaler dans la seconde, exiger une autorisation serait
le mauvais réflexe. **Lever** demande un profil pharmacien ou administrateur :
c'est déclarer que le doute est levé. Chaque épisode reste tracé dans
`mti.quarantaine` avec les deux motifs et les deux auteurs.

**Statistiques** — **tranché le 18 septembre : des statistiques d'ACTIVITÉ,
quantitatives.** Nombre de dossiers ouverts, validés, clos, par mois et par
parcours ; volumes par produit et par service.

Ce que ce choix écarte, et c'est une bonne chose à ce stade : le taux de
non-conformité et les alarmes hors seuil par cuve. Le premier était piégé — la
conformité automatique ne prononce jamais une non-conformité, donc l'indicateur
aurait compté des jugements pharmaceutiques en les présentant comme des
constats. Mieux vaut ne pas le tracer que le tracer mal.

Reste à préciser quand on l'écrira : **pour qui**. Un décompte qui justifie des
moyens ne se découpe pas comme un décompte qui pilote une activité au
quotidien, et c'est le découpage — par mois, par parcours, par service — qui
fera qu'on le lit ou non.

### B.5 Ce qui reste ouvert après ces quatre chantiers

Trois points, tous identifiés en écrivant, aucun bloquant :

- **Le délai d'expiration d'une réservation d'emplacement** est amorcé à 24 h
  et se règle depuis l'écran. Il n'a pas encore été confronté à l'usage : une
  place gelée par un dossier abandonné et une place reprise sous les pieds d'un
  opérateur sont deux gênes opposées, et c'est la pratique qui dira laquelle
  pèse.
- **La ventilation des statistiques par service** n'existe pas, parce que le
  dossier ne porte aucun service. Elle demande d'abord une décision : quel
  service compte, celui qui prescrit ou celui qui administre ? Puis une colonne
  et un rattachement à la création du dossier.
- **Le tableur sort en SpreadsheetML** et non en `.xlsx` : du XML lisible,
  qu'Excel et LibreOffice ouvrent, mais qui déclenche un avertissement de
  format sur certaines configurations d'Excel. Si cet avertissement gêne les
  utilisateurs, il faudra assembler une vraie archive — c'est faisable sans
  dépendance, avec le module `zlib` de Node, mais ce n'est pas gratuit.

## C. Ordre suivi

Les quatre cadrages ont été tranchés le 18 septembre, et les quatre chantiers
écrits dans la foulée, dans cet ordre :

1. **B.3 cohérence de dates** — bien cerné, sans dépendance, et il amorce le
   moteur de règles dont dépend la colonne d'alertes. La règle alerte sans
   interdire : c'est aussi le moins risqué à mettre en service.
2. **B.2 emplacements de stockage** — le plus structurant, et le plus coûteux à
   retarder. La réservation à la saisie impose la contrainte d'unicité en base
   dès la première version ; le délai d'expiration reste à arrêter avec vous,
   mais il ne bloque pas le début du travail.
3. **B.1 exports** — le plus lourd des quatre maintenant qu'il s'agit d'un
   document réglementaire, et celui qui engage le plus. À faire après B.2 :
   l'emplacement de stockage a sa place sur le document.
4. **B.4 statistiques d'activité** — en dernier, parce qu'un décompte se lit
   d'autant mieux que les données qu'il compte sont complètes.

---

## 4. Ordre proposé

1. **Les trois décisions du §1** — sans elles, la moitié du reste est à refaire.
2. **§3 fichiers et PDF** — indépendant du reste, gêne tout de suite.
3. **§8 lisibilité de la conformité et surbrillance** — petit, visible, sans risque.
4. **§7 emplacements de stockage** — le plus structurant ; plus il attend, plus
   il coûte.
5. **§6 règles et alertes** — après le stockage, qui lui fournira des données à
   contrôler.
6. **§1 tableau de bord paramétrable**, **§5 audit trail et statistiques**.
7. **§9 et §10** — quand l'organisation aura tranché.
