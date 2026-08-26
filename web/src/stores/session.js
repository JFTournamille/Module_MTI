import { defineStore } from 'pinia'
import { ref } from 'vue'
import { appel, memoriserOperateur, operateurChoisi } from '../api.js'

/**
 * Session courante : qui travaille.
 *
 * Le front portait l'opérateur en dur (« M. Martin DURAND »). Il le lit
 * maintenant du serveur, seule source qui sache aussi s'il est permis d'en
 * changer — ce qui n'est vrai qu'en mode démonstration.
 */
export const useSession = defineStore('session', () => {
  const mode = ref('dev')
  const selectionPossible = ref(false)
  const operateur = ref(null)
  const operateurs = ref([])
  const avertissement = ref(null)
  const erreur = ref('')

  async function charger () {
    erreur.value = ''
    try {
      const r = await appel('/api/session')
      if (!r.ok) {
        const corps = await r.json().catch(() => null)
        throw new Error(corps?.erreur ?? `Session illisible (${r.status}).`)
      }
      const s = await r.json()
      mode.value = s.mode
      selectionPossible.value = s.selectionPossible
      operateur.value = s.operateur
      operateurs.value = s.operateurs ?? []
      avertissement.value = s.avertissement

      // Le serveur a pu retenir un autre opérateur que celui demandé (compte
      // désactivé entre-temps) : on réaligne la mémoire locale sur la réalité.
      if (operateurChoisi() && s.operateur?.id !== operateurChoisi()) {
        memoriserOperateur(s.operateur?.id ?? '')
      }
    } catch (e) {
      erreur.value = e.message || 'API injoignable.'
      operateur.value = null
    }
  }

  /** Change d'opérateur, puis relit la session pour confirmation côté serveur. */
  async function choisir (id) {
    memoriserOperateur(id)
    await charger()
  }

  return { mode, selectionPossible, operateur, operateurs, avertissement, erreur,
    charger, choisir }
})
