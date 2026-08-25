import { transaction, requete } from '../db.js'

/** Types de points acceptés — doit rester aligné sur l'enum mti.type_point. */
const TYPES = new Set(['ouinon', 'valeur', 'photo', 'timer', 'texte', 'auto'])

export default async function dossiers (app) {
  // ── Création d'un dossier ────────────────────────────────────────────────
  app.post('/api/dossiers', async (request, reply) => {
    const { codeModele, reference } = request.body ?? {}
    if (!codeModele || !reference) {
      return reply.code(400).send({ erreur: 'codeModele et reference sont requis' })
    }

    const { rows: modeles } = await requete(
      `SELECT id, definition FROM mti.modele_parcours WHERE code = $1 AND actif LIMIT 1`,
      [codeModele]
    )
    if (!modeles.length) return reply.code(404).send({ erreur: `Modèle ${codeModele} introuvable` })
    const modele = modeles[0]

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO mti.dossier (reference, modele_parcours_id, cree_par)
         VALUES ($1, $2, $3) RETURNING id`,
        [reference, modele.id, request.utilisateur.id]
      )
      const dossierId = rows[0].id

      // La définition de chaque processus est FIGÉE dans le dossier : une
      // évolution ultérieure du modèle ne doit pas réécrire l'historique.
      const processus = modele.definition.processus ?? []
      for (const [i, p] of processus.entries()) {
        await client.query(
          `INSERT INTO mti.dossier_processus
             (dossier_id, ordre, code, nom, gabarit, externe, definition, etat, ouvert_le)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [dossierId, i + 1, p.code, p.nom, p.gabarit ?? 'standard', p.externe === true,
            JSON.stringify({ sections: p.sections ?? [] }),
            i === 0 ? 'en_cours' : 'a_venir', i === 0 ? new Date() : null]
        )
      }
      reply.code(201)
      return { id: dossierId, reference, nbProcessus: processus.length }
    })
  })

  // ── Lecture ──────────────────────────────────────────────────────────────
  app.get('/api/dossiers/:id', async (request, reply) => {
    const { rows } = await requete(
      `SELECT d.*, m.code AS code_modele, m.version AS version_modele
         FROM mti.dossier d
         JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
        WHERE d.id = $1`,
      [request.params.id]
    )
    if (!rows.length) return reply.code(404).send({ erreur: 'Dossier introuvable' })

    const { rows: processus } = await requete(
      `SELECT id, ordre, code, nom, gabarit, externe, definition, etat
         FROM mti.dossier_processus WHERE dossier_id = $1 ORDER BY ordre`,
      [request.params.id]
    )
    const { rows: saisies } = await requete(
      `SELECT s.*, t.secondes
         FROM mti.saisie s
         LEFT JOIN mti.saisie_timer t ON t.id = s.id
        WHERE s.dossier_processus_id = ANY($1::uuid[])`,
      [processus.map((p) => p.id)]
    )

    return { dossier: rows[0], processus, saisies }
  })

  // ── Enregistrement des saisies (lot) ────────────────────────────────────
  app.put('/api/processus/:id/saisies', async (request, reply) => {
    const lot = request.body?.saisies
    if (!Array.isArray(lot)) {
      return reply.code(400).send({ erreur: 'Corps attendu : { saisies: [...] }' })
    }

    for (const s of lot) {
      if (!TYPES.has(s.pointType)) {
        return reply.code(400).send({ erreur: `pointType invalide : ${s.pointType}` })
      }
      if (!Number.isInteger(s.sectionIndex) || !Number.isInteger(s.pointIndex)) {
        return reply.code(400).send({ erreur: 'sectionIndex et pointIndex doivent être des entiers' })
      }
    }

    try {
      return await transaction(request.utilisateur.id, request.ip, async (client) => {
        const enregistrees = []
        for (const s of lot) {
          // L'alarme est FIGÉE ici, côté serveur : le front l'affiche, la base
          // en conserve la valeur qui faisait foi au moment de la saisie.
          const seuil = s.seuil ?? null
          const valeur = s.valeurNum ?? null
          const horsSeuil = seuil !== null && valeur !== null ? Number(valeur) > Number(seuil) : null

          const { rows } = await client.query(
            `INSERT INTO mti.saisie
               (dossier_processus_id, section_index, point_index, point_num, point_type,
                exemplaire, operateur_role, obligatoire, reponse, valeur_num, valeur_texte,
                seuil_applique, hors_seuil, horodatage, timer_debut, timer_fin, operateur_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (dossier_processus_id, section_index, point_index, exemplaire, operateur_role)
             DO UPDATE SET
               obligatoire = EXCLUDED.obligatoire,
               reponse = EXCLUDED.reponse,
               valeur_num = EXCLUDED.valeur_num,
               valeur_texte = EXCLUDED.valeur_texte,
               seuil_applique = EXCLUDED.seuil_applique,
               hors_seuil = EXCLUDED.hors_seuil,
               horodatage = EXCLUDED.horodatage,
               timer_debut = EXCLUDED.timer_debut,
               timer_fin = EXCLUDED.timer_fin,
               operateur_id = EXCLUDED.operateur_id,
               saisi_le = now()
             RETURNING id`,
            [request.params.id, s.sectionIndex, s.pointIndex, s.pointNum ?? null, s.pointType,
              s.exemplaire ?? 1, s.operateurRole ?? 'op1', s.obligatoire === true,
              s.reponse ?? null, valeur, s.valeurTexte ?? null, seuil, horsSeuil,
              s.horodatage ?? null, s.timerDebut ?? null, s.timerFin ?? null,
              s.operateurRole === 'systeme' ? null : (s.operateurId ?? request.utilisateur.id)]
          )
          enregistrees.push(rows[0].id)
        }
        return { enregistrees: enregistrees.length }
      })
    } catch (e) {
      // Le trigger de verrouillage post-validation remonte ici.
      if (e.code === '23000' || /lecture seule/.test(e.message)) {
        return reply.code(409).send({ erreur: e.message })
      }
      throw e
    }
  })

  // ── Piste d'audit d'un dossier ──────────────────────────────────────────
  /**
   * Reconstitue l'historique complet : le dossier, ses processus, ses saisies
   * et ses signatures. C'est la pièce qu'un inspecteur demande — d'où le tri
   * chronologique strict et l'identification nominative de chaque auteur.
   *
   * Les transtypages sont explicites : `cle_cible` est du texte (elle désigne
   * des lignes de tables différentes), les clés étrangères sont des uuid.
   * Sans cast, Postgres infère $1 en text au premier usage et refuse ensuite
   * la comparaison avec une colonne uuid.
   */
  app.get('/api/dossiers/:id/audit', async (request, reply) => {
    const { rows: existe } = await requete(
      'SELECT 1 FROM mti.dossier WHERE id = $1::uuid', [request.params.id])
    if (!existe.length) return reply.code(404).send({ erreur: 'Dossier introuvable' })

    const { rows } = await requete(
      `WITH processus AS (
         SELECT id FROM mti.dossier_processus WHERE dossier_id = $1::uuid
       ), cles AS (
              SELECT $1::text AS cle
        UNION SELECT id::text FROM processus
        UNION SELECT s.id::text FROM mti.saisie s
                WHERE s.dossier_processus_id IN (SELECT id FROM processus)
        UNION SELECT g.id::text FROM mti.signature g WHERE g.dossier_id = $1::uuid
       )
       SELECT a.survenu_le, a.operation, a.table_cible, a.cle_cible,
              a.ancien, a.nouveau, u.titre, u.prenom, u.nom
         FROM mti.audit a
         JOIN cles c ON c.cle = a.cle_cible
         LEFT JOIN mti.utilisateur u ON u.id = a.utilisateur_id
        ORDER BY a.survenu_le, a.id`,
      [request.params.id]
    )
    return rows
  })

  // ── Validation d'un dossier ─────────────────────────────────────────────
  app.post('/api/dossiers/:id/valider', async (request, reply) => {
    const { conformite, commentaire } = request.body ?? {}
    if (!['conforme', 'non_conforme'].includes(conformite)) {
      return reply.code(400).send({ erreur: "conformite doit valoir 'conforme' ou 'non_conforme'" })
    }

    // Un dossier ne se valide pas avec des points obligatoires vides.
    const { rows: manquants } = await requete(
      `SELECT dp.nom AS processus, s.point_num, s.exemplaire, s.point_type
         FROM mti.saisie s
         JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
        WHERE dp.dossier_id = $1
          AND s.obligatoire
          AND CASE s.point_type
                WHEN 'ouinon' THEN s.reponse IS NULL
                WHEN 'valeur' THEN s.valeur_num IS NULL
                WHEN 'texte'  THEN coalesce(btrim(s.valeur_texte), '') = ''
                WHEN 'timer'  THEN s.timer_debut IS NULL
                ELSE false
              END`,
      [request.params.id]
    )
    if (manquants.length) {
      return reply.code(422).send({
        erreur: `${manquants.length} point(s) obligatoire(s) non renseigné(s)`,
        details: manquants
      })
    }

    try {
      return await transaction(request.utilisateur.id, request.ip, async (client) => {
        const { rows } = await client.query(
          `UPDATE mti.dossier
              SET statut = 'valide', conformite = $2, commentaire = $3,
                  valide_par = $4, valide_le = now()
            WHERE id = $1 AND statut <> 'valide'
            RETURNING id, statut, conformite, valide_le`,
          [request.params.id, conformite, commentaire ?? null, request.utilisateur.id]
        )
        if (!rows.length) {
          reply.code(409)
          return { erreur: 'Dossier introuvable ou déjà validé' }
        }
        await client.query(
          `UPDATE mti.dossier_processus
              SET etat = 'valide', valide_par = $2, valide_le = now()
            WHERE dossier_id = $1 AND etat = 'en_cours'`,
          [request.params.id, request.utilisateur.id]
        )
        return rows[0]
      })
    } catch (e) {
      if (/dévalid/.test(e.message)) return reply.code(409).send({ erreur: e.message })
      throw e
    }
  })
}
