<script setup>
/** Gabarit « standard » — processus 2 à 12 et processus ajoutés au catalogue. */
import BlocContresignature from './BlocContresignature.vue'
import CelluleControle from './CelluleControle.vue'
import { computed } from 'vue'
import { useParcours } from '../stores/parcours.js'

const props = defineProps({ processus: { type: Object, required: true } })
const store = useParcours()

const badge = {
  ouinon: ['b-yn', 'Oui/Non'],
  valeur: ['b-val', 'Valeur'],
  photo: ['b-photo', 'Photo'],
  fichier: ['b-fichier', 'Fichier'],
  timer: ['b-timer', 'Minuteur'],
  texte: ['b-texte', 'Texte'],
  emplacement: ['b-empl', 'Emplacement'],
  auto: ['b-auto', 'Auto']
}
const libelleEtat = { valide: 'Validé', en_cours: 'EN COURS', a_venir: 'À venir', annule: 'Annulé' }
const classeEtat = { valide: 's-done', en_cours: 's-active', a_venir: 's-prev', annule: 's-prev' }

/** Un processus à venir ou réalisé par un tiers se consulte, il ne se saisit pas. */
const lectureSeule = () => props.processus.etat === 'a_venir' || props.processus.etat === 'valide'

/** Le réglage d'exemplaires n'a de sens que si le processus porte un point `multi`. */
const aDesMulti = computed(() => (props.processus.sections ?? [])
  .some((s) => (s.points ?? []).some((p) => p.multi)))
</script>

<template>
  <div class="proc-head">
    <!-- Le rang est DANS le nom, comme dans la barre latérale et comme en v12.
         La pastille ronde qui le portait affichait `processus.n`, champ qui
         n'est pas repris à l'ouverture d'un dossier : elle était donc vide
         depuis toujours, un disque de 26 px qui ne disait rien. Le rang est
         une position dans la liste, il se lit de `store.selection`. -->
    <div>
      <div class="ph-name">{{ store.selection + 1 }}. {{ processus.nom }}</div>
      <div class="ph-sub">{{ processus.operateur ?? '' }}</div>
    </div>
    <!-- Le nombre d'exemplaires est un paramètre DE CE PROCESSUS : deux cuves
         à la réception, une poche à la préparation. Il n'apparaît que si le
         processus porte au moins un point marqué `multi` — ailleurs, c'est un
         réglage sans effet, et un réglage sans effet finit par être renseigné
         au hasard. -->
    <label v-if="aDesMulti" class="ph-ex" title="Nombre d'exemplaires des points dupliqués de ce processus">
      Exemplaires
      <input id="std-exemplaires" type="number" min="1" max="20" :value="processus.nbExemplaires ?? 1"
             :disabled="lectureSeule()"
             @change="store.changerExemplaires($event.target.value, store.selection)">
    </label>
    <label v-if="aDesMulti" class="ph-ex" title="Unités de secours, contrôlées comme les autres mais identifiées comme telles">
      dont secours
      <input id="std-secours" type="number" min="0" max="20" :value="processus.nbSecours ?? 0"
             :disabled="lectureSeule()"
             @change="store.changerExemplaires(
               processus.nbExemplaires ?? 1, store.selection, $event.target.value)">
    </label>
    <div class="status-badge" :class="classeEtat[processus.etat]">
      {{ libelleEtat[processus.etat] }}
    </div>
  </div>

  <div class="tbl-wrap">
    <div v-if="processus.etat === 'valide'" class="banner b-done">
      ✓ Processus validé{{ processus.externe ? ' — réalisé par un tiers' : '' }}
    </div>
    <div v-if="processus.externe && processus.etat !== 'valide'" class="banner b-ext">
      Processus réalisé par un tiers (Chimio, autre service…) — suivi ici, saisi ailleurs
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
          <!-- Une règle de cohérence ALERTE, elle n'interdit pas : la ligne se
               signale et dit la cause, la saisie reste possible. -->
          <tr v-else class="std-ir" :class="{ 'lg-alerte': store.alertesLigne(ligne).length }">
            <td>
              <div class="std-lbl">
                {{ ligne.point.libelle }}
                <span v-if="store.alertesLigne(ligne).length" class="alerte-pastille"
                      :title="store.alertesLigne(ligne).join('\n')">⚠ incohérence</span>
                <!-- Une unité de secours se signale dans le libellé : le
                     panneau standard n'a pas de colonne de rang, et sans
                     marqueur un secours passerait pour un doublon. -->
                <span v-if="ligne.secours" class="cnc-sec"
                      :title="`Unité de secours ${ligne.exemplaire} sur ${ligne.copies}`"
                  >secours {{ ligne.exemplaire }}/{{ ligne.copies }}</span>
                <span v-else-if="ligne.copies > 1" class="cnc-ex"
                  >{{ ligne.exemplaire }}/{{ ligne.copies }}</span>
              </div>
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
              <!-- L'opérateur de la LIGNE d'abord : deux points d'un même
                   processus peuvent avoir été saisis par deux personnes, et
                   l'opérateur du processus n'est qu'un défaut d'affichage. -->
              <span v-else-if="store.saisie(ligne.cle, ligne.point).operateur" class="std-op">
                {{ store.saisie(ligne.cle, ligne.point).operateur }}
              </span>
              <span v-else-if="processus.operateur" class="std-op">{{ processus.operateur }}</span>
              <span v-else class="std-dash">—</span>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
  <BlocContresignature />
</template>
