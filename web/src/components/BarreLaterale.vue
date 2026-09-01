<script setup>
/** Navigation chronologique des processus du dossier. */
const props = defineProps({
  processus: { type: Array, required: true },
  selection: { type: Number, required: true }
})
const emit = defineEmits(['selectionner', 'ouvrirCatalogue'])

const classeEtat = (etat) =>
  ({ valide: 'done', en_cours: 'active', a_venir: 'pending', annule: 'pending' })[etat] ?? 'pending'
/* Glyphe d'état, repris de `stIco()` de la v12 : une coche verte pour ce qui
   est fait, un chevron pour l'étape en cours, un cercle sourd pour le reste.
   Pas de pastille : la v12 n'en porte pas, et un rond plein pesait autant que
   le nom du processus qu'il accompagne alors qu'il ne dit rien de plus. */
const glyphe = (etat) => ({ valide: '✓', en_cours: '▶' })[etat] ?? '○'
const classeGlyphe = (etat) =>
  ({ valide: 'pico ok', en_cours: 'pico cur' })[etat] ?? 'pico'
/* La ligne de détail dit l'état réel du processus, comme en v12. Elle affichait
   « — » sur tout processus à venir : un tiret ne distingue pas un processus
   verrouillé par la chronologie d'un processus réalisé par un tiers, alors
   que ce n'est pas du tout la même chose pour celui qui lit la liste. */
const sousTitre = (p) => {
  if (p.etat === 'valide') return p.valideLe ?? 'Validé'
  if (p.etat === 'en_cours') return 'En cours…'
  if (p.externe) return 'Réalisé par un tiers'
  return 'Verrouillé'
}
const classeSousTitre = (p) => {
  if (p.etat === 'valide') return 'psub ok'
  if (p.etat === 'en_cours') return 'psub cur'
  if (p.externe) return 'psub ext'
  return 'psub'
}
</script>

<template>
  <div class="sidebar">
    <div class="sb-lbl">Processus chronologiques</div>
    <div class="proc-list">
      <div
        v-for="(p, i) in props.processus"
        :key="`${p.code}-${i}`"
        class="proc"
        :class="[classeEtat(p.etat), { sel: props.selection === i }]"
        @click="emit('selectionner', i)"
      >
        <!-- Le rang est DANS le nom, comme en v12 : « 1. Demande d'accès ».
             Il vient de la position dans la liste, pas d'un champ `n` du
             modèle — celui-ci n'était pas repris à l'ouverture d'un dossier, si
             bien que les pastilles s'affichaient vides depuis toujours. Un rang
             est de toute façon une position, il n'a pas à être stocké. -->
        <span :class="classeGlyphe(p.etat)">{{ glyphe(p.etat) }}</span>
        <div class="pcorps">
          <div class="pname">{{ i + 1 }}. {{ p.nom }}</div>
          <div :class="classeSousTitre(p)">{{ sousTitre(p) }}</div>
        </div>
      </div>
    </div>
    <div class="sb-footer">
      <button class="sb-add" @click="emit('ouvrirCatalogue')">＋ Ajouter un processus</button>
    </div>
  </div>
</template>
