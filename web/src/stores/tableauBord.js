import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appel, messageErreur } from '../api.js'

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
  /* Filtres par colonne. Ils partent au SERVEUR : la liste est plafonnée à 200
     lignes, et filtrer une liste déjà tronquée cacherait sans le dire les
     dossiers correspondants situés au-delà du plafond. */
  const filtreReference = ref('')
  const filtreLot = ref('')
  const filtrePatient = ref('')
  const filtreEtape = ref('')
  const filtrePrescription = ref('')
  /** Étapes réellement présentes en base, pour peupler le filtre d'étape. */
  const etapes = ref([])

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

  // Voir api.js : le 501 y porte son explication (AUTH_MODE=oidc sans SSO).
  const messageDe = messageErreur

  async function charger () {
    chargement.value = true
    erreur.value = ''
    try {
      const params = new URLSearchParams()
      if (recherche.value.trim()) params.set('q', recherche.value.trim())
      if (filtreProduit.value) params.set('produit', filtreProduit.value)
      if (filtreStatut.value) params.set('statut', filtreStatut.value)
      if (filtreReference.value.trim()) params.set('reference', filtreReference.value.trim())
      if (filtreLot.value.trim()) params.set('lot', filtreLot.value.trim())
      if (filtrePatient.value.trim()) params.set('patient', filtrePatient.value.trim())
      if (filtreEtape.value) params.set('etape', filtreEtape.value)
      if (filtrePrescription.value) params.set('prescription', filtrePrescription.value)

      const [rD, rP, rM, rE] = await Promise.all([
        appel('/api/dossiers?' + params.toString()),
        produits.value.length ? null : appel('/api/produits'),
        modeles.value.length ? null : appel('/api/modeles'),
        appel('/api/dossiers/etapes')
      ])
      if (!rD.ok) throw new Error(await messageDe(rD, `Liste illisible (${rD.status}).`))
      dossiers.value = await rD.json()
      if (rP?.ok) produits.value = await rP.json()
      if (rM?.ok) modeles.value = await rM.json()
      /* Les étapes sont relues à chaque chargement, pas mises en cache : la
         liste change dès qu'un processus est validé quelque part, et un filtre
         qui ne propose plus l'étape où l'on se trouve est pire qu'inutile. */
      if (rE?.ok) etapes.value = await rE.json()
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
    filtreReference.value = ''
    filtreLot.value = ''
    filtrePatient.value = ''
    filtreEtape.value = ''
    filtrePrescription.value = ''
    return charger()
  }

  /* Un chargement par frappe saturait l'API : quatre champs de filtre en plus
     rendaient la chose intenable. Le dernier appel gagne, après un temps mort
     court — assez pour ne pas gêner la frappe, assez pour n'envoyer qu'une
     requête par mot saisi. */
  let minuteur = null
  function chargerDiffere (delai = 300) {
    if (minuteur) clearTimeout(minuteur)
    minuteur = setTimeout(() => { minuteur = null; charger() }, delai)
  }

  /** Vrai dès qu'un filtre est posé — sert à signaler une liste restreinte. */
  const filtreActif = computed(() => Boolean(
    recherche.value.trim() || filtreProduit.value || filtreStatut.value ||
    filtreReference.value.trim() || filtreLot.value.trim() ||
    filtrePatient.value.trim() || filtreEtape.value || filtrePrescription.value))

  /**
   * Crée un dossier en un seul appel : produit et lot partent avec.
   *
   * Le n° de dossier n'est pas envoyé : c'est la base qui l'attribue depuis sa
   * séquence. `reference` reste accepté pour les appelants qui en imposent un
   * (jeu de démonstration, suites de test).
   */
  async function demarrerScenario ({ reference, codeModele, produitId, numeroLot }) {
    erreur.value = ''
    try {
      const r = await appel('/api/dossiers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reference: reference || undefined, codeModele,
          produitId: produitId || null, numeroLot: numeroLot || null })
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
    filtreReference, filtreLot, filtrePatient, filtreEtape, filtrePrescription,
    etapes, filtreActif,
    charger, chargerDiffere, reinitialiser, demarrerScenario
  }
})
