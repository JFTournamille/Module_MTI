import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appel } from '../api.js'

/**
 * Tableau de bord MTI : la liste des dossiers, et le point d'entrée du travail.
 *
 * Les compteurs et le statut d'affichage viennent du serveur (`statutAffiche`) :
 * « en attente d'allocation » n'est pas un statut stocké mais l'absence de
 * patient sur un dossier ouvert, et dupliquer cette règle ici la ferait
 * diverger de la base tôt ou tard.
 *
 * Pas de repli hors-ligne : une liste de dossiers lue dans un bundle serait
 * périmée, et démarrer un scénario sans base n'a pas de sens.
 */
export const useTableauBord = defineStore('tableauBord', () => {
  const dossiers = ref([])
  const produits = ref([])
  const modeles = ref([])
  const chargement = ref(false)
  const erreur = ref('')
  const indisponible = ref(false)

  const recherche = ref('')
  const filtreProduit = ref('')
  const filtreStatut = ref('')

  const compte = (code) => dossiers.value.filter((d) => d.statutAffiche === code).length
  /* Les compteurs portent sur ce qui est affiché : filtrer puis lire un total
     qui ne correspond pas à l'écran est trompeur. */
  /* Un dossier clos non conforme est clos : il compte parmi les terminés, pas
     parmi les scénarios en cours. */
  const clos = (d) => d.statutAffiche === 'termine' || d.statutAffiche === 'non_conforme'
  const nbEnCours = computed(() => dossiers.value.filter((d) => !clos(d)).length)
  const nbAttente = computed(() => compte('attente'))
  const nbTermines = computed(() => dossiers.value.filter(clos).length)
  const nbAlarmes = computed(() => dossiers.value.filter((d) => d.nbAlarmes > 0).length)

  async function messageDe (r, defaut) {
    try { return (await r.json())?.erreur || defaut } catch { return defaut }
  }

  async function charger () {
    chargement.value = true
    erreur.value = ''
    try {
      const params = new URLSearchParams()
      if (recherche.value.trim()) params.set('q', recherche.value.trim())
      if (filtreProduit.value) params.set('produit', filtreProduit.value)
      if (filtreStatut.value) params.set('statut', filtreStatut.value)

      const [rD, rP, rM] = await Promise.all([
        appel('/api/dossiers?' + params.toString()),
        produits.value.length ? null : appel('/api/produits'),
        modeles.value.length ? null : appel('/api/modeles')
      ])
      if (!rD.ok) throw new Error(await messageDe(rD, `Liste illisible (${rD.status}).`))
      dossiers.value = await rD.json()
      if (rP?.ok) produits.value = await rP.json()
      if (rM?.ok) modeles.value = await rM.json()
      indisponible.value = false
    } catch (e) {
      indisponible.value = true
      erreur.value = e.message || 'API injoignable.'
      dossiers.value = []
    } finally {
      chargement.value = false
    }
  }

  function reinitialiser () {
    recherche.value = ''
    filtreProduit.value = ''
    filtreStatut.value = ''
    return charger()
  }

  /** Crée un dossier en un seul appel : produit et lot partent avec. */
  async function demarrerScenario ({ reference, codeModele, produitId, numeroLot }) {
    erreur.value = ''
    try {
      const r = await appel('/api/dossiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference, codeModele, produitId: produitId || null,
          numeroLot: numeroLot || null })
      })
      if (!r.ok) { erreur.value = await messageDe(r, `Création refusée (${r.status}).`); return null }
      const { id } = await r.json()
      await charger()
      return id
    } catch (e) {
      erreur.value = e.message || 'API injoignable.'
      return null
    }
  }

  return {
    dossiers, produits, modeles, chargement, erreur, indisponible,
    recherche, filtreProduit, filtreStatut,
    nbEnCours, nbAttente, nbTermines, nbAlarmes,
    charger, reinitialiser, demarrerScenario
  }
})
