-- =============================================================================
--  Le plafond des pièces jointes, relevé pour les documents
--
--  8 Mio suffisaient à une photo prise au téléphone. Un certificat de
--  conformité en PDF les dépasse vite — un document signé électroniquement,
--  scanné en couleur, atteint couramment 10 à 15 Mio — et le refus tombait
--  alors sur le fichier que la traçabilité réclame le plus.
--
--  20 Mio, et pas davantage : le contenu vit en base (le conteneur est
--  éphémère), il passe donc par le dump, la réplication et la mémoire du
--  serveur. Le plafond n'est pas là pour le cas normal, il est là pour qu'un
--  envoi aberrant échoue tôt plutôt que de saturer la base.
--
--  Un plafond unique, volontairement, plutôt qu'un par genre de pièce : deux
--  seuils auraient demandé de savoir, en base, si une pièce est une photo ou
--  un document — information qui vit déjà dans `saisie.point_type`, et qu'une
--  contrainte devrait aller y chercher par jointure. Le tri des formats
--  acceptés se fait dans la route, où il est lisible.
-- =============================================================================

SET search_path TO mti, public;

ALTER TABLE piece_jointe
  DROP CONSTRAINT IF EXISTS piece_jointe_taille_plafond;
ALTER TABLE piece_jointe
  ADD CONSTRAINT piece_jointe_taille_plafond
  CHECK (taille <= 20 * 1024 * 1024);

COMMENT ON CONSTRAINT piece_jointe_taille_plafond ON piece_jointe IS
  '20 Mio. Relevé de 8 Mio pour les certificats de conformité en PDF, que le '
  'plafond précédent refusait.';
