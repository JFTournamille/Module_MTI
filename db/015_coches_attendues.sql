-- =============================================================================
--  Une coche jamais posée n'est pas une coche verte
--
--  DÉFAUT CORRIGÉ ICI, et il était grave : `coches_non_vertes` ne regardait que
--  les lignes de `saisie` existantes. Un dossier où personne n'a rien saisi n'a
--  aucune ligne, donc rien de rouge, donc « tout vert » — et la conformité
--  automatique se serait posée sur un parcours que personne n'a parcouru.
--
--  C'est exactement le contresens que l'automatisme ne doit pas produire :
--  « toutes les coches sont vertes » ne peut pas signifier « il n'y a pas de
--  coche ».
--
--  La fonction compare donc désormais aux POINTS OBLIGATOIRES DE LA DÉFINITION
--  FIGÉE du processus, pas aux saisies. Un point obligatoire sans aucune saisie
--  est rouge, au même titre qu'un point saisi à vide.
--
--  Limite assumée : la comparaison se fait au point, pas à l'exemplaire — un
--  point en n exemplaires dont seul le premier est renseigné passe ici. Les
--  exemplaires manquants restent couverts par le contrôle de complétude de
--  l'écran (`pointsIncomplets`), qui connaît `nb_exemplaires`. Ce qui est
--  fermé ici, c'est le trou béant : le dossier vide.
--
--  Les processus `externe` (réalisés par un tiers) sont exclus des points
--  attendus : leurs contrôles sont faits ailleurs et suivis ici, exiger leur
--  saisie rendrait tout dossier éternellement rouge.
-- =============================================================================

SET search_path TO mti, public;

CREATE OR REPLACE FUNCTION mti.coches_non_vertes (
  p_dossier   uuid,
  p_processus uuid DEFAULT NULL          -- NULL = tout le dossier
)
RETURNS TABLE (
  processus_id uuid,
  processus    text,
  point_num    text,
  libelle      text,
  exemplaire   integer,
  role         role_operateur,
  raison       text
)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  -- Ce qui est saisi mais pas vert.
  SELECT dp.id, dp.nom, s.point_num,
         coalesce(
           dp.definition -> 'sections' -> s.section_index
                          -> 'points'  -> s.point_index ->> 'libelle',
           '(point retiré du modèle)'),
         s.exemplaire, s.operateur_role,
         CASE
           WHEN s.hors_seuil       THEN 'relevé hors seuil'
           WHEN s.reponse = 'non'  THEN 'réponse « non »'
           ELSE 'point obligatoire non renseigné'
         END
    FROM mti.saisie s
    JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
   WHERE dp.dossier_id = p_dossier
     AND (p_processus IS NULL OR dp.id = p_processus)
     AND dp.etat <> 'annule'
     AND (
          s.hors_seuil
       OR s.reponse = 'non'
       OR (s.obligatoire AND CASE s.point_type
             WHEN 'ouinon' THEN s.reponse IS NULL
             WHEN 'valeur' THEN s.valeur_num IS NULL
             WHEN 'texte'  THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'date'   THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'liste'  THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'timer'  THEN s.timer_debut IS NULL
             WHEN 'photo'  THEN NOT EXISTS (
                                  SELECT 1 FROM mti.piece_jointe pj
                                   WHERE pj.saisie_id = s.id)
             ELSE false
           END)
     )

  UNION ALL

  -- Ce qui est attendu et jamais saisi : le trou que cette migration ferme.
  SELECT dp.id, dp.nom, pt ->> 'num', pt ->> 'libelle', 1, 'op1'::role_operateur,
         'point obligatoire jamais saisi'
    FROM mti.dossier_processus dp
    CROSS JOIN LATERAL jsonb_array_elements(
           coalesce(dp.definition -> 'sections', '[]'::jsonb))
         WITH ORDINALITY AS sec(section, si)
    CROSS JOIN LATERAL jsonb_array_elements(
           coalesce(sec.section -> 'points', '[]'::jsonb))
         WITH ORDINALITY AS p(pt, pi)
   WHERE dp.dossier_id = p_dossier
     AND (p_processus IS NULL OR dp.id = p_processus)
     AND dp.etat <> 'annule'
     AND NOT dp.externe
     AND (pt ->> 'obligatoire')::boolean IS TRUE
     AND NOT EXISTS (
           SELECT 1 FROM mti.saisie s
            WHERE s.dossier_processus_id = dp.id
              AND s.section_index = sec.si - 1     -- ORDINALITY compte de 1
              AND s.point_index   = p.pi - 1
         )
$$;

COMMENT ON FUNCTION mti.coches_non_vertes (uuid, uuid) IS
  'Ce qui empêche de conclure la conformité automatiquement : coches saisies '
  'non vertes ET points obligatoires jamais saisis. Un dossier vierge est donc '
  'rouge, pas vert — c''était le défaut de la version précédente.';
