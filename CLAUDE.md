# CLAUDE.md — Module MTI

## Contexte

Jean-François Tournamille — pharmacien hospitalier en onco-hématologie,
directeur adjoint chez Computer Engineering (éditeur de logiciels biomédicaux),
président d'OncoTherX, gestionnaire des outils numériques de la SFPO.

Ce dépôt est le module MTI : gestion des médicaments de thérapies innovantes,
à l'intersection de la pharmacie clinique, de la traçabilité et du numérique
en santé.

## Lire d'abord

[`docs/architecture.md`](docs/architecture.md) — les cinq décisions
structurantes, les arbitrages ouverts et le reste à faire. Ne pas contourner
ces décisions sans en discuter : elles répondent à des exigences
réglementaires, pas à des préférences techniques.

## Règles de fond

- **Le parcours est anonyme par défaut.** `dossier.patient_id` reste `NULL`
  jusqu'à la mise en fabrication, sauf préallocation explicite. Deux exceptions
  déclenchées par un geste : la préallocation, et **cocher « prescription
  réalisée »**, qui impose le rattachement — une prescription est nominative.
- **Le n° de dossier est attribué par la base.** Séquence
  `mti.dossier_reference_seq` et `DEFAULT` sur `dossier.reference` :
  `MTI-000001`, `MTI-000002`, … Ne pas le calculer côté navigateur — c'est ce
  qui produisait des collisions. La série a des trous, c'est voulu.
- **Toute écriture passe par `api/src/db.js:transaction()`.** C'est ce qui
  renseigne l'auteur pour le trigger d'audit. Une écriture hors de cette
  fonction produit une trace sans auteur.
- **Une photo est une pièce, pas une coche.** Le contenu vit en base
  (`piece_jointe.contenu`), le conteneur CapRover étant éphémère. Le dépôt part
  aussitôt, sans attendre « Enregistrer », et crée sa saisie porteuse. La
  réponse du dossier ne transporte jamais les octets.
- **Un document n'est pas une photo.** Le type `fichier` est dissocié de
  `photo` : formats acceptés différents (`MIMES_PAR_TYPE` dans
  `routes/dossiers.js`), rendu différent (vignette contre nom + poids), et
  **aucune recompression sur un document** — un certificat signé se transmet
  tel qu'il a été reçu, le recompresser produirait une pièce qui n'est plus
  celle du fabricant. `image/svg+xml` et `text/html` sont refusés PARTOUT :
  ils portent du script et le contenu est servi depuis l'origine de
  l'application. Une pièce non-image est servie en `Content-Disposition:
  attachment` avec `nosniff`, pour qu'un PDF ne s'ouvre pas dans la page.
- **Trois listes de types de points doivent rester alignées** : l'enum
  `mti.type_point`, `TYPES_POINT` de `routes/referentiels.js` (ce qu'un
  parcours peut CONTENIR) et `TYPES` de `routes/dossiers.js` (ce qu'une saisie
  peut ÊTRE). Elles ont divergé deux fois ; la seconde rendait le parcours en
  service **impossible à republier**. `api/tests/configuration.mjs` part de
  l'enum et éprouve chaque valeur : ne pas retirer cette vérification.
- **Un dossier de démonstration périmé se refait.** Le seed compare son modèle
  à celui en service. `--regenerer` force la reprise après un changement de
  scénario, que la version du modèle ne trahit pas.
- **`mti.audit` ne se modifie pas.** Le rôle `mti_app` n'a pas les droits
  `UPDATE`/`DELETE` dessus, et c'est volontaire.
- **Un dossier validé est en lecture seule.** Toute correction passe par une
  nouvelle version, jamais par un `UPDATE`.
- **Un parcours avorté se clôt, et se rouvre par un profil avancé.** `POST
  /api/dossiers/:id/clore` pose `statut = 'annule'` avec un motif obligatoire,
  son auteur et sa date (`dossier_clos_coherent`). Un dossier clos est figé au
  même titre qu'un dossier validé — `estFige()` dans `routes/dossiers.js` est
  le seul point de décision, ne pas remettre de test sur `'valide'` seul.
  Clore n'est pas valider : personne ne conclut sur la conformité d'un parcours
  inachevé, `conformite` reste `NULL`.
- **Rouvrir n'efface pas la clôture.** `POST /api/dossiers/:id/declore` est
  réservé aux profils `pharmacien` et `administrateur` (`PROFILS_DECLOTURE`) —
  c'est le premier endroit où `utilisateur.profil` conditionne un droit, et il
  doit rester le seul point de décision. Les colonnes de `dossier` ne portent
  que la clôture **en vigueur** et sont vidées à la réouverture ; l'historique
  vit dans `mti.cloture`, un épisode par arrêt, avec les motifs, auteurs et
  dates des deux gestes. Ne jamais faire repartir un statut sans fermer son
  épisode : l'index partiel `cloture_en_vigueur_unique` l'interdit. Un dossier
  **validé** ne se rouvre pas — il n'est pas clos, il est allé au bout.
  Les processus `annule` redeviennent `a_venir` ; ceux déjà `valide` ne bougent
  pas, les rouvrir effacerait leur validation.
- **Le nombre d'exemplaires appartient au PROCESSUS**
  (`dossier_processus.nb_exemplaires`), plus au dossier : ce qui se compte
  change d'un processus à l'autre — deux cuves à la réception, une poche à la
  préparation. Un compte unique obligeait à prendre le maximum et à cocher
  « sans objet » ailleurs. **Réduire le compte efface les saisies des
  exemplaires retirés** : les garder laisserait en base des relevés que plus
  personne ne peut relire.
- **Une unité de SECOURS a sa propre numérotation.** `dossier_processus.nb_secours`
  compte une réserve, en plus des `nb_exemplaires` nominaux ; `saisie.secours`
  fige à l'écriture le fait qu'un relevé porte sur elle. Ne **jamais** numéroter
  les secours à la suite des exemplaires : le compte se règle à la main, et
  passer de 3 à 2 aurait fait du relevé « secours n°1 » un relevé
  « exemplaire n°3 ». Sur une fiche de traçabilité, une ligne qui change de sens
  après coup n'est pas un défaut d'affichage, c'est une preuve falsifiée. Chaque
  compte n'efface donc que **ses propres** lignes. Seuls les points `multi` en
  portent : un point à compte propre (les trois tubes d'un kit) décrit un
  contenu figé, pas des unités dont on prévoirait une réserve. Côté conformité,
  l'asymétrie est voulue — un secours **non renseigné** est le cas normal et ne
  compte pas, un secours **contrôlé** hors seuil ou répondu « non » compte,
  parce qu'il porte sur une unité bien présente au dossier.
- **Une règle de cohérence ALERTE, elle n'INTERDIT pas.** `mti.incoherences_dates()`
  rend les règles `ordre_dates` en défaut ; rien n'est empêché — ni la saisie,
  ni la validation, ni le constat automatique de conformité. Une date peut être
  légitimement étrange, et un opérateur empêché d'enregistrer un fait réel
  saisira une fausse date plausible : une date fausse et muette est pire qu'une
  date vraie et signalée. Les règles vivent dans
  `modele_parcours.definition.regles`, donc dans la VERSION à laquelle le
  dossier est rattaché — corriger une règle ne corrige pas les dossiers en
  cours, c'est voulu. **Une règle désigne ses points par leur `code`**, jamais
  par leur rang, et une règle dont un point est introuvable est INERTE : elle
  ne compare rien plutôt que n'importe quoi. Un code de point est unique dans
  tout le parcours. Les deux extrémités sont rendues, pour que l'écran marque
  les deux cellules — l'opérateur ne sait pas encore laquelle des deux dates
  est fausse.
- **Un emplacement se CONSTATE, il ne se réserve pas.** Le référentiel
  (`contenant`, `emplacement`) décrit des places : où elles sont, comment elles
  se nomment (`CUVE-1-A-03`), et si elles sont en service. **Il n'y a ni
  disponibilité ni délai de réservation** — retirés le 18 septembre. Ce qui dit
  où un MTI a été posé, par qui et à quelle heure, c'est la **saisie** du point
  `emplacement`, et elle seule est figée par la validation du dossier ; une
  table d'occupation aurait donné deux sources dont une seule fait foi. Le coût
  est assumé et il faut le savoir : **rien n'empêche deux dossiers de désigner
  la même cassette**. Si cela devient un problème à l'usage, ce qu'il faudra
  rétablir est une contrainte d'unicité, pas une réservation à durée limitée.
  Une place se sort du service **avec un motif** ; un contenant ne se supprime
  pas, il se désactive. Le seed livre des contenants d'**exemple** — sans eux,
  un point `emplacement` n'a rien à proposer et l'écran se lit comme une panne.
- **Un export N'EST PAS une validation.** Il n'exige rien, ne bloque rien, et
  **dit ce qui manque plutôt que de le taire** — une case vide sans mention
  ferait croire à un contrôle non fait alors qu'il s'agit d'un contrôle non
  exporté. Le **filigrane est posé par le serveur** (`export-dossier.js:
  mentionsDuDossier`), jamais demandé par le client : une page périmée
  produirait sinon un document sans mention sur un dossier qui ne l'est plus.
  Une ligne sans relevé ne porte **ni date ni opérateur**, même si la base en a
  : les afficher à côté de « non renseigné » ferait lire un blanc comme un
  faux. Les PDF sont écrits sans bibliothèque (`api/src/pdf.js`) pour que
  **rien ne se glisse dans les métadonnées** d'un document nominatif ; le
  tableur sort en SpreadsheetML, lisible et sans archive à assembler. Toute
  édition est **tracée** dans `mti.export_dossier` avec son empreinte, l'état
  du dossier au moment de l'édition et son auteur — un fait daté, qui ne se
  réécrit pas quand le dossier change ensuite.
- **Les statistiques sont d'ACTIVITÉ, quantitatives.** Dossiers ouverts,
  validés, clos — par mois de création, parcours et produit. **Pas de taux de
  non-conformité** : la machine ne prononce jamais une non-conformité, donc
  l'indicateur compterait des jugements pharmaceutiques en les présentant comme
  des constats. **Pas de ventilation par service** : `dossier` n'en porte
  aucun, et une statistique devinée est pire qu'une statistique absente — c'est
  dit à l'écran plutôt que rendu par une colonne vide. Un dossier est compté
  **une seule fois**, au mois de sa création et dans son état du jour ;
  l'agrégation se fait **en base**, jamais à partir de la liste du tableau de
  bord, qui est plafonnée à 200 lignes. La couleur ne porte jamais seule : trois
  teintes passées au validateur de palette, légende toujours présente,
  étiquettes dans les segments et vue tableau complète.
- **La quarantaine SIGNALE, elle n'INTERDIT rien** — périmètre voulu à ce
  stade : filigrane sur tout l'écran, mention au tableau de bord, et la saisie
  reste possible. Un test le vérifie explicitement ; s'il échoue, c'est que le
  périmètre a changé. Ce qui fera la valeur de la fonction, c'est ce qui sera
  interdit pendant — un MTI en quarantaine ne devrait pas pouvoir être
  administré. **Poser** est ouvert à tous (signaler un doute ne doit pas
  attendre une autorisation) ; **lever** est réservé aux profils avancés, comme
  la réouverture d'un parcours clos. L'historique vit dans `mti.quarantaine`,
  un épisode par mise en quarantaine.
- **L'opérateur connecté vit dans la barre de titre**, pas dans l'en-tête du
  dossier : c'est le nom qui signera la prochaine saisie, il doit être visible
  et changeable sur tous les écrans. Ne pas le répéter ailleurs — deux sources
  pour une même information, dont une qui ne se change pas.
- **La conformité automatique est CONSTATÉE PAR LE SERVEUR, jamais affirmée
  par le client.** La route de validation reçoit `conformite: 'auto'` — une
  demande de constat — et interroge `mti.coches_non_vertes()`. Ne jamais
  calculer le vert côté navigateur : une conformité conclue est une signature,
  et une page périmée pourrait la poser sur un relevé hors seuil.
- **La machine confirme le vert, elle ne prononce jamais une non-conformité.**
  Tout vert donne `conforme` + `conformite_automatique = true` ; une coche
  rouge fait refuser le constat (422 avec le détail), jamais basculer en
  `non_conforme` — c'est un jugement pharmaceutique. La base tient
  l'asymétrie (`dossier_auto_jamais_non_conforme`). Ne pas la « compléter ».
- **« Toutes les coches vertes » ne veut pas dire « il n'y a pas de coche ».**
  `coches_non_vertes()` compare aux points obligatoires de la **définition
  figée**, pas aux lignes de `saisie` : la première version ne regardait que
  les saisies existantes, si bien qu'un dossier vierge était déclaré tout
  vert. Le pied de page évalue **le processus en cours**
  (`?processus=<id>`), la validation du dossier évalue le dossier entier.
- **« Parcours clos » ne désigne pas un dossier validé.** Le libellé disait
  l'inverse de ce qu'il dit maintenant : validé = allé au bout
  (« Parcours validé »), clos = arrêté en chemin. Le n° d'ordonnancier est
  transmis par CHIMIO à la préparation et **saisi à la main** — pas de séquence
  côté base, le registre est celui de CHIMIO.
- **Un parcours se crée par reprise d'un autre.** `POST /api/modeles` ouvre un
  code nouveau en v1, le plus souvent en recopiant un parcours voisin réduit
  aux processus retenus. Pas de route de suppression d'un modèle, et il ne doit
  pas y en avoir : les dossiers qui le référencent deviendraient illisibles.
- **Un modèle de parcours ne se modifie pas : on en publie une version.**
  L'onglet Configuration crée `version + 1` et la met en service ; les dossiers
  ouverts conservent la définition figée à leur création. Il n'y a pas de route
  de modification, et c'est volontaire.
- **Le rang d'un processus n'est pas un identifiant.** Retirer l'aphérèse en v3
  a décalé douze processus. Désigner un processus se fait par son `code`.
- **L'anonymat par défaut est une règle du CAR-T autologue, pas du module.**
  Elle est portée par `indexIdentificationPatient` du modèle : la thérapie
  génique et le MTI-PP sont nominatifs dès la commande et valent 0.
- **Il n'y a pas d'onglet « Parcours ».** Un parcours n'existe qu'une fois un
  dossier ouvert ; son onglet apparaît alors en fin de barre, portant la
  référence du dossier. Le mot « scénario » a disparu de l'interface.
- **Une migration ne peut pas adopter une version de parcours elle-même.** Au
  moment où elle s'applique, le seed n'a pas encore chargé `shared/` : l'UPDATE
  ne trouverait rien, et n'aurait donc aucun effet là où il est attendu. Elle
  pose une demande dans `mti.parametre` (`parcours.adoption_demandee`, au
  format `CODE:version`) et c'est `seed.js` qui l'exécute, puis **l'efface** —
  un geste unique, pas un réglage. La laisser ramènerait le parcours à cette
  version à chaque déploiement, et rendrait éphémère toute publication faite à
  l'écran. C'est l'exception explicite à « le fichier amorce, l'application
  fait autorité ensuite » : datée, limitée à une version, non rejouable. Le
  garde-fou reste entier après coup — un test l'éprouve.
- **Une migration appliquée ne se modifie pas.** `api/src/migrer.js` vérifie
  l'empreinte SHA-256 et refuse un fichier altéré : créer une nouvelle
  migration.
- **Les fonctions PL/pgSQL déclarent `SET search_path = mti, pg_temp`.**
  Sans cela elles échouent pour un client au `search_path` par défaut.
- **`shared/` est la source unique des référentiels.** Ne pas éditer
  `web/src/data/*.json` : ils sont recopiés par
  `npm --prefix web run sync:referentiels` et ignorés par git.
- **Ne pas constituer de référentiel patients.** L'annuaire de référence est
  le SIH (ou Pharma®/CHIMIO®).
- **Le CSS de `web/src/assets/scenario.css` est repris verbatim** de
  `docs/reference/scenario_mti_dialog_v9.html`. Le rendu a été validé par les
  utilisateurs : ne pas le retoucher sans raison explicite. Les retouches
  demandées depuis vivent dans une section appendue en fin de fichier — police,
  coches, contrastes et détails de la barre latérale repris de la v12 ; le
  minuteur garde l'afficheur de `checklist_cart_reception_v2.html`.
- **Les styles des contrôles ne sont plus préfixés `.chk`.** Ce préfixe était le
  conteneur du seul panneau de réception : `PanneauStandard` ne l'a pas, et le
  même composant s'y rendait sans style. C'est le composant qui porte son
  apparence.

## Modèle de données du parcours

Un point de contrôle :

```json
{
  "num": "2.2",
  "libelle": "Température cuve d'azote — seuil < −160 °C",
  "sousLibelle": "Relever la valeur affichée sur le contrôleur",
  "type": "valeur",
  "obligatoire": true,
  "multi": "cuve",
  "seuil": -160
}
```

- `type` : `ouinon` | `valeur` | `photo` | `fichier` | `timer` | `texte` |
  `auto` | `date` | `liste` | `emplacement` (aligné sur l'enum `mti.type_point`)
- `code` : identifiant STABLE du point, unique dans tout le parcours. C'est par
  lui qu'une règle le désigne — jamais par son rang
- `multi` : `false` | `"photo"` | `"cuve"` — duplication par n exemplaires
- `seuil` : déclenche l'alarme de température, figée à l'enregistrement dans
  `saisie.hors_seuil` côté serveur
- `obligatoire` : valeur initiale ; l'opérateur peut la changer par ligne
  (bouton ★), la valeur retenue est celle de la saisie

Une saisie est localisée par
`${idxProcessus}|${idxSection}|${idxPoint}|${exemplaire}|${'s'|'n'}|${role}`,
le marqueur de secours venant **avant** le rôle pour que `cleOp2()` puisse
continuer à basculer le seul suffixe de rôle.
Il n'y a plus de suffixe d'attribut `name` : c'est une donnée, pas une
convention de DOM.

## Contexte réglementaire

Les CAR-T sont des MTI soumis à des exigences strictes : conservation
impérative sous −150 °C (azote liquide), double contrôle pharmacien à
réception, traçabilité nominative patient-lot-opérateur, conformité BPP et
réglementation EMA/ANSM.

## Déploiement

CapRover sur le serveur OncoThériaque — trois apps (`mti-db` en one-click
PostgreSQL, `mti-api`, `mti-web`). Détails et réserves dans
`docs/architecture.md`.

## Conventions

- Code, commentaires, identifiants SQL et messages de commit **en français**.
- Pas d'ORM : le SQL reste lisible et auditable.
- Les commentaires expliquent *pourquoi*, en particulier quand une contrainte
  réglementaire dicte un choix technique.

## Secrets

**Le dépôt est public.** Aucun mot de passe, jeton ou identifiant ne doit y
figurer — et l'historique Git conserve tout ce qui y a été commité, même après
suppression du fichier. Un secret poussé par erreur doit être considéré comme
compromis et **changé**, pas seulement effacé.

Les secrets vivent dans les variables d'environnement de l'hébergeur
(CapRover → App Configs). `.env.example` documente les noms de variables, jamais
leurs valeurs.
