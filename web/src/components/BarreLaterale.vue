<script setup>
/** Navigation chronologique des processus du dossier. */
const props = defineProps({
  processus: { type: Array, required: true },
  selection: { type: Number, required: true }
})
const emit = defineEmits(['selectionner', 'ouvrirCatalogue'])

const classeEtat = (etat) =>
  ({ valide: 'done', en_cours: 'active', a_venir: 'pending', annule: 'pending' })[etat] ?? 'pending'
const classePastille = (etat) =>
  ({ valide: 'pnd', en_cours: 'pna' })[etat] ?? 'pnp'
/* La ligne de détail dit l'état réel du processus, comme en v12. Elle affichait
   « — » sur tout processus à venir : un tiret ne distingue pas un processus
   verrouillé par la chronologie d'un processus réalisé par le fabricant, alors
   que ce n'est pas du tout la même chose pour celui qui lit la liste. */
const sousTitre = (p) => {
  if (p.etat === 'valide') return p.valideLe ?? 'Validé'
  if (p.etat === 'en_cours') return 'En cours…'
  if (p.externe) return 'Processus externe'
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
        <div class="pn" :class="classePastille(p.etat)">{{ p.n }}</div>
        <div>
          <div class="pname">{{ p.nom }}</div>
          <div :class="classeSousTitre(p)">{{ sousTitre(p) }}</div>
        </div>
      </div>
    </div>
    <div class="sb-footer">
      <button class="sb-add" @click="emit('ouvrirCatalogue')">＋ Ajouter un processus</button>
    </div>
  </div>
</template>
