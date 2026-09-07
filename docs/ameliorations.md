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

### 1.1 Déclôturer, dévalider — contre la règle du dossier figé

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

**À décider** : pour un parcours avorté, voulez-vous pouvoir le reprendre plus
tard, ou seulement le clore ? Les deux ne demandent pas le même travail.

### 1.2 Validation automatique — complétude n'est pas conformité

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

Si vous préférez malgré tout la validation entièrement automatique, dites-le et
je l'implémente : c'est votre responsabilité professionnelle, pas la mienne. Je
vous demanderai seulement de le tracer explicitement dans l'audit
(« validation automatique sur complétude »), pour qu'une inspection puisse
distinguer les deux.

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

### 1.4 Le numéro d'ordonnancier et le processus qui le déclenche

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

**À décider aussi** : le numéro est-il attribué par la base (comme le n° de
dossier, série continue et auditable) ou repris de Pharma®/CHIMIO® ? Les deux
se défendent ; la seconde évite deux registres qui divergent.

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
| §3 **dissocier fichiers téléversés et photos**, accepter le PDF | nouvelle valeur `fichier` dans l'enum `type_point` (migration **seule dans son fichier**, contrainte PostgreSQL), élargissement de `MIMES_PHOTO`, et **relèvement du plafond de 8 Mio** — un PDF de certificat le dépasse vite. Le plafond est un `CHECK` en base : nouvelle migration. |
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
