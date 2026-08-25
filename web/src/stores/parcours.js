import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

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
  operateur: ''
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
    reference: '',
    designationProduit: '',
    codeBarre: '',
    numeroLot: 'TC-2026-0814',
    datePeremption: '2026-06-30',
    numeroOrdonnancier: '8812',
    nbExemplaires: 1,
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

  const operateurConnecte = ref({ nom: 'M. Martin DURAND', identifiant: 'mdurand' })

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
        fetch('/api/modeles/PARCOURS_CART_AUTOLOGUE'),
        fetch('/api/catalogue')
      ])
      if (!rModele.ok || !rCatalogue.ok) throw new Error('API indisponible')
      modele.value = await rModele.json()
      catalogue.value = await rCatalogue.json()
    } catch {
      // Repli hors-ligne : les référentiels sont embarqués dans le bundle.
      // La saisie reste possible sans réseau — la réception d'un MTI ne peut
      // pas dépendre de la disponibilité du serveur.
      const [m, c] = await Promise.all([
        import('../data/parcours-cart-v1.json'),
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

  // ────────────────────────────────────────────────────────────── Lignes ──

  /** Nombre de copies d'un point selon son mode de duplication.
   *  `multi: 'photo' | 'cuve'` → n exemplaires ; `false` → 1. */
  const nbCopies = (point) =>
    point.multi ? Math.max(1, Math.min(10, Number(dossier.nbExemplaires) || 1)) : 1

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
      section.points.forEach((point, idxPoint) => {
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
      section.points.forEach((point, idxPoint) => {
        lignes.push({
          genre: 'point',
          point,
          idxSection,
          idxPoint,
          exemplaire: 1,
          copies: 1,
          cle: cleSaisie(selection.value, idxSection, idxPoint, 1, 'op1')
        })
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
    if (dossier.preallocation && dossier.patient) return true
    return selection.value >= (modele.value?.indexIdentificationPatient ?? Infinity)
  })

  const libellePatient = computed(() => {
    if (dossier.preallocation && dossier.patient) {
      return { texte: `${dossier.patient.nom} • N° ${dossier.patient.reference}`, style: 'nomme' }
    }
    if (patientIdentifie.value) {
      return { texte: 'Patient à identifier à la mise en fabrication', style: 'attente' }
    }
    return { texte: 'Non affecté à un patient', style: 'anonyme' }
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

  function ajouterProcessus (item) {
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
  }

  const selectionner = (i) => { selection.value = i }
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
          case 'texte': return !s.valeurTexte.trim()
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
    saisie, basculerObligatoire,
    op2Ouvert, basculerOp2, cleOp2,
    alarme,
    demarrerMinuteur, arreterMinuteur, dureeMinuteur, minuteurEnCours,
    patientIdentifie, libellePatient, ordonnancierVisible,
    basculerPreallocation, choisirPatient,
    pointsIncomplets, arreterHorloge
  }
})
