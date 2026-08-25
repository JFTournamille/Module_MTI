<script setup>
/** Gabarit « standard » — processus 2 à 12 et processus ajoutés au catalogue. */
import CelluleControle from './CelluleControle.vue'
import { useParcours } from '../stores/parcours.js'

const props = defineProps({ processus: { type: Object, required: true } })
const store = useParcours()

const badge = {
  ouinon: ['b-yn', 'Oui/Non'],
  valeur: ['b-val', 'Valeur'],
  photo: ['b-photo', 'Photo'],
  timer: ['b-timer', 'Minuteur'],
  texte: ['b-texte', 'Texte'],
  auto: ['b-auto', 'Auto']
}
const libelleEtat = { valide: 'Validé', en_cours: 'EN COURS', a_venir: 'À venir', annule: 'Annulé' }
const classeEtat = { valide: 's-done', en_cours: 's-active', a_venir: 's-prev', annule: 's-prev' }

/** Un processus à venir ou externe se consulte, il ne se saisit pas. */
const lectureSeule = () => props.processus.etat === 'a_venir' || props.processus.etat === 'valide'
</script>

<template>
  <div class="proc-head">
    <div class="ph-num">{{ processus.n }}</div>
    <div>
      <div class="ph-name">{{ processus.nom }}</div>
      <div class="ph-sub">{{ processus.operateur ?? '' }}</div>
    </div>
    <div class="status-badge" :class="classeEtat[processus.etat]">
      {{ libelleEtat[processus.etat] }}
    </div>
  </div>

  <div class="tbl-wrap">
    <div v-if="processus.etat === 'valide'" class="banner b-done">
      ✓ Processus validé{{ processus.externe ? ' — externe' : '' }}
    </div>
    <div v-if="processus.externe && processus.etat !== 'valide'" class="banner b-ext">
      Processus externe — réalisé par le fabricant
    </div>
    <div v-if="processus.etat === 'a_venir'" class="banner b-prev">
      ⏳ À venir — processus non encore démarré
    </div>

    <table class="std-table">
      <colgroup>
        <col style="width:32%"><col style="width:10%"><col style="width:22%">
        <col style="width:8%"><col style="width:14%"><col style="width:14%">
      </colgroup>
      <tbody>
        <tr>
          <th class="std-th">Point de contrôle</th>
          <th class="std-th c">Type</th>
          <th class="std-th">Valeur</th>
          <th class="std-th c">Résultat</th>
          <th class="std-th">Horodatage</th>
          <th class="std-th">Opérateur</th>
        </tr>
        <template v-for="ligne in store.lignesStandard" :key="ligne.cle">
          <tr v-if="ligne.genre === 'section'" class="std-sec">
            <td colspan="6">{{ ligne.titre }}</td>
          </tr>
          <tr v-else class="std-ir">
            <td>
              <div class="std-lbl">{{ ligne.point.libelle }}</div>
              <div v-if="ligne.point.sousLibelle" class="std-sublbl">{{ ligne.point.sousLibelle }}</div>
            </td>
            <td style="text-align:center">
              <span class="std-badge" :class="badge[ligne.point.type]?.[0] ?? 'b-auto'">
                {{ badge[ligne.point.type]?.[1] ?? ligne.point.type }}
              </span>
            </td>
            <td>
              <CelluleControle
                :point="ligne.point" :cle="ligne.cle" :lecture-seule="lectureSeule()"
              />
            </td>
            <td style="text-align:center">
              <span v-if="store.saisie(ligne.cle, ligne.point).reponse === 'oui'" class="std-ck">✔</span>
              <span v-else-if="store.saisie(ligne.cle, ligne.point).reponse === 'non'"
                    style="color:#cc2200;font-weight:bold;">✘</span>
              <span v-else class="std-dash">—</span>
            </td>
            <td>
              <span v-if="store.saisie(ligne.cle, ligne.point).horodatage" class="std-ts">
                {{ store.saisie(ligne.cle, ligne.point).horodatage.replace('T', ' ') }}
              </span>
              <span v-else class="std-dash">—</span>
            </td>
            <td>
              <span v-if="ligne.point.type === 'auto'" class="std-op">Système</span>
              <span v-else-if="processus.operateur" class="std-op">{{ processus.operateur }}</span>
              <span v-else class="std-dash">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
