-- =============================================================================
--  Clôture d'un parcours avorté
--
--  Un parcours s'arrête parfois sans aboutir : décès du patient, aphérèse non
--  exploitable, échec de fabrication, décision médicale. Jusqu'ici un tel
--  dossier restait « en cours » indéfiniment et encombrait le tableau de bord
--  en réclamant une suite qui ne viendra pas.
--
--  DÉCISION : un parcours avorté SE CLÔT, il ne se reprend pas. Il n'y a donc
--  ni déclôture ni retour en arrière — c'est un choix explicite, pas un
--  manque. Reprendre un traitement, c'est ouvrir un nouveau dossier ; le
--  dossier clos reste lisible pour dire ce qui s'est passé.
--
--  Le statut `annule` existait déjà dans l'enum `statut_dossier` sans qu'aucun
--  code ne l'emploie. C'est lui qui porte la clôture, plutôt qu'un booléen de
--  plus : un dossier a un état, pas deux qui pourraient se contredire.
--
--  Trois colonnes, et une contrainte qui les rend indissociables du statut.
--  Un dossier clos SANS motif ne servirait à rien : le tableau de bord dirait
--  « clos » sans dire pourquoi, et c'est précisément la question que pose
--  celui qui le relit six mois plus tard.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS motif_cloture text,
  ADD COLUMN IF NOT EXISTS clos_par      uuid REFERENCES utilisateur(id),
  ADD COLUMN IF NOT EXISTS clos_le       timestamptz;

-- Un dossier clos porte obligatoirement un motif non vide, son auteur et sa
-- date. Même forme que `dossier_valide_coherent` : la cohérence d'un état
-- terminal se tient en base, pas dans la bonne volonté de l'appelant.
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_clos_coherent;
ALTER TABLE dossier ADD CONSTRAINT dossier_clos_coherent CHECK (
  statut <> 'annule' OR (
    motif_cloture IS NOT NULL AND btrim(motif_cloture) <> ''
    AND clos_par IS NOT NULL AND clos_le IS NOT NULL
  )
);

-- Et l'inverse : ces trois colonnes ne se renseignent QUE par une clôture.
-- Sans cela un dossier « en cours » pourrait porter un motif de clôture, ce
-- qui ne veut rien dire et se retrouverait tôt ou tard affiché.
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_cloture_sans_statut;
ALTER TABLE dossier ADD CONSTRAINT dossier_cloture_sans_statut CHECK (
  statut = 'annule' OR (
    motif_cloture IS NULL AND clos_par IS NULL AND clos_le IS NULL
  )
);

COMMENT ON COLUMN dossier.motif_cloture IS
  'Pourquoi le parcours a été abandonné. Obligatoire dès que statut = annule.';
COMMENT ON COLUMN dossier.clos_par IS
  'Qui a clos. L''audit le trace aussi, mais la colonne évite une jointure sur le journal pour l''afficher.';
