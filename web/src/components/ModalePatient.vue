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

async function chercher () {
  const courant = ++jeton
  recherche.value = true
  message.value = ''
  try {
    const r = await appel(`/api/patients?q=${encodeURIComponent(requete.value)}`)
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
  if (ouvert) { requete.value = ''; resultats.value = []; message.value = ''; chercher() }
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
