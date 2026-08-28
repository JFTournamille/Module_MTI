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
  jusqu'à la mise en fabrication, sauf préallocation explicite.
- **Toute écriture passe par `api/src/db.js:transaction()`.** C'est ce qui
  renseigne l'auteur pour le trigger d'audit. Une écriture hors de cette
  fonction produit une trace sans auteur.
- **`mti.audit` ne se modifie pas.** Le rôle `mti_app` n'a pas les droits
  `UPDATE`/`DELETE` dessus, et c'est volontaire.
- **Un dossier validé est en lecture seule.** Toute correction passe par une
  nouvelle version, jamais par un `UPDATE`.
- **Un modèle de parcours ne se modifie pas : on en publie une version.**
  L'onglet Configuration crée `version + 1` et la met en service ; les dossiers
  ouverts conservent la définition figée à leur création. Il n'y a pas de route
  de modification, et c'est volontaire.
- **Le rang d'un processus n'est pas un identifiant.** Retirer l'aphérèse en v3
  a décalé douze processus. Désigner un processus se fait par son `code`.
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
  utilisateurs : ne pas le retoucher sans raison explicite.

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

- `type` : `ouinon` | `valeur` | `photo` | `timer` | `texte` | `auto` | `date`
  (aligné sur l'enum `mti.type_point`)
- `multi` : `false` | `"photo"` | `"cuve"` — duplication par n exemplaires
- `seuil` : déclenche l'alarme de température, figée à l'enregistrement dans
  `saisie.hors_seuil` côté serveur
- `obligatoire` : valeur initiale ; l'opérateur peut la changer par ligne
  (bouton ★), la valeur retenue est celle de la saisie

Une saisie est localisée par
`${idxProcessus}|${idxSection}|${idxPoint}|${exemplaire}|${role}`.
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
