<script setup>
import { computed, ref } from 'vue'
import { useParcours } from '../stores/parcours.js'
import { useSession } from '../stores/session.js'

/**
 * Contresignature d'un processus par une 2e personne.
 *
 * La double validation demandée en réunion n'est pas une seconde saisie ligne à
 * ligne — le double contrôle Op.1/Op.2 existe déjà pour ça. C'est une validation
 * GLOBALE du processus par une 2e personne identifiée, avec rappel des points
 * concernés : c'est cette liste qui donne son sens au geste.
 */
const store = useParcours()
const session = useSession()

const points = computed(() => store.pointsDoubleValidation())
const posee = computed(() => store.contresignature())
const choix = ref('')

/** L'opérateur courant ne peut pas se contresigner : ce ne serait pas un
 *  second regard. Le serveur le refuse aussi — la liste évite d'y arriver. */
const candidats = computed(() =>
  session.operateurs.filter((o) => o.id !== session.operateur?.id))

const enCours = ref(false)
async function contresigner () {
  if (!choix.value) return
  enCours.value = true
  await store.contresigner(choix.value)
  enCours.value = false
  choix.value = ''
}

const dateCourte = (v) => v
  ? new Date(v).toLocaleString('fr-FR',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : ''
</script>

<template>
  <div v-if="points.length" class="contre" :class="posee ? 'contre-ok' : 'contre-req'">
    <template v-if="posee">
      <div class="contre-t" style="color:#2e7d32;">
        ✓ Processus contresigné par {{ posee.contresignataire.libelle }}
      </div>
      <div>
        {{ points.length }} point(s) en double validation, contresignés le
        {{ dateCourte(posee.signeLe) }}.
      </div>
      <div style="margin-top:5px;">
        Empreinte du contenu signé :
        <span class="contre-emp">{{ posee.empreinte.slice(0, 32) }}…</span>
      </div>
    </template>

    <template v-else>
      <div class="contre-t">👥 Double validation requise — 2<sup>e</sup> personne</div>
      <div>
        {{ points.length }} point(s) de ce processus doivent être contresignés. La
        2<sup>e</sup> personne valide l'ensemble du processus, avec identification nominative.
      </div>
      <ul>
        <li v-for="(p, i) in points" :key="i">
          <template v-if="p.num">{{ p.num }} — </template>{{ p.libelle }}
        </li>
      </ul>
      <div class="contre-f">
        <label for="contre-qui">2<sup>e</sup> personne :</label>
        <select id="contre-qui" v-model="choix" :disabled="store.lectureSeule">
          <option value="">— choisir —</option>
          <option v-for="o in candidats" :key="o.id" :value="o.id">
            {{ o.nom }}{{ o.profil ? ` — ${o.profil}` : '' }}
          </option>
        </select>
        <button class="contre-b" :disabled="!choix || enCours || store.lectureSeule"
                @click="contresigner()">
          {{ enCours ? 'Contresignature…' : 'Contresigner ce processus' }}
        </button>
      </div>
      <div style="margin-top:6px;font-size:11px;color:#777;line-height:1.5;">
        En l'absence d'authentification réelle, ce geste se limite à un choix nominatif :
        il n'a pas valeur probante. Deux identités authentifiées distinctes sont un
        prérequis, pas une évolution.
      </div>
    </template>
  </div>
</template>
