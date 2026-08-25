<script setup>
/**
 * Gabarit « réception » — le processus n°1, le plus détaillé.
 *
 * Toute la duplication (n cuves / n photos) et le double contrôle Op.2 sont
 * ici de simples `v-for` / `v-if` sur des données calculées. Les maquettes
 * faisaient le même travail en clonant des noeuds du DOM et en suffixant les
 * attributs `name` des radios, ce qui exigeait de nettoyer les copies à
 * chaque changement — d'où les attributs `data-generated-dup`.
 */
import CelluleControle from './CelluleControle.vue'
import { useParcours } from '../stores/parcours.js'

defineProps({ lectureSeule: { type: Boolean, default: false } })
const emit = defineEmits(['ouvrirRecherchePatient'])
const store = useParcours()

const badge = {
  ouinon: ['t-on', 'Oui/Non'],
  valeur: ['t-va', 'Valeur °C'],
  photo: ['t-ph', 'Photo'],
  timer: ['t-ti', 'Minuteur'],
  texte: ['t-tx', 'Texte'],
  auto: ['t-au', 'Auto']
}
const uniteMulti = (multi) => (multi === 'photo' ? 'photo(s)' : 'cuve(s)')
</script>

<template>
  <div class="chk">
    <div class="ch-hdr">
      <div class="cname">
        Désignation produit :
        <input
          class="cfi" type="text" style="width:340px;font-weight:normal;"
          placeholder="Dénomination du MTI"
          v-model="store.dossier.designationProduit" :disabled="lectureSeule"
        >
      </div>
    </div>

    <div class="ch-meta">
      <div class="mi">
        <label>Étiquetage CB</label>
        <input type="text" placeholder="Scan code-barre…" style="width:120px;"
               v-model="store.dossier.codeBarre" :disabled="lectureSeule">
      </div>
      <div class="mi">
        <label>N° lot</label>
        <input type="text" placeholder="Ex : TC-2026-0814" style="width:105px;"
               v-model="store.dossier.numeroLot" :disabled="lectureSeule">
      </div>
      <div class="mi">
        <label>Date péremption</label>
        <input type="date" style="width:115px;"
               v-model="store.dossier.datePeremption" :disabled="lectureSeule">
      </div>
      <div class="mi" style="border-left:2px solid #c0a8e8;padding-left:10px;">
        <label>N exemplaires</label>
        <!-- Plus de bouton « Appliquer » : la duplication est réactive. -->
        <input type="number" min="1" max="10" style="width:40px;"
               v-model.number="store.dossier.nbExemplaires" :disabled="lectureSeule">
        <span class="nbadge">n = {{ store.dossier.nbExemplaires }}</span>
      </div>
      <div class="ubadge">👤 {{ store.operateurConnecte.nom }}</div>
    </div>

    <!-- Préallocation : c'est elle qui fait apparaître l'identité patient -->
    <div class="ch-pa">
      <div class="ch-pa-tog">
        Préallocation :
        <label>
          <input type="radio" name="preallocation" :checked="!store.dossier.preallocation"
                 :disabled="lectureSeule" @change="store.basculerPreallocation(false)"> Non
        </label>
        <label>
          <input type="radio" name="preallocation" :checked="store.dossier.preallocation"
                 :disabled="lectureSeule" @change="store.basculerPreallocation(true)"> Oui
        </label>
      </div>
      <div class="ch-pa-flds" :class="{ show: store.dossier.preallocation }">
        <div class="pg">
          <label>Patient</label>
          <button class="sbtn" :disabled="lectureSeule"
                  @click="emit('ouvrirRecherchePatient')">🔍 Rechercher patient</button>
          <span v-if="store.dossier.patient"
                style="font-size:11px;color:#4a3880;font-weight:bold;margin-left:4px;">
            {{ store.dossier.patient.nom }} ({{ store.dossier.patient.reference }})
          </span>
        </div>
        <div class="pg">
          <label>Initiales</label>
          <input type="text" placeholder="Ex : MS" style="width:48px;"
                 v-model="store.dossier.initiales" :disabled="lectureSeule">
        </div>
        <div class="pg">
          <label>DDN</label>
          <input type="date" style="width:115px;"
                 v-model="store.dossier.dateNaissance" :disabled="lectureSeule">
        </div>
        <div class="pg" style="border-left:1px solid #d0b060;padding-left:8px;">
          <label>N° commande</label>
          <input type="text" placeholder="CMD-XXXX" style="width:95px;"
                 v-model="store.dossier.numeroCommande" :disabled="lectureSeule">
        </div>
        <div class="pg">
          <label>Date fabrication</label>
          <input type="date" style="width:115px;"
                 v-model="store.dossier.dateFabrication" :disabled="lectureSeule">
        </div>
        <div class="pg">
          <label>Transporteur</label>
          <input type="text" placeholder="Nom transporteur" style="width:95px;"
                 v-model="store.dossier.transporteur" :disabled="lectureSeule">
        </div>
      </div>
    </div>

    <div class="ch-scroll">
      <table>
        <colgroup>
          <col class="cn"><col class="cl"><col class="ct"><col class="co">
          <col class="cd"><col class="cdt"><col class="cop">
        </colgroup>
        <thead>
          <tr>
            <th class="cth">#</th>
            <th class="cth l">Point de contrôle</th>
            <th class="cth">Type</th>
            <th class="cth" title="Obligatoire">Obl.</th>
            <th class="cth l">Valeur / Détail</th>
            <th class="cth">Date &amp; Heure</th>
            <th class="cth l">Opérateur</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="ligne in store.lignesReception" :key="ligne.cle">
            <tr v-if="ligne.genre === 'section'" class="csec">
              <td colspan="7">{{ ligne.titre }}</td>
            </tr>

            <template v-else>
              <tr class="crow">
                <td class="cnc">
                  {{ ligne.point.num }}
                  <template v-if="ligne.copies > 1">
                    <br><span style="font-size:9px;color:#8060c0">
                      {{ ligne.exemplaire }}/{{ ligne.copies }}
                    </span>
                  </template>
                </td>
                <td>
                  <div class="clbl">
                    {{ ligne.point.libelle }}
                    <span v-if="ligne.copies > 1" class="cmul">
                      (Ex. {{ ligne.exemplaire }}/{{ ligne.copies }})
                    </span>
                  </div>
                  <div v-if="ligne.point.sousLibelle" class="csub">{{ ligne.point.sousLibelle }}</div>
                  <div v-if="ligne.point.multi && ligne.exemplaire === 1" class="cmul">
                    × {{ ligne.copies }} {{ uniteMulti(ligne.point.multi) }}
                  </div>
                </td>
                <td style="text-align:center">
                  <span class="ctb" :class="badge[ligne.point.type]?.[0] ?? 't-au'">
                    {{ badge[ligne.point.type]?.[1] ?? ligne.point.type }}
                  </span>
                </td>
                <td class="cobl">
                  <button
                    class="cobtn"
                    :class="store.saisie(ligne.cle, ligne.point).obligatoire ? 'on' : 'off'"
                    :title="store.saisie(ligne.cle, ligne.point).obligatoire
                      ? 'Point obligatoire' : 'Point optionnel'"
                    :disabled="lectureSeule"
                    @click="store.basculerObligatoire(ligne.cle, ligne.point)"
                  >★</button>
                </td>
                <td>
                  <CelluleControle :point="ligne.point" :cle="ligne.cle" :lecture-seule="lectureSeule" />
                </td>
                <td>
                  <input class="cdf" type="datetime-local"
                         v-model="store.saisie(ligne.cle, ligne.point).horodatage"
                         :disabled="lectureSeule">
                </td>
                <td>
                  <div class="copw">
                    <input class="copi" type="text" placeholder="Opérateur 1"
                           :value="store.operateurConnecte.nom" readonly>
                    <button
                      class="cadd"
                      :style="{ background: store.op2Ouvert(ligne.cle) ? '#2e7d4e' : '#6045a0' }"
                      :title="store.op2Ouvert(ligne.cle)
                        ? 'Retirer le double contrôle' : 'Ajouter un double contrôle'"
                      :disabled="lectureSeule"
                      @click="store.basculerOp2(ligne.cle)"
                    >{{ store.op2Ouvert(ligne.cle) ? '−' : '+' }}</button>
                  </div>
                </td>
              </tr>

              <!-- Ligne de double contrôle : une saisie distincte, pas une copie -->
              <tr v-if="store.op2Ouvert(ligne.cle)" class="crow op2r">
                <td></td>
                <td>
                  <span style="font-size:10px;color:#6045a0;font-style:italic;">
                    ↳ Contrôle double signature
                  </span>
                </td>
                <td></td>
                <td></td>
                <td>
                  <CelluleControle
                    :point="ligne.point" :cle="store.cleOp2(ligne.cle)" :lecture-seule="lectureSeule"
                  />
                </td>
                <td>
                  <input class="cdf" type="datetime-local"
                         v-model="store.saisie(store.cleOp2(ligne.cle)).horodatage"
                         :disabled="lectureSeule">
                </td>
                <td>
                  <div class="copw">
                    <span style="font-size:10px;color:#6045a0;margin-right:4px;">Op. 2 :</span>
                    <input class="copi" type="text" placeholder="Opérateur de contrôle"
                           v-model="store.saisie(store.cleOp2(ligne.cle)).operateur"
                           :disabled="lectureSeule">
                  </div>
                </td>
              </tr>
            </template>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
