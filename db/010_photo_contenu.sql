-- =============================================================================
--  La pièce jointe porte son contenu.
--
--  `piece_jointe` existait depuis le schéma initial, avec une colonne `chemin`
--  NOT NULL décrite comme « volume CapRover ou objet S3 ». Ni l'un ni l'autre
--  n'a été mis en place, et la table est restée vide : la cellule « photo » du
--  parcours ne faisait que cocher un pictogramme. Une traçabilité qui affiche
--  ✅ sans qu'aucune image existe est pire que pas de photo du tout — elle
--  atteste de quelque chose qui n'a pas été fait.
--
--  Le contenu est donc rangé EN BASE, en `bytea`. Deux raisons, dans cet ordre :
--
--  1. Le conteneur CapRover est éphémère. Un fichier écrit sur son disque
--     disparaît au redéploiement, alors que la ligne `piece_jointe` qui le
--     référence, elle, survit — on obtiendrait une pièce déclarée et
--     introuvable, exactement le défaut qu'on cherche à corriger.
--  2. La pièce suit la sauvegarde et la restauration du dossier sans procédure
--     séparée, et le journal d'audit couvre son dépôt comme le reste.
--
--  Le prix est connu : la base grossit, et une photo n'a pas à être relue à
--  chaque affichage de la liste (les routes ne renvoient jamais `contenu` avec
--  les métadonnées — il faut le demander par son URL). Si le volume devient un
--  sujet, `chemin` reste là pour basculer vers un stockage objet sans toucher
--  au reste : c'est pourquoi il devient facultatif plutôt que d'être supprimé.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE mti.piece_jointe
  ADD COLUMN IF NOT EXISTS contenu bytea;

ALTER TABLE mti.piece_jointe
  ALTER COLUMN chemin DROP NOT NULL;

/* Une pièce sans contenu NI chemin est une pièce déclarée qu'on ne peut pas
   servir : la contrainte refuse d'en créer. */
ALTER TABLE mti.piece_jointe
  DROP CONSTRAINT IF EXISTS piece_jointe_contenu_ou_chemin;
ALTER TABLE mti.piece_jointe
  ADD CONSTRAINT piece_jointe_contenu_ou_chemin
  CHECK (contenu IS NOT NULL OR chemin IS NOT NULL);

/* Plafond à 8 Mio. Le front réduit déjà les images avant l'envoi (côté long
   ramené à 1600 px, JPEG) : une photo de conteneur pèse alors 200 à 400 Kio.
   Le plafond n'est pas là pour le cas normal, il est là pour qu'un envoi
   aberrant soit refusé par la BASE et pas seulement par l'API — c'est la
   dernière ligne, celle qui tient même si une route oublie de vérifier. */
ALTER TABLE mti.piece_jointe
  DROP CONSTRAINT IF EXISTS piece_jointe_taille_plafond;
ALTER TABLE mti.piece_jointe
  ADD CONSTRAINT piece_jointe_taille_plafond
  CHECK (taille <= 8 * 1024 * 1024);

/* La taille annoncée doit être celle du contenu réellement stocké : sans cela
   une pièce pourrait déclarer 12 octets et en porter 4 Mio, et le plafond
   ci-dessus ne protégerait rien. */
ALTER TABLE mti.piece_jointe
  DROP CONSTRAINT IF EXISTS piece_jointe_taille_exacte;
ALTER TABLE mti.piece_jointe
  ADD CONSTRAINT piece_jointe_taille_exacte
  CHECK (contenu IS NULL OR taille = length(contenu));

COMMENT ON COLUMN mti.piece_jointe.contenu IS
  'Octets de la pièce. NULL si elle est rangée hors base, auquel cas `chemin` la localise.';
COMMENT ON COLUMN mti.piece_jointe.chemin IS
  'Localisation hors base (volume, objet S3). NULL quand le contenu est en base.';
