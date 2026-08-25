import { requete } from '../db.js'

/**
 * Recherche patient.
 *
 * Volontairement limitée : le module MTI n'est PAS un référentiel patients.
 * L'annuaire de référence est le SIH (ou Pharma®/CHIMIO®). Ici on interroge
 * les patients déjà rattachés à un dossier ; le branchement SIH viendra
 * remplacer cette source sans changer le contrat de l'API.
 */
export default async function patients (app) {
  app.get('/api/patients', async (request) => {
    const q = String(request.query.q ?? '').trim()

    // Une recherche à vide ne doit pas déverser l'annuaire.
    if (q.length < 2) return []

    const { rows } = await requete(
      `SELECT p.id, p.reference,
              coalesce(i.nom || ' ' || coalesce(i.prenom, ''), '(identité non enregistrée)') AS nom,
              i.date_naissance
         FROM mti.patient p
         LEFT JOIN mti.patient_identite i ON i.patient_id = p.id
        WHERE p.reference ILIKE $1
           OR i.nom ILIKE $1
           OR i.prenom ILIKE $1
        ORDER BY i.nom NULLS LAST
        LIMIT 20`,
      [`%${q}%`]
    )

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      nom: r.nom.trim(),
      dateNaissance: r.date_naissance
        ? new Date(r.date_naissance).toISOString().slice(0, 10)
        : null
    }))
  })
}
