-- =============================================================================
--  Profil des utilisateurs
--
--  Ajoute un axe « profil » à `mti.utilisateur`, distinct de `fonction` :
--
--   · `fonction` est un intitulé libre, descriptif (« pharmacien assistant »,
--     « préparateur référent MTI »). Il sert à l'affichage.
--   · `profil` est une valeur contrainte, destinée à porter des DROITS.
--
--  À ce stade, `profil` ne conditionne RIEN dans l'application : il est
--  renseignable et tracé, rien de plus. Le rendre agissant suppose d'abord
--  une authentification réelle — en AUTH_MODE=dev l'opérateur est fixe, un
--  contrôle de droits n'y aurait aucune valeur. Voir « L'authentification est
--  un prérequis » dans docs/architecture.md.
--
--  NULL est autorisé, et signifie « profil non attribué » : deviner le profil
--  des comptes existants serait pire que de laisser le champ vide.
-- =============================================================================

SET search_path TO mti, public;

CREATE TYPE profil_utilisateur AS ENUM (
  'pharmacien',      -- validation pharmaceutique, libération, signature
  'preparateur',     -- exécution des points de contrôle
  'ide',             -- administration au patient
  'qualite',         -- assurance qualité, déviations
  'administrateur'   -- gestion des comptes et des référentiels
);

ALTER TABLE utilisateur ADD COLUMN profil profil_utilisateur;

COMMENT ON COLUMN utilisateur.profil IS
  'Profil de droits. NULL = non attribué. Ne conditionne aucun accès tant que '
  'l''authentification réelle (AUTH_MODE=oidc) n''est pas branchée.';

-- Le trigger d'audit de `utilisateur` existe depuis 001 et couvre la nouvelle
-- colonne : `tracer_audit()` sérialise la ligne entière en jsonb, il n'y a donc
-- rien à ajouter pour que les changements de profil soient tracés.
