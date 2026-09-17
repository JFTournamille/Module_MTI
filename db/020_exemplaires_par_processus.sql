-- =============================================================================
--  Le nombre d'exemplaires appartient au PROCESSUS, pas au dossier
--
--  `dossier.nb_exemplaires` valait pour le dossier entier : un seul compte
--  pour les onze processus. Or ce qui se compte n'est pas le même d'un
--  processus à l'autre — deux cuves d'azote à la réception, une seule poche à
--  la préparation, trois contrôles à l'administration. Un compte unique
--  obligeait à prendre le maximum et à cocher « sans objet » ailleurs, ce qui
--  est exactement ce qu'une fiche de traçabilité ne doit pas contenir.
--
--  Le compte est donc porté par `dossier_processus`, et renseigné à la main
--  sur le processus en cours. La colonne du dossier reste : elle sert de
--  valeur initiale à l'instanciation, et les dossiers déjà ouverts la portent.
--
--  Plafond à 20 : au-delà, ce n'est plus une duplication de point de contrôle
--  mais une liste, et la fiche devient illisible. Le plafond du dossier était
--  à 10 ; celui-ci monte à 20 pour la cuve d'azote de l'exemple (10 cassettes
--  par étage).
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE dossier_processus
  ADD COLUMN IF NOT EXISTS nb_exemplaires integer NOT NULL DEFAULT 1;

ALTER TABLE dossier_processus DROP CONSTRAINT IF EXISTS dp_nb_exemplaires_borne;
ALTER TABLE dossier_processus ADD CONSTRAINT dp_nb_exemplaires_borne
  CHECK (nb_exemplaires BETWEEN 1 AND 20);

/* Reprise : les dossiers déjà ouverts gardent le compte qu'ils affichaient,
   sinon les saisies déjà posées sur l'exemplaire 2 deviendraient invisibles. */
UPDATE dossier_processus dp
   SET nb_exemplaires = least(20, greatest(1, d.nb_exemplaires))
  FROM dossier d
 WHERE d.id = dp.dossier_id
   AND dp.nb_exemplaires = 1
   AND d.nb_exemplaires <> 1;

COMMENT ON COLUMN dossier_processus.nb_exemplaires IS
  'Nombre d''exemplaires des points marqués `multi` DE CE PROCESSUS. Le compte '
  'du dossier ne sert plus que de valeur initiale.';
