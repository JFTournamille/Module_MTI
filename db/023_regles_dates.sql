-- =============================================================================
--  Règles de cohérence entre deux dates
--
--  Première forme du moteur de règles : « la date de ce point ne peut pas être
--  antérieure à la date de ce point-là ». L'alerte se déclenche à la saisie de
--  l'une comme de l'autre, et dit la cause.
--
--  ELLE ALERTE, ELLE N'INTERDIT PAS — décision du 18 septembre, et c'est le
--  choix le plus sûr pour la donnée elle-même. Une date peut être légitimement
--  étrange ; un opérateur empêché d'enregistrer un fait réel saisira une
--  fausse date plausible, et une date fausse et muette est bien pire qu'une
--  date vraie et signalée. C'est aussi ce que fait déjà la quarantaine, et ce
--  que fait la conformité automatique, qui ne prononce jamais une
--  non-conformité.
--
--  OÙ VIVENT LES RÈGLES. Dans `modele_parcours.definition -> 'regles'`, donc
--  dans la VERSION du parcours à laquelle le dossier est rattaché. Un dossier
--  ouvert garde les règles de sa version : corriger une règle ne corrigera pas
--  les dossiers en cours, et c'est voulu — une fiche de traçabilité ne change
--  pas de critères après coup.
--
--  COMMENT UN POINT EST DÉSIGNÉ. Par un `code`, jamais par son rang. Retirer
--  l'aphérèse en v3 avait décalé douze processus ; une règle qui aurait
--  désigné ses points par leur position se serait mise, sans rien dire, à
--  comparer deux autres dates. Une règle dont un point est introuvable dans la
--  définition figée est INERTE : elle ne compare rien plutôt que de comparer
--  n'importe quoi.
-- =============================================================================

SET search_path TO mti, public;

-- ── Lire une date saisie sans jamais échouer ────────────────────────────────
--
-- Les dates de points vivent dans `saisie.valeur_texte`, saisies par un champ
-- date du navigateur — mais rien n'interdit qu'une valeur ancienne ou importée
-- soit illisible. Un cast direct ferait alors échouer TOUTE la requête, donc
-- le tableau de bord entier, pour une seule ligne mal formée.
CREATE OR REPLACE FUNCTION mti.date_ou_null (p_texte text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = mti, pg_temp AS $$
BEGIN
  RETURN p_texte::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

COMMENT ON FUNCTION mti.date_ou_null (text) IS
  'Convertit un texte en date, ou NULL si c''est illisible. Ne lève jamais : '
  'une valeur mal formée ne doit pas faire échouer la requête qui la lit.';

-- ── Retrouver un point par son code dans une définition figée ───────────────
CREATE OR REPLACE FUNCTION mti.localiser_point (p_definition jsonb, p_code text)
RETURNS TABLE (section_index integer, point_index integer, num text, libelle text)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  SELECT (sec.si - 1)::integer, (p.pi - 1)::integer, pt ->> 'num', pt ->> 'libelle'
    FROM jsonb_array_elements(coalesce(p_definition -> 'sections', '[]'::jsonb))
         WITH ORDINALITY AS sec(section, si)
    CROSS JOIN LATERAL jsonb_array_elements(
           coalesce(sec.section -> 'points', '[]'::jsonb))
         WITH ORDINALITY AS p(pt, pi)
   WHERE pt ->> 'code' = p_code
   LIMIT 1
$$;

COMMENT ON FUNCTION mti.localiser_point (jsonb, text) IS
  'Position (section, point) du point portant ce code dans une définition '
  'figée, ou aucune ligne. Désigner un point par son code et non par son rang '
  'est ce qui empêche une règle de comparer deux autres dates après un '
  'réordonnancement.';

-- ── Les incohérences de dates d'un dossier ──────────────────────────────────
--
-- Calculée à la demande, comme `coches_non_vertes()`, et pour la même raison :
-- un résultat stocké se désynchronise de la saisie qui l'a produit, et il
-- faudrait alors se demander lequel des deux fait foi.
--
-- Quand un point porte plusieurs exemplaires, TOUTES les paires sont
-- comparées : une seule paire en défaut suffit à signaler. Ne regarder que le
-- premier exemplaire laisserait passer l'incohérence portée par le second.
CREATE OR REPLACE FUNCTION mti.incoherences_dates (
  p_dossier   uuid,
  p_processus uuid DEFAULT NULL
)
RETURNS TABLE (
  regle              text,
  libelle            text,
  message            text,
  processus_avant_id uuid,
  processus_avant    text,
  point_avant        text,
  point_avant_num    text,
  exemplaire_avant   integer,
  secours_avant      boolean,
  date_avant         date,
  processus_apres_id uuid,
  processus_apres    text,
  point_apres        text,
  point_apres_num    text,
  exemplaire_apres   integer,
  secours_apres      boolean,
  date_apres         date
)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  WITH regles AS (
    SELECT r.regle
      FROM mti.dossier d
      JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
      CROSS JOIN LATERAL jsonb_array_elements(
             coalesce(m.definition -> 'regles', '[]'::jsonb)) AS r(regle)
     WHERE d.id = p_dossier
       AND r.regle ->> 'type' = 'ordre_dates'
  ),
  -- Les deux extrémités de chaque règle, résolues dans la définition FIGÉE du
  -- dossier. Une jointure interne : une règle dont un point a disparu du
  -- parcours ne produit aucune ligne, donc aucune alerte.
  bornes AS (
    SELECT r.regle,
           dpa.id  AS proc_avant_id,  dpa.nom AS proc_avant,
           la.section_index AS sa,    la.point_index AS pa,
           la.libelle AS lib_avant,   la.num AS num_avant,
           dpb.id  AS proc_apres_id,  dpb.nom AS proc_apres,
           lb.section_index AS sb,    lb.point_index AS pb,
           lb.libelle AS lib_apres,   lb.num AS num_apres
      FROM regles r
      JOIN mti.dossier_processus dpa
        ON dpa.dossier_id = p_dossier
       AND dpa.code = r.regle -> 'avant' ->> 'processus'
      CROSS JOIN LATERAL mti.localiser_point(
             dpa.definition, r.regle -> 'avant' ->> 'point') la
      JOIN mti.dossier_processus dpb
        ON dpb.dossier_id = p_dossier
       AND dpb.code = r.regle -> 'apres' ->> 'processus'
      CROSS JOIN LATERAL mti.localiser_point(
             dpb.definition, r.regle -> 'apres' ->> 'point') lb
     WHERE dpa.etat <> 'annule' AND dpb.etat <> 'annule'
  )
  SELECT b.regle ->> 'code',
         coalesce(b.regle ->> 'libelle', 'Cohérence de dates'),
         coalesce(b.regle ->> 'message',
                  format('« %s » ne peut pas être postérieure à « %s ».',
                         b.lib_avant, b.lib_apres)),
         b.proc_avant_id, b.proc_avant, b.lib_avant, b.num_avant,
         sa_.exemplaire, sa_.secours, mti.date_ou_null(sa_.valeur_texte),
         b.proc_apres_id, b.proc_apres, b.lib_apres, b.num_apres,
         sb_.exemplaire, sb_.secours, mti.date_ou_null(sb_.valeur_texte)
    FROM bornes b
    JOIN mti.saisie sa_ ON sa_.dossier_processus_id = b.proc_avant_id
                       AND sa_.section_index = b.sa AND sa_.point_index = b.pa
    JOIN mti.saisie sb_ ON sb_.dossier_processus_id = b.proc_apres_id
                       AND sb_.section_index = b.sb AND sb_.point_index = b.pb
   WHERE mti.date_ou_null(sa_.valeur_texte) IS NOT NULL
     AND mti.date_ou_null(sb_.valeur_texte) IS NOT NULL
     /* Une règle ne se prononce QUE sur les deux dates renseignées. Une date
        manquante n'est pas une incohérence : c'est un point non saisi, et
        c'est `coches_non_vertes()` qui le dit, avec ses propres critères. */
     AND CASE WHEN (b.regle ->> 'strict')::boolean IS TRUE
              THEN mti.date_ou_null(sa_.valeur_texte) >= mti.date_ou_null(sb_.valeur_texte)
              ELSE mti.date_ou_null(sa_.valeur_texte) >  mti.date_ou_null(sb_.valeur_texte)
         END
     /* Filtre par processus : le pied de page évalue le processus affiché.
        Une incohérence est signalée dès que L'UN de ses deux points est dans
        ce processus — sinon une règle qui enjambe deux processus resterait
        invisible des deux côtés. */
     AND (p_processus IS NULL
          OR b.proc_avant_id = p_processus OR b.proc_apres_id = p_processus)
$$;

COMMENT ON FUNCTION mti.incoherences_dates (uuid, uuid) IS
  'Règles « ordre_dates » du parcours du dossier qui sont en défaut. Signale, '
  'n''interdit pas : aucune écriture n''est empêchée par cette fonction.';

GRANT EXECUTE ON FUNCTION mti.date_ou_null (text)            TO mti_app;
GRANT EXECUTE ON FUNCTION mti.localiser_point (jsonb, text)  TO mti_app;
GRANT EXECUTE ON FUNCTION mti.incoherences_dates (uuid, uuid) TO mti_app;
