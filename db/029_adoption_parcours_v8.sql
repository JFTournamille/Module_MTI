-- =============================================================================
--  Adoption du parcours CAR-T v8 au déploiement
--
--  Demandé le 18 septembre : que la v8 passe en service sans qu'il faille se
--  souvenir de lancer `seed --adopter` à la main, et que le jeu de
--  démonstration se refasse dessus.
--
--  POURQUOI CETTE MIGRATION NE FAIT QUE POSER UNE DEMANDE, et n'active rien
--  elle-même. Elle le pourrait, en une ligne d'UPDATE — mais elle serait
--  fausse une fois sur deux. L'ordre de déploiement est `migrer` puis `seed` :
--  au moment où cette migration s'applique, la v8 N'EST PAS ENCORE EN BASE,
--  c'est le seed qui la charge depuis `shared/`. Un UPDATE ici ne trouverait
--  rien sur une instance à jour, et n'aurait donc aucun effet là où il est
--  justement attendu. Inverser l'ordre ne règle rien : sur une base neuve,
--  c'est le schéma qui doit exister avant le seed.
--
--  La migration enregistre donc l'INTENTION — un fait daté, versionné,
--  rejouable à l'identique sur chaque environnement — et le seed, qui est le
--  seul à connaître les versions du dépôt, l'exécute. Il efface la demande
--  après coup : c'est un geste unique, pas un réglage permanent.
--
--  CE QUE CELA NE CONTOURNE PAS. Le seed refuse normalement de démonter une
--  version publiée depuis l'application — « le fichier amorce, l'application
--  fait autorité ensuite », pour qu'un établissement arrivé à la v141 ne soit
--  pas ramené à la v8 au redéploiement suivant, sans un mot. Cette demande est
--  l'exception explicite à cette règle, et c'est ce qui la rend acceptable :
--  elle est écrite, datée, limitée à UNE version, et elle ne se rejoue pas.
--  Les versions publiées depuis l'écran restent en base, consultables, et les
--  dossiers qui les référencent restent lisibles.
--
--  LE JEU DE DÉMONSTRATION SUIT TOUT SEUL. `seed-demo` compare le modèle de
--  chaque dossier fictif à celui EN SERVICE et refait ceux qui ont divergé :
--  une fois la v8 adoptée, le prochain `npm run seed:demo` les reconstruit
--  dessus, sans `--regenerer` et sans qu'aucun dossier réel soit touché.
-- =============================================================================

SET search_path TO mti, public;

INSERT INTO parametre (cle, valeur, libelle) VALUES
  ('parcours.adoption_demandee', 'PARCOURS_CART_AUTOLOGUE:8',
   'Version de parcours à remettre en service au prochain seed, puis à oublier. '
   'Format « CODE:version ». Vidée par le seed une fois l''adoption faite.')
ON CONFLICT (cle) DO UPDATE SET
  valeur = EXCLUDED.valeur,
  libelle = EXCLUDED.libelle,
  modifie_le = now();
