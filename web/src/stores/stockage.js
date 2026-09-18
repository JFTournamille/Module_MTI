import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { appel, messageErreur } from '../api.js'

/**
 * Contenants, emplacements et réservations.
 *
 * CE QUI EST AFFICHÉ ICI N'EST QU'UN INSTANTANÉ. La liste des places libres
 * peut être périmée au moment où l'opérateur clique : c'est l'index unique en
 * base qui arbitre, et le refus qu'il produit doit remonter à l'écran tel
 * quel — « cette place vient d'être prise », et non « erreur ». Ne JAMAIS
 * décider ici qu'une place est prenable : ce serait redonner au navigateur un
 * arbitrage qui lui a été retiré exprès.
 */
export const useStockage = defineStore('stockage', () => {
  const contenants = ref([])
  const parametres = ref([])
  const chargement = ref(false)
  const erreur = ref('')

  /* Les places d'un contenant sont mises en cache PAR CONTENANT : une cuve en
     porte deux cents, et les recharger à chaque ouverture de menu ferait
     clignoter la liste sous les doigts de l'opérateur. Le cache est vidé dès
     qu'une réservation aboutit — c'est le seul moment où il devient faux de
     façon certaine. */
  const placesParContenant = reactive({})

  const contenantsActifs = computed(() => contenants.value.filter((c) => c.actif))

  const delaiExpiration = computed(() => {
    const p = parametres.value.find((x) => x.cle === 'emplacement.expiration_heures')
    return p ? Number(p.valeur) : null
  })

  async function charger () {
    chargement.value = true
    erreur.value = ''
    try {
      const [rc, rp] = await Promise.all([
        appel('/api/contenants?inactifs=oui'),
        appel('/api/parametres')
      ])
      if (rc.ok) contenants.value = await rc.json()
      if (rp.ok) parametres.value = await rp.json()
    } catch (e) {
      erreur.value = messageErreur(e, 'Référentiel de stockage indisponible.')
    } finally {
      chargement.value = false
    }
  }

  /**
   * Places d'un contenant.
   *
   * `dossierId` est passé au serveur pour qu'il CONSERVE dans la liste la
   * place déjà tenue par ce dossier : sans cela, rouvrir une fiche ferait
   * disparaître du menu l'emplacement qu'elle occupe, et l'opérateur croirait
   * sa saisie perdue.
   */
  async function chargerPlaces (contenantId, dossierId = null, force = false) {
    if (!contenantId) return []
    const cle = `${contenantId}|${dossierId ?? ''}`
    if (!force && placesParContenant[cle]) return placesParContenant[cle]
    const q = new URLSearchParams({ libres: 'oui' })
    if (dossierId) q.set('dossier', dossierId)
    const r = await appel(`/api/contenants/${contenantId}/emplacements?${q}`)
    if (!r.ok) {
      erreur.value = `Places indisponibles (${r.status}).`
      return []
    }
    placesParContenant[cle] = await r.json()
    return placesParContenant[cle]
  }

  /** Vide le cache : après toute réservation, il est faux de façon certaine. */
  function oublierPlaces () {
    for (const cle of Object.keys(placesParContenant)) delete placesParContenant[cle]
  }

  async function creerContenant (corps) {
    const r = await appel('/api/contenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps)
    })
    if (!r.ok) {
      erreur.value = await messageDe(r, `Création refusée (${r.status}).`)
      return null
    }
    await charger()
    return await r.json()
  }

  async function basculerContenant (id, actif) {
    const r = await appel(`/api/contenants/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actif })
    })
    if (!r.ok) {
      erreur.value = await messageDe(r, `Changement refusé (${r.status}).`)
      return false
    }
    await charger()
    return true
  }

  async function reglerParametre (cle, valeur) {
    const r = await appel(`/api/parametres/${encodeURIComponent(cle)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valeur })
    })
    if (!r.ok) {
      erreur.value = await messageDe(r, `Réglage refusé (${r.status}).`)
      return false
    }
    await charger()
    return true
  }

  /** Occupations d'un dossier, en vigueur et passées. */
  async function occupationsDe (dossierId) {
    if (!dossierId) return []
    const r = await appel(`/api/dossiers/${dossierId}/emplacements`)
    return r.ok ? await r.json() : []
  }

  async function messageDe (r, defaut) {
    try {
      const d = await r.json()
      return d?.erreur ?? defaut
    } catch {
      return defaut
    }
  }

  return {
    contenants,
    contenantsActifs,
    parametres,
    delaiExpiration,
    chargement,
    erreur,
    charger,
    chargerPlaces,
    oublierPlaces,
    creerContenant,
    basculerContenant,
    reglerParametre,
    occupationsDe
  }
})
