-- =============================================================================
--  Rôles et privilèges
--
--  Le journal d'audit ne vaut que s'il est inaltérable DEPUIS L'APPLICATION.
--  On révoque donc UPDATE et DELETE sur `audit` pour le rôle applicatif : même
--  une faille dans l'API ne permet pas de réécrire la traçabilité.
--
--  Adapter le mot de passe via psql -v mot_de_passe=... ou le définir hors script.
-- =============================================================================

SET search_path TO mti, public;

-- Rôle utilisé par l'API. À créer une seule fois.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mti_app') THEN
    CREATE ROLE mti_app LOGIN;
    RAISE NOTICE 'Rôle mti_app créé — définir son mot de passe séparément (ALTER ROLE mti_app PASSWORD ...).';
  END IF;
END $$;

GRANT USAGE ON SCHEMA mti TO mti_app;

-- Lecture/écriture courante.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mti TO mti_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mti TO mti_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA mti
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mti_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA mti
  GRANT USAGE, SELECT ON SEQUENCES TO mti_app;

-- ── Le point important : l'audit est en écriture seule ──
-- L'INSERT passe par le trigger `tracer_audit()`, déclaré SECURITY DEFINER :
-- il s'exécute avec les droits du propriétaire, pas ceux de mti_app.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON mti.audit FROM mti_app;
GRANT SELECT ON mti.audit TO mti_app;

-- Idem pour les signatures : on ajoute, on ne réécrit pas.
REVOKE UPDATE, DELETE ON mti.signature FROM mti_app;

-- Les données identifiantes patient sont séparément révocables : si l'instance
-- n'est pas hébergée en HDS, retirer ce GRANT suffit à interdire toute
-- persistance d'identité (l'API basculera sur la résolution SIH à la volée).
-- REVOKE INSERT, UPDATE ON mti.patient_identite FROM mti_app;
