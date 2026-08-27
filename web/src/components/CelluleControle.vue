<script setup>
/**
 * Cellule « Valeur / Détail » d'un point de contrôle.
 *
 * Un seul composant couvre les six types du modèle. Les maquettes
 * construisaient ce fragment par concaténation de chaînes HTML
 * (`cDetail()` / `renderMain()`), ce qui interdisait toute liaison
 * bidirectionnelle : la valeur saisie n'existait que dans le DOM.
 */
import { computed } from 'vue'
import { useParcours } from '../stores/parcours.js'

const props = defineProps({
  point: { type: Object, required: true },
  cle: { type: String, required: true },
  lectureSeule: { type: Boolean, default: false }
})

const store = useParcours()
const saisie = computed(() => store.saisie(props.cle, props.point))
const alarme = computed(() => store.alarme(props.cle, props.point))
</script>

<template>
  <!-- Oui / Non -->
  <div v-if="point.type === 'ouinon'" class="cyn">
    <label>
      <input
        type="radio" class="roi" :name="cle" value="oui"
        v-model="saisie.reponse" :disabled="lectureSeule"
      > Oui
    </label>
    <label>
      <input
        type="radio" class="ron" :name="cle" value="non"
        v-model="saisie.reponse" :disabled="lectureSeule"
      > Non
    </label>
  </div>

  <!-- Valeur numérique, avec alarme de seuil -->
  <div v-else-if="point.type === 'valeur'" style="display:flex;align-items:center;gap:3px;">
    <input
      class="cfi" type="number" step="0.1"
      :placeholder="point.seuil !== undefined ? '°C' : 'Valeur'"
      style="width:64px;"
      v-model="saisie.valeurNum" :disabled="lectureSeule"
    >
    <span v-if="alarme" :class="alarme.horsSeuil ? 'calm' : 'cokb'">
      {{ alarme.horsSeuil
        ? `⚠ ${alarme.valeur} °C > ${alarme.seuil} °C`
        : `✓ ${alarme.valeur} °C` }}
    </span>
  </div>

  <!-- Photos -->
  <div v-else-if="point.type === 'photo'" class="cthr">
    <div
      v-for="(photo, i) in saisie.photos" :key="i"
      class="cth2" :class="{ done: photo.presente }"
      :title="photo.libelle"
      @click="lectureSeule || (photo.presente = !photo.presente)"
    >{{ photo.presente ? '✅' : '📷' }}</div>
  </div>

  <!-- Minuteur -->
  <div v-else-if="point.type === 'timer'" class="ctrow">
    <span class="ctd">{{ store.dureeMinuteur(cle) }}</span>
    <button
      class="cbt" :disabled="lectureSeule || store.minuteurEnCours(cle)"
      @click="store.demarrerMinuteur(cle)"
    >▶ T0</button>
    <button
      v-if="store.minuteurEnCours(cle)" class="cbt"
      @click="store.arreterMinuteur(cle)"
    >■</button>
  </div>

  <!-- Texte -->
  <input
    v-else-if="point.type === 'texte'"
    class="cfi" type="text" placeholder="Saisir…"
    v-model="saisie.valeurTexte" :disabled="lectureSeule"
  >

  <!-- Date — jalon calendaire (aphérèse, lymphodéplétion, réception prévue).
       La valeur vit dans valeurTexte au format ISO, comme la rend l'input. -->
  <input
    v-else-if="point.type === 'date'"
    class="cfi" type="date" style="width:150px;"
    v-model="saisie.valeurTexte" :disabled="lectureSeule"
  >

  <!-- Automatique : renseigné par le système à la validation -->
  <span v-else style="font-size:10px;color:#777;font-style:italic;">
    {{ point.valeurAuto ?? 'Automatique' }}
  </span>
</template>
