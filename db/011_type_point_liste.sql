-- =============================================================================
--  Type de point « liste »
--
--  Certains contrôles n'ont ni une réponse oui/non ni un texte libre, mais un
--  choix parmi des valeurs arrêtées : le motif d'une non-conformité, le
--  diluant employé, la voie d'administration, le service destinataire. Les
--  saisir en texte libre les rend inexploitables — « IV », « i.v. », « voie
--  veineuse » et « intraveineuse » sont quatre écritures d'une même chose, et
--  aucun décompte ne les rapproche.
--
--  La valeur choisie est rangée dans `saisie.valeur_texte`, comme pour « date »
--  et « texte » : le type du point dit déjà comment la lire, et une colonne de
--  plus dans une table de saisies déjà large ne se justifie pas. Les valeurs
--  proposées vivent dans la DÉFINITION du point (`options`), donc dans la
--  version du modèle : une liste qui change plus tard ne réécrit pas ce qui a
--  été choisi, et un dossier reste relisible avec les choix qu'on lui offrait.
--
--  `ALTER TYPE ... ADD VALUE` est permis dans une transaction depuis
--  PostgreSQL 12, à condition que la nouvelle valeur ne soit pas utilisée dans
--  la même transaction. migrer.js encapsulant chaque fichier, cette migration
--  doit rester seule à faire ce changement.
-- =============================================================================

SET search_path TO mti, public;

ALTER TYPE type_point ADD VALUE IF NOT EXISTS 'liste';
