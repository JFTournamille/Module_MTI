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

/** Heure d'un jalon de minuteur, ou « — » tant qu'il n'est pas posé. */
function heure (epoch) {
  if (!epoch) return '—'
  const d = new Date(epoch)
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<template>
  <!-- Oui / Non — deux boutons, pas deux radios.
       Une radio se vise mal et se lit mal de loin ; deux boutons dont l'un
       s'allume disent l'état de la ligne d'un coup d'œil, ce qu'un opérateur
       qui parcourt trente points fait en permanence. C'est le choix de la
       maquette v12. -->
  <div v-if="point.type === 'ouinon'" class="cyn">
    <button
      class="ctl-b" :class="{ on: saisie.reponse === 'oui' }" :disabled="lectureSeule"
      @click="saisie.reponse = saisie.reponse === 'oui' ? null : 'oui'"
    >Oui</button>
    <button
      class="ctl-b no" :class="{ on: saisie.reponse === 'non' }" :disabled="lectureSeule"
      @click="saisie.reponse = saisie.reponse === 'non' ? null : 'non'"
    >Non</button>
  </div>

  <!-- Valeur numérique, avec alarme de seuil -->
  <div v-else-if="point.type === 'valeur'" class="cval">
    <input
      class="cfi" :class="{ 'hors-seuil': alarme?.horsSeuil }" type="number" step="0.1"
      :placeholder="point.seuil !== undefined ? '− °C' : 'Valeur'"
      style="width:82px;"
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

  <!-- Minuteur.
       Repris de `checklist_cart_reception_v2.html` : afficheur monospace vert
       sur noir, ▶ T0 pour lancer, ■ Fin pour arrêter, et la ligne Début / Fin
       en dessous. Cette dernière manquait à l'application : sans elle,
       l'afficheur donne une durée sans dire de quand à quand, ce qui est
       précisément ce qu'un relevé de traçabilité doit établir. -->
  <div v-else-if="point.type === 'timer'">
    <div class="ctrow">
      <button
        class="cbt" :disabled="lectureSeule || !!saisie.timerDebut"
        @click="store.demarrerMinuteur(cle)"
      >▶ T0</button>
      <span class="ctd">{{ store.dureeMinuteur(cle) }}</span>
      <button
        class="cbt stop" :disabled="lectureSeule || !store.minuteurEnCours(cle)"
        @click="store.arreterMinuteur(cle)"
      >■ Fin</button>
    </div>
    <div class="ctse">
      Début : <b>{{ heure(saisie.timerDebut) }}</b>&nbsp;&nbsp;
      Fin : <b>{{ heure(saisie.timerFin) }}</b>
    </div>
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
