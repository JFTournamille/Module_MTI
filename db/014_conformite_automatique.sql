-- =============================================================================
--  Conformité automatique — quand toutes les coches sont vertes
--
--  DÉCISION : si tous les contrôles d'un processus sont verts, la conformité
--  est conclue automatiquement, sans que l'opérateur ait à la cocher.
--
--  Deux garde-fous portent toute la valeur de cette automatisation.
--
--  1. C'EST LE SERVEUR QUI CONSTATE, jamais le navigateur. Une conformité
--     conclue est une signature : la faire calculer côté client, c'est
--     permettre qu'une page périmée, un bogue d'affichage ou une requête
--     forgée signent « conforme » sur un relevé hors seuil. D'où la fonction
--     ci-dessous, et le fait que la route de validation ne reçoive plus une
--     conformité à enregistrer mais une DEMANDE de constat.
--
--  2. LA MACHINE PEUT CONFIRMER LE VERT, JAMAIS PRONONCER UNE
--     NON-CONFORMITÉ. Le vert est un constat mécanique — tout est renseigné,
--     rien hors seuil, aucun « non ». Une non-conformité est un jugement
--     pharmaceutique sur ce qu'il faut en faire : elle reste à l'opérateur.
--     Cette asymétrie est volontaire ; ne pas la « compléter ».
--
--  Et une conformité automatique se DIT : `conformite_automatique` la
--  distingue dans le journal d'audit, pour qu'une inspection ne confonde pas
--  un constat mécanique avec une conclusion signée à la main.
-- =============================================================================

SET search_path TO mti, public;

-- ── Ce qui distingue un constat d'une conclusion ────────────────────────────
ALTER TABLE dossier
  ADD COLUMN IF NOT EXISTS conformite_automatique boolean NOT NULL DEFAULT false;

/* La conformité par processus, que le pied de page évalue désormais : « ce qui
   est conforme » doit désigner le processus en cours de validation, pas un
   dossier dont l'opérateur ne voit qu'un onzième à l'écran. */
ALTER TABLE dossier_processus
  ADD COLUMN IF NOT EXISTS conformite            conformite,
  ADD COLUMN IF NOT EXISTS conformite_automatique boolean NOT NULL DEFAULT false;

-- Une conformité « automatique » sans conformité ne veut rien dire.
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_auto_exige_conformite;
ALTER TABLE dossier ADD CONSTRAINT dossier_auto_exige_conformite CHECK (
  NOT conformite_automatique OR conformite IS NOT NULL
);
ALTER TABLE dossier_processus DROP CONSTRAINT IF EXISTS dp_auto_exige_conformite;
ALTER TABLE dossier_processus ADD CONSTRAINT dp_auto_exige_conformite CHECK (
  NOT conformite_automatique OR conformite IS NOT NULL
);

/* Et le garde-fou de l'asymétrie, en base : une NON-conformité ne peut pas
   être automatique. Si un jour du code tentait de la poser, il échouerait ici
   plutôt que de produire une non-conformité que personne n'a prononcée. */
ALTER TABLE dossier DROP CONSTRAINT IF EXISTS dossier_auto_jamais_non_conforme;
ALTER TABLE dossier ADD CONSTRAINT dossier_auto_jamais_non_conforme CHECK (
  NOT conformite_automatique OR conformite = 'conforme'
);
ALTER TABLE dossier_processus DROP CONSTRAINT IF EXISTS dp_auto_jamais_non_conforme;
ALTER TABLE dossier_processus ADD CONSTRAINT dp_auto_jamais_non_conforme CHECK (
  NOT conformite_automatique OR conformite = 'conforme'
);

-- ── Ce qui n'est pas vert ───────────────────────────────────────────────────
--
-- Renvoie les raisons, pas un booléen : le même appel sert à refuser une
-- conformité automatique ET à dire à l'écran ce qui reste rouge. Un booléen
-- aurait obligé à recalculer ailleurs, donc à diverger.
--
-- Trois façons pour une coche de ne pas être verte :
--   — un relevé hors seuil (l'alarme, figée à la saisie) ;
--   — une réponse « non » à un point oui/non ;
--   — un point obligatoire non renseigné.
--
-- `photo` est inclus, contrairement au contrôle de complétude historique de la
-- route de validation, qui l'ignorait : une pièce jointe manquante n'est pas
-- une coche verte. La conformité automatique est donc plus exigeante que la
-- validation manuelle, et c'est cohérent — on peut valider en déclarant une
-- non-conformité, on ne peut pas la faire constater comme conforme.
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
     /* Un processus annulé par une clôture n'a plus rien à dire : le retenir
        rendrait tout dossier clos éternellement rouge. */
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
   ORDER BY dp.ordre, s.section_index, s.point_index, s.exemplaire
$$;

GRANT EXECUTE ON FUNCTION mti.coches_non_vertes (uuid, uuid) TO mti_app;

COMMENT ON FUNCTION mti.coches_non_vertes (uuid, uuid) IS
  'Ce qui empêche de conclure la conformité automatiquement. Passer p_processus '
  'pour n''évaluer qu''un processus — c''est ce que fait le pied de page.';

COMMENT ON COLUMN dossier.conformite_automatique IS
  'La conformité a été CONSTATÉE par le serveur (toutes les coches vertes), '
  'pas conclue à la main. Distinction volontairement lisible dans l''audit.';
