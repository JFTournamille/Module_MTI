import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { appel, messageErreur } from '../api.js'
import { useSession } from './session.js'

/**
 * Clé d'une saisie. Remplace intégralement les suffixes de noms de radios
 * (`_ex{i}`, `_cuve{i}`, `_op2_{uid}`) des maquettes HTML : la localisation
 * d'une saisie est une donnée, plus une convention de nommage dans le DOM.
 */
export const cleSaisie = (idxProcessus, idxSection, idxPoint, exemplaire, role) =>
  `${idxProcessus}|${idxSection}|${idxPoint}|${exemplaire}|${role}`

/** Format attendu par <input type="datetime-local">. */
export function versDatetimeLocal (d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const saisieVide = () => ({
  reponse: null,          // 'oui' | 'non'
  valeurNum: null,
  valeurTexte: '',
  horodatage: '',
  obligatoire: false,
  photos: [],             // [{ libelle, presente }]
  timerDebut: null,       // epoch ms
  timerFin: null,
  operateur: '',
  /* Texte libre de l'opérateur sur la ligne, restitué en bulle. */
  commentaire: '',
  /* N° de série de l'exemplaire, en complément du n° de lot. */
  numeroSerie: ''
})

export const useParcours = defineStore('parcours', () => {
  // ── Référentiels chargés depuis l'API (ou les JSON embarqués en secours) ──
  const modele = ref(null)
  const catalogue = ref(null)
  const chargement = ref(true)
  const horsLigne = ref(false)

  // ── Processus du dossier en cours ──
  const processus = ref([])
  const selection = ref(0)

  // ── En-tête du dossier ──
  const dossier = reactive({
    statut: 'brouillon',
    reference: '',
    designationProduit: '',
    codeBarre: '',
    numeroLot: 'TC-2026-0814',
    datePeremption: '2026-06-30',
    numeroOrdonnancier: '8812',
    nbExemplaires: 1,
    // Jalon de prescription : réalisée ou non. Aucune donnée de prescription
    // n'est portée ici — la source de vérité est le logiciel de prescription.
    prescriptionFaite: false,
    // Préallocation
    preallocation: false,
    patient: null,          // { reference, nom, dateNaissance }
    initiales: '',
    dateNaissance: '',
    numeroCommande: '',
    dateFabrication: '',
    transporteur: '',
    // Conclusion
    conformite: null,
    commentaire: ''
  })

  /* L'opérateur n'est plus en dur : il vient de la session. Le rendre calculé
     fait suivre la colonne « Opérateur » de la table de réception dès qu'on
     change d'opérateur en démonstration, sans réinitialiser les saisies. */
  const session = useSession()
  const operateurConnecte = computed(() =>
    session.operateur ?? { nom: '—', identifiant: '' })

  // ── Saisies : un dictionnaire plat, clé -> valeurs ──
  const saisies = reactive({})
  // Lignes pour lesquelles le double contrôle Op.2 est ouvert.
  const op2Ouverts = reactive(new Set())

  /** Horloge unique pour tous les minuteurs.
   *  Les maquettes créaient un setInterval par minuteur, jamais nettoyé lors
   *  d'un re-rendu : chaque changement de « n exemplaires » laissait des
   *  intervalles orphelins. Ici, un seul tick alimente tous les affichages. */
  const maintenant = ref(Date.now())
  let tick = null
  const demarrerHorloge = () => {
    if (!tick) tick = setInterval(() => { maintenant.value = Date.now() }, 500)
  }
  const arreterHorloge = () => { if (tick) { clearInterval(tick); tick = null } }

  // ─────────────────────────────────────────────────────────── Chargement ──

  async function charger () {
    chargement.value = true
    horsLigne.value = false
    try {
      const [rModele, rCatalogue] = await Promise.all([
        appel('/api/modeles/PARCOURS_CART_AUTOLOGUE'),
        appel('/api/catalogue')
      ])
      if (!rModele.ok || !rCatalogue.ok) throw new Error('API indisponible')
      modele.value = await rModele.json()
      catalogue.value = await rCatalogue.json()
    } catch {
      // Repli hors-ligne : les référentiels sont embarqués dans le bundle.
      // La saisie reste possible sans réseau — la réception d'un MTI ne peut
      // pas dépendre de la disponibilité du serveur.
      const [m, c] = await Promise.all([
        import('../data/parcours-cart-v2.json'),
        import('../data/catalogue-processus-v1.json')
      ])
      modele.value = m.default
      catalogue.value = c.default
      horsLigne.value = true
    } finally {
      instancierProcessus()
      chargement.value = false
      demarrerHorloge()
    }
  }

  /** Copie la définition du modèle dans les processus du dossier.
   *  Cette copie est volontaire : un dossier doit rester relisible à
   *  l'identique même après évolution du modèle (cf. db/001_schema.sql). */
  function instancierProcessus () {
    if (!modele.value) return
    processus.value = modele.value.processus.map((p, i) => ({
      ...p,
      etat: i === 0 ? 'en_cours' : 'a_venir',
      operateur: i === 0 ? operateurConnecte.value.nom : null,
      duCatalogue: false
    }))
    selection.value = 0
  }

  // ──────────────────────────────────────────────── Dossier persisté ──
  //
  // Jusqu'ici l'onglet Scénario était un formulaire sans lendemain : il lisait
  // le référentiel et n'écrivait nulle part. L'API existait pourtant en entier.
  // Ce bloc est le câblage manquant.

  const dossierId = ref(null)
  /** id API de chaque processus, indexé comme `processus`. */
  const processusIds = ref([])
  const enregistrement = ref(false)
  const dernierEnregistrement = ref(null)
  const erreurDossier = ref('')
  const lectureSeule = computed(() => dossier.statut === 'valide')

  /** Le dossier ouvert survit à un rechargement — sinon on perd sa saisie. */
  const CLE_DOSSIER = 'mti.dossier'
  const memoriserDossier = (id) => {
    try { id ? localStorage.setItem(CLE_DOSSIER, id) : localStorage.removeItem(CLE_DOSSIER) }
    catch { /* stockage refusé : on continue sans mémoire */ }
  }
  const dossierMemorise = () => {
    try { return localStorage.getItem(CLE_DOSSIER) || null } catch { return null }
  }

  // Délègue à api.js : le cas 501 (AUTH_MODE=oidc sans SSO branché) y porte son
  // explication, et il ne doit pas diverger d'un écran à l'autre.
  const messageDe = messageErreur

  /** Crée un dossier et l'ouvre. La référence est libre mais obligatoire. */
  async function creerDossier (reference, codeModele = 'PARCOURS_CART_AUTOLOGUE') {
    erreurDossier.value = ''
    try {
      const r = await appel('/api/dossiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codeModele, reference })
      })
      if (!r.ok) { erreurDossier.value = await messageDe(r, `Création refusée (${r.status}).`); return null }
      const { id } = await r.json()
      await ouvrirDossier(id)
      return id
    } catch (e) {
      erreurDossier.value = e.message || 'API injoignable.'
      return null
    }
  }

  /**
   * Ouvre un dossier persisté.
   *
   * Les processus viennent de `dossier_processus`, PAS du modèle : c'est la
   * définition figée à la création du dossier. Un dossier ouvert en 2026 doit
   * rester relisible à l'identique après une évolution du référentiel.
   */
  async function ouvrirDossier (id) {
    erreurDossier.value = ''
    try {
      const r = await appel(`/api/dossiers/${id}`)
      if (!r.ok) {
        erreurDossier.value = await messageDe(r, `Dossier illisible (${r.status}).`)
        if (r.status === 404) { dossierId.value = null; memoriserDossier(null) }
        return false
      }
      const d = await r.json()
      dossierId.value = d.dossier.id
      memoriserDossier(d.dossier.id)

      const j = (v) => (v ? String(v).slice(0, 10) : '')
      Object.assign(dossier, {
        reference: d.dossier.reference ?? '',
        designationProduit: d.dossier.designation_produit ?? '',
        codeBarre: d.dossier.code_barre ?? '',
        numeroLot: d.dossier.numero_lot ?? '',
        datePeremption: j(d.dossier.date_peremption),
        numeroOrdonnancier: d.dossier.numero_ordonnancier ?? '',
        numeroCommande: d.dossier.numero_commande ?? '',
        dateFabrication: j(d.dossier.date_fabrication),
        transporteur: d.dossier.transporteur ?? '',
        nbExemplaires: d.dossier.nb_exemplaires ?? 1,
        preallocation: d.dossier.preallocation === true,
        prescriptionFaite: d.dossier.prescription_faite === true,
        conformite: d.dossier.conformite ?? null,
        commentaire: d.dossier.commentaire ?? '',
        statut: d.dossier.statut,
        /* Le patient vient du serveur, qui ne le joint que si le dossier en
           porte un. L'omettre ici faisait annoncer « en attente d'allocation »
           sur un dossier alloué. */
        patient: d.patient ?? null,
        initiales: d.patient?.initiales ?? '',
        dateNaissance: d.patient?.dateNaissance
          ? String(d.patient.dateNaissance).slice(0, 10) : ''
      })

      processus.value = d.processus.map((p) => ({
        code: p.code,
        nom: p.nom,
        gabarit: p.gabarit,
        externe: p.externe === true,
        sections: p.definition?.sections ?? [],
        etat: p.etat,
        operateur: null,
        duCatalogue: p.ajoute_du_catalogue === true
      }))
      processusIds.value = d.processus.map((p) => p.id)

      Object.keys(saisies).forEach((k) => delete saisies[k])
      op2Ouverts.clear()
      const parId = new Map(d.processus.map((p, i) => [p.id, i]))
      for (const s of d.saisies ?? []) {
        const idx = parId.get(s.dossier_processus_id)
        if (idx === undefined) continue
        const cle = cleSaisie(idx, s.section_index, s.point_index, s.exemplaire, s.operateur_role)
        saisies[cle] = {
          reponse: s.reponse,
          valeurNum: s.valeur_num === null ? null : Number(s.valeur_num),
          valeurTexte: s.valeur_texte ?? '',
          horodatage: s.horodatage ? versDatetimeLocal(new Date(s.horodatage)) : '',
          obligatoire: s.obligatoire === true,
          /* Les pièces jointes ne sont pas encore persistées (mti.piece_jointe
             existe, le stockage reste à faire) : on rétablit la structure
             attendue par l'affichage, sans prétendre retrouver les photos. */
          photos: s.point_type === 'photo'
            ? [{ libelle: 'Avant', presente: false }, { libelle: 'Après', presente: false }]
            : [],
          timerDebut: s.timer_debut ? new Date(s.timer_debut).getTime() : null,
          timerFin: s.timer_fin ? new Date(s.timer_fin).getTime() : null,
          operateur: s.operateur_libelle ?? '',
          commentaire: s.commentaire ?? '',
          numeroSerie: s.numero_serie ?? ''
        }
        if (s.operateur_role === 'op2') {
          op2Ouverts.add(cleSaisie(idx, s.section_index, s.point_index, s.exemplaire, 'op1'))
        }
      }

      // On reprend là où le dossier en est, pas au début.
      const enCours = d.processus.findIndex((p) => p.etat !== 'valide')
      selection.value = enCours >= 0 ? enCours : 0
      await chargerSignatures()
      return true
    } catch (e) {
      erreurDossier.value = e.message || 'API injoignable.'
      return false
    }
  }

  /** Enregistre l'en-tête (produit, lot, péremption, préallocation…). */
  async function enregistrerEntete () {
    if (!dossierId.value || lectureSeule.value) return false
    const r = await appel(`/api/dossiers/${dossierId.value}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        designationProduit: dossier.designationProduit,
        numeroLot: dossier.numeroLot,
        codeBarre: dossier.codeBarre,
        datePeremption: dossier.datePeremption || null,
        numeroOrdonnancier: dossier.numeroOrdonnancier,
        numeroCommande: dossier.numeroCommande,
        dateFabrication: dossier.dateFabrication || null,
        transporteur: dossier.transporteur,
        nbExemplaires: Number(dossier.nbExemplaires) || 1,
        preallocation: dossier.preallocation === true,
        prescriptionFaite: dossier.prescriptionFaite === true,
        patientId: dossier.preallocation ? (dossier.patient?.id ?? null) : null
      })
    })
    if (!r.ok) { erreurDossier.value = await messageDe(r, `En-tête non enregistré (${r.status}).`); return false }
    return true
  }

  /**
   * Enregistre les saisies d'un processus.
   *
   * Seules les saisies déjà touchées sont envoyées : l'accès est paresseux, une
   * clé absente signifie « point jamais renseigné », ce qui n'est pas la même
   * chose qu'un point vidé.
   */
  async function enregistrerProcessus (idx = selection.value) {
    if (!dossierId.value) { erreurDossier.value = 'Aucun dossier ouvert.'; return false }
    const p = processus.value[idx]
    if (!p) return false
    const pid = processusIds.value[idx]
    if (!pid) {
      erreurDossier.value = `« ${p.nom} » n'existe pas côté serveur : ses saisies ne ` +
        'seraient pas enregistrées. Rouvrez le dossier.'
      return false
    }

    const lot = []
    for (const [iS, section] of (p.sections ?? []).entries()) {
      for (const [iP, point] of (section.points ?? []).entries()) {
        const copies = nbCopies(point)
        for (let ex = 1; ex <= copies; ex++) {
          const cleOp1 = cleSaisie(idx, iS, iP, ex, 'op1')
          for (const role of ['op1', 'op2']) {
            const cle = role === 'op1' ? cleOp1 : cleOp2(cleOp1)
            const s = saisies[cle]
            if (!s) continue
            if (role === 'op2' && !op2Ouverts.has(cleOp1)) continue
            const num = s.valeurNum
            lot.push({
              sectionIndex: iS,
              pointIndex: iP,
              pointNum: point.num ?? null,
              pointType: point.type,
              exemplaire: ex,
              operateurRole: role,
              obligatoire: s.obligatoire === true,
              reponse: s.reponse,
              valeurNum: num === '' || num === null || num === undefined ? null : Number(num),
              valeurTexte: s.valeurTexte || null,
              /* Le seuil part avec la saisie : c'est le serveur qui figera
                 l'alarme, pas l'affichage. */
              seuil: point.seuil ?? null,
              horodatage: s.horodatage ? new Date(s.horodatage).toISOString() : null,
              timerDebut: s.timerDebut ? new Date(s.timerDebut).toISOString() : null,
              timerFin: s.timerFin ? new Date(s.timerFin).toISOString() : null,
              commentaire: s.commentaire || null,
              numeroSerie: s.numeroSerie || null
            })
          }
        }
      }
    }
    if (!lot.length) return true

    enregistrement.value = true
    erreurDossier.value = ''
    try {
      const r = await appel(`/api/processus/${pid}/saisies`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ saisies: lot })
      })
      if (!r.ok) {
        erreurDossier.value = await messageDe(r, `Enregistrement refusé (${r.status}).`)
        return false
      }
      dernierEnregistrement.value = new Date()
      return true
    } catch (e) {
      erreurDossier.value = e.message || 'API injoignable — saisies NON enregistrées.'
      return false
    } finally {
      enregistrement.value = false
    }
  }

  /** Enregistre tout (en-tête et processus courant) puis valide le dossier. */
  async function validerDossier () {
    if (!dossierId.value) { erreurDossier.value = 'Aucun dossier ouvert.'; return false }
    if (!dossier.conformite) { erreurDossier.value = 'Conclure la conformité avant de valider.'; return false }
    if (!(await enregistrerEntete())) return false
    if (!(await enregistrerProcessus())) return false

    const r = await appel(`/api/dossiers/${dossierId.value}/valider`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conformite: dossier.conformite, commentaire: dossier.commentaire || null })
    })
    if (!r.ok) {
      const corps = await r.json().catch(() => null)
      if (r.status === 422 && corps?.details?.length) {
        erreurDossier.value = `${corps.erreur} : ` +
          corps.details.map((d) => `${d.point_num ?? '?'} (${d.processus})`).join(', ')
      } else {
        erreurDossier.value = corps?.erreur ?? `Validation refusée (${r.status}).`
      }
      return false
    }
    await ouvrirDossier(dossierId.value)
    return true
  }

  /** Bascule le jalon de prescription et l'enregistre aussitôt : un jalon coché
   *  qui attendrait un « Enregistrer » se perdrait au changement d'onglet. */
  async function basculerPrescription () {
    if (!dossierId.value || lectureSeule.value) return false
    dossier.prescriptionFaite = !dossier.prescriptionFaite
    const ok = await enregistrerEntete()
    if (!ok) dossier.prescriptionFaite = !dossier.prescriptionFaite
    return ok
  }

  /**
   * Fait avancer un processus. Valider ouvre le suivant encore à venir.
   *
   * Les saisies du processus sont enregistrées d'abord : les valider puis les
   * perdre serait le pire enchaînement possible.
   */
  async function changerEtatProcessus (etat, idx = selection.value) {
    if (!dossierId.value || lectureSeule.value) return false
    const pid = processusIds.value[idx]
    if (!pid) {
      erreurDossier.value = 'Ce processus n\'existe pas côté serveur. Rouvrez le dossier.'
      return false
    }
    if (etat === 'valide' && !(await enregistrerProcessus(idx))) return false

    erreurDossier.value = ''
    const r = await appel(`/api/processus/${pid}/etat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ etat })
    })
    if (!r.ok) {
      erreurDossier.value = await messageDe(r, `Avancement refusé (${r.status}).`)
      return false
    }
    /* Relire le dossier plutôt que de recalculer localement : c'est le serveur
       qui décide quel processus s'ouvre ensuite. */
    const cible = selection.value
    await ouvrirDossier(dossierId.value)
    if (etat !== 'valide') selection.value = cible
    return true
  }

  function fermerDossier () {
    dossierId.value = null
    processusIds.value = []
    memoriserDossier(null)
  }

  // ────────────────────────────────────────────────────────────── Lignes ──

  /**
   * Nombre de copies d'un point.
   *
   * `exemplaires: n` — compte PROPRE au point, indépendant du dossier. C'est ce
   * qu'exige un kit : trois tubes CD4 et deux tubes CD8 ne se comptent pas
   * ensemble, et surtout pas avec le nombre d'exemplaires du produit.
   * `multi: 'photo' | 'cuve'` — compte porté par le dossier, comme avant.
   */
  const nbCopies = (point) => {
    if (point.exemplaires) return Math.max(1, Math.min(12, Number(point.exemplaires)))
    return point.multi ? Math.max(1, Math.min(10, Number(dossier.nbExemplaires) || 1)) : 1
  }

  /**
   * Développe les sections du processus de réception en lignes affichables.
   * Remplace `applyNExemplaires()` et son clonage de DOM : ici la duplication
   * est un simple calcul, donc toujours cohérente avec l'état.
   */
  const lignesReception = computed(() => {
    const p = processus.value[selection.value]
    if (!p || p.gabarit !== 'reception') return []
    const lignes = []
    p.sections.forEach((section, idxSection) => {
      lignes.push({ genre: 'section', titre: section.titre, cle: `s${idxSection}` })
      let kitCourant = null
      section.points.forEach((point, idxPoint) => {
        /* En-tête de kit : les étapes propres à chaque composant restent
           regroupées, avec la composition sous les yeux de l'opérateur. */
        if (point.kit && point.kit !== kitCourant) {
          const kit = (section.kits ?? []).find((k) => k.id === point.kit)
          if (kit) lignes.push({ genre: 'kit', kit, cle: `k${idxSection}-${point.kit}` })
          kitCourant = point.kit
        } else if (!point.kit) {
          kitCourant = null
        }
        const copies = nbCopies(point)
        for (let ex = 1; ex <= copies; ex++) {
          lignes.push({
            genre: 'point',
            point,
            idxSection,
            idxPoint,
            exemplaire: ex,
            copies,
            cle: cleSaisie(selection.value, idxSection, idxPoint, ex, 'op1')
          })
        }
      })
    })
    return lignes
  })

  const lignesStandard = computed(() => {
    const p = processus.value[selection.value]
    if (!p || p.gabarit === 'reception') return []
    const sections = p.sections?.length
      ? p.sections
      : [{ titre: p.nom, points: [{ libelle: 'Points de contrôle à définir', type: 'texte' }] }]
    const lignes = []
    sections.forEach((section, idxSection) => {
      lignes.push({ genre: 'section', titre: section.titre, cle: `s${idxSection}` })
      let kitCourant = null
      section.points.forEach((point, idxPoint) => {
        if (point.kit && point.kit !== kitCourant) {
          const kit = (section.kits ?? []).find((k) => k.id === point.kit)
          if (kit) lignes.push({ genre: 'kit', kit, cle: `k${idxSection}-${point.kit}` })
          kitCourant = point.kit
        } else if (!point.kit) {
          kitCourant = null
        }
        /* Les processus standard portent eux aussi des exemplaires : la poche
           d'aphérèse en a deux, chacune avec son n° de série. */
        const copies = nbCopies(point)
        for (let ex = 1; ex <= copies; ex++) {
          lignes.push({
            genre: 'point',
            point,
            idxSection,
            idxPoint,
            exemplaire: ex,
            copies,
            cle: cleSaisie(selection.value, idxSection, idxPoint, ex, 'op1')
          })
        }
      })
    })
    return lignes
  })

  // ────────────────────────────────────────────────────────────── Saisies ──

  /** Accès paresseux : la saisie est créée au premier usage, avec le caractère
   *  obligatoire hérité du modèle mais modifiable par l'opérateur (bouton ★). */
  function saisie (cle, pointParDefaut = null) {
    if (!saisies[cle]) {
      const s = saisieVide()
      if (pointParDefaut) {
        s.obligatoire = pointParDefaut.obligatoire === true
        if (pointParDefaut.type === 'photo') {
          s.photos = [{ libelle: 'Avant', presente: false }, { libelle: 'Après', presente: false }]
        }
      }
      saisies[cle] = s
    }
    return saisies[cle]
  }

  const basculerObligatoire = (cle, point) => {
    const s = saisie(cle, point)
    s.obligatoire = !s.obligatoire
  }

  /** Lignes dont le commentaire est déplié. */
  const commentairesOuverts = reactive(new Set())
  const commentaireOuvert = (cle) => commentairesOuverts.has(cle)
  const basculerCommentaire = (cle) => {
    commentairesOuverts.has(cle) ? commentairesOuverts.delete(cle) : commentairesOuverts.add(cle)
  }

  // ── Contresignature de processus par une 2e personne ──
  const signatures = ref([])

  /** Points du processus soumis à double validation. */
  function pointsDoubleValidation (idx = selection.value) {
    const p = processus.value[idx]
    if (!p) return []
    return (p.sections ?? []).flatMap((sc) => (sc.points ?? []))
      .filter((pt) => pt.doubleValidation === true)
  }

  /** Contresignature posée sur le processus courant, s'il y en a une. */
  function contresignature (idx = selection.value) {
    const pid = processusIds.value[idx]
    if (!pid) return null
    return signatures.value.find((s) => s.processusId === pid && s.role === 'verificateur') ?? null
  }

  async function chargerSignatures () {
    if (!dossierId.value) { signatures.value = []; return }
    const r = await appel(`/api/dossiers/${dossierId.value}/signatures`)
    signatures.value = r.ok ? await r.json() : []
  }

  /** Contresigne le processus courant. La 2e personne doit être une autre. */
  async function contresigner (utilisateurId, idx = selection.value) {
    const pid = processusIds.value[idx]
    if (!pid) return false
    erreurDossier.value = ''
    if (!(await enregistrerProcessus(idx))) return false
    const r = await appel(`/api/processus/${pid}/contresigner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ utilisateurId })
    })
    if (!r.ok) {
      erreurDossier.value = await messageDe(r, `Contresignature refusée (${r.status}).`)
      return false
    }
    await chargerSignatures()
    return true
  }

  // ── Double contrôle ──
  const cleOp2 = (cle) => cle.replace(/\|op1$/, '|op2')
  const op2Ouvert = (cle) => op2Ouverts.has(cle)
  function basculerOp2 (cle) {
    if (op2Ouverts.has(cle)) {
      op2Ouverts.delete(cle)
      delete saisies[cleOp2(cle)]   // pas de saisie Op.2 orpheline
    } else {
      op2Ouverts.add(cle)
      saisie(cleOp2(cle))
    }
  }

  // ── Alarme température ──
  /** Calculée à l'affichage, mais c'est la valeur figée à l'enregistrement qui
   *  fait foi côté base (`saisie.hors_seuil`). */
  function alarme (cle, point) {
    const seuil = point.seuil
    if (seuil === undefined || seuil === null) return null
    const v = saisies[cle]?.valeurNum
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return null
    const valeur = Number(v)
    return { horsSeuil: valeur > seuil, valeur, seuil }
  }

  // ── Minuteurs ──
  function demarrerMinuteur (cle) {
    const s = saisie(cle)
    if (s.timerDebut && !s.timerFin) return
    s.timerDebut = Date.now()
    s.timerFin = null
  }
  function arreterMinuteur (cle) {
    const s = saisie(cle)
    if (!s.timerDebut || s.timerFin) return
    s.timerFin = Date.now()
    if (!s.horodatage) s.horodatage = versDatetimeLocal(new Date(s.timerFin))
  }
  function dureeMinuteur (cle) {
    const s = saisies[cle]
    if (!s?.timerDebut) return '00:00'
    const fin = s.timerFin ?? maintenant.value
    const total = Math.max(0, Math.floor((fin - s.timerDebut) / 1000))
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }
  const minuteurEnCours = (cle) => !!saisies[cle]?.timerDebut && !saisies[cle]?.timerFin

  // ────────────────────────────────────────── Identification du patient ──

  /** Règle métier : le parcours est anonyme jusqu'à la mise en fabrication.
   *  Avant cette étape, seule une préallocation explicite fait apparaître
   *  l'identité. C'est aussi ce qui limite l'exposition des données de santé. */
  const patientIdentifie = computed(() => {
    // Un patient rattaché, quelle qu'en soit l'origine — préallocation
    // explicite ou allocation à la mise en fabrication — est identifié.
    if (dossier.patient) return true
    return selection.value >= (modele.value?.indexIdentificationPatient ?? Infinity)
  })

  const libellePatient = computed(() => {
    if (dossier.patient) {
      return { texte: `${dossier.patient.nom} • N° ${dossier.patient.reference}`, style: 'nomme' }
    }
    if (patientIdentifie.value) {
      return { texte: 'Patient à identifier à la mise en fabrication', style: 'attente' }
    }
    /* « En attente d'allocation », pas « non affecté » : le dossier n'est pas
       en défaut, il est à un stade du parcours où l'identité n'a pas encore
       lieu d'être — et c'est le libellé retenu au tableau de bord. */
    return { texte: "En attente d'allocation", style: 'anonyme' }
  })

  const ordonnancierVisible = computed(() =>
    selection.value >= (modele.value?.indexIdentificationPatient ?? Infinity))

  function basculerPreallocation (actif) {
    dossier.preallocation = actif
    if (!actif) {
      dossier.patient = null
      dossier.initiales = ''
      dossier.dateNaissance = ''
    }
  }

  function choisirPatient (patient) {
    dossier.patient = patient
    dossier.preallocation = true
    if (patient?.dateNaissance) dossier.dateNaissance = patient.dateNaissance
  }

  // ───────────────────────────────────────── Ajout depuis le catalogue ──

  /**
   * Ajoute un processus du catalogue.
   *
   * Sur un dossier persisté, l'ajout passe par l'API : sans `dossier_processus`
   * correspondant, les saisies du processus ajouté n'auraient nulle part où
   * aller et l'enregistrement échouerait sans le dire.
   */
  async function ajouterProcessus (item) {
    if (dossierId.value) {
      erreurDossier.value = ''
      const r = await appel(`/api/dossiers/${dossierId.value}/processus`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: item.code, nom: item.nom, gabarit: 'standard',
          externe: false, sections: item.sections ?? []
        })
      })
      if (!r.ok) {
        erreurDossier.value = await messageDe(r, `Ajout refusé (${r.status}).`)
        return false
      }
      const cree = await r.json()
      processus.value.push({
        code: cree.code, nom: cree.nom, gabarit: cree.gabarit,
        externe: cree.externe === true, sections: cree.definition?.sections ?? [],
        etat: cree.etat, operateur: null, duCatalogue: true
      })
      processusIds.value.push(cree.id)
      selection.value = processus.value.length - 1
      return true
    }

    // Hors dossier (repli hors-ligne) : ajout local, non enregistré.
    processus.value.push({
      n: processus.value.length + 1,
      code: item.code,
      nom: item.nom,
      gabarit: 'standard',
      externe: false,
      sections: item.sections,
      etat: 'a_venir',
      operateur: null,
      duCatalogue: true
    })
    selection.value = processus.value.length - 1
    return true
  }

  /** Changer de processus enregistre celui qu'on quitte : sinon une saisie
   *  disparaîtrait sans avertissement, ce qu'aucun opérateur ne peut deviner. */
  async function selectionner (i) {
    if (dossierId.value && !lectureSeule.value && i !== selection.value) {
      await enregistrerProcessus(selection.value)
    }
    selection.value = i
  }
  const processusCourant = computed(() => processus.value[selection.value] ?? null)

  // ────────────────────────────────────── Contrôle de complétude ──

  /** Points obligatoires non renseignés du processus courant.
   *  Sert au blocage de la validation — ce que les maquettes ne faisaient pas. */
  const pointsIncomplets = computed(() => {
    const lignes = processusCourant.value?.gabarit === 'reception'
      ? lignesReception.value
      : lignesStandard.value
    return lignes
      .filter((l) => l.genre === 'point')
      .filter((l) => {
        const s = saisies[l.cle]
        const obligatoire = s ? s.obligatoire : l.point.obligatoire === true
        if (!obligatoire) return false
        if (!s) return true
        switch (l.point.type) {
          case 'ouinon': return s.reponse === null
          case 'valeur': return s.valeurNum === null || s.valeurNum === ''
          case 'texte': case 'date': return !s.valeurTexte.trim()
          case 'timer': return !s.timerDebut
          case 'photo': return !s.photos.some((p) => p.presente)
          case 'auto': return false
          default: return false
        }
      })
      .map((l) => ({ num: l.point.num, libelle: l.point.libelle, exemplaire: l.exemplaire }))
  })

  return {
    modele, catalogue, chargement, horsLigne,
    processus, selection, processusCourant, dossier, operateurConnecte,
    saisies, lignesReception, lignesStandard, nbCopies,
    charger, instancierProcessus, selectionner, ajouterProcessus,
    dossierId, processusIds, enregistrement, dernierEnregistrement, erreurDossier,
    lectureSeule, creerDossier, ouvrirDossier, enregistrerEntete,
    enregistrerProcessus, validerDossier, fermerDossier, dossierMemorise,
    changerEtatProcessus,
    commentaireOuvert, basculerCommentaire,
    signatures, pointsDoubleValidation, contresignature, chargerSignatures, contresigner,
    basculerPrescription,
    saisie, basculerObligatoire,
    op2Ouvert, basculerOp2, cleOp2,
    alarme,
    demarrerMinuteur, arreterMinuteur, dureeMinuteur, minuteurEnCours,
    patientIdentifie, libellePatient, ordonnancierVisible,
    basculerPreallocation, choisirPatient,
    pointsIncomplets, arreterHorloge
  }
})
