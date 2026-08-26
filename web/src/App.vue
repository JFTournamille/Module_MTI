<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BarreLaterale from './components/BarreLaterale.vue'
import PanneauReception from './components/PanneauReception.vue'
import PanneauStandard from './components/PanneauStandard.vue'
import ModalePatient from './components/ModalePatient.vue'
import ModaleCatalogue from './components/ModaleCatalogue.vue'
import PanneauUtilisateurs from './components/PanneauUtilisateurs.vue'
import { useParcours } from './stores/parcours.js'

const store = useParcours()

/** Onglet affiché : 'scenario' | 'utilisateurs'. */
const onglet = ref('scenario')
const TITRES = {
  scenario: 'Scénario MTI — Processus chronologique',
  utilisateurs: 'Administration — Utilisateurs'
}
const modalePatient = ref(false)
const modaleCatalogue = ref(false)

onMounted(() => store.charger())
onBeforeUnmount(() => store.arreterHorloge())

const enReception = computed(() => store.processusCourant?.gabarit === 'reception')

/** La validation reste bloquée tant qu'un point obligatoire n'est pas renseigné
 *  et qu'aucune conclusion de conformité n'est posée. */
const blocages = computed(() => {
  const raisons = []
  if (store.pointsIncomplets.length) {
    raisons.push(`${store.pointsIncomplets.length} point(s) obligatoire(s) non renseigné(s)`)
  }
  if (!store.dossier.conformite) raisons.push('conformité non conclue')
  return raisons
})
</script>

<template>
  <div class="dlg">
    <div class="titlebar">
      <span>{{ TITRES[onglet] }}</span>
      <button class="x">✕</button>
    </div>

    <nav class="onglets" role="tablist" aria-label="Navigation principale">
      <button class="onglet" :class="{ act: onglet === 'scenario' }" role="tab"
              :aria-selected="onglet === 'scenario'" @click="onglet = 'scenario'">
        Scénario
      </button>
      <button class="onglet" :class="{ act: onglet === 'utilisateurs' }" role="tab"
              :aria-selected="onglet === 'utilisateurs'" @click="onglet = 'utilisateurs'">
        Utilisateurs
      </button>
    </nav>

    <template v-if="onglet === 'scenario'">
    <div class="hdr">
      <div class="hdr-left">
        <div class="name">
          <span v-if="store.libellePatient.style === 'nomme'">{{ store.libellePatient.texte }}</span>
          <span v-else-if="store.libellePatient.style === 'attente'"
                style="font-style:italic;color:#c8b8f8;font-size:13px;">
            {{ store.libellePatient.texte }}
          </span>
          <span v-else class="unaffected">{{ store.libellePatient.texte }}</span>
        </div>
        <div class="meta">
          N° lot : {{ store.dossier.numeroLot || '—' }}
          <template v-if="store.ordonnancierVisible">
            &nbsp;|&nbsp; N° ordonnancier : {{ store.dossier.numeroOrdonnancier || '—' }}
          </template>
          &nbsp;|&nbsp; Péremption : {{ store.dossier.datePeremption || '—' }}
        </div>
      </div>
      <div class="op-badge">
        Opérateur connecté<span>{{ store.operateurConnecte.nom }}</span>
      </div>
    </div>

    <div class="body">
      <BarreLaterale
        :processus="store.processus"
        :selection="store.selection"
        @selectionner="store.selectionner"
        @ouvrir-catalogue="modaleCatalogue = true"
      />
      <div class="main">
        <div v-if="store.chargement" style="padding:20px;color:#777;font-size:13px;">
          Chargement des référentiels…
        </div>
        <template v-else>
          <PanneauReception
            v-if="enReception"
            @ouvrir-recherche-patient="modalePatient = true"
          />
          <PanneauStandard v-else-if="store.processusCourant" :processus="store.processusCourant" />
        </template>
      </div>
    </div>

    <div class="footer">
      <button class="f-btn">Imprimer</button>
      <button class="f-btn">Exporter PDF</button>
      <div class="conf-grp">
        Conformité :
        <label>
          <input type="radio" name="conformite" value="non_conforme"
                 v-model="store.dossier.conformite"> Non conforme
        </label>
        <label>
          <input type="radio" name="conformite" value="conforme"
                 v-model="store.dossier.conformite"> Conforme
        </label>
      </div>
      <button class="btn-ann">✕ Annuler</button>
      <button
        class="btn-val" :disabled="blocages.length > 0"
        :title="blocages.length ? `Validation bloquée : ${blocages.join(' ; ')}` : 'Valider le processus'"
        :style="blocages.length ? 'opacity:.5;cursor:not-allowed;' : ''"
      >✓ Valider</button>
    </div>

    <!-- Bandeau d'état : hors-ligne et points bloquants -->
    <div v-if="store.horsLigne || blocages.length"
         style="background:#fffbf0;border-top:1px solid #d0b060;padding:4px 14px;
                font-size:11px;color:#7a5000;display:flex;gap:14px;flex-wrap:wrap;">
      <span v-if="store.horsLigne">
        ⚠ Mode hors-ligne — référentiels embarqués, saisies non synchronisées.
      </span>
      <span v-if="blocages.length">Validation bloquée : {{ blocages.join(' ; ') }}</span>
    </div>
    </template>

    <PanneauUtilisateurs v-else-if="onglet === 'utilisateurs'" />
  </div>

  <ModalePatient
    :ouvert="modalePatient"
    @fermer="modalePatient = false"
    @choisir="store.choisirPatient"
  />
  <ModaleCatalogue
    :ouvert="modaleCatalogue"
    :catalogue="store.catalogue"
    @fermer="modaleCatalogue = false"
    @ajouter="store.ajouterProcessus"
  />
</template>
