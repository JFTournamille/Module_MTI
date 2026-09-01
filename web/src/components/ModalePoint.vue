<script setup>
/**
 * Choisir un point de contrôle existant, ou en créer un.
 *
 * Ajouter un point produisait toujours un « Nouveau point de contrôle » vierge,
 * qu'il fallait ensuite retaper. Or les mêmes contrôles reviennent d'un
 * processus à l'autre et d'un parcours à l'autre — « Identité patient vérifiée
 * (2 concordances) », « Aspect de la poche », « Température cuve » — et les
 * ressaisir à l'identique produit des libellés qui divergent d'une lettre :
 * deux parcours qu'on ne peut plus comparer, et des points qu'on ne peut plus
 * dénombrer.
 *
 * La liste couvre donc TOUS les parcours, pas seulement celui qu'on édite :
 * c'est là qu'est le gisement, un parcours voisin ayant déjà formulé le
 * contrôle qu'on s'apprête à réécrire.
 */
import { computed, ref, watch } from 'vue'
import { TYPES_POINT } from '../stores/configuration.js'

const props = defineProps({
  ouvert: { type: Boolean, required: true },
  /** Points du parcours en cours d'édition, déjà à plat. */
  pointsCourants: { type: Array, default: () => [] },
  /** Code du parcours en cours, pour ne pas le rapatrier deux fois. */
  codeCourant: { type: String, default: '' }
})
const emit = defineEmits(['fermer', 'choisir', 'creer'])

const LIB_TYPE = Object.fromEntries(TYPES_POINT)
const requete = ref('')
const autresParcours = ref([])
const chargement = ref(false)
const champ = ref(null)

/** Ce qui distingue deux points : le libellé et le type, pas la position. */
const cle = (pt) => `${(pt.libelle ?? '').trim().toLowerCase()}|${pt.type}`

/**
 * Catalogue complet, dédoublonné.
 *
 * Le parcours courant passe en premier : c'est le voisinage immédiat, et c'est
 * de là que vient le plus souvent le point qu'on cherche.
 */
const catalogue = computed(() => {
  const vus = new Set()
  const liste = []
  for (const e of [...props.pointsCourants, ...autresParcours.value]) {
    const k = cle(e.point)
    if (!e.point?.libelle || vus.has(k)) continue
    vus.add(k)
    liste.push(e)
  }
  return liste
})

/** Recherche sans accents ni casse : « decongelation » doit trouver « Décongélation ». */
const sansAccent = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const resultats = computed(() => {
  const q = sansAccent(requete.value.trim())
  if (!q) return catalogue.value.slice(0, 60)
  return catalogue.value
    .filter((e) => sansAccent(e.point.libelle).includes(q) ||
                   sansAccent(e.origine).includes(q))
    .slice(0, 60)
})

/* Proposer la création n'a de sens que si le libellé saisi n'existe pas déjà :
   sinon on offrirait de créer un doublon de ce que la liste montre juste
   au-dessus. */
const dejaPresent = computed(() => {
  const q = requete.value.trim().toLowerCase()
  return q ? catalogue.value.some((e) => e.point.libelle.trim().toLowerCase() === q) : false
})

/** Marqueurs du point, pour reconnaître ce qu'on reprend sans l'ouvrir. */
function marqueurs (pt) {
  const m = []
  if (pt.seuil != null) m.push(`seuil ${pt.seuil} °C`)
  if (pt.doubleValidation) m.push('2 pers.')
  if (Number(pt.exemplaires) > 1) m.push(`× ${pt.exemplaires}`)
  if (pt.multi) m.push('× n')
  if (pt.numeroSerie) m.push('n° de série')
  return m
}

async function chargerAutresParcours () {
  chargement.value = true
  autresParcours.value = []
  try {
    const modeles = await fetch('/api/modeles').then((r) => r.json())
    for (const m of modeles) {
      if (m.code === props.codeCourant) continue
      const d = await fetch(`/api/modeles/${m.code}`).then((r) => r.json()).catch(() => null)
      for (const [iP, p] of (d?.processus ?? []).entries()) {
        for (const sc of p.sections ?? []) {
          for (const pt of sc.points ?? []) {
            autresParcours.value.push({
              point: pt,
              origine: `${m.libelle} · ${iP + 1}. ${p.nom} · ${sc.titre}`
            })
          }
        }
      }
    }
  } catch { /* hors ligne : la liste se limite au parcours courant */ }
  chargement.value = false
}

watch(() => props.ouvert, async (o) => {
  if (!o) return
  requete.value = ''
  await chargerAutresParcours()
  champ.value?.focus()
})
</script>

<template>
  <div v-if="ouvert" class="cmodal-ov show" @click.self="emit('fermer')">
    <div class="cmodal pt-modal">
      <div class="cmodal-hd">
        <span>Ajouter un point de contrôle</span>
        <span style="cursor:pointer" @click="emit('fermer')">✕</span>
      </div>
      <div class="cmodal-motif">
        Reprendre un point déjà formulé ailleurs plutôt que le retaper : deux
        libellés qui diffèrent d'une lettre sont deux points qu'on ne peut plus
        rapprocher d'un parcours à l'autre.
      </div>
      <div class="cmodal-bd">
        <input ref="champ" type="text" v-model="requete"
               placeholder="Chercher un point de contrôle, ou saisir un libellé nouveau…">

        <div class="pt-res">
          <div v-if="chargement" class="pt-vide">chargement des parcours…</div>
          <div v-else-if="!resultats.length" class="pt-vide">
            Aucun point ne correspond.
          </div>
          <div v-for="(e, i) in resultats" :key="i" class="pt-row"
               @click="emit('choisir', e.point); emit('fermer')">
            <div class="pt-l">
              <span class="n">{{ e.point.libelle }}</span>
              <span class="o">{{ e.origine }}</span>
            </div>
            <div class="pt-m">
              <span class="bt" :class="'bt-' + e.point.type">{{ LIB_TYPE[e.point.type] }}</span>
              <span v-for="m in marqueurs(e.point)" :key="m" class="tagc">{{ m }}</span>
            </div>
          </div>
        </div>
      </div>
      <div class="cmodal-ft">
        <button class="adm-b" @click="emit('fermer')">Annuler</button>
        <button class="adm-b" @click="emit('creer', ''); emit('fermer')">
          Créer un point vierge
        </button>
        <button v-if="requete.trim() && !dejaPresent" class="adm-b-p"
                @click="emit('creer', requete.trim()); emit('fermer')">
          Créer « {{ requete.trim().slice(0, 40) }} »
        </button>
      </div>
    </div>
  </div>
</template>
