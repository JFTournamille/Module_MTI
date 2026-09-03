<script setup>
/**
 * Recherche patient.
 *
 * Interroge l'API, qui relaie vers le SIH. On ne constitue PAS de référentiel
 * patients local : la maquette embarquait une liste en dur (`PATS` / `fakePatients`),
 * ce qui n'est acceptable qu'en démonstration.
 *
 * À l'ouverture, la fenêtre montre ce que le module connaît déjà — la liste de
 * Codifications → Patients, par le même `tous=oui`. Ce n'est pas un annuaire :
 * ce sont les patients qu'un dossier a rattachés. La saisie prend ensuite le
 * relais dès deux caractères.
 */
import { appel } from '../api.js'
import { ref, watch } from 'vue'

const props = defineProps({
  ouvert: { type: Boolean, required: true },
  /* Pourquoi la modale s'ouvre. Vide quand c'est un rattachement ordinaire ;
     renseigné quand un autre geste l'exige — poser le jalon de prescription,
     par exemple — pour que l'utilisateur sache ce qu'il est en train de faire. */
  motif: { type: String, default: '' }
})
const emit = defineEmits(['fermer', 'choisir'])

const requete = ref('')
const resultats = ref([])
const recherche = ref(false)
const message = ref('')
let jeton = 0

/* La route refuse une recherche de moins de deux caractères, pour ne pas
   déverser l'annuaire à chaque frappe. */
const LONGUEUR_MINIMALE = 2

/* Ce que dit une liste vide dépend de ce qu'on a demandé, et les deux phrases
   ne sont pas interchangeables : « aucun résultat » affirme qu'un patient
   n'existe pas, ce qu'on ne peut pas dire tant qu'on n'a rien cherché. */
const RIEN_DE_CONNU = 'Aucun patient rattaché pour l\'instant. Le module ne tient ' +
  'pas d\'annuaire : il ne connaît que les patients qu\'un dossier a rattachés.'
const RIEN_DE_TROUVE = 'Aucun résultat'

async function interroger (url, siVide) {
  const courant = ++jeton
  recherche.value = true
  message.value = ''
  try {
    const r = await appel(url)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    if (courant !== jeton) return          // réponse obsolète, on l'ignore
    resultats.value = data
    if (!data.length) message.value = siVide
  } catch {
    if (courant !== jeton) return
    resultats.value = []
    message.value = 'Recherche indisponible — annuaire patient non joignable.'
  } finally {
    if (courant === jeton) recherche.value = false
  }
}

/* Ce que le module connaît déjà : la même liste que Codifications → Patients,
   par le même `tous=oui`, plafonné côté serveur. La fenêtre s'ouvrait sinon
   vide, sur un « Aucun résultat » qui laissait croire l'outil cassé alors
   qu'aucune recherche n'avait eu lieu. */
function listerConnus () {
  return interroger('/api/patients?tous=oui', RIEN_DE_CONNU)
}

/* Sous deux caractères — dont l'effacement complet de la saisie — on revient à
   cette liste de départ plutôt que d'afficher une absence de résultat. Au-delà,
   c'est le serveur qui cherche : il voit au-delà du plafond de la liste, et il
   compare aussi la référence et l'IPP, que le libellé affiché ne porte pas. */
function chercher () {
  const q = requete.value.trim()
  if (q.length < LONGUEUR_MINIMALE) return listerConnus()
  return interroger(`/api/patients?q=${encodeURIComponent(q)}`, RIEN_DE_TROUVE)
}

watch(() => props.ouvert, (ouvert) => {
  if (!ouvert) return
  requete.value = ''
  resultats.value = []
  listerConnus()
})
</script>

<template>
  <div class="cmodal-ov" :class="{ show: ouvert }" @click.self="emit('fermer')">
    <div class="cmodal">
      <div class="cmodal-hd">
        <span>Recherche patient</span>
        <span style="cursor:pointer" @click="emit('fermer')">✕</span>
      </div>
      <div v-if="props.motif" class="cmodal-motif">{{ props.motif }}</div>
      <div class="cmodal-bd">
        <input
          type="text" placeholder="Nom, prénom ou N° patient…"
          v-model="requete" @input="chercher"
        >
        <div class="cmodal-res">
          <div v-if="recherche" style="padding:8px;color:#aaa;font-size:11px;">Recherche…</div>
          <div v-else-if="message" style="padding:8px;color:#aaa;font-size:11px;">{{ message }}</div>
          <div
            v-else v-for="p in resultats" :key="p.reference"
            class="cmodal-row" @click="emit('choisir', p); emit('fermer')"
          >
            <strong>{{ p.nom }}</strong>
            <span>{{ p.reference }}<template v-if="p.dateNaissance"> — DDN : {{ p.dateNaissance }}</template></span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
