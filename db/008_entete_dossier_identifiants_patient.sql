-- =============================================================================
--  En-tête du dossier : information importante et jalon d'aphérèse.
--  Identifiants patient : IPP et numéros à libellé libre.
--
--  Trois besoins exprimés en séance, qui tiennent tous en colonnes.
--
--  1. `information_importante` — une ligne libre, visible en permanence en
--     en-tête du dossier. C'est l'endroit où l'on écrit ce que le parcours ne
--     prévoit pas : « conteneur endommagé, litige transporteur en cours »,
--     « patient en réanimation, administration suspendue ». Pas un commentaire
--     de plus : `dossier.commentaire` existe déjà et n'est pas affiché en
--     en-tête, il documente le dossier ; celle-ci alerte celui qui l'ouvre.
--
--  2. `apherese_faite` / `date_apherese` — l'aphérèse n'est plus un processus
--     du parcours. Elle a été ramenée à ce qu'elle est réellement à ce stade du
--     projet : une date, facultative. Même forme que `prescription_faite`, pour
--     la même raison — jalonner le parcours sans prétendre porter l'acte.
--     `false` signifie « pas encore réalisée », pas « inconnue ».
--
--  3. `patient_identite.ipp` et `.identifiants` — l'IPP est LE pointeur vers le
--     dossier du SIH. Le porter ne contredit pas la règle « pas de référentiel
--     patients » : c'est précisément ce qui permet de ne pas en constituer un,
--     puisqu'il rend le dossier de référence retrouvable.
--
--     Les autres numéros vivent dans un JSONB plutôt que dans deux colonnes
--     `numero_1` / `numero_2` : leur LIBELLÉ est modifiable par l'utilisateur,
--     et il diffère d'un établissement à l'autre (n° de séjour, n° d'essai
--     clinique, n° de protocole). Deux colonnes auraient figé un nombre
--     arbitraire et laissé le libellé sans place où vivre. Forme attendue :
--       [{"libelle": "N° patient 1", "valeur": "…"}, …]
--     La contrainte ci-dessous vérifie la forme, pas le contenu : un tableau
--     d'objets portant `libelle` et `valeur` en texte.
--
--  Ces colonnes rejoignent des tables déjà auditées par les triggers de 001 :
--  toute écriture est tracée avec son auteur, il n'y a rien à ajouter ici.
-- =============================================================================

SET search_path TO mti, public;

-- ── 1 et 2. En-tête du dossier ──────────────────────────────────────────────

ALTER TABLE dossier
  ADD COLUMN information_importante text,
  ADD COLUMN apherese_faite         boolean NOT NULL DEFAULT false,
  ADD COLUMN date_apherese          date;

COMMENT ON COLUMN dossier.information_importante IS
  'Information à porter à la connaissance de quiconque ouvre le dossier, '
  'affichée en en-tête. Distincte de `commentaire`, qui documente le dossier '
  'sans être mis en avant.';

COMMENT ON COLUMN dossier.apherese_faite IS
  'Jalon : l''aphérèse a-t-elle été réalisée. Facultatif. Ne porte aucune '
  'donnée de l''acte lui-même.';

COMMENT ON COLUMN dossier.date_apherese IS
  'Date de l''aphérèse, renseignée quand le jalon est posé.';

/* Une date sans jalon posé est une incohérence : elle affirmerait une aphérèse
   que le dossier déclare non faite. L'inverse est permis — le jalon peut être
   posé avant que la date soit connue. */
ALTER TABLE dossier
  ADD CONSTRAINT dossier_date_apherese_exige_jalon
  CHECK (date_apherese IS NULL OR apherese_faite);

-- ── 3. Identifiants patient ─────────────────────────────────────────────────

ALTER TABLE patient_identite
  ADD COLUMN ipp           text,
  ADD COLUMN identifiants  jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN patient_identite.ipp IS
  'Identifiant permanent du patient dans le SIH. C''est le pointeur vers le '
  'dossier de référence — le porter est ce qui dispense d''en recopier le '
  'contenu ici.';

COMMENT ON COLUMN patient_identite.identifiants IS
  'Numéros complémentaires, libellé compris : [{"libelle":…,"valeur":…}]. Le '
  'libellé est modifiable par l''utilisateur et varie d''un établissement à '
  'l''autre (n° de séjour, d''essai clinique, de protocole), d''où le JSONB '
  'plutôt que des colonnes figées.';

/* La vérification passe par une fonction : PostgreSQL refuse une sous-requête
   dans un CHECK, et parcourir un tableau JSONB en exige une. C'est l'un des
   rares usages légitimes d'une fonction dans un CHECK — le résultat ne dépend
   que de la valeur de la colonne, rien d'extérieur à la ligne, d'où IMMUTABLE.

   `search_path` figé au strict nécessaire : la fonction n'appelle que des
   primitives JSONB, mais une fonction IMMUTABLE dont le search_path est
   variable est un vecteur classique de détournement. */
CREATE OR REPLACE FUNCTION identifiants_patient_bien_formes (v jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  /* Le coalesce n'est pas cosmétique. `e -> 'libelle'` sur une clé ABSENTE rend
     NULL SQL, `jsonb_typeof(NULL)` rend NULL, et `NULL <> 'string'` vaut NULL —
     pas TRUE. Sans lui, la clause WHERE de l'élément fautif s'évalue à NULL, la
     ligne n'est pas retournée, et NOT EXISTS conclut que tout va bien :
     `[{"valeur":"42"}]`, sans libellé, était accepté. */
  SELECT jsonb_typeof(v) = 'array'
     AND NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v) e
            WHERE coalesce(jsonb_typeof(e), '')              <> 'object'
               OR coalesce(jsonb_typeof(e -> 'libelle'), '') <> 'string'
               OR coalesce(jsonb_typeof(e -> 'valeur'), '')  <> 'string'
         );
$$;

COMMENT ON FUNCTION identifiants_patient_bien_formes (jsonb) IS
  'Forme attendue de patient_identite.identifiants : tableau d''objets portant '
  '`libelle` et `valeur` en texte. Appelée depuis un CHECK, d''où IMMUTABLE.';

ALTER TABLE patient_identite
  ADD CONSTRAINT patient_identite_identifiants_forme
  CHECK (identifiants_patient_bien_formes(identifiants));
