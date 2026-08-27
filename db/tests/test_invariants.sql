-- Tests des invariants réglementaires du schéma MTI.
-- Exécution : psql -d <base> -v ON_ERROR_STOP=1 -f db/tests/test_invariants.sql
\set QUIET on
-- Volontairement PAS de `SET search_path` : les triggers doivent fonctionner
-- pour un client connecté avec le search_path par défaut, comme l'API. Un test
-- qui positionne le search_path masque les références de type non qualifiées.
SET search_path TO public;

-- Toute la suite tourne dans une transaction annulée à la fin. Trois raisons :
--   1. les UUID du jeu de test sont figés, donc un second passage violerait
--      les clés primaires ;
--   2. `mti.audit` est append-only par construction — on ne peut pas effacer
--      après coup les traces produites par les tests ;
--   3. la suite doit pouvoir tourner sur une base installée, sans la polluer.
-- Les tests attendus en échec sont dans des blocs PL/pgSQL avec gestionnaire
-- d'exception, qui posent un point de sauvegarde implicite : une erreur
-- rattrapée n'annule donc pas la transaction englobante.
/* Posé DANS le fichier, pas seulement dans la ligne de commande : sans cela un
   appel qui oublie `-v ON_ERROR_STOP=1` poursuit après une erreur et affiche
   quand même « ✓ Tous les invariants sont vérifiés » en fin de course. Une
   suite qui peut mentir sur son propre résultat ne sert à rien. */
\set ON_ERROR_STOP on

BEGIN;

\echo '── Préparation du jeu de test ──'

INSERT INTO mti.utilisateur (id, identifiant, nom, prenom, titre, fonction) VALUES
  ('11111111-1111-1111-1111-111111111111', 'test_preparateur', 'TEST', 'Préparateur', 'M.', 'préparateur'),
  ('22222222-2222-2222-2222-222222222222', 'test_pharmacien', 'TEST', 'Pharmacien', 'Dr', 'pharmacien');

INSERT INTO mti.modele_parcours (id, code, version, libelle, definition, actif, publie_le)
VALUES ('33333333-3333-3333-3333-333333333333', 'PARCOURS_TEST', 1, 'Parcours de test',
        '{"processus":[]}'::jsonb, true, now());

SELECT set_config('mti.utilisateur_id', '11111111-1111-1111-1111-111111111111', false);

INSERT INTO mti.dossier (id, reference, modele_parcours_id, numero_lot, cree_par)
VALUES ('44444444-4444-4444-4444-444444444444', 'DOS-TEST-001',
        '33333333-3333-3333-3333-333333333333', 'TC-2026-0814',
        '11111111-1111-1111-1111-111111111111');

INSERT INTO mti.dossier_processus (id, dossier_id, ordre, code, nom, gabarit, definition, etat)
VALUES ('55555555-5555-5555-5555-555555555555', '44444444-4444-4444-4444-444444444444',
        1, 'RECEPTION', 'Réception', 'reception', '{"sections":[]}'::jsonb, 'en_cours');

\set QUIET off

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 1 — Le parcours est anonyme par défaut (patient_id NULL autorisé)'
DO $$
BEGIN
  PERFORM 1 FROM mti.dossier
    WHERE id = '44444444-4444-4444-4444-444444444444' AND patient_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ÉCHEC : le dossier devrait être anonyme'; END IF;
  RAISE NOTICE '  ✓ dossier créé sans patient';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 2 — Une préallocation sans patient est refusée'
DO $$
BEGIN
  UPDATE mti.dossier SET preallocation = true
   WHERE id = '44444444-4444-4444-4444-444444444444';
  RAISE EXCEPTION 'ÉCHEC : la préallocation sans patient a été acceptée';
EXCEPTION
  WHEN check_violation THEN RAISE NOTICE '  ✓ refusé : %', 'contrainte dossier_preallocation_coherente';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 3 — Toute saisie est tracée dans le journal d''audit'
DO $$
DECLARE v_avant bigint; v_apres bigint; v_acteur uuid;
BEGIN
  SELECT count(*) INTO v_avant FROM mti.audit WHERE table_cible = 'saisie';

  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_num,
                          point_type, obligatoire, valeur_num, seuil_applique, hors_seuil,
                          horodatage, operateur_id)
  VALUES ('55555555-5555-5555-5555-555555555555', 0, 2, '1.3', 'valeur', true,
          -168.4, -150, false, now(), '11111111-1111-1111-1111-111111111111');

  SELECT count(*) INTO v_apres FROM mti.audit WHERE table_cible = 'saisie';
  IF v_apres <> v_avant + 1 THEN
    RAISE EXCEPTION 'ÉCHEC : audit non alimenté (% -> %)', v_avant, v_apres;
  END IF;

  SELECT utilisateur_id INTO v_acteur FROM mti.audit
   WHERE table_cible = 'saisie' ORDER BY id DESC LIMIT 1;
  IF v_acteur <> '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'ÉCHEC : acteur non capturé (%)', v_acteur;
  END IF;

  RAISE NOTICE '  ✓ INSERT tracé, acteur identifié';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 4 — Une modification conserve l''ancienne valeur dans l''audit'
DO $$
DECLARE v_ancien numeric; v_nouveau numeric;
BEGIN
  UPDATE mti.saisie SET valeur_num = -155.0
   WHERE dossier_processus_id = '55555555-5555-5555-5555-555555555555' AND point_num = '1.3';

  SELECT (ancien ->> 'valeur_num')::numeric, (nouveau ->> 'valeur_num')::numeric
    INTO v_ancien, v_nouveau
    FROM mti.audit
   WHERE table_cible = 'saisie' AND operation = 'UPDATE'
   ORDER BY id DESC LIMIT 1;

  IF v_ancien <> -168.4 OR v_nouveau <> -155.0 THEN
    RAISE EXCEPTION 'ÉCHEC : valeurs avant/après incorrectes (% -> %)', v_ancien, v_nouveau;
  END IF;
  RAISE NOTICE '  ✓ ancienne valeur % conservée, nouvelle valeur %', v_ancien, v_nouveau;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 5 — Le double contrôle accepte deux opérateurs sur le même point'
DO $$
BEGIN
  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_num,
                          point_type, operateur_role, reponse, operateur_id)
  VALUES ('55555555-5555-5555-5555-555555555555', 0, 0, '1.1', 'ouinon', 'op1', 'oui',
          '11111111-1111-1111-1111-111111111111');

  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_num,
                          point_type, operateur_role, reponse, operateur_id)
  VALUES ('55555555-5555-5555-5555-555555555555', 0, 0, '1.1', 'ouinon', 'op2', 'oui',
          '22222222-2222-2222-2222-222222222222');

  RAISE NOTICE '  ✓ Op.1 et Op.2 enregistrés séparément sur le point 1.1';
END $$;

\echo ''
\echo 'TEST 6 — Le même point ne peut pas être saisi deux fois par le même rôle'
DO $$
BEGIN
  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_num,
                          point_type, operateur_role, reponse, operateur_id)
  VALUES ('55555555-5555-5555-5555-555555555555', 0, 0, '1.1', 'ouinon', 'op1', 'non',
          '11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'ÉCHEC : doublon accepté';
EXCEPTION
  WHEN unique_violation THEN RAISE NOTICE '  ✓ doublon refusé';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 7 — Les exemplaires (n cuves / n photos) coexistent sur un même point'
DO $$
DECLARE v_n integer;
BEGIN
  -- Cuve 1 et 2 conformes, cuve 3 hors seuil : le cas qui doit déclencher l'alarme.
  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_num,
                          point_type, exemplaire, valeur_num, seuil_applique, hors_seuil,
                          operateur_id)
  SELECT '55555555-5555-5555-5555-555555555555', 1, 1, '2.2', 'valeur', ex, temp,
         -160, temp > -160, '11111111-1111-1111-1111-111111111111'
    FROM (VALUES (1, -168.2::numeric), (2, -163.0), (3, -152.7)) AS v(ex, temp);

  SELECT count(*) INTO v_n FROM mti.saisie
   WHERE dossier_processus_id = '55555555-5555-5555-5555-555555555555' AND point_num = '2.2';
  IF v_n <> 3 THEN RAISE EXCEPTION 'ÉCHEC : % exemplaires au lieu de 3', v_n; END IF;
  RAISE NOTICE '  ✓ 3 exemplaires enregistrés indépendamment';
END $$;

\echo ''
\echo 'TEST 8 — L''alarme de température est figée à la saisie'
DO $$
DECLARE v_alarmes integer;
BEGIN
  SELECT count(*) INTO v_alarmes FROM mti.saisie
   WHERE hors_seuil AND dossier_processus_id = '55555555-5555-5555-5555-555555555555';
  IF v_alarmes <> 1 THEN
    RAISE EXCEPTION 'ÉCHEC : % alarme(s) au lieu de 1 (cuve 3 à -152,7 °C)', v_alarmes;
  END IF;
  RAISE NOTICE '  ✓ 1 saisie hors seuil sur 3 (cuve 3 : -152,7 °C > -160 °C)';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 9 — Après validation, les saisies passent en lecture seule'
DO $$
BEGIN
  UPDATE mti.dossier
     SET statut = 'valide', conformite = 'conforme',
         valide_par = '22222222-2222-2222-2222-222222222222', valide_le = now()
   WHERE id = '44444444-4444-4444-4444-444444444444';
  RAISE NOTICE '  · dossier validé par le pharmacien';

  BEGIN
    UPDATE mti.saisie SET valeur_num = -100
     WHERE dossier_processus_id = '55555555-5555-5555-5555-555555555555' AND point_num = '1.3';
    RAISE EXCEPTION 'ÉCHEC : modification acceptée sur un dossier validé';
  EXCEPTION
    WHEN integrity_constraint_violation THEN RAISE NOTICE '  ✓ UPDATE refusé après validation';
  END;

  BEGIN
    DELETE FROM mti.saisie
     WHERE dossier_processus_id = '55555555-5555-5555-5555-555555555555' AND point_num = '1.3';
    RAISE EXCEPTION 'ÉCHEC : suppression acceptée sur un dossier validé';
  EXCEPTION
    WHEN integrity_constraint_violation THEN RAISE NOTICE '  ✓ DELETE refusé après validation';
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 10 — Un dossier validé ne peut pas être dévalidé'
DO $$
BEGIN
  UPDATE mti.dossier SET statut = 'en_cours'
   WHERE id = '44444444-4444-4444-4444-444444444444';
  RAISE EXCEPTION 'ÉCHEC : dévalidation acceptée';
EXCEPTION
  WHEN integrity_constraint_violation THEN RAISE NOTICE '  ✓ dévalidation refusée';
END $$;

\echo ''
\echo 'TEST 11 — Une validation sans conclusion de conformité est refusée'
DO $$
BEGIN
  INSERT INTO mti.dossier (reference, modele_parcours_id, statut, cree_par)
  VALUES ('DOS-TEST-002', '33333333-3333-3333-3333-333333333333', 'valide',
          '11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'ÉCHEC : dossier validé sans conformité accepté';
EXCEPTION
  WHEN check_violation THEN RAISE NOTICE '  ✓ refusé : conformité et signataire obligatoires';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 12 — La vue des minuteurs calcule bien la durée'
DO $$
DECLARE v_sec bigint;
BEGIN
  INSERT INTO mti.dossier_processus (id, dossier_id, ordre, code, nom, definition, etat)
  VALUES ('66666666-6666-6666-6666-666666666666', '44444444-4444-4444-4444-444444444444',
          2, 'DECONGELATION', 'Décongélation', '{}'::jsonb, 'en_cours');

  -- Le dossier étant validé, on teste la vue sur une saisie insérée avant blocage :
  -- on repasse par un dossier neuf.
  INSERT INTO mti.dossier (id, reference, modele_parcours_id, cree_par)
  VALUES ('77777777-7777-7777-7777-777777777777', 'DOS-TEST-003',
          '33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');
  INSERT INTO mti.dossier_processus (id, dossier_id, ordre, code, nom, definition, etat)
  VALUES ('88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777',
          1, 'DECONGELATION', 'Décongélation', '{}'::jsonb, 'en_cours');
  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_type,
                          timer_debut, timer_fin, operateur_id)
  VALUES ('88888888-8888-8888-8888-888888888888', 0, 0, 'timer',
          now() - interval '4 minutes 30 seconds', now(),
          '11111111-1111-1111-1111-111111111111');

  SELECT secondes INTO v_sec FROM mti.saisie_timer
   WHERE id = (SELECT id FROM mti.saisie
                WHERE dossier_processus_id = '88888888-8888-8888-8888-888888888888');
  IF v_sec NOT BETWEEN 269 AND 271 THEN
    RAISE EXCEPTION 'ÉCHEC : durée calculée = % (attendu ~270)', v_sec;
  END IF;
  RAISE NOTICE '  ✓ durée minuteur = % secondes', v_sec;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 13 — Un minuteur ne peut pas avoir une fin sans début'
DO $$
BEGIN
  INSERT INTO mti.saisie (dossier_processus_id, section_index, point_index, point_type,
                          timer_fin, operateur_id)
  VALUES ('88888888-8888-8888-8888-888888888888', 9, 9, 'timer', now(),
          '11111111-1111-1111-1111-111111111111');
  RAISE EXCEPTION 'ÉCHEC : minuteur incohérent accepté';
EXCEPTION
  WHEN check_violation THEN RAISE NOTICE '  ✓ refusé : contrainte saisie_timer_coherent';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 14 — Un seul modèle de parcours actif par code'
DO $$
BEGIN
  INSERT INTO mti.modele_parcours (code, version, libelle, definition, actif)
  VALUES ('PARCOURS_TEST', 2, 'Parcours de test v2', '{"processus":[]}'::jsonb, true);
  RAISE EXCEPTION 'ÉCHEC : deux versions actives acceptées';
EXCEPTION
  WHEN unique_violation THEN RAISE NOTICE '  ✓ refusé : une seule version active par code';
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo '── Récapitulatif du journal d''audit (base entière, jeu de test inclus) ──'
SELECT table_cible, operation, count(*) AS nb
  FROM mti.audit GROUP BY 1, 2 ORDER BY 1, 2;

-- ═══════════════════════════════════════════════════════════════════════════
\echo ''
\echo 'TEST 15 — Une écriture sur un compte utilisateur est tracée avec son auteur'
DO $$
DECLARE v_auteur uuid; v_avant text; v_apres text;
BEGIN
  -- Les comptes portent l'identité des opérateurs : leurs modifications doivent
  -- être aussi traçables que les saisies. Le profil sert de témoin.
  UPDATE mti.utilisateur SET profil = 'pharmacien'
   WHERE id = '22222222-2222-2222-2222-222222222222';

  SELECT utilisateur_id, ancien->>'profil', nouveau->>'profil'
    INTO v_auteur, v_avant, v_apres
    FROM mti.audit
   WHERE table_cible = 'utilisateur'
     AND cle_cible = '22222222-2222-2222-2222-222222222222'
     AND operation = 'UPDATE'
   ORDER BY survenu_le DESC, id DESC
   LIMIT 1;

  IF v_auteur IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : modification de compte tracée sans auteur';
  END IF;
  IF v_auteur <> '11111111-1111-1111-1111-111111111111' THEN
    RAISE EXCEPTION 'ÉCHEC : auteur inattendu (%)', v_auteur;
  END IF;
  IF v_apres <> 'pharmacien' OR v_avant IS NOT NULL THEN
    RAISE EXCEPTION 'ÉCHEC : profil mal tracé (% → %)', v_avant, v_apres;
  END IF;
  RAISE NOTICE '  ✓ changement de profil tracé (NULL → pharmacien), auteur identifié';
END $$;

\echo ''
\echo 'TEST 16 — Une date d''aphérèse sans jalon posé est refusée'
DO $$
DECLARE v_modele uuid;
BEGIN
  SELECT id INTO v_modele FROM mti.modele_parcours WHERE actif LIMIT 1;
  BEGIN
    -- Une date sans jalon affirmerait une aphérèse que le dossier déclare non
    -- faite. L'inverse est permis : le jalon peut précéder la date connue.
    INSERT INTO mti.dossier (reference, modele_parcours_id, date_apherese, cree_par)
    VALUES ('TEST-APH-1', v_modele, '2026-06-01',
            '11111111-1111-1111-1111-111111111111');
    RAISE EXCEPTION 'ÉCHEC : date d''aphérèse acceptée sans jalon';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ✓ date sans jalon refusée';
  END;

  INSERT INTO mti.dossier (reference, modele_parcours_id, apherese_faite, cree_par)
  VALUES ('TEST-APH-2', v_modele, true,
          '11111111-1111-1111-1111-111111111111');
  RAISE NOTICE '  ✓ jalon posé sans date accepté';
END $$;

\echo ''
\echo 'TEST 17 — La forme des identifiants patient est vérifiée en base'
DO $$
DECLARE v_patient uuid; v_ok boolean;
BEGIN
  INSERT INTO mti.patient (reference, source) VALUES ('TEST-IPP', 'TEST')
  RETURNING id INTO v_patient;

  INSERT INTO mti.patient_identite (patient_id, nom, ipp, identifiants)
  VALUES (v_patient, 'ESSAI', '80123456',
          '[{"libelle":"N° patient 1","valeur":"A-12"}]');
  RAISE NOTICE '  ✓ IPP et identifiant bien formé acceptés';

  /* Le cas qui a réellement échappé à la première écriture de la contrainte :
     une clé ABSENTE rend NULL, et NULL <> ''string'' vaut NULL, pas TRUE. Sans
     coalesce, cet objet sans libellé passait. */
  BEGIN
    UPDATE mti.patient_identite SET identifiants = '[{"valeur":"42"}]'
     WHERE patient_id = v_patient;
    RAISE EXCEPTION 'ÉCHEC : identifiant sans libellé accepté';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ✓ identifiant sans libellé refusé';
  END;

  BEGIN
    UPDATE mti.patient_identite SET identifiants = '[{"libelle":"N°","valeur":42}]'
     WHERE patient_id = v_patient;
    RAISE EXCEPTION 'ÉCHEC : valeur numérique acceptée';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ✓ valeur non textuelle refusée';
  END;

  BEGIN
    UPDATE mti.patient_identite SET identifiants = '["A-12"]'
     WHERE patient_id = v_patient;
    RAISE EXCEPTION 'ÉCHEC : élément scalaire accepté';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  ✓ élément scalaire refusé';
  END;

  -- Qualifiée et castée : la suite tourne avec un search_path par défaut, comme
  -- un vrai client, et `'…'` seul serait de type `unknown`.
  SELECT mti.identifiants_patient_bien_formes('{"libelle":"x","valeur":"y"}'::jsonb)
    INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'ÉCHEC : un objet nu passe pour un tableau';
  END IF;
  RAISE NOTICE '  ✓ objet nu (hors tableau) refusé';
END $$;

-- Les traces produites par les tests disparaissent avec la transaction ; celles
-- déjà présentes en base restent, l'audit étant append-only par construction.
ROLLBACK;

\echo ''
\echo '✓ Tous les invariants sont vérifiés — jeu de test annulé, base inchangée.'
