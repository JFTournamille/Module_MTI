import { requete, transaction } from '../db.js'

/**
 * Référentiel des services (unités fonctionnelles).
 *
 * Un dossier MTI circule entre des services : celui qui prescrit, la PUI qui
 * réceptionne et prépare, celui qui administre. En texte libre, « hémato 4B »,
 * « Hématologie 4B » et « HEMATO4B » désignent la même unité sans qu'aucun
 * regroupement ne les rapproche.
 *
 * L'UF est la clé — c'est l'identifiant du SIH, celui des bons et de la
 * facturation. Le libellé change (fusion, renommage) et n'identifie rien.
 *
 * Un service ne se SUPPRIME pas, il se désactive : les dossiers qui le
 * référencent doivent rester lisibles, exactement comme pour les comptes
 * utilisateurs et les versions de parcours.
 */
export default async function services (app) {
  app.get('/api/services', async (request) => {
    const inactifs = request.query.inactifs === 'oui'
    const q = String(request.query.q ?? '').trim()
    const params = []
    const conditions = []
    if (!inactifs) conditions.push('actif')
    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(uf ILIKE $${params.length} OR libelle ILIKE $${params.length}
                        OR coalesce(pole, '') ILIKE $${params.length})`)
    }
    const { rows } = await requete(
      `SELECT id, uf, libelle, pole, actif
         FROM mti.service
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY uf`,
      params)
    return rows
  })

  app.post('/api/services', async (request, reply) => {
    const uf = String(request.body?.uf ?? '').trim()
    const libelle = String(request.body?.libelle ?? '').trim()
    const pole = String(request.body?.pole ?? '').trim() || null
    if (!uf || !libelle) {
      return reply.code(400).send({ erreur: 'uf et libelle sont requis.' })
    }

    const { rows: deja } = await requete(
      'SELECT actif FROM mti.service WHERE uf = $1', [uf])
    if (deja.length) {
      /* Le message distingue les deux cas : une UF prise par un service actif
         est une erreur de saisie, une UF prise par un service désactivé se
         règle en le réactivant — et non en inventant une autre UF. */
      return reply.code(409).send({
        erreur: deja[0].actif
          ? `L'UF ${uf} est déjà prise par un service actif.`
          : `L'UF ${uf} appartient à un service désactivé : le réactiver plutôt ` +
            'que d\'en créer un autre sous la même UF.'
      })
    }

    const cree = await transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO mti.service (uf, libelle, pole) VALUES ($1, $2, $3)
         RETURNING id, uf, libelle, pole, actif`,
        [uf, libelle, pole])
      return rows[0]
    })
    return reply.code(201).send(cree)
  })

  app.patch('/api/services/:id', async (request, reply) => {
    const corps = request.body ?? {}
    const colonnes = []
    const valeurs = [request.params.id]
    for (const [cle, colonne] of Object.entries({
      uf: 'uf', libelle: 'libelle', pole: 'pole', actif: 'actif'
    })) {
      if (corps[cle] === undefined) continue
      valeurs.push(cle === 'actif' ? corps[cle] === true
        : (String(corps[cle]).trim() || (cle === 'pole' ? null : '')))
      colonnes.push(`${colonne} = $${valeurs.length}`)
    }
    if (!colonnes.length) return reply.code(400).send({ erreur: 'Aucun champ à modifier.' })
    if (corps.uf !== undefined && !String(corps.uf).trim()) {
      return reply.code(400).send({ erreur: "L'UF ne peut pas être vidée : c'est la clé." })
    }
    if (corps.libelle !== undefined && !String(corps.libelle).trim()) {
      return reply.code(400).send({ erreur: 'Le libellé ne peut pas être vidé.' })
    }

    try {
      const maj = await transaction(request.utilisateur.id, request.ip, async (client) => {
        const { rows } = await client.query(
          `UPDATE mti.service SET ${colonnes.join(', ')} WHERE id = $1
           RETURNING id, uf, libelle, pole, actif`, valeurs)
        return rows[0]
      })
      if (!maj) return reply.code(404).send({ erreur: 'Service introuvable.' })
      return maj
    } catch (e) {
      if (e.code === '23505') {
        return reply.code(409).send({ erreur: `L'UF ${corps.uf} est déjà prise.` })
      }
      throw e
    }
  })
}
