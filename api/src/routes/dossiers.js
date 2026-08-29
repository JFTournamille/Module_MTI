import { createHash } from 'node:crypto'
import { transaction, requete } from '../db.js'

/** Types de points acceptés — doit rester aligné sur l'enum mti.type_point. */
const TYPES = new Set(['ouinon', 'valeur', 'photo', 'timer', 'texte', 'auto', 'date'])

export default async function dossiers (app) {
  // ── Création d'un dossier ────────────────────────────────────────────────
  app.post('/api/dossiers', async (request, reply) => {
    /* Le produit et le n° de lot sont acceptés dès la création : les renseigner
       par un PATCH séparé exposait à un dossier créé mais sans produit, si le
       second appel échouait. */
    const { codeModele, produitId, designationProduit, numeroLot } =
      request.body ?? {}
    /* La référence est FACULTATIVE : sans elle, la base l'attribue depuis sa
       séquence (MTI-000001, MTI-000002, …). Elle reste imposable — le jeu de
       démonstration et les suites de test s'en servent — mais l'application
       ne la propose plus : une référence calculée par le navigateur n'est
       unique que par chance. */
    const reference = String(request.body?.reference ?? '').trim()
    if (!codeModele) {
      return reply.code(400).send({ erreur: 'codeModele est requis' })
    }

    const { rows: modeles } = await requete(
      `SELECT id, definition FROM mti.modele_parcours WHERE code = $1 AND actif LIMIT 1`,
      [codeModele]
    )
    if (!modeles.length) return reply.code(404).send({ erreur: `Modèle ${codeModele} introuvable` })
    const modele = modeles[0]

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      /* Deux formes d'insertion plutôt qu'un COALESCE : passer `reference` à
         NULL heurterait le NOT NULL sans jamais atteindre le DEFAULT. Omettre
         la colonne est le seul moyen de laisser la base numéroter. */
      const { rows } = reference
        ? await client.query(
          `INSERT INTO mti.dossier (reference, modele_parcours_id, cree_par,
                                    produit_id, designation_produit, numero_lot)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, reference`,
          [reference, modele.id, request.utilisateur.id,
            produitId || null, designationProduit || null, numeroLot || null]
        )
        : await client.query(
          `INSERT INTO mti.dossier (modele_parcours_id, cree_par,
                                    produit_id, designation_produit, numero_lot)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, reference`,
          [modele.id, request.utilisateur.id,
            produitId || null, designationProduit || null, numeroLot || null]
        )
      const dossierId = rows[0].id
      const referenceAttribuee = rows[0].reference

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
      return { id: dossierId, reference: referenceAttribuee, nbProcessus: processus.length }
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
      prescriptionFaite: 'prescription_faite',
      commentaire: 'commentaire',
      informationImportante: 'information_importante',
      aphereseFaite: 'apherese_faite',
      dateApherese: 'date_apherese'
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
      if (['preallocation', 'prescriptionFaite', 'aphereseFaite'].includes(cle) &&
          typeof v !== 'boolean') {
        return reply.code(400).send({ erreur: `${cle} doit valoir true ou false.` })
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

    /* Décocher « aphérèse faite » efface la date : la base refuserait de toute
       façon une date sans jalon (dossier_date_apherese_exige_jalon), et un 409
       de contrainte serait un mauvais message pour un geste qui a un sens
       évident. On l'applique ici plutôt que de laisser le client s'en souvenir. */
    if (corps.aphereseFaite === false && corps.dateApherese === undefined) {
      valeurs.push(null)
      colonnes.push(`date_apherese = $${valeurs.length + 1}`)
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

  // ── Contresignature d'un processus par une 2e personne ───────────────────
  //
  // La double validation demandée en réunion n'est pas une seconde saisie ligne
  // à ligne — le double contrôle Op.1/Op.2 existe déjà pour ça. C'est une
  // contresignature GLOBALE du processus par une 2e personne identifiée, avec
  // rappel des points concernés.
  //
  // Elle vit dans `mti.signature`, où elle a sa place : le rôle « verificateur »
  // existe, la table est auditée, et le rôle applicatif n'a ni UPDATE ni DELETE
  // dessus — une contresignature posée ne se retire pas.
  app.post('/api/processus/:id/contresigner', async (request, reply) => {
    const { utilisateurId } = request.body ?? {}
    if (!utilisateurId) {
      return reply.code(400).send({ erreur: 'utilisateurId de la 2e personne requis.' })
    }

    const { rows: ctx } = await requete(
      `SELECT dp.dossier_id, dp.nom, dp.definition, d.statut
         FROM mti.dossier_processus dp
         JOIN mti.dossier d ON d.id = dp.dossier_id
        WHERE dp.id = $1`,
      [request.params.id])
    if (!ctx.length) return reply.code(404).send({ erreur: 'Processus introuvable.' })
    if (ctx[0].statut === 'valide') {
      return reply.code(409).send({ erreur: 'Dossier validé : les signatures sont figées.' })
    }

    // Une contresignature par la même personne que la 1re n'en est pas une :
    // tout l'objet du double contrôle est qu'un second regard s'exerce.
    if (utilisateurId === request.utilisateur.id) {
      return reply.code(409).send({
        erreur: 'La 2e personne doit être différente de celle qui saisit. Une ' +
                'contresignature par le même opérateur ne vaut pas double contrôle.'
      })
    }

    const { rows: second } = await requete(
      'SELECT id, identifiant, nom, prenom, titre, profil FROM mti.utilisateur WHERE id = $1 AND actif',
      [utilisateurId])
    if (!second.length) {
      return reply.code(409).send({
        erreur: "La 2e personne n'existe pas ou son compte est désactivé."
      })
    }

    const points = (ctx[0].definition?.sections ?? [])
      .flatMap((sc, iS) => (sc.points ?? []).map((pt, iP) => ({ ...pt, iS, iP })))
      .filter((pt) => pt.doubleValidation === true)
    if (!points.length) {
      return reply.code(409).send({
        erreur: `Aucun point de « ${ctx[0].nom} » n'est soumis à double validation.`
      })
    }

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      /* L'empreinte porte sur CE QUI EST SIGNÉ : le processus et la liste
         exacte des points contresignés. Si la définition du processus changeait,
         l'empreinte ne correspondrait plus — c'est le but. */
      const contenu = JSON.stringify({
        processus: request.params.id,
        nom: ctx[0].nom,
        points: points.map((pt) => ({ num: pt.num ?? null, libelle: pt.libelle })),
        contresignataire: second[0].id
      })
      const empreinte = createHash('sha256').update(contenu).digest('hex')

      const { rows } = await client.query(
        `INSERT INTO mti.signature (dossier_id, processus_id, role, utilisateur_id, empreinte)
         VALUES ($1, $2, 'verificateur', $3, $4)
         ON CONFLICT (dossier_id, processus_id, role, utilisateur_id) DO NOTHING
         RETURNING id, signe_le`,
        [ctx[0].dossier_id, request.params.id, second[0].id, empreinte])

      if (!rows.length) {
        return {
          deja: true,
          message: `« ${ctx[0].nom} » est déjà contresigné par ce vérificateur.`
        }
      }
      return {
        id: rows[0].id,
        signeLe: rows[0].signe_le,
        empreinte,
        processus: ctx[0].nom,
        contresignataire: {
          id: second[0].id,
          identifiant: second[0].identifiant,
          libelle: `${second[0].titre ? second[0].titre + ' ' : ''}${second[0].prenom} ${second[0].nom}`,
          profil: second[0].profil
        },
        points: points.map((pt) => ({ num: pt.num ?? null, libelle: pt.libelle }))
      }
    })
  })

  /** Contresignatures posées sur un dossier, pour l'affichage. */
  app.get('/api/dossiers/:id/signatures', async (request) => {
    const { rows } = await requete(
      `SELECT s.id, s.processus_id, s.role, s.signe_le, s.empreinte,
              u.identifiant, u.profil,
              coalesce(u.titre || ' ', '') || u.prenom || ' ' || u.nom AS libelle
         FROM mti.signature s
         JOIN mti.utilisateur u ON u.id = s.utilisateur_id
        WHERE s.dossier_id = $1
        ORDER BY s.signe_le`,
      [request.params.id])
    return rows.map((r) => ({
      id: r.id,
      processusId: r.processus_id,
      role: r.role,
      signeLe: r.signe_le,
      empreinte: r.empreinte,
      contresignataire: { identifiant: r.identifiant, libelle: r.libelle, profil: r.profil }
    }))
  })

  // ── Avancement d'un processus ────────────────────────────────────────────
  //
  // Il manquait la moitié du mécanisme : `dossier_processus.etat` était posé à
  // la création (le premier « en_cours », les autres « a_venir ») et plus rien
  // ne le faisait bouger. Or le front verrouille en lecture seule tout
  // processus « a_venir » : le parcours ne pouvait donc pas avancer d'un cran,
  // et seul le premier processus était jamais saisissable.
  //
  // Valider un processus ouvre le suivant encore à venir. C'est l'enchaînement
  // chronologique du parcours ; les processus qu'on veut pouvoir réaliser sans
  // attendre s'ouvrent explicitement (etat « en_cours »).
  app.post('/api/processus/:id/etat', async (request, reply) => {
    const etat = (request.body ?? {}).etat
    if (!['a_venir', 'en_cours', 'valide'].includes(etat)) {
      return reply.code(400).send({
        erreur: "etat doit valoir 'a_venir', 'en_cours' ou 'valide'."
      })
    }

    const { rows: contexte } = await requete(
      `SELECT dp.dossier_id, dp.ordre, d.statut
         FROM mti.dossier_processus dp
         JOIN mti.dossier d ON d.id = dp.dossier_id
        WHERE dp.id = $1`,
      [request.params.id])
    if (!contexte.length) return reply.code(404).send({ erreur: 'Processus introuvable.' })
    if (contexte[0].statut === 'valide') {
      return reply.code(409).send({
        erreur: 'Dossier validé : son avancement est figé. Toute correction passe par ' +
                'une nouvelle version du dossier.'
      })
    }

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      const { rows } = await client.query(
        `UPDATE mti.dossier_processus
            SET etat = $2::mti.etat_processus,
                ouvert_le = CASE WHEN $2 = 'a_venir' THEN NULL
                                 ELSE coalesce(ouvert_le, now()) END,
                valide_par = CASE WHEN $2 = 'valide' THEN $3::uuid ELSE NULL END,
                valide_le  = CASE WHEN $2 = 'valide' THEN now() ELSE NULL END
          WHERE id = $1
          RETURNING id, ordre, nom, etat, ouvert_le, valide_le`,
        [request.params.id, etat, request.utilisateur.id])

      let suivant = null
      if (etat === 'valide') {
        /* Ouvrir le suivant encore à venir, pas simplement `ordre + 1` : un
           processus ajouté depuis le catalogue, ou déjà ouvert, ne doit pas
           faire sauter un cran au parcours. */
        const { rows: ouverts } = await client.query(
          `UPDATE mti.dossier_processus
              SET etat = 'en_cours', ouvert_le = coalesce(ouvert_le, now())
            WHERE id = (SELECT id FROM mti.dossier_processus
                         WHERE dossier_id = $1 AND ordre > $2 AND etat = 'a_venir'
                         ORDER BY ordre LIMIT 1)
            RETURNING id, ordre, nom, etat`,
          [contexte[0].dossier_id, contexte[0].ordre])
        suivant = ouverts[0] ?? null
      }
      return { processus: rows[0], suivant }
    })
  })

  // ── Lecture ──────────────────────────────────────────────────────────────
  // ── Liste des dossiers, pour le tableau de bord ──────────────────────────
  //
  // L'anonymat par défaut vaut ICI AUSSI, et c'est le point délicat : une liste
  // est justement l'endroit où une identité fuit sans qu'on y pense. Le nom
  // n'est joint que si le dossier porte un patient — préallocation explicite ou
  // allocation à la mise en fabrication. Sinon la ligne est « en attente
  // d'allocation », et aucune donnée identifiante ne quitte la base.
  /**
   * Étapes en cours réellement présentes, pour peupler le filtre de colonne.
   *
   * Lues des DOSSIERS et non du modèle actif : un dossier ouvert sous une
   * version précédente porte des processus que le modèle actif ne connaît plus
   * — l'aphérèse en est l'exemple. Filtrer sur une liste tirée du modèle actif
   * laisserait ces dossiers infiltrables.
   */
  app.get('/api/dossiers/etapes', async () => {
    const { rows } = await requete(
      `SELECT DISTINCT etape FROM (
         SELECT (SELECT dp.nom FROM mti.dossier_processus dp
                  WHERE dp.dossier_id = d.id AND dp.etat <> 'valide'
                  ORDER BY dp.ordre LIMIT 1) AS etape
           FROM mti.dossier d
       ) e
        WHERE etape IS NOT NULL
        ORDER BY etape`)
    return rows.map((r) => r.etape)
  })

  app.get('/api/dossiers', async (request) => {
    const q = String(request.query.q ?? '').trim()
    const produit = String(request.query.produit ?? '').trim()
    const patient = String(request.query.patient ?? '').trim()
    const statut = String(request.query.statut ?? '').trim()
    /* Filtres par colonne du tableau de bord. Ils sont appliqués ICI et non
       côté front : la liste est plafonnée à 200 lignes, et filtrer une liste
       déjà tronquée donnerait des résultats faux sans le dire — un dossier
       correspondant au filtre mais au-delà du plafond serait simplement
       invisible. */
    const reference = String(request.query.reference ?? '').trim()
    const lot = String(request.query.lot ?? '').trim()
    const etape = String(request.query.etape ?? '').trim()
    const prescription = String(request.query.prescription ?? '').trim()

    const conditions = []
    const params = []

    if (produit) { params.push(produit); conditions.push(`d.produit_id = $${params.length}`) }
    /* `patient` accepte un UUID (lien direct depuis une fiche) ou du texte (le
       filtre de colonne). Distinguer sur la forme évite d'avoir deux paramètres
       pour la même colonne, et de casser un appelant qui passerait un id. */
    if (patient) {
      const estUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        .test(patient)
      if (estUuid) {
        params.push(patient)
        conditions.push(`d.patient_id = $${params.length}`)
      } else {
        params.push(`%${patient}%`)
        const n = params.length
        conditions.push(`(pat.reference ILIKE $${n} OR i.nom ILIKE $${n} OR i.prenom ILIKE $${n})`)
      }
    }
    if (reference) {
      params.push(`%${reference}%`)
      conditions.push(`d.reference ILIKE $${params.length}`)
    }
    if (lot) {
      params.push(`%${lot}%`)
      conditions.push(`d.numero_lot ILIKE $${params.length}`)
    }
    /* L'étape est le nom du premier processus non validé — la même expression
       que la colonne affichée. La recopier ici plutôt que de filtrer sur la
       valeur calculée : PostgreSQL n'autorise pas un alias de SELECT dans le
       WHERE, et une sous-requête corrélée reste lisible. */
    if (etape) {
      params.push(etape)
      conditions.push(`(SELECT dp.nom FROM mti.dossier_processus dp
                         WHERE dp.dossier_id = d.id AND dp.etat <> 'valide'
                         ORDER BY dp.ordre LIMIT 1) = $${params.length}`)
    }
    if (prescription === 'oui') conditions.push('d.prescription_faite')
    else if (prescription === 'non') conditions.push('NOT d.prescription_faite')

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

    /* Les compteurs passent par des LATERAL agrégés, et non par cinq
       sous-requêtes corrélées répétées ligne à ligne. La version corrélée
       relisait `saisie` une fois par dossier : mesurée à 2,9 s sur 310 dossiers
       et 19 800 saisies quand les statistiques n'étaient pas à jour, contre
       76 ms une fois la table analysée — un écart de quarante qui ne dépendait
       que de l'humeur du planificateur. Les LATERAL rendent le coût lisible et
       indépendant de ce hasard. */
    const { rows } = await requete(
      `SELECT d.id, d.reference, d.numero_lot, d.statut, d.conformite, d.preallocation,
              d.patient_id, d.prescription_faite, d.cree_le, d.valide_le,
              coalesce(d.designation_produit, pr.denomination) AS produit,
              pr.id AS produit_id, pat.reference AS patient_reference,
              i.nom AS patient_nom, i.prenom AS patient_prenom,
              m.code AS code_modele, m.version AS version_modele,
              proc.etape, proc.nb_processus, proc.nb_valides, proc.dernier_valide,
              coalesce(al.nb_alarmes, 0) AS nb_alarmes,
              greatest(d.cree_le, d.valide_le, proc.dernier_valide, al.derniere_saisie)
                AS derniere_activite
         FROM mti.dossier d
         JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
         LEFT JOIN mti.produit pr ON pr.id = d.produit_id
         LEFT JOIN mti.patient pat ON pat.id = d.patient_id
         LEFT JOIN mti.patient_identite i ON i.patient_id = pat.id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS nb_processus,
                  count(*) FILTER (WHERE dp.etat = 'valide')::int AS nb_valides,
                  max(dp.valide_le) AS dernier_valide,
                  (SELECT dp2.nom FROM mti.dossier_processus dp2
                    WHERE dp2.dossier_id = d.id AND dp2.etat <> 'valide'
                    ORDER BY dp2.ordre LIMIT 1) AS etape
             FROM mti.dossier_processus dp
            WHERE dp.dossier_id = d.id
         ) proc ON true
         LEFT JOIN LATERAL (
           SELECT count(*) FILTER (WHERE s.hors_seuil)::int AS nb_alarmes,
                  max(s.saisi_le) AS derniere_saisie
             FROM mti.saisie s
             JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
            WHERE dp.dossier_id = d.id
         ) al ON true
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
        /* Jalon, pas une prescription : ce module n'en porte aucune donnée. */
        prescriptionFaite: r.prescription_faite === true,
        /* Le statut d'affichage du tableau de bord : « en attente d'allocation »
           n'existe pas en base, c'est l'absence de patient sur un dossier
           ouvert. */
        statutAffiche: r.statut === 'valide'
          ? (r.conformite === 'non_conforme' ? 'non_conforme' : 'termine')
          : (alloue ? 'en_cours' : 'attente'),
        /* La conformité est la seule chose qui distingue deux dossiers clos.
           Sans elle le tableau de bord affichait « terminé, 100 % » sur un
           dossier déclaré non conforme — l'information la plus importante du
           dossier était la seule à ne pas remonter. */
        conformite: r.conformite,
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
    /* L'opérateur de chaque saisie est joint ici : sans son nom, la colonne
       « Opérateur » restait vide sur tout dossier rouvert, alors que
       l'attribution est justement ce que la traçabilité doit montrer. */
    const { rows: saisies } = await requete(
      `SELECT s.*, t.secondes,
              coalesce(u.titre || ' ', '') || u.prenom || ' ' || u.nom AS operateur_libelle,
              u.identifiant AS operateur_identifiant
         FROM mti.saisie s
         LEFT JOIN mti.saisie_timer t ON t.id = s.id
         LEFT JOIN mti.utilisateur u ON u.id = s.operateur_id
        WHERE s.dossier_processus_id = ANY($1::uuid[])`,
      [processus.map((p) => p.id)]
    )

    /* Le patient n'est joint QUE si le dossier en porte un — préallocation
       explicite ou allocation à la mise en fabrication. Sans cette jointure,
       l'en-tête d'un dossier rouvert annonçait « non affecté à un patient »
       alors qu'un patient était bien alloué : l'écran mentait sur l'état du
       dossier. Le contrôle reste l'existence de `patient_id`, pas la
       préallocation. */
    let patient = null
    if (rows[0].patient_id) {
      const { rows: p } = await requete(
        `SELECT pat.id, pat.reference, pat.source,
                i.nom, i.prenom, i.initiales, i.date_naissance,
                i.ipp, i.identifiants
           FROM mti.patient pat
           LEFT JOIN mti.patient_identite i ON i.patient_id = pat.id
          WHERE pat.id = $1`,
        [rows[0].patient_id])
      if (p.length) {
        patient = {
          id: p[0].id,
          reference: p[0].reference,
          source: p[0].source,
          nom: [p[0].nom, p[0].prenom].filter(Boolean).join(' ') || null,
          initiales: p[0].initiales,
          dateNaissance: p[0].date_naissance,
          ipp: p[0].ipp ?? null,
          identifiants: p[0].identifiants ?? []
        }
      }
    }

    /* Les photos remontent SANS leur contenu : une réception peut en porter
       une dizaine, et les rapatrier en base64 dans la réponse du dossier
       ferait passer celle-ci de quelques dizaines de kilo-octets à plusieurs
       méga-octets à chaque ouverture. Chaque vignette va chercher ses octets
       par son URL, que le navigateur met en cache. */
    const { rows: photos } = saisies.length
      ? await requete(
        `SELECT pj.id, pj.saisie_id, pj.libelle, pj.nom_fichier, pj.mime,
                pj.taille, pj.sha256, pj.ajoute_le,
                coalesce(u.titre || ' ', '') || u.prenom || ' ' || u.nom AS ajoute_par_libelle
           FROM mti.piece_jointe pj
           LEFT JOIN mti.utilisateur u ON u.id = pj.ajoute_par
          WHERE pj.saisie_id = ANY($1::uuid[])
          ORDER BY pj.ajoute_le`,
        [saisies.map((s) => s.id)])
      : { rows: [] }

    return { dossier: rows[0], patient, processus, saisies, photos }
  })

  // ── Photos : dépôt, lecture, retrait ─────────────────────────────────────
  //
  // La cellule « photo » ne faisait que basculer un pictogramme : elle
  // affichait ✅ sans qu'aucune image existe nulle part. Sur un dossier de
  // traçabilité, c'est pire que rien — la coche atteste d'un contrôle visuel
  // qui n'a laissé aucune preuve.
  //
  // La photo est rattachée à un POINT (processus, section, point, exemplaire,
  // rôle), pas à un identifiant de saisie : le navigateur ne connaît pas ces
  // identifiants, ils sont attribués à l'enregistrement du lot. La route crée
  // donc la saisie si elle n'existe pas encore — déposer une photo est un
  // geste de saisie à part entière, il n'a pas à en attendre un autre.

  /** Formats acceptés. Un point « photo » reçoit une image, pas un document. */
  const MIMES_PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp'])
  const TAILLE_MAX = 8 * 1024 * 1024

  /* Le plafond de corps est relevé pour CETTE route seulement. Le serveur est
     à 2 Mio, ce qui suffit à tout le reste ; une image de 8 Mio pèse 10,7 Mio
     une fois en base64, et Fastify la refuserait avant que le contrôle
     ci-dessous ait pu dire pourquoi. Un « 413 » sans message n'apprend rien à
     celui qui vient de prendre la photo. */
  app.post('/api/dossiers/:id/processus/:pid/photos', {
    bodyLimit: 12 * 1024 * 1024
  }, async (request, reply) => {
    const c = request.body ?? {}
    if (!MIMES_PHOTO.has(c.mime)) {
      return reply.code(415).send({
        erreur: `Format non accepté : ${c.mime ?? '(absent)'}. Attendu : ` +
                [...MIMES_PHOTO].join(', ') + '.'
      })
    }
    if (!Number.isInteger(c.sectionIndex) || !Number.isInteger(c.pointIndex)) {
      return reply.code(400).send({ erreur: 'sectionIndex et pointIndex doivent être des entiers.' })
    }
    if (typeof c.contenu !== 'string' || !c.contenu) {
      return reply.code(400).send({ erreur: 'contenu (base64) est requis.' })
    }

    let octets
    try {
      octets = Buffer.from(c.contenu, 'base64')
    } catch {
      return reply.code(400).send({ erreur: 'contenu illisible : base64 attendu.' })
    }
    /* Buffer.from ne signale pas une base64 invalide, il tronque en silence.
       Une pièce vide passerait donc pour un dépôt réussi. */
    if (!octets.length) {
      return reply.code(400).send({ erreur: 'contenu vide après décodage : base64 invalide ?' })
    }
    if (octets.length > TAILLE_MAX) {
      return reply.code(413).send({
        erreur: `Image trop lourde : ${Math.round(octets.length / 1024)} Kio, ` +
                `plafond ${TAILLE_MAX / 1024 / 1024} Mio.`
      })
    }

    const { rows: garde } = await requete(
      `SELECT d.statut FROM mti.dossier_processus dp
         JOIN mti.dossier d ON d.id = dp.dossier_id
        WHERE dp.id = $1 AND dp.dossier_id = $2`,
      [request.params.pid, request.params.id])
    if (!garde.length) return reply.code(404).send({ erreur: 'Processus introuvable pour ce dossier.' })
    if (garde[0].statut === 'valide') {
      return reply.code(409).send({
        erreur: "Dossier validé : lecture seule. Une correction passe par une nouvelle version."
      })
    }

    return transaction(request.utilisateur.id, request.ip, async (client) => {
      /* La saisie porteuse est créée au besoin, sans rien écraser si elle
         existe : le DO UPDATE ne touche que `saisi_le`, pour ne pas effacer un
         commentaire ou un caractère obligatoire déjà posés. */
      const { rows: [saisie] } = await client.query(
        `INSERT INTO mti.saisie
           (dossier_processus_id, section_index, point_index, point_num, point_type,
            exemplaire, operateur_role, obligatoire, operateur_id)
         VALUES ($1,$2,$3,$4,'photo',$5,$6,$7,$8)
         ON CONFLICT (dossier_processus_id, section_index, point_index, exemplaire, operateur_role)
         DO UPDATE SET saisi_le = now()
         RETURNING id`,
        [request.params.pid, c.sectionIndex, c.pointIndex, c.pointNum ?? null,
          c.exemplaire ?? 1, c.operateurRole ?? 'op1', c.obligatoire === true,
          request.utilisateur.id])

      const sha = createHash('sha256').update(octets).digest('hex')
      const { rows: [piece] } = await client.query(
        `INSERT INTO mti.piece_jointe
           (saisie_id, libelle, nom_fichier, mime, taille, sha256, contenu, ajoute_par)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, libelle, nom_fichier, mime, taille, sha256, ajoute_le`,
        [saisie.id, c.libelle || null, c.nomFichier || 'photo.jpg', c.mime,
          octets.length, sha, octets, request.utilisateur.id])

      reply.code(201)
      return { ...piece, saisie_id: saisie.id }
    })
  })

  /* Le contenu se sert par son URL, avec un cache long : l'identifiant est un
     UUID et la pièce est immuable — elle se remplace, elle ne se réécrit pas. */
  app.get('/api/photos/:id', async (request, reply) => {
    const { rows } = await requete(
      'SELECT mime, nom_fichier, contenu FROM mti.piece_jointe WHERE id = $1',
      [request.params.id])
    if (!rows.length || !rows[0].contenu) {
      return reply.code(404).send({ erreur: 'Pièce introuvable.' })
    }
    return reply
      .header('content-type', rows[0].mime)
      .header('cache-control', 'private, max-age=31536000, immutable')
      .header('content-disposition',
        `inline; filename="${String(rows[0].nom_fichier).replace(/[^\w.-]/g, '_')}"`)
      .send(rows[0].contenu)
  })

  app.delete('/api/photos/:id', async (request, reply) => {
    const { rows } = await requete(
      `SELECT d.statut FROM mti.piece_jointe pj
         JOIN mti.saisie s ON s.id = pj.saisie_id
         JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
         JOIN mti.dossier d ON d.id = dp.dossier_id
        WHERE pj.id = $1`,
      [request.params.id])
    if (!rows.length) return reply.code(404).send({ erreur: 'Pièce introuvable.' })
    if (rows[0].statut === 'valide') {
      return reply.code(409).send({ erreur: 'Dossier validé : lecture seule.' })
    }
    return transaction(request.utilisateur.id, request.ip, async (client) => {
      await client.query('DELETE FROM mti.piece_jointe WHERE id = $1', [request.params.id])
      reply.code(204)
      return null
    })
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
                seuil_applique, hors_seuil, horodatage, timer_debut, timer_fin, operateur_id,
                commentaire, numero_serie)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
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
               commentaire = EXCLUDED.commentaire,
               numero_serie = EXCLUDED.numero_serie,
               saisi_le = now()
             RETURNING id`,
            [request.params.id, s.sectionIndex, s.pointIndex, s.pointNum ?? null, s.pointType,
              s.exemplaire ?? 1, s.operateurRole ?? 'op1', s.obligatoire === true,
              s.reponse ?? null, valeur, s.valeurTexte ?? null, seuil, horsSeuil,
              s.horodatage ?? null, s.timerDebut ?? null, s.timerFin ?? null,
              s.operateurRole === 'systeme' ? null : (s.operateurId ?? request.utilisateur.id),
              /* Chaînes vides ramenées à NULL : « pas de commentaire » et
                 « commentaire vide » ne sont pas deux états à distinguer. */
              (s.commentaire ?? '').trim() || null,
              (s.numeroSerie ?? '').trim() || null]
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
                WHEN 'date'   THEN coalesce(btrim(s.valeur_texte), '') = ''
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
