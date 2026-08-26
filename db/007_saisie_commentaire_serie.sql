-- =============================================================================
--  Commentaire libre et n° de série par saisie
--
--  Deux demandes de la réunion du 26 juin 2026, qui portent toutes deux sur la
--  SAISIE et non sur le point de contrôle : c'est l'opérateur qui les renseigne,
--  au moment de l'acte, pour un exemplaire donné.
--
--  `commentaire` — texte libre par ligne, restitué en bulle. Un point de
--  contrôle répond oui ou non ; ce qui explique un écart, une réserve ou une
--  circonstance ne rentre pas dans une case à cocher. Sans ce champ, cette
--  information partait dans le commentaire global du dossier, où elle perdait
--  le lien avec la ligne concernée.
--
--  `numero_serie` — en COMPLÉMENT du n° de lot, jamais à sa place. Un lot
--  couvre plusieurs exemplaires ; le n° de série en identifie un seul. Pour un
--  kit de tubes, c'est ce qui permet de dire lequel des trois tubes CD4 a été
--  envoyé au laboratoire.
--
--  Les deux vivent sur `mti.saisie`, dont la clé unique porte déjà
--  (dossier_processus, section, point, exemplaire, role) : un n° de série par
--  exemplaire ne demande donc aucune structure supplémentaire.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE saisie
  ADD COLUMN commentaire  text,
  ADD COLUMN numero_serie text;

COMMENT ON COLUMN saisie.commentaire IS
  'Texte libre de l''opérateur sur cette ligne, restitué en bulle. Explique un '
  'écart ou une réserve que le type du point ne permet pas d''exprimer.';

COMMENT ON COLUMN saisie.numero_serie IS
  'N° de série de l''exemplaire, en complément du n° de lot — jamais à sa place. '
  'Renseigné quand le point porte le drapeau numeroSerie.';

-- Le trigger d'audit de `saisie` existe depuis 001 et sérialise la ligne
-- entière : commentaires et n° de série sont donc tracés, avec leur auteur.
