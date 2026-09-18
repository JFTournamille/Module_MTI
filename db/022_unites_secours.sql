-- =============================================================================
--  Unités de secours
--
--  Un processus peut porter, en plus de ses n exemplaires, un nombre d'unités
--  DE SECOURS : elles se contrôlent comme les autres, mais elles sont
--  identifiées comme telles — c'est ce qui les distingue d'un exemplaire de
--  plus, et ce qui permettra de dire, après coup, si le traitement administré
--  venait d'une unité nominale ou d'un secours.
--
--  LE PIÈGE ÉVITÉ ICI, et c'est toute la raison de la colonne `secours`.
--
--  La solution facile aurait été de numéroter les secours À LA SUITE des
--  exemplaires : trois exemplaires, deux secours → exemplaires 1 à 5, les deux
--  derniers « étant » les secours. Mais le compte d'exemplaires se règle à la
--  main et peut changer : passer de 3 à 2 aurait fait du relevé « secours
--  n°1 » un relevé « exemplaire n°3 ». Sur une fiche de traçabilité, une ligne
--  qui change de sens après coup n'est pas un défaut d'affichage, c'est une
--  preuve falsifiée.
--
--  Les secours ont donc leur PROPRE numérotation (1..s) et un marqueur figé en
--  base à la saisie. Un relevé sait pour toujours s'il porte sur une unité de
--  secours, quoi qu'on fasse ensuite aux comptes.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE dossier_processus
  ADD COLUMN IF NOT EXISTS nb_secours integer NOT NULL DEFAULT 0;

ALTER TABLE dossier_processus DROP CONSTRAINT IF EXISTS dp_nb_secours_borne;
ALTER TABLE dossier_processus ADD CONSTRAINT dp_nb_secours_borne
  CHECK (nb_secours BETWEEN 0 AND 20);

ALTER TABLE saisie
  ADD COLUMN IF NOT EXISTS secours boolean NOT NULL DEFAULT false;

/* La clé d'unicité inclut désormais `secours` : sans cela, le secours n°1 et
   l'exemplaire n°1 d'un même point entreraient en collision, et l'un
   écraserait l'autre par le ON CONFLICT de la route de saisie. */
ALTER TABLE saisie
  DROP CONSTRAINT IF EXISTS saisie_dossier_processus_id_section_index_point_index_exemp_key;
ALTER TABLE saisie DROP CONSTRAINT IF EXISTS saisie_localisation_unique;
ALTER TABLE saisie ADD CONSTRAINT saisie_localisation_unique
  UNIQUE (dossier_processus_id, section_index, point_index, exemplaire,
          secours, operateur_role);

COMMENT ON COLUMN saisie.secours IS
  'Le relevé porte sur une unité DE SECOURS. Figé à la saisie et jamais '
  'recalculé : les secours ont leur propre numérotation, pour qu''un changement '
  'du nombre d''exemplaires ne puisse pas reclasser un relevé après coup.';
COMMENT ON COLUMN dossier_processus.nb_secours IS
  'Unités de secours de CE processus, en plus de ses nb_exemplaires.';

-- ── Un secours non renseigné n'est pas une coche rouge ──────────────────────
--
-- Une unité de secours est une réserve : ne pas l'avoir utilisée est le cas
-- NORMAL, et exiger qu'elle soit renseignée rendrait tout dossier rouge dès
-- qu'on prévoit un secours. En revanche, un secours RENSEIGNÉ hors seuil ou
-- répondu « non » reste rouge : s'il a été contrôlé, son résultat compte.
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
           '(point retiré du modèle)')
         || CASE WHEN s.secours THEN ' (unité de secours)' ELSE '' END,
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
       OR (s.obligatoire AND NOT s.secours AND CASE s.point_type
             WHEN 'ouinon' THEN s.reponse IS NULL
             WHEN 'valeur' THEN s.valeur_num IS NULL
             WHEN 'texte'  THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'date'   THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'liste'  THEN coalesce(btrim(s.valeur_texte), '') = ''
             WHEN 'timer'  THEN s.timer_debut IS NULL
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

  -- Points attendus jamais saisis. Les secours n'en font pas partie : une
  -- réserve non utilisée est le cas normal.
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
              AND NOT s.secours
         )
$$;
