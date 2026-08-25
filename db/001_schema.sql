-- =============================================================================
--  Module MTI — Schéma de base
--  Cible : PostgreSQL 15+ (déployé en one-click app CapRover)
--
--  Principes structurants :
--   1. Journal d'audit APPEND-ONLY alimenté par trigger (BPP / EU GMP Annexe 11).
--      Aucune saisie validée n'est modifiée en place : toute écriture est tracée.
--   2. Les données identifiantes patient sont ISOLÉES dans `patient_identite`.
--      Le reste du schéma ne référence qu'un identifiant opaque. Cette table est
--      la seule qui déclenche l'obligation d'hébergement HDS : elle peut être
--      chiffrée, externalisée ou laissée vide (résolution à la volée depuis le
--      SIH) sans toucher au reste du modèle.
--   3. Les modèles de parcours sont VERSIONNÉS (`modele_parcours.definition`).
--      Un dossier garde une copie figée de la définition de ses processus, afin
--      qu'un dossier validé reste relisible à l'identique après évolution du
--      modèle.
--   4. Le parcours est ANONYME par défaut. `dossier.patient_id` est NULL jusqu'à
--      la mise en fabrication, sauf préallocation explicite.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS mti;
SET search_path TO mti, public;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────── Types énumérés ──

CREATE TYPE role_operateur   AS ENUM ('op1', 'op2', 'systeme');
CREATE TYPE etat_processus   AS ENUM ('a_venir', 'en_cours', 'valide', 'annule');
CREATE TYPE statut_dossier   AS ENUM ('brouillon', 'en_cours', 'valide', 'annule');
CREATE TYPE conformite       AS ENUM ('conforme', 'non_conforme');
CREATE TYPE reponse_ouinon   AS ENUM ('oui', 'non');
CREATE TYPE type_point       AS ENUM ('ouinon', 'valeur', 'photo', 'timer', 'texte', 'auto');
CREATE TYPE role_signature   AS ENUM ('receptionnaire', 'verificateur', 'pharmacien', 'medecin');

-- ────────────────────────────────────────────────────────────── Utilisateurs ──

CREATE TABLE utilisateur (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifiant   text NOT NULL UNIQUE,          -- login SSO / LDAP de l'établissement
  nom           text NOT NULL,
  prenom        text NOT NULL,
  titre         text,                          -- « M. », « Dr », « Pr »…
  fonction      text,                          -- pharmacien, préparateur, IDE…
  actif         boolean NOT NULL DEFAULT true,
  cree_le       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE utilisateur IS
  'Identités authentifiées. Le double contrôle exige deux utilisateur.id distincts : '
  'un champ texte libre ne vaut pas signature.';

-- ─────────────────────────────────────────────────────────────────── Patient ──

-- Référence opaque : c'est ce que le reste du schéma manipule.
CREATE TABLE patient (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     text NOT NULL,                 -- IPP / N° patient dans le SIH
  source        text NOT NULL DEFAULT 'SIH',   -- SIH, PHARMA, CHIMIO, saisie manuelle
  cree_le       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, reference)
);

-- Données identifiantes — table isolée, cf. principe n°2.
CREATE TABLE patient_identite (
  patient_id       uuid PRIMARY KEY REFERENCES patient(id) ON DELETE CASCADE,
  nom              text,
  prenom           text,
  initiales        text,
  date_naissance   date,
  maj_le           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE patient_identite IS
  'Données de santé à caractère personnel (art. L1111-8 CSP). Seule table soumise '
  'à l''obligation HDS. Peut rester vide si l''identité est résolue à la volée '
  'depuis le SIH plutôt que persistée.';

-- ─────────────────────────────────────────────────────────────────── Produit ──

CREATE TABLE produit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  denomination   text NOT NULL,                -- KYMRIAH®, YESCARTA®…
  dci            text,                         -- tisagenlecleucel…
  laboratoire    text,
  seuil_temp_c   numeric(6,2) NOT NULL DEFAULT -150,
  actif          boolean NOT NULL DEFAULT true,
  UNIQUE (denomination)
);

-- ───────────────────────────────────────────── Modèles de parcours (versionnés) ──

CREATE TABLE modele_parcours (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  version      integer NOT NULL CHECK (version > 0),
  libelle      text NOT NULL,
  definition   jsonb NOT NULL,                 -- cf. shared/parcours-cart-v1.json
  actif        boolean NOT NULL DEFAULT false,
  publie_le    timestamptz,
  cree_le      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

-- Une seule version active par code.
CREATE UNIQUE INDEX modele_parcours_actif_unique
  ON modele_parcours (code) WHERE actif;

CREATE TABLE catalogue_processus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL,
  version      integer NOT NULL CHECK (version > 0),
  definition   jsonb NOT NULL,                 -- cf. shared/catalogue-processus-v1.json
  actif        boolean NOT NULL DEFAULT false,
  cree_le      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

-- ───────────────────────────────────────────────────────────────── Dossier ──

CREATE TABLE dossier (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference           text NOT NULL UNIQUE,    -- référence interne du dossier MTI
  modele_parcours_id  uuid NOT NULL REFERENCES modele_parcours(id),

  -- Le parcours est anonyme jusqu'à la mise en fabrication.
  patient_id          uuid REFERENCES patient(id),
  preallocation       boolean NOT NULL DEFAULT false,

  produit_id          uuid REFERENCES produit(id),
  designation_produit text,                    -- saisie libre si produit non référencé
  numero_lot          text,
  code_barre          text,
  date_peremption     date,
  numero_ordonnancier text,
  numero_commande     text,
  date_fabrication    date,
  transporteur        text,
  nb_exemplaires      integer NOT NULL DEFAULT 1 CHECK (nb_exemplaires BETWEEN 1 AND 10),

  statut              statut_dossier NOT NULL DEFAULT 'brouillon',
  conformite          conformite,
  commentaire         text,

  cree_par            uuid NOT NULL REFERENCES utilisateur(id),
  cree_le             timestamptz NOT NULL DEFAULT now(),
  valide_par          uuid REFERENCES utilisateur(id),
  valide_le           timestamptz,

  -- Un dossier validé porte obligatoirement une conclusion de conformité.
  CONSTRAINT dossier_valide_coherent CHECK (
    statut <> 'valide' OR (conformite IS NOT NULL AND valide_par IS NOT NULL AND valide_le IS NOT NULL)
  ),
  -- Une préallocation implique un patient identifié.
  CONSTRAINT dossier_preallocation_coherente CHECK (
    NOT preallocation OR patient_id IS NOT NULL
  )
);

CREATE INDEX dossier_patient_idx ON dossier (patient_id);
CREATE INDEX dossier_lot_idx     ON dossier (numero_lot);
CREATE INDEX dossier_statut_idx  ON dossier (statut);

-- Instance d'un processus dans un dossier. `definition` est la copie FIGÉE de la
-- définition du processus au moment de l'ouverture du dossier (principe n°3).
CREATE TABLE dossier_processus (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id   uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  ordre        integer NOT NULL,
  code         text NOT NULL,
  nom          text NOT NULL,
  gabarit      text NOT NULL DEFAULT 'standard',   -- 'reception' | 'standard'
  externe      boolean NOT NULL DEFAULT false,     -- réalisé par le fabricant
  ajoute_du_catalogue boolean NOT NULL DEFAULT false,
  definition   jsonb NOT NULL,
  etat         etat_processus NOT NULL DEFAULT 'a_venir',
  ouvert_le    timestamptz,
  valide_par   uuid REFERENCES utilisateur(id),
  valide_le    timestamptz,
  UNIQUE (dossier_id, ordre)
);

CREATE INDEX dossier_processus_dossier_idx ON dossier_processus (dossier_id);

-- ────────────────────────────────────────────────────────────────── Saisies ──

CREATE TABLE saisie (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_processus_id  uuid NOT NULL REFERENCES dossier_processus(id) ON DELETE CASCADE,

  -- Localisation du point dans la définition figée.
  section_index         integer NOT NULL,
  point_index           integer NOT NULL,
  point_num             text,                  -- « 1.3 », « 2.2 »… si le modèle en fournit
  point_type            type_point NOT NULL,
  exemplaire            integer NOT NULL DEFAULT 1 CHECK (exemplaire >= 1),
  operateur_role        role_operateur NOT NULL DEFAULT 'op1',

  -- Le caractère obligatoire est décidé à la saisie (bouton ★), pas figé au modèle.
  obligatoire           boolean NOT NULL DEFAULT false,

  reponse               reponse_ouinon,
  valeur_num            numeric(12,3),         -- températures, viabilité, niveaux…
  valeur_texte          text,
  seuil_applique        numeric(12,3),         -- seuil en vigueur au moment de la saisie
  hors_seuil            boolean,               -- alarme calculée et FIGÉE à la saisie

  horodatage            timestamptz,           -- date & heure déclarée du contrôle
  timer_debut           timestamptz,
  timer_fin             timestamptz,

  operateur_id          uuid REFERENCES utilisateur(id),
  saisi_le              timestamptz NOT NULL DEFAULT now(),

  UNIQUE (dossier_processus_id, section_index, point_index, exemplaire, operateur_role),

  CONSTRAINT saisie_timer_coherent CHECK (timer_fin IS NULL OR timer_debut IS NOT NULL),
  -- Une saisie « systeme » n'a pas d'opérateur humain ; les autres en ont un.
  CONSTRAINT saisie_operateur_coherent CHECK (
    (operateur_role = 'systeme' AND operateur_id IS NULL)
    OR (operateur_role <> 'systeme')
  )
);

CREATE INDEX saisie_processus_idx ON saisie (dossier_processus_id);
CREATE INDEX saisie_alarme_idx    ON saisie (hors_seuil) WHERE hors_seuil;

-- Durée du minuteur : calculée, jamais stockée en double.
CREATE VIEW saisie_timer AS
  SELECT id, timer_debut, timer_fin,
         EXTRACT(EPOCH FROM (COALESCE(timer_fin, now()) - timer_debut))::bigint AS secondes
    FROM saisie
   WHERE timer_debut IS NOT NULL;

-- ─────────────────────────────────────────────────────────── Pièces jointes ──

CREATE TABLE piece_jointe (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saisie_id    uuid NOT NULL REFERENCES saisie(id) ON DELETE CASCADE,
  libelle      text,                           -- « Face 1 », « RFI », « CoA »…
  nom_fichier  text NOT NULL,
  mime         text NOT NULL,
  taille       bigint NOT NULL CHECK (taille > 0),
  sha256       text NOT NULL,                  -- intégrité de la pièce archivée
  chemin       text NOT NULL,                  -- volume CapRover ou objet S3
  ajoute_par   uuid NOT NULL REFERENCES utilisateur(id),
  ajoute_le    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX piece_jointe_saisie_idx ON piece_jointe (saisie_id);

-- ──────────────────────────────────────────────────────────────── Signatures ──

CREATE TABLE signature (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dossier_id   uuid NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  processus_id uuid REFERENCES dossier_processus(id) ON DELETE CASCADE,
  role         role_signature NOT NULL,
  utilisateur_id uuid NOT NULL REFERENCES utilisateur(id),
  empreinte    text NOT NULL,                  -- SHA-256 du contenu signé
  signe_le     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dossier_id, processus_id, role, utilisateur_id)
);

COMMENT ON COLUMN signature.empreinte IS
  'SHA-256 du contenu signé. Permet de détecter toute divergence entre le contenu '
  'archivé et ce qui a effectivement été signé.';

-- =============================================================================
--  Journal d'audit — APPEND-ONLY
-- =============================================================================

CREATE TABLE audit (
  id            bigserial PRIMARY KEY,
  survenu_le    timestamptz NOT NULL DEFAULT now(),
  operation     text NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  table_cible   text NOT NULL,
  cle_cible     text NOT NULL,
  ancien        jsonb,
  nouveau       jsonb,
  -- Acteur : positionné par l'API via SET LOCAL mti.utilisateur_id.
  utilisateur_id uuid,
  contexte      text          -- adresse IP, session, motif de modification…
);

CREATE INDEX audit_cible_idx ON audit (table_cible, cle_cible, survenu_le DESC);
CREATE INDEX audit_date_idx  ON audit (survenu_le DESC);

COMMENT ON TABLE audit IS
  'Journal append-only. Les droits UPDATE et DELETE doivent être révoqués pour le '
  'rôle applicatif (cf. 003_roles.sql) : la traçabilité ne vaut que si elle est '
  'inaltérable depuis l''application.';

-- `SET search_path` est indispensable : le corps de la fonction s'exécute avec le
-- search_path de l'APPELANT, pas celui du script de création. Sans cela, les
-- références aux types du schéma `mti` échouent dès qu'un client se connecte
-- sans avoir positionné son search_path (cas de l'API). Pour une fonction
-- SECURITY DEFINER, c'est en plus une protection contre le détournement de
-- search_path.
CREATE OR REPLACE FUNCTION tracer_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = mti, pg_temp AS $$
DECLARE
  v_utilisateur uuid;
  v_cle         text;
BEGIN
  BEGIN
    v_utilisateur := nullif(current_setting('mti.utilisateur_id', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_utilisateur := NULL;
  END;

  v_cle := COALESCE(
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'id'),
    (to_jsonb(COALESCE(NEW, OLD)) ->> 'patient_id')
  );

  INSERT INTO mti.audit (operation, table_cible, cle_cible, ancien, nouveau,
                         utilisateur_id, contexte)
  VALUES (
    TG_OP,
    TG_TABLE_NAME,
    v_cle,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    v_utilisateur,
    nullif(current_setting('mti.contexte', true), '')
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Tables sous audit.
CREATE TRIGGER audit_dossier            AFTER INSERT OR UPDATE OR DELETE ON dossier            FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_dossier_processus  AFTER INSERT OR UPDATE OR DELETE ON dossier_processus  FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_saisie             AFTER INSERT OR UPDATE OR DELETE ON saisie             FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_piece_jointe       AFTER INSERT OR UPDATE OR DELETE ON piece_jointe       FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_signature          AFTER INSERT OR UPDATE OR DELETE ON signature          FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_patient_identite   AFTER INSERT OR UPDATE OR DELETE ON patient_identite   FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_utilisateur        AFTER INSERT OR UPDATE OR DELETE ON utilisateur        FOR EACH ROW EXECUTE FUNCTION tracer_audit();
CREATE TRIGGER audit_modele_parcours    AFTER INSERT OR UPDATE OR DELETE ON modele_parcours    FOR EACH ROW EXECUTE FUNCTION tracer_audit();

-- =============================================================================
--  Verrouillage post-validation (mode lecture seule)
-- =============================================================================

CREATE OR REPLACE FUNCTION interdire_modification_si_valide() RETURNS trigger
LANGUAGE plpgsql SET search_path = mti, pg_temp AS $$
DECLARE
  v_statut mti.statut_dossier;
BEGIN
  SELECT d.statut INTO v_statut
    FROM mti.dossier_processus dp
    JOIN mti.dossier d ON d.id = dp.dossier_id
   WHERE dp.id = COALESCE(NEW.dossier_processus_id, OLD.dossier_processus_id);

  IF v_statut = 'valide' THEN
    RAISE EXCEPTION
      'Dossier validé : les saisies sont en lecture seule. Toute correction passe '
      'par une nouvelle version du dossier (traçabilité BPP).'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER saisie_lecture_seule
  BEFORE INSERT OR UPDATE OR DELETE ON saisie
  FOR EACH ROW EXECUTE FUNCTION interdire_modification_si_valide();

-- Un dossier validé ne peut pas revenir en arrière.
CREATE OR REPLACE FUNCTION interdire_devalidation() RETURNS trigger
LANGUAGE plpgsql SET search_path = mti, pg_temp AS $$
BEGIN
  IF OLD.statut = 'valide' AND NEW.statut <> 'valide' THEN
    RAISE EXCEPTION 'Un dossier validé ne peut pas être dévalidé (statut % -> %).',
      OLD.statut, NEW.statut
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER dossier_pas_de_devalidation
  BEFORE UPDATE ON dossier
  FOR EACH ROW EXECUTE FUNCTION interdire_devalidation();
