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
const sousTitre = (p) =>
  p.etat === 'valide' ? (p.valideLe ?? 'Validé') : p.etat === 'en_cours' ? 'En cours…' : '—'
const classeSousTitre = (etat) =>
  etat === 'valide' ? 'psub ok' : etat === 'en_cours' ? 'psub cur' : 'psub'
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
          <div :class="classeSousTitre(p.etat)">{{ sousTitre(p) }}</div>
        </div>
      </div>
    </div>
    <div class="sb-footer">
      <button class="sb-add" @click="emit('ouvrirCatalogue')">＋ Ajouter un processus</button>
    </div>
  </div>
</template>
