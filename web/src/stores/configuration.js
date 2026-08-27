import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appel, messageErreur } from '../api.js'

/**
 * Onglet Configuration : le modèle de parcours et ses points de contrôle.
 *
 * Une seule règle gouverne tout ce fichier : **on ne modifie pas un modèle, on
 * en publie une nouvelle version.** L'édition se fait donc sur un BROUILLON
 * local — une copie profonde de la version active — et « Publier » crée
 * `version + 1` côté serveur.
 *
 * Ce n'est pas de la prudence excessive. `dossier_processus.definition` porte
 * une copie figée de la définition à la création du dossier : modifier le
 * modèle en place ne toucherait de toute façon pas aux dossiers ouverts, mais
 * ferait perdre la trace de ce qui a été appliqué à quel dossier. Or ce qui a
 * été contrôlé doit rester relisible tel qu'il a été prescrit au moment du
 * contrôle.
 */
const CODE = 'PARCOURS_CART_AUTOLOGUE'

/** Types de points, alignés sur l'enum `mti.type_point`. */
export const TYPES_POINT = [
  ['ouinon', 'Oui / Non'],
  ['valeur', 'Valeur (°C, numération…)'],
  ['texte', 'Texte libre'],
  ['date', 'Date'],
  ['photo', 'Photo'],
  ['timer', 'Minuteur'],
  ['auto', 'Automatique (à la validation)']
]

const copie = (x) => JSON.parse(JSON.stringify(x))

export const useConfiguration = defineStore('configuration', () => {
  /** Brouillon éditable — jamais la version active elle-même. */
  const brouillon = ref(null)
  const versionBase = ref(null)
  const versions = ref([])
  const chargement = ref(false)
  const erreur = ref('')
  const message = ref('')
  const indisponible = ref(false)

  const iProcessus = ref(0)
  const iSection = ref(0)
  const iPoint = ref(0)

  const processus = computed(() => brouillon.value?.processus ?? [])
  const processusCourant = computed(() => processus.value[iProcessus.value] ?? null)
  const sectionCourante = computed(() =>
    processusCourant.value?.sections?.[iSection.value] ?? null)
  const pointCourant = computed(() =>
    sectionCourante.value?.points?.[iPoint.value] ?? null)

  /* Nombre de dossiers ouverts sous la version active : c'est ce qui dit à
     l'utilisateur ce que publier ne changera PAS. Sans ce chiffre, « publier »
     a l'air d'une modification rétroactive. */
  const versionActive = computed(() => versions.value.find((v) => v.actif) ?? null)

  /** Vrai dès que le brouillon diffère de la version dont il est issu. */
  const modifie = ref(false)
  const marquer = () => { modifie.value = true; message.value = '' }

  async function charger () {
    chargement.value = true
    erreur.value = ''
    try {
      const [rM, rV] = await Promise.all([
        appel(`/api/modeles/${CODE}`),
        appel(`/api/modeles/${CODE}/versions`)
      ])
      if (!rM.ok) throw new Error(await messageErreur(rM, `Modèle illisible (${rM.status}).`))
      if (!rV.ok) throw new Error(await messageErreur(rV, `Versions illisibles (${rV.status}).`))
      const m = await rM.json()
      versions.value = await rV.json()
      versionBase.value = m.version
      brouillon.value = copie(m)
      modifie.value = false
      indisponible.value = false
      iProcessus.value = 0; iSection.value = 0; iPoint.value = 0
    } catch (e) {
      indisponible.value = true
      erreur.value = e.message || 'API injoignable.'
      brouillon.value = null
    } finally {
      chargement.value = false
    }
  }

  function choisirProcessus (i) {
    iProcessus.value = i; iSection.value = 0; iPoint.value = 0
  }
  function choisirPoint (iS, iP) { iSection.value = iS; iPoint.value = iP }

  // ── Processus ─────────────────────────────────────────────────────────────

  function ajouterProcessus () {
    const n = processus.value.length + 1
    processus.value.push({
      code: `NOUVEAU_${n}`,
      nom: `Nouveau processus ${n}`,
      gabarit: 'standard',
      externe: false,
      sections: [{
        titre: 'Section 1',
        kits: [],
        points: [{ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false }]
      }]
    })
    choisirProcessus(processus.value.length - 1)
    marquer()
  }

  function retirerProcessus (i) {
    if (processus.value.length <= 1) return
    processus.value.splice(i, 1)
    choisirProcessus(Math.min(i, processus.value.length - 1))
    marquer()
  }

  function deplacerProcessus (i, sens) {
    const j = i + sens
    if (j < 0 || j >= processus.value.length) return
    const [p] = processus.value.splice(i, 1)
    processus.value.splice(j, 0, p)
    choisirProcessus(j)
    marquer()
  }

  // ── Sections, kits et points ──────────────────────────────────────────────

  function ajouterSection () {
    const p = processusCourant.value
    if (!p) return
    p.sections.push({
      titre: `Section ${p.sections.length + 1}`,
      kits: [],
      points: [{ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false }]
    })
    choisirPoint(p.sections.length - 1, 0)
    marquer()
  }

  function retirerSection (iS) {
    const p = processusCourant.value
    if (!p || p.sections.length <= 1) return
    p.sections.splice(iS, 1)
    choisirPoint(Math.min(iS, p.sections.length - 1), 0)
    marquer()
  }

  function ajouterPoint (iS) {
    const sc = processusCourant.value?.sections?.[iS]
    if (!sc) return
    sc.points.push({ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false })
    choisirPoint(iS, sc.points.length - 1)
    marquer()
  }

  function retirerPoint (iS, iP) {
    const sc = processusCourant.value?.sections?.[iS]
    if (!sc || sc.points.length <= 1) return
    sc.points.splice(iP, 1)
    choisirPoint(iS, Math.min(iP, sc.points.length - 1))
    marquer()
  }

  /**
   * Change une propriété du point courant, en tenant les dépendances.
   *
   * Ces règles sont les mêmes que celles du serveur, appliquées ici pour que
   * l'écran n'autorise pas une combinaison qu'il refusera à la publication :
   * un seuil n'a de sens que sur un relevé de valeur, un n° de série suppose
   * plusieurs exemplaires.
   */
  function poser (champ, valeur) {
    const pt = pointCourant.value
    if (!pt) return
    pt[champ] = valeur
    if (champ === 'type' && valeur !== 'valeur') delete pt.seuil
    if (champ === 'exemplaires') {
      const n = Number(valeur)
      if (!Number.isInteger(n) || n < 2) { delete pt.exemplaires; pt.numeroSerie = false }
      else pt.exemplaires = n
    }
    if (champ === 'numeroSerie' && valeur && !(Number(pt.exemplaires) > 1 || pt.multi)) {
      pt.exemplaires = 2
    }
    marquer()
  }

  function ajouterKit () {
    const sc = sectionCourante.value
    if (!sc) return
    sc.kits = sc.kits ?? []
    const n = sc.kits.length + 1
    sc.kits.push({ id: `KIT_${n}`, nom: `Kit ${n}`, composition: '' })
    marquer()
  }

  function retirerKit (i) {
    const sc = sectionCourante.value
    if (!sc?.kits) return
    const [k] = sc.kits.splice(i, 1)
    // Un point rattaché à un kit disparu porterait une référence morte, que le
    // serveur refuserait à la publication.
    for (const pt of sc.points ?? []) if (pt.kit === k?.id) delete pt.kit
    marquer()
  }

  // ── Publication ───────────────────────────────────────────────────────────

  /** Publie le brouillon comme version suivante, et la rend active. */
  async function publier () {
    if (!brouillon.value) return false
    erreur.value = ''
    message.value = ''
    const { code, version, actif, ...definition } = brouillon.value
    const r = await appel(`/api/modeles/${CODE}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition })
    })
    if (!r.ok) {
      erreur.value = await messageErreur(r, `Publication refusée (${r.status}).`)
      return false
    }
    const publie = await r.json()
    message.value = `Version ${publie.version} publiée et mise en service. ` +
      'Les dossiers déjà ouverts conservent leur définition figée.'
    await charger()
    return true
  }

  /** Abandonne le brouillon et repart de la version active. */
  async function annuler () { await charger() }

  return {
    brouillon, versionBase, versions, versionActive, chargement, erreur, message,
    indisponible, modifie,
    iProcessus, iSection, iPoint,
    processus, processusCourant, sectionCourante, pointCourant,
    charger, choisirProcessus, choisirPoint, marquer,
    ajouterProcessus, retirerProcessus, deplacerProcessus,
    ajouterSection, retirerSection, ajouterPoint, retirerPoint,
    poser, ajouterKit, retirerKit,
    publier, annuler
  }
})
