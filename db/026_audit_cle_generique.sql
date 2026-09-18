-- =============================================================================
--  Audit : retrouver la clé d'une ligne quelle que soit la table
--
--  LE DÉFAUT CORRIGÉ. `tracer_audit()` cherchait la clé de la ligne dans `id`,
--  puis dans `patient_id`, et s'arrêtait là. Toutes les tables sous audit
--  avaient un `id` — jusqu'à `mti.parametre`, dont la clé primaire est `cle`.
--  Résultat : toute écriture dans cette table échouait sur
--  `cle_cible NOT NULL`, c'est-à-dire que la table était **impossible à
--  modifier**. Le réglage du délai d'expiration des emplacements, qui vit
--  précisément là, ne pouvait pas être changé.
--
--  Le repli est donc rendu GÉNÉRIQUE : à défaut de `id` ou `patient_id`, on
--  lit la clé primaire réelle de la table dans le catalogue. Une table future
--  n'aura pas à se souvenir de cette contrainte pour être auditable — et une
--  table sans clé primaire du tout reste tracée sous `'(sans clé)'` plutôt que
--  de faire échouer l'écriture : perdre l'identifiant d'une ligne est
--  regrettable, refuser l'écriture qui la produit l'est bien davantage.
--
--  La recherche au catalogue n'a lieu QUE si les deux colonnes usuelles sont
--  absentes : les tables existantes ne paient rien.
-- =============================================================================

SET search_path TO mti, public;

CREATE OR REPLACE FUNCTION tracer_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mti, pg_temp AS $$
DECLARE
  v_utilisateur uuid;
  v_cle         text;
  v_ligne       jsonb;
  v_colonne     text;
BEGIN
  BEGIN
    v_utilisateur := nullif(current_setting('mti.utilisateur_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_utilisateur := NULL;
  END;

  v_ligne := to_jsonb(COALESCE(NEW, OLD));
  v_cle := COALESCE(v_ligne ->> 'id', v_ligne ->> 'patient_id');

  IF v_cle IS NULL THEN
    -- Clé primaire réelle de la table, colonnes concaténées si elle en a
    -- plusieurs. Lu au catalogue plutôt que deviné.
    SELECT string_agg(v_ligne ->> a.attname, '|' ORDER BY a.attnum)
      INTO v_cle
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = TG_RELID AND i.indisprimary;
  END IF;

  INSERT INTO mti.audit (operation, table_cible, cle_cible, ancien, nouveau,
                         utilisateur_id, contexte)
  VALUES (
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(v_cle, '(sans clé)'),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    v_utilisateur,
    nullif(current_setting('mti.contexte', true), '')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
