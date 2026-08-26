import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appel } from '../api.js'
import { useSession } from './session.js'

/**
 * Comptes utilisateurs.
 *
 * Contrairement aux référentiels du parcours, il n'y a PAS de repli hors-ligne :
 * une liste de comptes lue dans un bundle serait périmée, et créer un compte
 * sans base n'a pas de sens. Hors ligne, le panneau le dit et n'affiche rien.
 */
export const useUtilisateurs = defineStore('utilisateurs', () => {
  const liste = ref([])
  const profils = ref([])
  const chargement = ref(false)
  const erreur = ref('')
  const indisponible = ref(false)
  const recherche = ref('')
  const avecInactifs = ref(false)

  const actifs = computed(() => liste.value.filter((u) => u.actif))
  const inactifs = computed(() => liste.value.filter((u) => !u.actif))

  /** Lecture du corps d'erreur de l'API, qui porte toujours un champ `erreur`. */
  async function messageDe (reponse, defaut) {
    try {
      const corps = await reponse.json()
      return corps?.erreur || defaut
    } catch { return defaut }
  }

  async function charger () {
    chargement.value = true
    erreur.value = ''
    try {
      const params = new URLSearchParams()
      if (recherche.value.trim()) params.set('q', recherche.value.trim())
      if (avecInactifs.value) params.set('inactifs', 'oui')

      const [rU, rP] = await Promise.all([
        appel('/api/utilisateurs?' + params.toString()),
        profils.value.length ? null : appel('/api/profils')
      ])
      if (!rU.ok) throw new Error(await messageDe(rU, `Lecture impossible (${rU.status}).`))
      liste.value = await rU.json()
      if (rP?.ok) profils.value = await rP.json()
      indisponible.value = false
    } catch (e) {
      indisponible.value = true
      erreur.value = e.message || 'API injoignable.'
      liste.value = []
    } finally {
      chargement.value = false
    }
  }

  /** Retourne `true` si l'écriture a abouti ; sinon `erreur` porte la cause. */
  async function envoyer (url, methode, corps) {
    erreur.value = ''
    try {
      const r = await appel(url, {
        method: methode,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps)
      })
      if (!r.ok) {
        erreur.value = await messageDe(r, `Échec (${r.status}).`)
        return false
      }
      await charger()
      /* Le sélecteur d'opérateur est alimenté par la session, chargée une seule
         fois au démarrage : sans ce rafraîchissement, un compte créé ici
         n'apparaîtrait qu'après un rechargement de la page — et un compte
         désactivé continuerait d'y figurer. */
      await useSession().charger()
      return true
    } catch (e) {
      erreur.value = e.message || 'API injoignable.'
      return false
    }
  }

  const creer = (u) => envoyer('/api/utilisateurs', 'POST', u)
  const modifier = (id, champs) => envoyer(`/api/utilisateurs/${id}`, 'PATCH', champs)
  const basculerActif = (id, actif) => envoyer(`/api/utilisateurs/${id}/actif`, 'POST', { actif })

  return {
    liste, profils, chargement, erreur, indisponible, recherche, avecInactifs,
    actifs, inactifs, charger, creer, modifier, basculerActif
  }
})
