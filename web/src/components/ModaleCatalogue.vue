<script setup>
/** Catalogue des processus ajoutables à un parcours en cours. */
import { ref, watch } from 'vue'

const props = defineProps({
  ouvert: { type: Boolean, required: true },
  catalogue: { type: Object, default: null }
})
const emit = defineEmits(['fermer', 'ajouter'])

const selection = ref(null)
watch(() => props.ouvert, (o) => { if (o) selection.value = null })

const estSelectionne = (groupe, i) =>
  selection.value?.groupe === groupe && selection.value?.index === i
</script>

<template>
  <div class="cat-ov" :class="{ show: ouvert }" @click.self="emit('fermer')">
    <div class="cat-dlg">
      <div class="cat-hd">
        Ajouter un processus préparamétré
        <button @click="emit('fermer')">✕</button>
      </div>
      <div class="cat-sub">
        Sélectionnez un type de processus dans le catalogue. Les points de contrôle
        associés seront pré-chargés.
      </div>
      <div class="cat-body">
        <template v-for="g in catalogue?.groupes ?? []" :key="g.groupe">
          <div class="cat-grp">{{ g.groupe }}</div>
          <div
            v-for="(item, i) in g.items" :key="item.code"
            class="cat-item" :class="{ sel: estSelectionne(g.groupe, i) }"
            @click="selection = { groupe: g.groupe, index: i, item }"
          >
            <div class="cat-ico">{{ item.icone }}</div>
            <div>
              <div class="cat-name">{{ item.nom }}</div>
              <div class="cat-desc">{{ item.description }}</div>
            </div>
          </div>
        </template>
      </div>
      <div class="cat-foot">
        <button class="cat-btn-cancel" @click="emit('fermer')">Annuler</button>
        <button
          class="cat-btn-ok" :disabled="!selection"
          @click="emit('ajouter', selection.item); emit('fermer')"
        >Ajouter ce processus</button>
      </div>
    </div>
  </div>
</template>
