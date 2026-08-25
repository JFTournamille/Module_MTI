-- =============================================================================
--  Lecture du suivi des migrations par le rôle applicatif
--
--  `public.migration` est créée par api/src/migrer.js avec le compte
--  superutilisateur. Le rôle applicatif ne peut donc pas la lire, et
--  l'endpoint /api/sante ne peut pas rapporter combien de migrations sont
--  appliquées — information utile en exploitation, d'autant plus quand
--  l'interface d'hébergement n'expose pas de logs.
--
--  Lecture seule : l'application n'a aucune raison d'écrire dans ce suivi.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mti_app') THEN
    RAISE NOTICE 'Rôle mti_app absent — 002_roles.sql doit être appliqué d''abord.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'migration') THEN
    GRANT USAGE ON SCHEMA public TO mti_app;
    GRANT SELECT ON public.migration TO mti_app;
    REVOKE INSERT, UPDATE, DELETE ON public.migration FROM mti_app;
  ELSE
    RAISE NOTICE 'Table public.migration absente — rien à faire.';
  END IF;
END $$;
