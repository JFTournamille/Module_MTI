import { requete, transaction } from '../db.js'

/* Types de points reconnus, alignés sur l'enum `mti.type_point`. Dupliqué ici
   à dessein : accepter un type que la base refusera ensuite à l'écriture d'une
   saisie produirait un modèle publié mais insaisissable. */
const TYPES_POINT = ['ouinon', 'valeur', 'photo', 'timer', 'texte', 'auto', 'date']

/** Modèles de parcours et catalogue de processus. */
export default async function referentiels (app) {
  app.get('/api/modeles/:code', async (request, reply) => {
    const { rows } = await requete(
      `SELECT code, version, libelle, definition
         FROM mti.modele_parcours
        WHERE code = $1 AND actif
        LIMIT 1`,
      [request.params.code]
    )
    if (!rows.length) {
      return reply.code(404).send({ erreur: `Aucun modèle actif pour le code ${request.params.code}` })
    }
    // La définition versionnée est renvoyée telle quelle : le front n'a pas à
    // connaître la structure du stockage.
    return { ...rows[0].definition, code: rows[0].code, version: rows[0].version }
  })

  /**
   * Produits de référence.
   *
   * Sert au filtre du tableau de bord et au choix du produit à la création d'un
   * dossier. Les inactifs sont exclus : un produit retiré du référentiel ne doit
   * pas être proposé, mais les dossiers qui le portent restent lisibles.
   */
  app.get('/api/produits', async () => {
    const { rows } = await requete(
      `SELECT id, denomination, dci, laboratoire, seuil_temp_c
         FROM mti.produit WHERE actif ORDER BY denomination`)
    return rows.map((r) => ({
      id: r.id,
      denomination: r.denomination,
      dci: r.dci,
      laboratoire: r.laboratoire,
      seuilTempC: r.seuil_temp_c === null ? null : Number(r.seuil_temp_c)
    }))
  })

  /** Modèles de parcours disponibles, pour le choix à la création. */
  app.get('/api/modeles', async () => {
    const { rows } = await requete(
      `SELECT code, version, libelle,
              jsonb_array_length(coalesce(definition->'processus', '[]'::jsonb)) AS nb_processus
         FROM mti.modele_parcours WHERE actif ORDER BY libelle`)
    return rows.map((r) => ({
      code: r.code, version: r.version, libelle: r.libelle, nbProcessus: r.nb_processus
    }))
  })

  app.get('/api/catalogue', async () => {
    const { rows } = await requete(
      `SELECT definition FROM mti.catalogue_processus
        WHERE actif ORDER BY version DESC LIMIT 1`
    )
    return rows.length ? rows[0].definition : { groupes: [] }
  })
  /**
   * Détail d'une VERSION précise d'un modèle, active ou non.
   *
   * L'onglet Configuration doit pouvoir relire une version retirée du service :
   * c'est ce qui permet de comprendre ce que porte un dossier ouvert sous elle.
   */
  app.get('/api/modeles/:code/versions', async (request) => {
    const { rows } = await requete(
      `SELECT version, libelle, actif, publie_le, cree_le,
              jsonb_array_length(coalesce(definition->'processus', '[]'::jsonb)) AS nb_processus,
              (SELECT count(*)::int FROM mti.dossier d
                 JOIN mti.modele_parcours m2 ON m2.id = d.modele_parcours_id
                WHERE m2.code = m.code AND m2.version = m.version) AS nb_dossiers
         FROM mti.modele_parcours m
        WHERE code = $1
        ORDER BY version DESC`,
      [request.params.code])
    return rows.map((r) => ({
      version: r.version,
      libelle: r.libelle,
      actif: r.actif,
      publieLe: r.publie_le,
      creeLe: r.cree_le,
      nbProcessus: r.nb_processus,
      /* Le nombre de dossiers ouverts sous cette version : c'est ce qui dit à
         l'utilisateur ce qu'il ne changera PAS en publiant une nouvelle
         version. Sans ce chiffre, « publier » a l'air d'une modification
         rétroactive, ce qu'il n'est justement pas. */
      nbDossiers: r.nb_dossiers
    }))
  })

  app.get('/api/modeles/:code/versions/:version', async (request, reply) => {
    const v = Number(request.params.version)
    if (!Number.isInteger(v) || v < 1) {
      return reply.code(400).send({ erreur: 'Version invalide.' })
    }
    const { rows } = await requete(
      `SELECT code, version, libelle, actif, definition
         FROM mti.modele_parcours WHERE code = $1 AND version = $2`,
      [request.params.code, v])
    if (!rows.length) return reply.code(404).send({ erreur: 'Version introuvable.' })
    return {
      ...rows[0].definition,
      code: rows[0].code,
      version: rows[0].version,
      actif: rows[0].actif
    }
  })

  /**
   * Publie une NOUVELLE VERSION du modèle, et la rend active.
   *
   * C'est le point dur de l'onglet Configuration, et la raison pour laquelle il
   * n'y a pas de route de modification. Un modèle ne se corrige pas sur place :
   *
   *   - `dossier_processus.definition` porte une COPIE de la définition, figée à
   *     la création du dossier. Modifier le modèle actif ne toucherait donc pas
   *     aux dossiers ouverts — mais laisserait croire le contraire, et
   *     surtout ferait perdre la trace de ce qui a été appliqué à quel dossier ;
   *   - une exigence BPP : ce qui a été contrôlé doit rester relisible tel qu'il
   *     a été prescrit au moment du contrôle.
   *
   * Chaque enregistrement crée donc `version + 1`, active la nouvelle et retire
   * l'ancienne du service. L'ancienne reste en base, consultable.
   */
  app.post('/api/modeles/:code/versions', async (request, reply) => {
    const corps = request.body ?? {}
    const definition = corps.definition
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      return reply.code(400).send({ erreur: 'definition attendue (objet).' })
    }
    if (!Array.isArray(definition.processus) || definition.processus.length === 0) {
      return reply.code(400).send({ erreur: 'La définition doit porter au moins un processus.' })
    }

    /* Validation de forme avant écriture. Une définition acceptée puis illisible
       à l'ouverture d'un dossier serait bien pire qu'un refus : elle ne se
       manifesterait qu'au moment de la saisie, dossier par dossier. */
    const erreurs = []
    const codesVus = new Set()
    definition.processus.forEach((p, i) => {
      const ou = `processus ${i + 1}`
      if (!p || typeof p !== 'object') { erreurs.push(`${ou} : objet attendu`); return }
      if (!String(p.code ?? '').trim()) erreurs.push(`${ou} : code manquant`)
      if (!String(p.nom ?? '').trim()) erreurs.push(`${ou} : nom manquant`)
      if (p.code) {
        if (codesVus.has(p.code)) erreurs.push(`${ou} : code « ${p.code} » en double`)
        codesVus.add(p.code)
      }
      if (p.gabarit !== undefined && !['standard', 'reception'].includes(p.gabarit)) {
        erreurs.push(`${ou} : gabarit inconnu « ${p.gabarit} »`)
      }
      const sections = p.sections
      if (!Array.isArray(sections) || sections.length === 0) {
        erreurs.push(`${ou} : au moins une section attendue`)
        return
      }
      sections.forEach((sc, j) => {
        const ouSc = `${ou}, section ${j + 1}`
        if (!String(sc?.titre ?? '').trim()) erreurs.push(`${ouSc} : titre manquant`)
        if (!Array.isArray(sc?.points) || sc.points.length === 0) {
          erreurs.push(`${ouSc} : au moins un point attendu`)
          return
        }
        const idsKits = new Set((Array.isArray(sc.kits) ? sc.kits : []).map((k) => k?.id))
        sc.points.forEach((pt, k) => {
          const ouPt = `${ouSc}, point ${k + 1}`
          if (!String(pt?.libelle ?? '').trim()) erreurs.push(`${ouPt} : libellé manquant`)
          if (!TYPES_POINT.includes(pt?.type)) {
            erreurs.push(`${ouPt} : type inconnu « ${pt?.type} »`)
          }
          if (pt?.seuil !== undefined && pt.seuil !== null && !Number.isFinite(Number(pt.seuil))) {
            erreurs.push(`${ouPt} : seuil non numérique`)
          }
          /* Un seuil n'a de sens que sur un relevé de valeur : posé sur un
             oui/non il ne déclencherait jamais rien, et l'utilisateur croirait
             son alarme armée. */
          if (pt?.seuil !== undefined && pt.seuil !== null && pt.type !== 'valeur') {
            erreurs.push(`${ouPt} : un seuil ne s'applique qu'à un point de type « valeur »`)
          }
          if (pt?.exemplaires !== undefined && pt.exemplaires !== null) {
            const n = Number(pt.exemplaires)
            if (!Number.isInteger(n) || n < 1 || n > 12) {
              erreurs.push(`${ouPt} : exemplaires doit être un entier de 1 à 12`)
            }
          }
          // Un n° de série se porte PAR exemplaire : sans exemplaires, il n'a
          // rien à identifier.
          if (pt?.numeroSerie === true && !(Number(pt.exemplaires) > 1 || pt.multi)) {
            erreurs.push(`${ouPt} : un n° de série suppose plusieurs exemplaires`)
          }
          if (pt?.kit && !idsKits.has(pt.kit)) {
            erreurs.push(`${ouPt} : kit « ${pt.kit} » absent de la section`)
          }
        })
      })
    })
    if (erreurs.length) {
      return reply.code(400).send({
        erreur: `Définition refusée : ${erreurs.slice(0, 6).join(' ; ')}` +
          (erreurs.length > 6 ? ` (et ${erreurs.length - 6} autre(s))` : '')
      })
    }

    /* L'index d'identification patient est un RANG : il se décale dès qu'un
       processus est inséré ou retiré en amont. Le recalculer d'après le code du
       processus concerné plutôt que de le recopier évite exactement le défaut
       qu'a produit le retrait de l'aphérèse en v3. */
    const iFab = definition.processus.findIndex((p) => p.code === 'MISE_EN_FABRICATION')
    const dansLeParcours = iFab >= 0
    const definitionFinale = {
      ...definition,
      ...(dansLeParcours ? { indexIdentificationPatient: iFab } : {})
    }
    if (!dansLeParcours && definition.indexIdentificationPatient !== undefined) {
      const n = Number(definition.indexIdentificationPatient)
      if (!Number.isInteger(n) || n < 0 || n > definition.processus.length) {
        return reply.code(400).send({
          erreur: 'indexIdentificationPatient hors du parcours, et MISE_EN_FABRICATION absent.'
        })
      }
    }

    const resultat = await transaction(
      request.utilisateur.id, request.ip,
      async (client) => {
        const { rows: actuel } = await client.query(
          `SELECT max(version) AS v, max(libelle) AS libelle
             FROM mti.modele_parcours WHERE code = $1`,
          [request.params.code])
        if (!actuel[0]?.v) return { inconnu: true }

        const nouvelle = Number(actuel[0].v) + 1
        const libelle = String(corps.libelle ?? '').trim() || actuel[0].libelle

        /* Désactiver AVANT d'insérer : l'index partiel
           `modele_parcours_actif_unique` n'autorise qu'une version active par
           code, et l'ordre inverse échouerait. */
        await client.query(
          'UPDATE mti.modele_parcours SET actif = false WHERE code = $1 AND actif',
          [request.params.code])

        const { rows } = await client.query(
          `INSERT INTO mti.modele_parcours
             (code, version, libelle, definition, actif, publie_le)
           VALUES ($1, $2, $3, $4::jsonb, true, now())
           RETURNING version, libelle, publie_le`,
          [request.params.code, nouvelle, libelle,
            JSON.stringify({ ...definitionFinale, code: request.params.code, version: nouvelle })])
        return rows[0]
      })

    if (resultat?.inconnu) {
      return reply.code(404).send({ erreur: `Aucun modèle pour le code ${request.params.code}.` })
    }
    return reply.code(201).send({
      code: request.params.code,
      version: resultat.version,
      libelle: resultat.libelle,
      publieLe: resultat.publie_le,
      nbProcessus: definition.processus.length,
      indexIdentificationPatient: definitionFinale.indexIdentificationPatient ?? null
    })
  })

}
