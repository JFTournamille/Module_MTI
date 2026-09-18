-- =============================================================================
--  Emplacements de stockage, et leur réservation
--
--  Une cuve d'azote, des étages A à J, des emplacements 1 à 20 : deux cents
--  places. Un point de contrôle de type « emplacement » propose les places
--  libres et RÉSERVE celle qu'on choisit.
--
--  CE QUI DÉCIDE DE LA QUALITÉ DU MODULE ICI, et c'est une seule ligne : la
--  contrainte d'unicité est EN BASE, pas dans le navigateur. La liste des
--  places libres affichée à l'écran n'est qu'un instantané ; entre le moment
--  où elle s'affiche et celui où l'opérateur choisit, une autre réception peut
--  avoir pris la même cassette. C'est l'index partiel ci-dessous qui arbitre,
--  et lui seul. Une vérification côté client aurait donné deux réceptions
--  convaincues d'occuper la même place — et un MTI posé sur un autre.
--
--  LA RÉSERVATION PREND EFFET DÈS LA SAISIE — décision du 18 septembre. C'est
--  au moment du geste physique que deux réceptions simultanées risquent de se
--  croiser ; attendre la validation du processus laisserait la fenêtre de
--  collision ouverte pendant toute sa durée, et le second opérateur ne
--  l'apprendrait qu'à la validation, une fois la cuve déjà remplie.
--
--  AVEC EXPIRATION, pour qu'un dossier abandonné ne gèle pas une place dans
--  une cuve qui n'en a que deux cents. L'expiration est un ÉVÉNEMENT, pas une
--  condition implicite : une réservation expirée est réellement libérée, avec
--  sa date et son motif. Deux raisons. D'abord `now()` ne peut pas figurer
--  dans le prédicat d'un index — l'unicité doit donc porter sur un fait
--  enregistré. Ensuite une place « libre parce que le temps a passé » mais
--  toujours marquée occupée en base serait invérifiable après coup : on ne
--  saurait pas dire qui l'occupait à une date donnée.
-- =============================================================================

SET search_path TO mti, public;

-- ── Paramètres de l'application ─────────────────────────────────────────────
--
-- Le délai d'expiration N'EST PAS EN DUR. Une place reprise sous les pieds
-- d'un opérateur est plus grave qu'une place gelée une journée, et on ne
-- saura qu'à l'usage laquelle des deux gêne le plus. Amorcé haut, à 24 h.
CREATE TABLE IF NOT EXISTS parametre (
  cle         text PRIMARY KEY,
  valeur      text NOT NULL,
  libelle     text NOT NULL,
  modifie_le  timestamptz NOT NULL DEFAULT now(),
  modifie_par uuid REFERENCES utilisateur(id)
);

COMMENT ON TABLE parametre IS
  'Réglages de l''application qui doivent pouvoir changer sans redéploiement.';

INSERT INTO parametre (cle, valeur, libelle) VALUES
  ('emplacement.expiration_heures', '24',
   'Durée au-delà de laquelle une réservation d''emplacement non confirmée est libérée')
ON CONFLICT (cle) DO NOTHING;

-- ── Contenants et emplacements ──────────────────────────────────────────────
--
-- Le contenant déclare sa GÉOMÉTRIE (des étages nommés, n emplacements par
-- étage) et ses places sont ensuite matérialisées une à une. Les énumérer
-- plutôt que les calculer coûte deux cents lignes par cuve — rien — et permet
-- ce que le calcul ne permettrait pas : mettre UNE place hors service parce
-- que son rack est tordu, sans toucher aux 199 autres.
CREATE TABLE IF NOT EXISTS contenant (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code     text NOT NULL UNIQUE,
  libelle  text NOT NULL,
  genre    text NOT NULL DEFAULT 'cuve',
  actif    boolean NOT NULL DEFAULT true,
  cree_le  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contenant_code_non_vide CHECK (btrim(code) <> ''),
  CONSTRAINT contenant_genre_connu CHECK (genre IN ('cuve', 'congelateur', 'enceinte'))
);

CREATE TABLE IF NOT EXISTS emplacement (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contenant_id uuid NOT NULL REFERENCES contenant(id) ON DELETE CASCADE,
  etage        text NOT NULL,
  /* `numero` et non `position` : `position` est une fonction SQL du standard
     (`position(x in y)`). Le nom passe dans une définition de table, mais il
     casse la déclaration `RETURNS TABLE` d'une fonction. */
  numero       integer NOT NULL CHECK (numero >= 1),
  actif        boolean NOT NULL DEFAULT true,
  hors_service_motif text,
  UNIQUE (contenant_id, etage, numero),
  /* Une place hors service dit POURQUOI. « Indisponible » sans raison
     obligerait à aller demander, et personne ne la remettrait en service faute
     de savoir ce qui l'en avait sortie. */
  CONSTRAINT emplacement_hors_service_motive CHECK (
    actif OR coalesce(btrim(hors_service_motif), '') <> ''
  )
);

CREATE INDEX IF NOT EXISTS emplacement_contenant_idx ON emplacement (contenant_id);

COMMENT ON COLUMN emplacement.etage IS
  'Étiquette de l''étage telle qu''elle est lue sur la cuve — « A », « B »… '
  'Du texte et non un rang : un étage peut s''appeler « haut » ou « 1 bis ».';

-- ── Occupation ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS occupation_emplacement (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  emplacement_id uuid NOT NULL REFERENCES emplacement(id),
  dossier_id     uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  processus_id   uuid REFERENCES dossier_processus(id) ON DELETE SET NULL,
  exemplaire     integer NOT NULL DEFAULT 1 CHECK (exemplaire >= 1),
  secours        boolean NOT NULL DEFAULT false,

  pose_le        timestamptz NOT NULL DEFAULT now(),
  pose_par       uuid NOT NULL REFERENCES utilisateur(id),
  expire_le      timestamptz,

  libere_le      timestamptz,
  libere_par     uuid REFERENCES utilisateur(id),
  motif_liberation text,

  /* Une libération dit quand ET pourquoi. Sans motif, on ne distinguerait pas
     un déstockage normal d'une expiration automatique — et c'est justement la
     différence qu'un inventaire doit pouvoir lire. */
  CONSTRAINT occupation_liberation_coherente CHECK (
    (libere_le IS NULL AND motif_liberation IS NULL)
    OR (libere_le IS NOT NULL AND coalesce(btrim(motif_liberation), '') <> '')
  )
);

CREATE INDEX IF NOT EXISTS occupation_dossier_idx ON occupation_emplacement (dossier_id);
CREATE INDEX IF NOT EXISTS occupation_expire_idx
  ON occupation_emplacement (expire_le) WHERE libere_le IS NULL;

/* ═══ LA CONTRAINTE QUI ARBITRE ═══
   Une place n'a qu'une occupation en vigueur. C'est cette ligne, et aucune
   autre, qui empêche deux réceptions simultanées de prendre la même cassette.
   Le prédicat ne porte QUE sur `libere_le IS NULL` : `now()` n'est pas
   immuable et ne peut pas figurer dans un index — c'est pourquoi l'expiration
   doit être matérialisée par une libération réelle avant toute reprise. */
CREATE UNIQUE INDEX IF NOT EXISTS emplacement_occupe_unique
  ON occupation_emplacement (emplacement_id) WHERE libere_le IS NULL;

COMMENT ON INDEX mti.emplacement_occupe_unique IS
  'Une place, une occupation en vigueur. C''est l''arbitre : la liste des '
  'places libres affichée à l''écran n''est qu''un instantané.';

-- ── Créer un contenant et ses places d'un geste ─────────────────────────────
CREATE OR REPLACE FUNCTION mti.creer_emplacements (
  p_contenant uuid,
  p_etages    text[],
  p_par_etage integer
)
RETURNS integer
LANGUAGE plpgsql SET search_path = mti, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  IF p_par_etage < 1 OR p_par_etage > 200 THEN
    RAISE EXCEPTION 'Nombre d''emplacements par étage hors bornes (1 à 200) : %', p_par_etage;
  END IF;
  IF coalesce(array_length(p_etages, 1), 0) = 0 THEN
    RAISE EXCEPTION 'Au moins un étage est attendu';
  END IF;

  INSERT INTO mti.emplacement (contenant_id, etage, numero)
  SELECT p_contenant, btrim(e), p
    FROM unnest(p_etages) AS e
    CROSS JOIN generate_series(1, p_par_etage) AS p
   ON CONFLICT (contenant_id, etage, numero) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── Libérer les réservations expirées ───────────────────────────────────────
--
-- Appelée avant toute réservation, et jamais en tâche de fond : une place doit
-- être libérée au moment où quelqu'un cherche à la prendre, pas à un horaire
-- qui n'a rien à voir. Le motif est explicite, pour qu'un inventaire puisse
-- distinguer une expiration d'un déstockage.
CREATE OR REPLACE FUNCTION mti.liberer_occupations_expirees ()
RETURNS integer
LANGUAGE plpgsql SET search_path = mti, pg_temp AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE mti.occupation_emplacement
     SET libere_le = now(),
         motif_liberation = 'Réservation expirée — processus resté ouvert'
   WHERE libere_le IS NULL
     AND expire_le IS NOT NULL
     AND expire_le <= now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── Les places d'un contenant, avec leur état ───────────────────────────────
CREATE OR REPLACE FUNCTION mti.emplacements_etat (p_contenant uuid DEFAULT NULL)
RETURNS TABLE (
  emplacement_id uuid,
  contenant_id   uuid,
  contenant      text,
  etage          text,
  numero         integer,
  libelle        text,
  actif          boolean,
  hors_service_motif text,
  occupation_id  uuid,
  dossier_id     uuid,
  dossier        text,
  exemplaire     integer,
  secours        boolean,
  pose_le        timestamptz,
  expire_le      timestamptz
)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  SELECT e.id, c.id, c.libelle, e.etage, e.numero,
         format('%s-%s-%s', c.code, e.etage, lpad(e.numero::text, 2, '0')),
         e.actif, e.hors_service_motif,
         o.id, o.dossier_id, d.reference, o.exemplaire, o.secours, o.pose_le, o.expire_le
    FROM mti.emplacement e
    JOIN mti.contenant c ON c.id = e.contenant_id
    LEFT JOIN mti.occupation_emplacement o
           ON o.emplacement_id = e.id AND o.libere_le IS NULL
    LEFT JOIN mti.dossier d ON d.id = o.dossier_id
   WHERE (p_contenant IS NULL OR e.contenant_id = p_contenant)
   ORDER BY c.code, e.etage, e.numero
$$;

-- ── Un point « emplacement » obligatoire et vide n'est pas vert ─────────────
--
-- Reprise intégrale de la fonction : le nouveau type doit compter comme les
-- autres, sans quoi un stockage sans place assignée serait déclaré tout vert.
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
             WHEN 'emplacement' THEN coalesce(btrim(s.valeur_texte), '') = ''
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

-- ── Droits et audit ─────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON mti.contenant               TO mti_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mti.emplacement             TO mti_app;
GRANT SELECT, INSERT, UPDATE          ON mti.occupation_emplacement TO mti_app;
GRANT SELECT, INSERT, UPDATE          ON mti.parametre              TO mti_app;
GRANT EXECUTE ON FUNCTION mti.creer_emplacements (uuid, text[], integer) TO mti_app;
GRANT EXECUTE ON FUNCTION mti.liberer_occupations_expirees ()           TO mti_app;
GRANT EXECUTE ON FUNCTION mti.emplacements_etat (uuid)                  TO mti_app;

/* Une occupation ne se SUPPRIME pas : elle se libère. `DELETE` est absent de
   ces droits à dessein — l'historique des places occupées est ce qui permet de
   dire, après coup, où était un MTI à une date donnée. */
CREATE TRIGGER occupation_emplacement_audit
  AFTER INSERT OR UPDATE ON occupation_emplacement
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();
CREATE TRIGGER contenant_audit
  AFTER INSERT OR UPDATE OR DELETE ON contenant
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();
CREATE TRIGGER parametre_audit
  AFTER INSERT OR UPDATE ON parametre
  FOR EACH ROW EXECUTE FUNCTION mti.tracer_audit();
