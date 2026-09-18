-- =============================================================================
--  Statistiques d'activité
--
--  QUANTITATIVES — décision du 18 septembre. Combien de dossiers ouverts,
--  validés, clos ; par mois, par parcours, par produit, par service.
--
--  CE QUE CE CHOIX ÉCARTE, et c'est une bonne chose à ce stade : le taux de
--  non-conformité. Il était piégé — la conformité automatique ne prononce
--  jamais une non-conformité, elle se contente de constater le vert ou de
--  refuser de conclure. Un indicateur « taux de NC » aurait donc compté des
--  jugements pharmaceutiques en les présentant comme des constats de la
--  machine. Mieux vaut ne pas le tracer que le tracer mal.
--
--  PAS DE VENTILATION PAR SERVICE, et ce n'est pas un oubli : `mti.dossier` ne
--  porte aucun service. Le référentiel des UF existe, mais rien ne rattache un
--  dossier à l'une d'elles — le service prescripteur n'est pas une donnée du
--  module aujourd'hui. Produire cette colonne obligerait à la deviner, et une
--  statistique devinée est pire qu'une statistique absente. C'est le seul
--  découpage demandé qui manque, et il demande d'abord une décision : quel
--  service compte, celui qui prescrit ou celui qui administre ?
--
--  UN DOSSIER EST COMPTÉ DANS UN SEUL ÉTAT, celui d'aujourd'hui, au mois de
--  sa CRÉATION. C'est un décompte d'activité — « ce qui a été ouvert en mars,
--  et où cela en est » — et non un flux d'événements. L'alternative aurait été
--  de compter chaque dossier au mois de chaque transition, ce qui donne des
--  totaux mensuels supérieurs au nombre de dossiers et se lit mal.
-- =============================================================================

SET search_path TO mti, public;

CREATE OR REPLACE FUNCTION mti.statistiques_activite (
  p_depuis date DEFAULT NULL,
  p_jusqu_a date DEFAULT NULL
)
RETURNS TABLE (
  mois          date,
  code_modele   text,
  parcours      text,
  produit       text,
  en_cours      bigint,
  valides       bigint,
  clos          bigint,
  total         bigint
)
LANGUAGE sql STABLE SET search_path = mti, pg_temp AS $$
  SELECT date_trunc('month', d.cree_le)::date,
         m.code,
         m.libelle,
         coalesce(d.designation_produit, pr.denomination, '(produit non renseigné)'),
         count(*) FILTER (WHERE d.statut NOT IN ('valide', 'annule')),
         count(*) FILTER (WHERE d.statut = 'valide'),
         count(*) FILTER (WHERE d.statut = 'annule'),
         count(*)
    FROM mti.dossier d
    JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
    LEFT JOIN mti.produit pr ON pr.id = d.produit_id
   WHERE (p_depuis  IS NULL OR d.cree_le >= p_depuis)
     AND (p_jusqu_a IS NULL OR d.cree_le < (p_jusqu_a + 1))
   GROUP BY 1, 2, 3, 4
$$;

COMMENT ON FUNCTION mti.statistiques_activite (date, date) IS
  'Décompte d''activité : dossiers par mois de création, parcours et produit, '
  'ventilés par état actuel. Un dossier compte une seule fois.';

GRANT EXECUTE ON FUNCTION mti.statistiques_activite (date, date) TO mti_app;

/* L'index porte sur la date de création : c'est par elle que la fonction
   regroupe et filtre, et le tableau de bord la lit déjà. Sans lui, un
   établissement à quelques milliers de dossiers relirait la table entière à
   chaque ouverture de l'onglet. */
CREATE INDEX IF NOT EXISTS dossier_cree_le_idx ON dossier (cree_le);
