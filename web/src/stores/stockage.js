import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { appel, messageErreur } from '../api.js'

/**
 * Contenants et emplacements — un référentiel de places, rien de plus.
 *
 * IL N'Y A PLUS DE RÉSERVATION : ni disponibilité, ni délai. Une place existe
 * et elle est en service, ou non. C'est la SAISIE qui dit où un MTI a été
 * posé, par qui et à quelle heure — et elle seule est figée par la validation
 * du dossier.
 */
export const useStockage = defineStore('stockage', () => {
  const contenants = ref([])
  const parametres = ref([])
  const chargement = ref(false)
  const erreur = ref('')

  /* Les places d'un contenant sont mises en cache : une cuve en porte deux
     cents, et les recharger à chaque ouverture de menu ferait clignoter la
     liste sous les doigts de l'opérateur. Le référentiel ne bouge qu'en
     Codifications, où `charger()` le rafraîchit. */
  const placesParContenant = reactive({})

  const contenantsActifs = computed(() => contenants.value.filter((c) => c.actif))

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
   * Places EN SERVICE d'un contenant, telles que le menu de saisie les propose.
   *
   * Une place sortie du service n'est pas proposée : la choisir n'aurait aucun
   * sens. Rien d'autre n'est filtré — une place n'est ni libre ni occupée.
   */
  async function chargerPlaces (contenantId, force = false) {
    if (!contenantId) return []
    if (!force && placesParContenant[contenantId]) return placesParContenant[contenantId]
    const r = await appel(`/api/contenants/${contenantId}/emplacements?enService=oui`)
    if (!r.ok) {
      erreur.value = `Places indisponibles (${r.status}).`
      return []
    }
    placesParContenant[contenantId] = await r.json()
    return placesParContenant[contenantId]
  }

  /** Vide le cache — après une mise hors service depuis Codifications. */
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
    chargement,
    erreur,
    charger,
    chargerPlaces,
    oublierPlaces,
    creerContenant,
    basculerContenant,
    reglerParametre
  }
})
