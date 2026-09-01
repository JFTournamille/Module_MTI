import { requete, transaction } from '../db.js'

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

    /* Une recherche à vide ne doit pas déverser l'annuaire — SAUF demande
       explicite, pour l'écran de codification qui montre ce que le module
       connaît déjà. Ce n'est pas un référentiel patients : c'est la liste des
       patients qu'un dossier a rattachés, et elle est plafonnée. Le module
       n'en constitue pas un, l'annuaire de référence reste le SIH. */
    const tous = request.query.tous === 'oui'
    if (q.length < 2 && !tous) return []

    const { rows } = await requete(
      `SELECT p.id, p.reference, p.source,
              coalesce(i.nom || ' ' || coalesce(i.prenom, ''), '(identité non enregistrée)') AS nom,
              i.date_naissance, i.ipp, i.identifiants
         FROM mti.patient p
         LEFT JOIN mti.patient_identite i ON i.patient_id = p.id
        WHERE $2 OR p.reference ILIKE $1
                  OR i.nom ILIKE $1
                  OR i.prenom ILIKE $1
        ORDER BY i.nom NULLS LAST
        LIMIT $3`,
      [`%${q}%`, tous && !q, tous ? 200 : 20]
    )

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      source: r.source,
      nom: r.nom.trim(),
      ipp: r.ipp,
      identifiants: r.identifiants ?? [],
      dateNaissance: r.date_naissance
        ? new Date(r.date_naissance).toISOString().slice(0, 10)
        : null
    }))
  })

  /**
   * Identifiants d'un patient : IPP et numéros à libellé libre.
   *
   * L'IPP est le pointeur vers le dossier du SIH ; les numéros complémentaires
   * portent leur propre libellé, modifiable, parce qu'il varie d'un
   * établissement à l'autre (n° de séjour, d'essai clinique, de protocole).
   *
   * Le PATCH remplace la LISTE entière plutôt que d'exposer un ajout, un
   * retrait et un renommage : la liste est courte, elle est éditée d'un bloc à
   * l'écran, et trois routes auraient introduit des états intermédiaires
   * (numéro ajouté, libellé pas encore posé) qu'aucun écran ne produit.
   *
   * `patient_identite` porte des données de santé à caractère personnel : la
   * ligne est créée à la demande, pas au rattachement, pour qu'un dossier
   * anonyme n'en fabrique aucune.
   */
  app.patch('/api/patients/:id/identifiants', async (request, reply) => {
    const corps = request.body ?? {}
    const aIpp = 'ipp' in corps
    const aListe = 'identifiants' in corps
    if (!aIpp && !aListe) {
      return reply.code(400).send({ erreur: 'Rien à modifier : ipp ou identifiants attendu.' })
    }

    let liste
    if (aListe) {
      if (!Array.isArray(corps.identifiants)) {
        return reply.code(400).send({ erreur: 'identifiants doit être un tableau.' })
      }
      if (corps.identifiants.length > 12) {
        return reply.code(400).send({ erreur: 'Douze numéros au plus par patient.' })
      }
      liste = []
      for (const e of corps.identifiants) {
        const libelle = String(e?.libelle ?? '').trim()
        const valeur = String(e?.valeur ?? '').trim()
        /* Un numéro sans libellé serait illisible, un libellé sans numéro est
           une ligne vide restée à l'écran : on l'ignore plutôt que de refuser
           l'enregistrement entier pour une ligne que l'utilisateur a laissée
           tomber. */
        if (!valeur) continue
        if (!libelle) {
          return reply.code(400).send({
            erreur: `Le numéro « ${valeur} » n'a pas de libellé.`
          })
        }
        if (libelle.length > 60 || valeur.length > 60) {
          return reply.code(400).send({ erreur: 'Libellé et valeur : 60 caractères au plus.' })
        }
        liste.push({ libelle, valeur })
      }
    }

    const ipp = aIpp ? (String(corps.ipp ?? '').trim() || null) : undefined
    if (ipp !== undefined && ipp !== null && ipp.length > 60) {
      return reply.code(400).send({ erreur: 'IPP : 60 caractères au plus.' })
    }

    const resultat = await transaction(
      request.utilisateur.id, request.ip,
      async (client) => {
        const { rows: existe } = await client.query(
          'SELECT 1 FROM mti.patient WHERE id = $1::uuid', [request.params.id])
        if (!existe.length) return null

        /* Les colonnes à écrire viennent de EXCLUDED, pas de paramètres
           supplémentaires : numéroter à la main après les trois de l'INSERT est
           exactement le genre de calcul qui produit un `$2` réutilisé. Un champ
           absent du corps n'est pas listé ici, donc pas écrasé — c'est ce qui
           permet de modifier l'IPP sans toucher aux numéros, et l'inverse. */
        const colonnes = []
        if (ipp !== undefined) colonnes.push('ipp = EXCLUDED.ipp')
        if (liste !== undefined) colonnes.push('identifiants = EXCLUDED.identifiants')

        /* La ligne d'identité peut ne pas exister : le patient a pu être
           rattaché sans qu'aucune identité soit persistée. INSERT … ON CONFLICT
           plutôt qu'un UPDATE qui ne toucherait rien en silence. */
        const { rows } = await client.query(
          `INSERT INTO mti.patient_identite (patient_id, ipp, identifiants)
           VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (patient_id) DO UPDATE
             SET ${colonnes.join(', ')}, maj_le = now()
           RETURNING ipp, identifiants`,
          [request.params.id, ipp ?? null, JSON.stringify(liste ?? [])])
        return rows[0]
      })

    if (!resultat) return reply.code(404).send({ erreur: 'Patient introuvable' })
    return { ipp: resultat.ipp, identifiants: resultat.identifiants ?? [] }
  })
}
