-- =============================================================================
--  Type de point « fichier » — un document téléversé n'est pas une photo
--
--  Le module ne connaissait que `photo` : prendre un cliché ou joindre un
--  certificat passaient par le même point, la même liste de formats et le même
--  rendu en vignette. Ce sont deux gestes différents — l'un se fait à la
--  webcam devant la cuve, l'autre en reprenant un PDF reçu du fabricant — et
--  le second ne s'affiche pas en miniature.
--
--  Ce fichier ne contient QUE l'ajout de la valeur. `ALTER TYPE ... ADD VALUE`
--  est permis dans une transaction depuis PostgreSQL 12, à condition que la
--  nouvelle valeur ne soit pas UTILISÉE dans la même transaction. La
--  contrainte qui va avec (plafond de taille) vit donc dans la migration
--  suivante — les regrouper ferait échouer les deux.
-- =============================================================================

SET search_path TO mti, public;

ALTER TYPE type_point ADD VALUE IF NOT EXISTS 'fichier';
