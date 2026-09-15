-- =============================================================================
--  Un point « fichier » sans document n'est pas une coche verte
--
--  `coches_non_vertes` traitait `photo` — une pièce jointe absente rend le
--  point rouge — mais le type `fichier` n'existait pas encore quand elle a été
--  écrite. Sans cette reprise, un point « fichier » obligatoire et SAISI mais
--  sans document aurait compté comme vert : la branche `ELSE false` l'aurait
--  laissé passer.
--
--  Le cas n'est pas théorique : la saisie porteuse est créée par le dépôt lui
--  même, mais aussi par un commentaire ou par le bouton ★ — un point peut donc
--  exister en base sans sa pièce.
-- =============================================================================

SET search_path TO mti, public;

CREATE OR REPLACE FUNCTION mti.coches_non_vertes (
  p_dossier   uuid,
  p_processus uuid DEFAULT NULL
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
             -- Photo ET fichier : dans les deux cas, ce qui manque est la pièce.
             WHEN 'photo'   THEN NOT EXISTS (
                                   SELECT 1 FROM mti.piece_jointe pj
                                    WHERE pj.saisie_id = s.id)
             WHEN 'fichier' THEN NOT EXISTS (
                                   SELECT 1 FROM mti.piece_jointe pj
                                    WHERE pj.saisie_id = s.id)
             ELSE false
           END)
     )

  UNION ALL

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
              AND s.section_index = sec.si - 1
              AND s.point_index   = p.pi - 1
         )
$$;
