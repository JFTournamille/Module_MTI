import { requete, transaction } from '../db.js'

/**
 * Emplacements de stockage : le référentiel des places.
 *
 * Une cuve d'azote, des étages A à J, des emplacements 1 à 20. Un point de
 * contrôle de type « emplacement » propose ces places, et le relevé CONSTATE
 * celle où le MTI a été posé.
 *
 * IL N'Y A PLUS DE RÉSERVATION — décision du 18 septembre. Ni disponibilité,
 * ni délai. Ce référentiel décrit des places ; c'est la SAISIE qui dit où un
 * MTI se trouve, par qui et à quelle heure, et elle seule est figée par la
 * validation du dossier. Doubler cette information d'une table d'occupation
 * aurait donné deux sources dont une seule fait foi.
 *
 * Ce que cela coûte, et qui est assumé : rien n'empêche deux dossiers de
 * désigner la même cassette. Si cela devient un problème à l'usage, ce qu'il
 * faudra rétablir est une contrainte d'unicité, pas une réservation à durée
 * limitée.
 *
 * UN CONTENANT NE SE SUPPRIME PAS une fois qu'il a servi : les dossiers qui
 * citent ses places doivent rester lisibles. Il se désactive.
 */
export default async function stockage (app) {
  /** Bornes de la géométrie d'un contenant. Larges, mais pas infinies : une
   *  faute de frappe à 10 000 emplacements remplirait la table sans rien
   *  signaler. */
  const MAX_ETAGES = 60
  const MAX_PAR_ETAGE = 200

  // ── Référentiel ───────────────────────────────────────────────────────────

  app.get('/api/contenants', async (request) => {
    const inactifs = request.query.inactifs === 'oui'
    const { rows } = await requete(
      `SELECT c.id, c.code, c.libelle, c.genre, c.actif, c.cree_le,
              e.nb_places, e.nb_actives
         FROM mti.contenant c
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS nb_places,
                  count(*) FILTER (WHERE em.actif)::int AS nb_actives
             FROM mti.emplacement em WHERE em.contenant_id = c.id
         ) e ON true
        ${inactifs ? '' : 'WHERE c.actif'}
        ORDER BY c.code`)
    /* Places totales et places EN SERVICE, rien de plus : « occupées » et
       « libres » supposaient une réservation, qui n'existe plus. */
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      libelle: r.libelle,
      genre: r.genre,
      actif: r.actif,
      nbPlaces: r.nb_places ?? 0,
      nbActives: r.nb_actives ?? 0
    }))
  })

  app.post('/api/contenants', async (request, reply) => {
    const code = String(request.body?.code ?? '').trim().toUpperCase()
    const libelle = String(request.body?.libelle ?? '').trim()
    const genre = String(request.body?.genre ?? 'cuve').trim()
    const etages = request.body?.etages
    const parEtage = Number(request.body?.emplacementsParEtage)

    if (!code) return reply.code(400).send({ erreur: 'Code attendu.' })
    if (!libelle) return reply.code(400).send({ erreur: 'Libellé attendu.' })
    if (!['cuve', 'congelateur', 'enceinte'].includes(genre)) {
      return reply.code(400).send({ erreur: `Genre inconnu : ${genre}` })
    }
    if (!Array.isArray(etages) || etages.length === 0 || etages.length > MAX_ETAGES) {
      return reply.code(400).send({
        erreur: `Étages attendus : de 1 à ${MAX_ETAGES} étiquettes.`
      })
    }
    const etiquettes = etages.map((e) => String(e ?? '').trim()).filter(Boolean)
    if (etiquettes.length !== etages.length) {
      return reply.code(400).send({ erreur: 'Une étiquette d\'étage est vide.' })
    }
    if (new Set(etiquettes).size !== etiquettes.length) {
      return reply.code(400).send({ erreur: 'Deux étages portent la même étiquette.' })
    }
    if (!Number.isInteger(parEtage) || parEtage < 1 || parEtage > MAX_PAR_ETAGE) {
      return reply.code(400).send({
        erreur: `emplacementsParEtage doit être un entier de 1 à ${MAX_PAR_ETAGE}.`
      })
    }

    try {
      return await transaction(request.utilisateur.id, request.ip, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO mti.contenant (code, libelle, genre)
           VALUES ($1, $2, $3) RETURNING id, code, libelle, genre, actif`,
          [code, libelle, genre])
        const { rows: [{ creer_emplacements: crees }] } = await client.query(
          'SELECT mti.creer_emplacements($1, $2::text[], $3)',
          [rows[0].id, etiquettes, parEtage])
        return { ...rows[0], nbPlaces: crees }
      })
    } catch (e) {
      if (e.code === '23505') {
        return reply.code(409).send({ erreur: `Le code « ${code} » existe déjà.` })
      }
      throw e
    }
  })

  app.patch('/api/contenants/:id', async (request, reply) => {
    const champs = []
    const valeurs = []
    if (request.body?.libelle !== undefined) {
      const l = String(request.body.libelle).trim()
      if (!l) return reply.code(400).send({ erreur: 'Libellé vide.' })
      valeurs.push(l); champs.push(`libelle = $${valeurs.length + 1}`)
    }
    if (request.body?.actif !== undefined) {
      valeurs.push(request.body.actif === true); champs.push(`actif = $${valeurs.length + 1}`)
    }
    if (!champs.length) return reply.code(400).send({ erreur: 'Rien à modifier.' })

    const r = await transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `UPDATE mti.contenant SET ${champs.join(', ')}
          WHERE id = $1 RETURNING id, code, libelle, genre, actif`,
        [request.params.id, ...valeurs])
      return rows[0] ?? null
    })
    if (!r) return reply.code(404).send({ erreur: 'Contenant introuvable.' })
    return r
  })

  /**
   * Places d'un contenant.
   *
   * `?enService=oui` écarte celles qui sont sorties du service : c'est ce que
   * le menu de saisie propose, une place hors service ne devant pas pouvoir
   * être choisie. Il n'y a plus de filtre « libres » — une place n'est ni
   * libre ni occupée, elle existe et elle est en service ou non.
   */
  app.get('/api/contenants/:id/emplacements', async (request) => {
    const { rows } = await requete(
      'SELECT * FROM mti.emplacements_etat($1)', [request.params.id])
    const enServiceSeulement = request.query.enService === 'oui'

    return rows
      .filter((r) => !enServiceSeulement || r.actif)
      .map((r) => ({
        id: r.emplacement_id,
        contenantId: r.contenant_id,
        contenant: r.contenant,
        etage: r.etage,
        numero: r.numero,
        libelle: r.libelle,
        actif: r.actif,
        horsServiceMotif: r.hors_service_motif
      }))
  })

  /** Une place hors service dit pourquoi ; la remettre en service efface le motif. */
  app.patch('/api/emplacements/:id', async (request, reply) => {
    const actif = request.body?.actif === true
    const motif = String(request.body?.motif ?? '').trim()
    if (!actif && !motif) {
      return reply.code(400).send({
        erreur: 'Un emplacement hors service dit pourquoi : motif attendu.'
      })
    }
    const r = await transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `UPDATE mti.emplacement
            SET actif = $2, hors_service_motif = CASE WHEN $2 THEN NULL ELSE $3 END
          WHERE id = $1 RETURNING id, actif, hors_service_motif`,
        [request.params.id, actif, motif || null])
      return { emplacement: rows[0] ?? null }
    })
    if (!r.emplacement) return reply.code(404).send({ erreur: 'Emplacement introuvable.' })
    return r.emplacement
  })

  // ── Paramètres ────────────────────────────────────────────────────────────

  app.get('/api/parametres', async () => {
    const { rows } = await requete(
      'SELECT cle, valeur, libelle, modifie_le FROM mti.parametre ORDER BY cle')
    return rows
  })

  app.patch('/api/parametres/:cle', async (request, reply) => {
    const valeur = String(request.body?.valeur ?? '').trim()
    if (!valeur) return reply.code(400).send({ erreur: 'Valeur attendue.' })

    const r = await transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `UPDATE mti.parametre
            SET valeur = $2, modifie_le = now(), modifie_par = $3
          WHERE cle = $1 RETURNING cle, valeur, libelle, modifie_le`,
        [request.params.cle, valeur, request.utilisateur.id])
      return rows[0] ?? null
    })
    if (!r) return reply.code(404).send({ erreur: 'Paramètre inconnu.' })
    return r
  })
}
