-- =============================================================================
--  Statut de prescription du dossier
--
--  Un dossier MTI a besoin de savoir si la prescription a été faite. Il n'a pas
--  besoin, pour autant, de porter la prescription elle-même.
--
--  Ce module ne constitue donc PAS de référentiel de prescriptions, pour la même
--  raison qu'il ne constitue pas de référentiel patients : la source de vérité
--  est le logiciel de prescription (Pharma®/CHIMIO®). Rattacher une prescription
--  identifiée — sa référence, son protocole, son prescripteur — suppose de
--  décider où elle vit et qui en répond ; cette décision est reportée.
--
--  D'ici là, un simple booléen répond au besoin réel : jalonner le parcours.
--  `false` signifie « pas encore réalisée », pas « inconnue » : c'est l'état de
--  départ de tout dossier, et il n'y a pas de tiers état à distinguer.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE dossier
  ADD COLUMN prescription_faite boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN dossier.prescription_faite IS
  'Jalon : la prescription a-t-elle été réalisée. Ne porte AUCUNE donnée de '
  'prescription — la source de vérité est le logiciel de prescription. Le '
  'rattachement d''une prescription identifiée reste à décider.';

-- Le trigger d'audit de `dossier` existe depuis 001 et sérialise la ligne
-- entière : le passage du jalon est donc tracé, avec son auteur, sans rien
-- ajouter ici.
