-- =============================================================================
--  Numérotation automatique des dossiers : MTI-000001, MTI-000002, …
--
--  Jusqu'ici la référence était proposée par le NAVIGATEUR, à partir de
--  l'horodatage (« MTI-2026-0829-1030 »). Deux dossiers créés dans la même
--  minute sur deux postes se seraient vu proposer la même référence, et rien
--  ne garantissait que la série soit continue ni lisible. Or la référence est
--  ce par quoi un dossier se désigne dans les échanges, y compris hors de
--  l'application : elle doit être courte, ordonnée et attribuée une seule fois.
--
--  L'attribution revient donc à la base. Une séquence est le seul mécanisme
--  qui reste juste sous concurrence : `nextval` est atomique et ne rejoue
--  jamais une valeur, même si la transaction qui l'a consommée est annulée.
--
--  Conséquence assumée : la série peut comporter des TROUS (un dossier annulé
--  avant validation, une transaction en échec). C'est le prix de l'unicité
--  sous concurrence, et c'est le bon arbitrage ici : une référence réattribuée
--  ferait pointer deux dossiers d'audit vers le même numéro, ce qu'aucune
--  numérotation de traçabilité ne peut se permettre. Un trou se constate, une
--  collision se subit.
--
--  La référence reste néanmoins IMPOSABLE à l'insertion (le jeu de
--  démonstration écrit « DEMO-MTI-… », les suites de test « MTI-NAV-… ») :
--  c'est un DEFAULT, pas un trigger. Ce qui est fourni est conservé tel quel.
-- =============================================================================

SET search_path TO mti, public;

CREATE SEQUENCE IF NOT EXISTS mti.dossier_reference_seq AS bigint START 1;

/* Le générateur saute les numéros déjà pris : rien n'interdit à un appelant
   d'imposer « MTI-000004 » alors que la séquence n'y est pas encore arrivée.
   Sans cette boucle, l'insertion suivante échouerait sur la contrainte
   d'unicité — un dossier refusé pour une raison que l'utilisateur ne peut ni
   comprendre ni corriger. */
CREATE OR REPLACE FUNCTION mti.reference_dossier_suivante ()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = mti, pg_temp
AS $$
DECLARE
  candidate text;
BEGIN
  LOOP
    candidate := 'MTI-' || lpad(nextval('mti.dossier_reference_seq')::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM mti.dossier WHERE reference = candidate);
  END LOOP;
  RETURN candidate;
END;
$$;

ALTER TABLE mti.dossier
  ALTER COLUMN reference SET DEFAULT mti.reference_dossier_suivante();

/* Reprise d'une base déjà peuplée : la séquence est calée au-dessus du plus
   grand numéro de la série existante. Seules les références EXACTEMENT à la
   forme « MTI-nnnnnn » comptent — « MTI-NAV-… » ou « DEMO-MTI-… » n'en font
   pas partie et ne doivent pas décaler la numérotation. */
DO $$
DECLARE
  dernier bigint;
BEGIN
  SELECT coalesce(max(substring(reference from '^MTI-([0-9]{6,})$')::bigint), 0)
    INTO dernier
    FROM mti.dossier;
  IF dernier > 0 THEN
    PERFORM setval('mti.dossier_reference_seq', dernier, true);
  END IF;
END $$;

GRANT USAGE, SELECT ON SEQUENCE mti.dossier_reference_seq TO mti_app;

COMMENT ON COLUMN mti.dossier.reference IS
  'Référence interne du dossier MTI. Attribuée par la séquence '
  '(MTI-000001, MTI-000002, …) sauf si l''appelant en impose une.';
