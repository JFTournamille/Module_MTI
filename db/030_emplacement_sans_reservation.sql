-- =============================================================================
--  L'emplacement se CONSTATE, il ne se réserve plus
--
--  Demandé le 18 septembre : supprimer la disponibilité et les délais de
--  réservation. Un point « emplacement » redevient ce qu'il est vraiment sur
--  une fiche de traçabilité — le constat d'où le MTI a été posé — et cesse
--  d'être un système de réservation.
--
--  CE QUI DISPARAÎT, et pourquoi c'est cohérent :
--
--   · `occupation_emplacement` en entier. Elle n'existait que pour porter la
--     réservation : qui tient quoi, depuis quand, jusqu'à quand. Sans
--     réservation, elle n'a plus aucun écrivain. Et surtout elle faisait
--     DOUBLON avec la saisie : c'est le relevé qui dit où le MTI a été posé,
--     par qui et à quelle heure, et lui seul est figé par la validation du
--     dossier. Deux sources pour une même information, dont une seule fait foi.
--   · l'index `emplacement_occupe_unique`, qui arbitrait les collisions.
--   · `liberer_occupations_expirees()`, et le paramètre du délai.
--
--  CE QUE CELA COÛTE, et il faut le dire : plus rien n'empêche deux dossiers
--  de désigner la même cassette. La base ne l'arbitre plus, parce qu'on lui a
--  retiré la notion de place occupée. C'est un choix de périmètre assumé — le
--  module constate ce que l'opérateur a fait, il ne pilote pas l'occupation de
--  la cuve. Si cette collision devient un vrai problème à l'usage, ce qu'il
--  faudra rétablir est l'index d'unicité, pas la réservation à durée limitée.
--
--  CE QUI RESTE : le référentiel des contenants et de leurs places, la
--  possibilité d'en sortir une du service avec un motif, et le point de
--  contrôle qui désigne une place par son libellé lisible (CUVE-1-A-03).
-- =============================================================================

SET search_path TO mti, public;

DROP TRIGGER IF EXISTS occupation_emplacement_audit ON occupation_emplacement;
DROP TABLE IF EXISTS occupation_emplacement;

DROP FUNCTION IF EXISTS mti.liberer_occupations_expirees ();

DELETE FROM parametre WHERE cle = 'emplacement.expiration_heures';

-- ── L'état d'une place n'est plus qu'une description ────────────────────────
--
-- La fonction rendait l'occupation en cours. Elle ne rend plus que ce que la
-- place EST : où elle se trouve, comment elle se nomme, et si elle est en
-- service. Ce qui l'utilise réellement est le menu de saisie et l'écran de
-- codification, qui n'ont jamais eu besoin d'autre chose.
DROP FUNCTION IF EXISTS mti.emplacements_etat (uuid);

CREATE OR REPLACE FUNCTION mti.emplacements_etat (p_contenant uuid DEFAULT NULL)
RETURNS TABLE (
  emplacement_id uuid,
  contenant_id   uuid,
  contenant      text,
  etage          text,
  numero         integer,
  libelle        text,
  actif          boolean,
  hors_service_motif text
)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  SELECT e.id, c.id, c.libelle, e.etage, e.numero,
         format('%s-%s-%s', c.code, e.etage, lpad(e.numero::text, 2, '0')),
         e.actif, e.hors_service_motif
    FROM mti.emplacement e
    JOIN mti.contenant c ON c.id = e.contenant_id
   WHERE (p_contenant IS NULL OR e.contenant_id = p_contenant)
   ORDER BY c.code, e.etage, e.numero
$$;

COMMENT ON FUNCTION mti.emplacements_etat (uuid) IS
  'Places d''un contenant : où elles sont, comment elles se nomment, et si '
  'elles sont en service. Plus aucune notion d''occupation.';

GRANT EXECUTE ON FUNCTION mti.emplacements_etat (uuid) TO mti_app;
