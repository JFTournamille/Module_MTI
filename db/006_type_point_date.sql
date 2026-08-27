-- =============================================================================
--  Type de point « date »
--
--  Le processus de commande MTI porte des jalons calendaires : date d'aphérèse,
--  date de lymphodéplétion, date de réception prévue du produit. Les saisir en
--  texte libre les rendrait inexploitables — impossible de trier, de comparer,
--  ni de signaler une réception prévue dépassée.
--
--  La valeur est stockée dans `saisie.valeur_texte` au format ISO (AAAA-MM-JJ),
--  comme le rend un <input type="date">. Pas de colonne dédiée : le type du
--  point dit déjà comment lire la valeur, et une colonne de plus dans une table
--  de saisies déjà large ne se justifie pas.
--
--  `ALTER TYPE ... ADD VALUE` est permis dans une transaction depuis
--  PostgreSQL 12, à condition que la nouvelle valeur ne soit pas utilisée dans
--  la même transaction — ce qui est le cas ici. migrer.js encapsulant chaque
--  fichier, cette migration doit rester seule à faire ce changement.
-- =============================================================================

SET search_path TO mti, public;

ALTER TYPE type_point ADD VALUE IF NOT EXISTS 'date';
