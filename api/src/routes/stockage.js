import { requete, transaction } from '../db.js'
import { reserverEmplacement, refusDeReservation } from '../stockage.js'

/**
 * Emplacements de stockage : le référentiel, et leur réservation.
 *
 * Une cuve d'azote, des étages A à J, des emplacements 1 à 20. Un point de
 * contrôle de type « emplacement » propose les places libres et réserve celle
 * qu'on choisit.
 *
 * CE QUI ARBITRE EST EN BASE, pas ici. L'index partiel
 * `emplacement_occupe_unique` est le seul juge de qui occupe quoi : la liste
 * des places libres que ces routes renvoient n'est qu'un instantané, et entre
 * son affichage et le choix de l'opérateur une autre réception peut avoir pris
 * la même cassette. Ces routes traduisent le refus de la base en message
 * lisible, elles ne le remplacent pas.
 *
 * UN CONTENANT NE SE SUPPRIME PAS une fois qu'il a servi : les occupations
 * passées disent où était un MTI à une date donnée, et c'est précisément ce
 * qu'un inventaire doit pouvoir relire. Il se désactive.
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
              e.nb_places, e.nb_actives, o.nb_occupees
         FROM mti.contenant c
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS nb_places,
                  count(*) FILTER (WHERE em.actif)::int AS nb_actives
             FROM mti.emplacement em WHERE em.contenant_id = c.id
         ) e ON true
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS nb_occupees
             FROM mti.emplacement em
             JOIN mti.occupation_emplacement oc
               ON oc.emplacement_id = em.id AND oc.libere_le IS NULL
            WHERE em.contenant_id = c.id
         ) o ON true
        ${inactifs ? '' : 'WHERE c.actif'}
        ORDER BY c.code`)
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      libelle: r.libelle,
      genre: r.genre,
      actif: r.actif,
      nbPlaces: r.nb_places ?? 0,
      nbActives: r.nb_actives ?? 0,
      nbOccupees: r.nb_occupees ?? 0,
      /* Le nombre de places LIBRES est calculé ici et non demandé au client :
         « actives moins occupées » est une règle, et une règle recopiée dans
         le navigateur finit par diverger de celle du serveur. */
      nbLibres: Math.max(0, (r.nb_actives ?? 0) - (r.nb_occupees ?? 0))
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
   * Places d'un contenant, avec leur état.
   *
   * `?libres=oui` ne renvoie que ce qui est prenable — mais garde la place
   * DÉJÀ tenue par le dossier passé en `dossier`, sans quoi rouvrir une fiche
   * ferait disparaître du menu l'emplacement qu'elle occupe, et l'opérateur
   * croirait sa saisie perdue.
   */
  app.get('/api/contenants/:id/emplacements', async (request) => {
    /* Les expirées sont libérées AVANT la lecture : afficher comme occupée une
       place que la prochaine réservation va libérer ferait chercher ailleurs
       pour rien. */
    await transaction(request.utilisateur.id, request.ip, (client) =>
      client.query('SELECT mti.liberer_occupations_expirees()'))

    const { rows } = await requete(
      'SELECT * FROM mti.emplacements_etat($1)', [request.params.id])
    const libres = request.query.libres === 'oui'
    const dossier = String(request.query.dossier ?? '') || null

    return rows
      .filter((r) => !libres || (r.actif && (!r.occupation_id || r.dossier_id === dossier)))
      .map((r) => ({
        id: r.emplacement_id,
        contenantId: r.contenant_id,
        contenant: r.contenant,
        etage: r.etage,
        numero: r.numero,
        libelle: r.libelle,
        actif: r.actif,
        horsServiceMotif: r.hors_service_motif,
        occupation: r.occupation_id
          ? {
              id: r.occupation_id,
              dossierId: r.dossier_id,
              dossier: r.dossier,
              exemplaire: r.exemplaire,
              secours: r.secours,
              poseLe: r.pose_le,
              expireLe: r.expire_le
            }
          : null
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
      if (!actif) {
        /* Mettre hors service une place OCCUPÉE ferait disparaître un MTI de
           l'inventaire sans que rien ne le déplace. La libérer d'abord est un
           geste distinct, et volontaire. */
        const { rows: occ } = await client.query(
          `SELECT 1 FROM mti.occupation_emplacement
            WHERE emplacement_id = $1 AND libere_le IS NULL`, [request.params.id])
        if (occ.length) return { occupee: true }
      }
      const { rows } = await client.query(
        `UPDATE mti.emplacement
            SET actif = $2, hors_service_motif = CASE WHEN $2 THEN NULL ELSE $3 END
          WHERE id = $1 RETURNING id, actif, hors_service_motif`,
        [request.params.id, actif, motif || null])
      return { emplacement: rows[0] ?? null }
    })
    if (r.occupee) {
      return reply.code(409).send({
        erreur: 'Cet emplacement est occupé : le libérer avant de le mettre hors service.'
      })
    }
    if (!r.emplacement) return reply.code(404).send({ erreur: 'Emplacement introuvable.' })
    return r.emplacement
  })

  // ── Occupation ────────────────────────────────────────────────────────────

  /** Places tenues par un dossier, en vigueur et passées. */
  app.get('/api/dossiers/:id/emplacements', async (request) => {
    const { rows } = await requete(
      `SELECT o.id, o.exemplaire, o.secours, o.pose_le, o.expire_le,
              o.libere_le, o.motif_liberation,
              format('%s-%s-%s', c.code, e.etage, lpad(e.numero::text, 2, '0')) AS libelle,
              c.libelle AS contenant, e.etage, e.numero,
              btrim(concat_ws(' ', up.titre, up.prenom, up.nom)) AS pose_par,
              btrim(concat_ws(' ', ul.titre, ul.prenom, ul.nom)) AS libere_par
         FROM mti.occupation_emplacement o
         JOIN mti.emplacement e ON e.id = o.emplacement_id
         JOIN mti.contenant c ON c.id = e.contenant_id
         LEFT JOIN mti.utilisateur up ON up.id = o.pose_par
         LEFT JOIN mti.utilisateur ul ON ul.id = o.libere_par
        WHERE o.dossier_id = $1
        ORDER BY o.pose_le DESC`,
      [request.params.id])
    return rows
  })

  app.post('/api/emplacements/:id/reserver', async (request, reply) => {
    const dossierId = String(request.body?.dossierId ?? '').trim()
    if (!dossierId) return reply.code(400).send({ erreur: 'dossierId attendu.' })
    const exemplaire = Number(request.body?.exemplaire ?? 1)
    if (!Number.isInteger(exemplaire) || exemplaire < 1) {
      return reply.code(400).send({ erreur: 'exemplaire doit être un entier positif.' })
    }

    const r = await transaction(request.utilisateur.id, request.ip, (client) =>
      reserverEmplacement(client, {
        emplacementId: request.params.id,
        dossierId,
        processusId: request.body?.processusId ?? null,
        exemplaire,
        secours: request.body?.secours === true,
        utilisateurId: request.utilisateur.id
      }))

    const refus = refusDeReservation(r)
    if (refus) return reply.code(refus.statut).send(refus.corps)
    return { occupation: r.occupation, inchange: r.inchange === true }
  })

  app.post('/api/occupations/:id/liberer', async (request, reply) => {
    const motif = String(request.body?.motif ?? '').trim()
    if (!motif) {
      return reply.code(400).send({
        erreur: 'Une libération dit pourquoi : motif attendu.'
      })
    }
    const r = await transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `UPDATE mti.occupation_emplacement
            SET libere_le = now(), libere_par = $2, motif_liberation = $3
          WHERE id = $1 AND libere_le IS NULL
          RETURNING id`,
        [request.params.id, request.utilisateur.id, motif])
      return rows[0] ?? null
    })
    if (!r) {
      return reply.code(409).send({
        erreur: 'Occupation introuvable ou déjà libérée.'
      })
    }
    return { libere: r.id }
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

    /* Le délai d'expiration est borné : à zéro, toute réservation serait
       expirée d'avance et la cuve paraîtrait vide en permanence. */
    if (request.params.cle === 'emplacement.expiration_heures') {
      const n = Number(valeur)
      if (!Number.isFinite(n) || n < 1 || n > 24 * 365) {
        return reply.code(400).send({
          erreur: 'Le délai d\'expiration est un nombre d\'heures de 1 à 8760.'
        })
      }
    }

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
