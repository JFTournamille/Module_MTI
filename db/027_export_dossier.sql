-- =============================================================================
--  Trace des exports de dossier
--
--  Un export de dossier est NOMINATIF dès qu'un patient est rattaché : il sort
--  de l'application une identité, un lot, des dates et le nom des opérateurs.
--  Sa production doit donc être tracée, pas seulement permise — savoir qui a
--  édité quoi et quand fait partie de ce qu'un contrôle peut demander.
--
--  POURQUOI UNE TABLE ET PAS UNE ÉCRITURE DIRECTE DANS `mti.audit`. L'audit est
--  alimenté par des triggers, et `mti_app` n'y a ni UPDATE ni DELETE — c'est
--  volontaire. Y écrire à la main depuis l'application ouvrirait une porte que
--  cette conception a fermée exprès. Un fait métier se pose dans une table
--  métier, et le trigger d'audit le trace comme le reste.
--
--  L'EMPREINTE du document est conservée. Deux éditions du même dossier à deux
--  instants ne donnent pas le même fichier — ne serait-ce que par l'horodatage
--  d'édition — et pouvoir dire « le PDF qu'on me présente est bien celui qui a
--  été produit ce jour-là » vaut mieux que de le supposer.
-- =============================================================================

SET search_path TO mti, public;

CREATE TABLE IF NOT EXISTS export_dossier (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id  uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  format      text NOT NULL,
  -- L'état du dossier AU MOMENT de l'édition : un dossier validé plus tard ne
  -- doit pas faire croire que le document sorti avant l'était déjà.
  statut      statut_dossier NOT NULL,
  conformite  conformite,
  nominatif   boolean NOT NULL,
  taille      integer NOT NULL,
  sha256      text NOT NULL,
  genere_par  uuid NOT NULL REFERENCES utilisateur(id),
  genere_le   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT export_format_connu CHECK (format IN ('pdf', 'xls'))
);

CREATE INDEX IF NOT EXISTS export_dossier_idx ON export_dossier (dossier_id, genere_le DESC);

COMMENT ON TABLE export_dossier IS
  'Éditions du dossier de traçabilité. Un export nominatif est un document qui '
  'sort de l''application : sa production est tracée, pas seulement permise.';
COMMENT ON COLUMN export_dossier.sha256 IS
  'Empreinte du fichier produit, pour pouvoir rapprocher un document présenté '
  'après coup de l''édition qui l''a réellement produit.';

/* Un export ne se modifie ni ne s'efface : c'est un fait daté. Comme pour
   l'audit, l'absence d'UPDATE et de DELETE dans ces droits est délibérée. */
GRANT SELECT, INSERT ON mti.export_dossier TO mti_app;

CREATE TRIGGER export_dossier_audit
  AFTER INSERT ON export_dossier
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();

-- ── L'établissement, en en-tête des documents ───────────────────────────────
--
-- Un document réglementaire porte le nom de l'établissement qui l'édite. Il
-- vit dans les paramètres et non dans le code : le même module sert plusieurs
-- établissements, et un nom en dur obligerait à redéployer pour chacun.
INSERT INTO parametre (cle, valeur, libelle) VALUES
  ('etablissement.nom', 'Établissement — à renseigner',
   'Nom porté en en-tête des documents exportés')
ON CONFLICT (cle) DO NOTHING;
