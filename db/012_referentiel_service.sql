-- =============================================================================
--  Référentiel des services (unités fonctionnelles)
--
--  Un dossier MTI circule entre des services : l'hématologie qui prescrit, la
--  PUI qui réceptionne et prépare, le service qui administre. Ces services
--  étaient jusqu'ici du texte libre, quand ils étaient notés — donc
--  inexploitables : « hémato 4B », « Hématologie 4B » et « HEMATO4B »
--  désignent la même unité sans qu'aucun regroupement ne les rapproche.
--
--  L'UF est LA clé : c'est l'identifiant que porte le SIH, celui qui figure
--  sur les bons et dans les échanges avec la facturation. Le libellé, lui,
--  change (fusion de services, renommage) et n'identifie rien.
--
--  Table volontairement pauvre — UF, libellé, un pôle facultatif. Y ajouter
--  responsable, téléphone, étage, c'est recopier l'annuaire de
--  l'établissement, qui vit ailleurs et sera toujours plus à jour. Même
--  raisonnement que pour les patients : on référence, on ne duplique pas.
-- =============================================================================

SET search_path TO mti, public;

CREATE TABLE IF NOT EXISTS service (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uf        text NOT NULL,               -- unité fonctionnelle, telle que dans le SIH
  libelle   text NOT NULL,
  pole      text,                        -- pôle de rattachement, facultatif
  actif     boolean NOT NULL DEFAULT true,
  cree_le   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uf)
);

CREATE INDEX IF NOT EXISTS service_libelle_idx ON service (libelle);

COMMENT ON TABLE service IS
  'Unités fonctionnelles de l''établissement. L''UF identifie, le libellé décrit.';
COMMENT ON COLUMN service.uf IS
  'Unité fonctionnelle telle que la porte le SIH. C''est la clé de rapprochement.';

/* Le référentiel suit les mêmes droits que le reste : lecture et écriture par
   l'application, l'audit restant hors de sa portée. Le GRANT est explicite
   plutôt que laissé aux privilèges par défaut, qui ne s'appliquent qu'aux
   tables créées par le rôle qui les a posés. */
GRANT SELECT, INSERT, UPDATE, DELETE ON mti.service TO mti_app;

/* Le référentiel est tracé comme les autres tables de configuration : qui a
   ouvert, renommé ou retiré une UF doit se relire. `modele_parcours` et
   `utilisateur` sont déjà sous audit pour la même raison. */
DROP TRIGGER IF EXISTS audit_service ON mti.service;
CREATE TRIGGER audit_service
  AFTER INSERT OR UPDATE OR DELETE ON mti.service
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();
