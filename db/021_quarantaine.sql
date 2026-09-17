-- =============================================================================
--  Mise en quarantaine d'un traitement
--
--  PÉRIMÈTRE VOULU, et il faut le dire clairement : à ce stade la quarantaine
--  SIGNALE, elle n'INTERDIT rien. Le module affiche un filigrane sur tout
--  l'écran et une mention au tableau de bord ; il ne bloque ni la saisie, ni
--  la validation, ni l'administration.
--
--  C'est un choix explicite, pas un oubli — et c'est ce qu'il faudra reprendre
--  le jour où le circuit réel sera arrêté : ce qui fera la valeur de la
--  fonction, c'est ce qui est INTERDIT pendant, pas le bandeau. Un MTI en
--  quarantaine ne devrait pas pouvoir être administré. La colonne est posée
--  ici pour que ce blocage n'ait plus qu'à s'y accrocher.
--
--  ASYMÉTRIE VOLONTAIRE côté API : mettre en quarantaine est ouvert à tous —
--  quiconque constate un doute doit pouvoir le signaler immédiatement, et
--  faire attendre une autorisation serait exactement le mauvais réflexe. En
--  SORTIR est réservé aux profils avancés : lever une quarantaine, c'est
--  déclarer que le doute est levé.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS quarantaine       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quarantaine_motif text,
  ADD COLUMN IF NOT EXISTS quarantaine_par   uuid REFERENCES utilisateur(id),
  ADD COLUMN IF NOT EXISTS quarantaine_le    timestamptz;

-- Même forme que la clôture : un état qui signale sans dire pourquoi ne sert à
-- rien, et c'est la première question de celui qui le découvre.
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_quarantaine_coherente;
ALTER TABLE dossier ADD CONSTRAINT dossier_quarantaine_coherente CHECK (
  NOT quarantaine OR (
    quarantaine_motif IS NOT NULL AND btrim(quarantaine_motif) <> ''
    AND quarantaine_par IS NOT NULL AND quarantaine_le IS NOT NULL
  )
);

/* L'inverse aussi : un motif de quarantaine sur un dossier qui n'y est pas
   traînerait jusqu'à être affiché sur une ligne sereine. */
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_quarantaine_sans_etat;
ALTER TABLE dossier ADD CONSTRAINT dossier_quarantaine_sans_etat CHECK (
  quarantaine OR (
    quarantaine_motif IS NULL AND quarantaine_par IS NULL AND quarantaine_le IS NULL
  )
);

/* L'historique, sur le modèle de `cloture` : un traitement peut entrer et
   sortir de quarantaine plusieurs fois, et chaque épisode doit rester lisible.
   Les colonnes ci-dessus ne portent que l'épisode EN COURS. */
CREATE TABLE IF NOT EXISTS quarantaine (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,

  motif       text NOT NULL CHECK (btrim(motif) <> ''),
  pose_par    uuid NOT NULL REFERENCES utilisateur(id),
  pose_le     timestamptz NOT NULL DEFAULT now(),

  motif_levee text,
  leve_par    uuid REFERENCES utilisateur(id),
  leve_le     timestamptz,

  CONSTRAINT quarantaine_levee_coherente CHECK (
    (motif_levee IS NULL AND leve_par IS NULL AND leve_le IS NULL)
    OR (btrim(coalesce(motif_levee, '')) <> ''
        AND leve_par IS NOT NULL AND leve_le IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS quarantaine_dossier_idx ON quarantaine (dossier_id, pose_le DESC);

-- Une seule quarantaine en cours par dossier : sans cet index, une levée mal
-- enchaînée laisserait deux épisodes ouverts et on ne saurait plus lequel
-- fermer. Même garde-fou que pour les clôtures.
CREATE UNIQUE INDEX IF NOT EXISTS quarantaine_en_cours_unique
  ON quarantaine (dossier_id) WHERE leve_le IS NULL;

CREATE INDEX IF NOT EXISTS dossier_quarantaine_idx ON dossier (quarantaine)
  WHERE quarantaine;

GRANT SELECT, INSERT, UPDATE ON mti.quarantaine TO mti_app;
-- Pas de DELETE : un épisode de quarantaine ne s'efface pas, il se lève.

DROP TRIGGER IF EXISTS audit_quarantaine ON mti.quarantaine;
CREATE TRIGGER audit_quarantaine
  AFTER INSERT OR UPDATE OR DELETE ON mti.quarantaine
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();

COMMENT ON COLUMN dossier.quarantaine IS
  'Signale un traitement en quarantaine. N''INTERDIT rien à ce stade : le '
  'blocage de l''administration reste à écrire quand le circuit sera arrêté.';
