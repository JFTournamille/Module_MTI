-- =============================================================================
--  Déclôturer un parcours — et n'effacer aucune clôture au passage
--
--  REVIREMENT ASSUMÉ. La migration 013 disait « un parcours avorté se clôt, il
--  ne se déclôt pas », et la décision est revenue : un profil avancé doit
--  pouvoir rouvrir un parcours clos. Le commentaire de 013 n'est pas réécrit —
--  une migration appliquée ne se modifie pas — il est corrigé ici.
--
--  Ce qui ne change pas, en revanche, c'est la raison qui avait fait écarter la
--  déclôture : **rendre un dossier modifiable ne doit pas effacer ce que
--  quelqu'un a constaté**. Une clôture porte un motif, un auteur et une date.
--  Les colonnes de `dossier` ne peuvent pas les garder — la contrainte
--  `dossier_cloture_sans_statut` les vide dès que le statut repart — d'où
--  cette table d'historique.
--
--  Un dossier peut donc être clos, rouvert, reclos : chaque épisode laisse sa
--  ligne. Ce que le module perdrait sans elle, c'est précisément ce qu'une
--  inspection viendrait chercher : combien de fois, par qui, et pourquoi.
-- =============================================================================

SET search_path TO mti, public;

CREATE TABLE IF NOT EXISTS cloture (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id      uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,

  motif           text NOT NULL CHECK (btrim(motif) <> ''),
  clos_par        uuid NOT NULL REFERENCES utilisateur(id),
  clos_le         timestamptz NOT NULL DEFAULT now(),

  -- Renseignés à la réouverture. NULL = clôture encore en vigueur.
  motif_reouverture text,
  reouvert_par      uuid REFERENCES utilisateur(id),
  reouvert_le       timestamptz,

  -- Une réouverture est un acte : elle a un auteur, une date et un motif, ou
  -- elle n'a pas eu lieu. Les trois vont ensemble.
  CONSTRAINT cloture_reouverture_coherente CHECK (
    (motif_reouverture IS NULL AND reouvert_par IS NULL AND reouvert_le IS NULL)
    OR (btrim(coalesce(motif_reouverture, '')) <> ''
        AND reouvert_par IS NOT NULL AND reouvert_le IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS cloture_dossier_idx ON cloture (dossier_id, clos_le DESC);

/* Une seule clôture en vigueur par dossier : sans cet index, une réouverture
   mal enchaînée laisserait deux épisodes ouverts et on ne saurait plus lequel
   fermer. */
CREATE UNIQUE INDEX IF NOT EXISTS cloture_en_vigueur_unique
  ON cloture (dossier_id) WHERE reouvert_le IS NULL;

-- Reprise de l'existant : les dossiers déjà clos par la 013 ont leur épisode.
INSERT INTO cloture (dossier_id, motif, clos_par, clos_le)
SELECT d.id, d.motif_cloture, d.clos_par, d.clos_le
  FROM dossier d
 WHERE d.statut = 'annule'
   AND d.motif_cloture IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM cloture c
                    WHERE c.dossier_id = d.id AND c.reouvert_le IS NULL);

GRANT SELECT, INSERT, UPDATE ON mti.cloture TO mti_app;

/* Pas de DELETE, volontairement : un épisode de clôture ne s'efface pas. Une
   réouverture le CLÔT dans l'historique, elle ne le supprime pas. */

DROP TRIGGER IF EXISTS audit_cloture ON mti.cloture;
CREATE TRIGGER audit_cloture
  AFTER INSERT OR UPDATE OR DELETE ON mti.cloture
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();

COMMENT ON TABLE cloture IS
  'Historique des clôtures et réouvertures d''un parcours. Les colonnes de '
  '`dossier` ne portent que la clôture EN VIGUEUR : elles sont vidées à la '
  'réouverture, cette table garde la trace.';
