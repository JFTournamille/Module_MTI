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
import BlocContresignature from './BlocContresignature.vue'
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
        <!-- La table est en `table-layout:fixed` : ce sont CES largeurs qui
             font foi, pas celles portées par les `th`. Le colgroup était resté
             à l'ancien ordre en sept colonnes — le libellé s'en trouvait
             écrasé pendant que « Heure » s'étalait. -->
        <colgroup>
          <col class="c-obl"><col class="c-num"><col class="c-lbl"><col class="c-typ">
          <col class="c-act"><col class="c-cmt"><col class="c-heu"><col class="c-ope">
        </colgroup>
        <thead>
          <!-- Ordre des colonnes repris de la maquette v12 : l'étoile
               d'abord — c'est le premier tri que fait l'œil — puis le numéro,
               le libellé, le type, la saisie. Le commentaire prend sa propre
               colonne au lieu d'être glissé sous le libellé, où il se
               confondait avec les marqueurs du point. -->
          <tr>
            <th class="cth c" style="width:34px;" title="Obligatoire">★</th>
            <th class="cth c" style="width:50px;">N°</th>
            <th class="cth l">Point de contrôle</th>
            <th class="cth c" style="width:96px;">Type</th>
            <th class="cth l" style="width:210px;">Action / Valeur</th>
            <th class="cth c" style="width:40px;" title="Commentaire libre">🗨</th>
            <th class="cth c" style="width:150px;">Heure</th>
            <th class="cth l" style="width:180px;">Opérateur</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="ligne in store.lignesReception" :key="ligne.cle">
            <tr v-if="ligne.genre === 'section'" class="csec">
              <td colspan="8">
                <span class="csec-t">{{ ligne.titre }}</span>
                <span class="csec-n">
                  {{ ligne.nbPoints }} point(s)<template v-if="ligne.nbKits">
                    · {{ ligne.nbKits }} kit(s)</template>
                </span>
              </td>
            </tr>

            <!-- En-tête de kit : la composition reste sous les yeux de
                 l'opérateur, sinon « 3 tubes » ne veut rien dire. -->
            <tr v-else-if="ligne.genre === 'kit'" class="ckit">
              <td colspan="8">
                <span class="ckit-b">⊞ Kit</span>
                <strong>{{ ligne.kit.nom }}</strong>
                <span class="ckit-c">— {{ ligne.kit.composition }}</span>
              </td>
            </tr>

            <template v-else>
              <tr class="crow">
                <td class="c">
                  <button
                    class="etoile"
                    :class="store.saisie(ligne.cle, ligne.point).obligatoire ? 'on' : 'off'"
                    :title="store.saisie(ligne.cle, ligne.point).obligatoire
                      ? 'Point obligatoire' : 'Point optionnel'"
                    :disabled="lectureSeule"
                    @click="store.basculerObligatoire(ligne.cle, ligne.point)"
                  >{{ store.saisie(ligne.cle, ligne.point).obligatoire ? '★' : '☆' }}</button>
                </td>
                <td class="cnc">
                  {{ ligne.point.num }}
                  <template v-if="ligne.copies > 1">
                    <br><span class="cnc-ex">{{ ligne.exemplaire }}/{{ ligne.copies }}</span>
                  </template>
                </td>
                <td>
                  <div class="clbl">{{ ligne.point.libelle }}</div>
                  <div v-if="ligne.point.sousLibelle" class="csub">{{ ligne.point.sousLibelle }}</div>
                  <!-- Les marqueurs du point, en pastilles sous le libellé :
                       ils qualifient le point, pas la saisie. -->
                  <div class="cflags">
                    <span v-if="ligne.point.doubleValidation" class="tagl tagl-dbl"
                          title="Point soumis à double validation : contresigné par une 2e personne">
                      👥 2 pers.
                    </span>
                    <span v-if="ligne.copies > 1" class="tagl tagl-dup"
                          :title="`Exemplaire ${ligne.exemplaire} sur ${ligne.copies}`">
                      ⧉ ×{{ ligne.copies }}
                    </span>
                    <span v-if="ligne.point.multi && ligne.exemplaire === 1" class="tagl tagl-dup">
                      ⧉ {{ uniteMulti(ligne.point.multi) }}
                    </span>
                    <span v-if="ligne.point.numeroSerie" class="tagl tagl-ser"
                          title="Un n° de série est enregistré par exemplaire, en complément du n° de lot">
                      ⬚ n° série
                    </span>
                  </div>
                </td>
                <td class="c">
                  <span class="ctb" :class="badge[ligne.point.type]?.[0] ?? 't-au'">
                    {{ badge[ligne.point.type]?.[1] ?? ligne.point.type }}
                  </span>
                </td>
                <td>
                  <CelluleControle :point="ligne.point" :cle="ligne.cle" :lecture-seule="lectureSeule" />
                  <!-- Le n° de série identifie CET exemplaire ; il vient en
                       complément du n° de lot, qui couvre tout l'envoi. -->
                  <div v-if="ligne.point.numeroSerie" class="cserie">
                    <label>N° série</label>
                    <input type="text" placeholder="Ex. CD4-000117"
                           v-model="store.saisie(ligne.cle, ligne.point).numeroSerie"
                           :disabled="lectureSeule">
                  </div>
                </td>
                <td class="c">
                  <button class="ccmt-b"
                          :class="{ plein: store.saisie(ligne.cle, ligne.point).commentaire }"
                          :title="store.saisie(ligne.cle, ligne.point).commentaire
                            || 'Ajouter un commentaire'"
                          @click="store.basculerCommentaire(ligne.cle)">🗨</button>
                </td>
                <td>
                  <input class="cdf" type="datetime-local"
                         v-model="store.saisie(ligne.cle, ligne.point).horodatage"
                         :disabled="lectureSeule">
                </td>
                <td>
                  <div class="copw">
                    <!-- L'opérateur AFFICHÉ est celui qui a fait la saisie, pas
                         celui qui regarde l'écran : sur un dossier rouvert par
                         quelqu'un d'autre, le second attribuait la saisie à la
                         mauvaise personne. L'opérateur connecté ne s'affiche que
                         sur une ligne encore vierge — c'est lui qui sera
                         enregistré si elle est renseignée. -->
                    <input class="copi" type="text" placeholder="Opérateur 1"
                           :value="store.saisie(ligne.cle, ligne.point).operateur
                                   || store.operateurConnecte.nom" readonly>
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

              <!-- Commentaire libre : ce qui explique un écart ne rentre pas
                   dans une case à cocher. -->
              <tr v-if="store.commentaireOuvert(ligne.cle)" class="crow ccmt-r">
                <td></td>
                <td colspan="7">
                  <div class="ccmt-t">Commentaire — {{ ligne.point.num }} · restitué en bulle</div>
                  <textarea rows="2" class="ccmt-z" placeholder="Observation, écart, réserve…"
                            v-model="store.saisie(ligne.cle, ligne.point).commentaire"
                            :disabled="lectureSeule"></textarea>
                  <div class="ccmt-a">
                    <button class="ccmt-ok" @click="store.basculerCommentaire(ligne.cle)">
                      Replier
                    </button>
                    <button class="ccmt-x" :disabled="lectureSeule"
                            @click="store.saisie(ligne.cle, ligne.point).commentaire = '';
                                    store.basculerCommentaire(ligne.cle)">
                      Effacer
                    </button>
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
  <BlocContresignature />
</template>
