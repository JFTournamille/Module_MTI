-- =============================================================================
--  Type de point « emplacement »
--
--  Un point qui ne relève pas une valeur mais RÉSERVE une place physique : la
--  cassette où le MTI va être posé dans la cuve d'azote.
--
--  SEUL DANS SON FICHIER, et ce n'est pas une préférence de rangement.
--  `ALTER TYPE ... ADD VALUE` est autorisé dans une transaction depuis
--  PostgreSQL 12, mais à la condition que la nouvelle valeur ne soit pas
--  UTILISÉE dans cette même transaction. Le migrateur enveloppe chaque fichier
--  dans une transaction : y ajouter la moindre ligne qui mentionne
--  « emplacement » ferait échouer la migration. La suite est en 025.
-- =============================================================================

SET search_path TO mti, public;

ALTER TYPE type_point ADD VALUE IF NOT EXISTS 'emplacement';
