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
}
