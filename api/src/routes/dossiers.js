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

  // ── Ajout d'un processus en cours de parcours ────────────────────────────
  //
  // Le catalogue permet d'insérer un processus complémentaire (contrôle qualité
  // intermédiaire, non-conformité, transport interne). Sans cette route, l'ajout
  // restait local au navigateur : les saisies du processus ajouté n'avaient
  // aucun `dossier_processus` où atterrir, et l'enregistrement échouait en
  // silence — le pire des cas pour une traçabilité.
  app.post('/api/dossiers/:id/processus', async (request, reply) => {
    const { code, nom, gabarit, externe, sections } = request.body ?? {}
    if (!code || !nom) return reply.code(400).send({ erreur: 'code et nom sont requis.' })
    if (sections !== undefined && !Array.isArray(sections)) {
      return reply.code(400).send({ erreur: 'sections doit être un tableau.' })
    }

    const { rows: dossierRows } = await requete(
      'SELECT statut FROM mti.dossier WHERE id = $1', [request.params.id])
    if (!dossierRows.length) return reply.code(404).send({ erreur: 'Dossier introuvable.' })
    if (dossierRows[0].statut === 'valide') {
      return reply.code(409).send({
        erreur: "Dossier validé : on n'y ajoute plus de processus. Toute correction " +
                'passe par une nouvelle version du dossier.'
      })
    }

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      /* L'ordre est calculé dans la transaction : deux ajouts simultanés ne
         doivent pas se retrouver au même rang. */
      const { rows: [{ suivant }] } = await client.query(
        `SELECT coalesce(max(ordre), 0) + 1 AS suivant
           FROM mti.dossier_processus WHERE dossier_id = $1`,
        [request.params.id])

      const { rows } = await client.query(
        `INSERT INTO mti.dossier_processus
           (dossier_id, ordre, code, nom, gabarit, externe, definition, etat,
            ajoute_du_catalogue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'a_venir', true)
         RETURNING id, ordre, code, nom, gabarit, externe, definition, etat,
                   ajoute_du_catalogue`,
        [request.params.id, suivant, code, nom, gabarit ?? 'standard', externe === true,
          JSON.stringify({ sections: sections ?? [] })])

      reply.code(201)
      return rows[0]
    })
  })

  // ── En-tête du dossier ───────────────────────────────────────────────────
  //
  // La création ne prend que la référence : sans cette route, le produit, le
  // n° de lot et la péremption saisis dans l'interface n'allaient nulle part.
  //
  // `patient_id` et `preallocation` passent par ici : c'est la préallocation,
  // seule voie par laquelle une identité apparaît avant la mise en fabrication.
  app.patch('/api/dossiers/:id', async (request, reply) => {
    /* Liste blanche : ni statut, ni conformite, ni valide_par ne se modifient
       ici — la validation a sa route, qui vérifie les points obligatoires. */
    const CHAMPS = {
      designationProduit: 'designation_produit',
      produitId: 'produit_id',
      numeroLot: 'numero_lot',
      codeBarre: 'code_barre',
      datePeremption: 'date_peremption',
      numeroOrdonnancier: 'numero_ordonnancier',
      numeroCommande: 'numero_commande',
      dateFabrication: 'date_fabrication',
      transporteur: 'transporteur',
      nbExemplaires: 'nb_exemplaires',
      patientId: 'patient_id',
      preallocation: 'preallocation',
      commentaire: 'commentaire'
    }
    const corps = request.body ?? {}
    const colonnes = []
    const valeurs = []
    for (const [cle, colonne] of Object.entries(CHAMPS)) {
      if (!(cle in corps)) continue
      let v = corps[cle]
      if (typeof v === 'string' && v.trim() === '') v = null
      if (cle === 'nbExemplaires') {
        const n = Number(v)
        if (!Number.isInteger(n) || n < 1 || n > 10) {
          return reply.code(400).send({ erreur: 'nbExemplaires doit être un entier de 1 à 10.' })
        }
        v = n
      }
      if (cle === 'preallocation' && typeof v !== 'boolean') {
        return reply.code(400).send({ erreur: 'preallocation doit valoir true ou false.' })
      }
      valeurs.push(v)
      colonnes.push(`${colonne} = $${valeurs.length + 1}`)
    }
    if (!colonnes.length) return reply.code(400).send({ erreur: 'Aucun champ à modifier.' })

    // Une préallocation sans patient n'a pas de sens, et un patient sans
    // préallocation ferait apparaître une identité sans acte explicite.
    if (corps.preallocation === false && corps.patientId === undefined) {
      valeurs.push(null)
      colonnes.push(`patient_id = $${valeurs.length + 1}`)
    }

    const { rows } = await transaction(
      request.utilisateur.id, request.ip,
      async (client) => {
        /* Un dossier validé est figé : la condition est dans le UPDATE, pas
           dans une lecture préalable, pour qu'aucune écriture ne se glisse
           entre les deux. */
        const r = await client.query(
          `UPDATE mti.dossier SET ${colonnes.join(', ')}
            WHERE id = $1 AND statut <> 'valide'
            RETURNING id, statut`,
          [request.params.id, ...valeurs])
        return r
      })

    if (!rows.length) {
      const { rows: existe } = await requete(
        'SELECT statut FROM mti.dossier WHERE id = $1', [request.params.id])
      if (!existe.length) return reply.code(404).send({ erreur: 'Dossier introuvable.' })
      return reply.code(409).send({
        erreur: 'Dossier validé : son en-tête est en lecture seule. Toute correction ' +
                'passe par une nouvelle version du dossier.'
      })
    }
    return { id: rows[0].id, statut: rows[0].statut }
  })

  // ── Lecture ──────────────────────────────────────────────────────────────
  // ── Liste des dossiers, pour le tableau de bord ──────────────────────────
  //
  // L'anonymat par défaut vaut ICI AUSSI, et c'est le point délicat : une liste
  // est justement l'endroit où une identité fuit sans qu'on y pense. Le nom
  // n'est joint que si le dossier porte un patient — préallocation explicite ou
  // allocation à la mise en fabrication. Sinon la ligne est « en attente
  // d'allocation », et aucune donnée identifiante ne quitte la base.
  app.get('/api/dossiers', async (request) => {
    const q = String(request.query.q ?? '').trim()
    const produit = String(request.query.produit ?? '').trim()
    const patient = String(request.query.patient ?? '').trim()
    const statut = String(request.query.statut ?? '').trim()

    const conditions = []
    const params = []

    if (produit) { params.push(produit); conditions.push(`d.produit_id = $${params.length}`) }
    if (patient) { params.push(patient); conditions.push(`d.patient_id = $${params.length}`) }

    // `attente` n'est pas un statut stocké : c'est l'absence de patient sur un
    // dossier encore ouvert. Le calculer ici évite de dupliquer la règle côté
    // front, où elle finirait par diverger.
    if (statut === 'attente') conditions.push("d.patient_id IS NULL AND d.statut <> 'valide'")
    else if (statut === 'en_cours') conditions.push("d.statut <> 'valide'")
    else if (statut) { params.push(statut); conditions.push(`d.statut = $${params.length}`) }

    if (q) {
      params.push(`%${q}%`)
      const n = params.length
      // La recherche porte sur le nom du patient : c'est ce que demande
      // l'usage (« retrouver le dossier de M. X »). Elle ne peut donc pas
      // ignorer patient_identite — mais elle ne RENVOIE le nom que pour les
      // dossiers qui portent déjà un patient, cf. la projection plus bas.
      conditions.push(`(d.reference ILIKE $${n} OR d.numero_lot ILIKE $${n}
                        OR coalesce(d.designation_produit, pr.denomination) ILIKE $${n}
                        OR pat.reference ILIKE $${n}
                        OR i.nom ILIKE $${n} OR i.prenom ILIKE $${n})`)
    }

    const { rows } = await requete(
      `SELECT d.id, d.reference, d.numero_lot, d.statut, d.preallocation,
              d.patient_id, d.cree_le, d.valide_le,
              coalesce(d.designation_produit, pr.denomination) AS produit,
              pr.id AS produit_id, pat.reference AS patient_reference,
              i.nom AS patient_nom, i.prenom AS patient_prenom,
              m.code AS code_modele, m.version AS version_modele,
              (SELECT dp.nom FROM mti.dossier_processus dp
                WHERE dp.dossier_id = d.id AND dp.etat <> 'valide'
                ORDER BY dp.ordre LIMIT 1) AS etape,
              (SELECT count(*)::int FROM mti.dossier_processus dp
                WHERE dp.dossier_id = d.id) AS nb_processus,
              (SELECT count(*)::int FROM mti.dossier_processus dp
                WHERE dp.dossier_id = d.id AND dp.etat = 'valide') AS nb_valides,
              (SELECT count(*)::int FROM mti.saisie s
                 JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
                WHERE dp.dossier_id = d.id AND s.hors_seuil) AS nb_alarmes,
              greatest(d.cree_le, d.valide_le,
                (SELECT max(dp.valide_le) FROM mti.dossier_processus dp
                  WHERE dp.dossier_id = d.id),
                (SELECT max(s.saisi_le) FROM mti.saisie s
                   JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
                  WHERE dp.dossier_id = d.id)) AS derniere_activite
         FROM mti.dossier d
         JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
         LEFT JOIN mti.produit pr ON pr.id = d.produit_id
         LEFT JOIN mti.patient pat ON pat.id = d.patient_id
         LEFT JOIN mti.patient_identite i ON i.patient_id = pat.id
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY derniere_activite DESC NULLS LAST
        LIMIT 200`,
      params)

    return rows.map((r) => {
      const alloue = r.patient_id !== null
      return {
        id: r.id,
        reference: r.reference,
        produit: r.produit,
        produitId: r.produit_id,
        numeroLot: r.numero_lot,
        statut: r.statut,
        /* Le statut d'affichage du tableau de bord : « en attente d'allocation »
           n'existe pas en base, c'est l'absence de patient sur un dossier
           ouvert. */
        statutAffiche: r.statut === 'valide' ? 'termine' : (alloue ? 'en_cours' : 'attente'),
        /* Un dossier validé est clos, même si tous ses processus n'ont pas été
           validés un à un : c'est la validation du dossier qui le fige. */
        etape: r.statut === 'valide' ? 'Parcours clos' : (r.etape ?? 'Parcours clos'),
        nbProcessus: r.nb_processus,
        nbValides: r.nb_valides,
        avancement: r.nb_processus ? Math.round((r.nb_valides / r.nb_processus) * 100) : 0,
        nbAlarmes: r.nb_alarmes,
        codeModele: r.code_modele,
        versionModele: r.version_modele,
        creeLe: r.cree_le,
        valideLe: r.valide_le,
        derniereActivite: r.derniere_activite,
        /* Rien d'identifiant ne sort tant que le dossier n'a pas de patient. */
        patient: alloue
          ? {
              reference: r.patient_reference,
              nom: [r.patient_nom, r.patient_prenom].filter(Boolean).join(' ') || null,
              preallocation: r.preallocation
            }
          : null
      }
    })
  })

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
