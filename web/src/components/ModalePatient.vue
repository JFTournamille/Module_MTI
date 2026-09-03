<script setup>
/**
 * Recherche patient.
 *
 * Interroge l'API, qui relaie vers le SIH. On ne constitue PAS de référentiel
 * patients local : la maquette embarquait une liste en dur (`PATS` / `fakePatients`),
 * ce qui n'est acceptable qu'en démonstration.
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
   déverser l'annuaire. L'appeler quand même — à l'ouverture, où le champ est
   vide — affichait « Aucun résultat » avant toute frappe : l'écran annonçait
   un annuaire vide là où aucune recherche n'avait encore eu lieu. Les deux
   situations ne se ressemblent pas et ne se disent pas de la même façon. */
const LONGUEUR_MINIMALE = 2
const INVITE = 'Saisir au moins deux caractères : nom, prénom ou n° patient.'

async function chercher () {
  const q = requete.value.trim()
  if (q.length < LONGUEUR_MINIMALE) {
    /* Le jeton avance sans qu'aucun appel parte : une réponse encore en vol
       — l'utilisateur a effacé sa saisie pendant la requête — ne doit pas
       repeupler la liste après coup. */
    jeton++
    resultats.value = []
    recherche.value = false
    message.value = INVITE
    return
  }

  const courant = ++jeton
  recherche.value = true
  message.value = ''
  try {
    const r = await appel(`/api/patients?q=${encodeURIComponent(q)}`)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const data = await r.json()
    if (courant !== jeton) return          // réponse obsolète, on l'ignore
    resultats.value = data
    if (!data.length) message.value = 'Aucun résultat'
  } catch {
    if (courant !== jeton) return
    resultats.value = []
    message.value = 'Recherche indisponible — annuaire patient non joignable.'
  } finally {
    if (courant === jeton) recherche.value = false
  }
}

watch(() => props.ouvert, (ouvert) => {
  if (!ouvert) return
  jeton++
  requete.value = ''
  resultats.value = []
  recherche.value = false
  message.value = INVITE
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
