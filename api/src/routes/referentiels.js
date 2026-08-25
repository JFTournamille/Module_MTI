import { requete } from '../db.js'

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

  app.get('/api/catalogue', async () => {
    const { rows } = await requete(
      `SELECT definition FROM mti.catalogue_processus
        WHERE actif ORDER BY version DESC LIMIT 1`
    )
    return rows.length ? rows[0].definition : { groupes: [] }
  })
}
