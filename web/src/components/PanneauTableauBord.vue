<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useTableauBord } from '../stores/tableauBord.js'

const store = useTableauBord()
const emit = defineEmits(['ouvrir'])

const formulaireOuvert = ref(false)
const nouveau = reactive({ codeModele: '', produitId: '', numeroLot: '' })

onMounted(async () => {
  await store.charger()
  if (!nouveau.codeModele && store.modeles.length) nouveau.codeModele = store.modeles[0].code
})


/* Deux dossiers clos ne se valent pas : la non-conformité est la conclusion du
   parcours, pas un détail à ouvrir le dossier pour découvrir. */
const LIB_STATUT = {
  en_cours: 'En cours',
  attente: "En attente d'allocation",
  termine: 'Terminé',
  non_conforme: 'Non conforme'
}

const tuiles = computed(() => [
  { code: '', classe: '', valeur: store.nbEnCours, libelle: 'Parcours en cours' },
  { code: 'attente', classe: 'att', valeur: store.nbAttente, libelle: "En attente d'allocation" },
  { code: 'valide', classe: 'fin', valeur: store.nbTermines, libelle: 'Terminés — consultables' },
  { code: '', classe: 'alr', valeur: store.nbAlarmes, libelle: 'Dossiers avec alarme', filtreAlarme: true }
])

const dossiersAffiches = computed(() =>
  filtreAlarme.value ? store.dossiers.filter((d) => d.nbAlarmes > 0) : store.dossiers)

/* Le filtre « alarme » n'existe pas côté serveur : c'est une lecture de la
   liste déjà chargée, pas un critère de recherche. */
const filtreAlarme = ref(false)

function choisirTuile (t) {
  filtreAlarme.value = t.filtreAlarme === true
  if (!t.filtreAlarme) {
    store.filtreStatut = store.filtreStatut === t.code ? '' : t.code
    store.charger()
  }
}

async function demarrer () {
  const id = await store.demarrerScenario({
    codeModele: nouveau.codeModele,
    produitId: nouveau.produitId,
    numeroLot: (nouveau.numeroLot || '').trim()
  })
  if (id) {
    formulaireOuvert.value = false
    Object.assign(nouveau, { produitId: '', numeroLot: '' })
    emit('ouvrir', id)
  }
}

const dateCourte = (v) => v
  ? new Date(v).toLocaleString('fr-FR',
      { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—'
</script>

<template>
  <div class="adm">
    <div class="adm-bar">
      <label for="tb-q" style="font-weight:bold;color:#4a3880;">Rechercher :</label>
      <input id="tb-q" type="text" v-model="store.recherche" @input="store.chargerDiffere()"
             placeholder="Patient, produit, n° de lot, n° de dossier…" style="width:280px;"/>
      <!-- Le choix du produit a rejoint la ligne de filtres, sous l'en-tête de
           sa colonne : deux commandes pour le même critère invitent à se
           demander laquelle gagne. -->
      <span v-if="store.filtreActif" class="tb-restreint">liste restreinte par un filtre</span>
      <button class="adm-b" @click="filtreAlarme = false; store.reinitialiser()">Réinitialiser</button>
      <button class="adm-b adm-b-p" style="margin-left:auto;"
              @click="formulaireOuvert = !formulaireOuvert">
        {{ formulaireOuvert ? '✕ Annuler' : '▶ Démarrer un parcours MTI' }}
      </button>
    </div>

    <div v-if="store.indisponible" class="adm-msg adm-msg-hs">
      Tableau de bord indisponible : {{ store.erreur }}
      <div style="margin-top:5px;font-size:12px;">
        La liste des dossiers n'est pas embarquée dans l'application : une liste lue
        hors ligne serait périmée, et démarrer un parcours sans base n'aurait pas de sens.
      </div>
    </div>
    <div v-else-if="store.erreur" class="adm-msg adm-msg-ko">{{ store.erreur }}</div>

    <div v-if="formulaireOuvert && !store.indisponible" class="adm-form">
      <div class="adm-form-t">Nouveau dossier MTI</div>
      <div class="adm-r">
        <label>N° de dossier</label>
        <!-- Pas de champ : le numéro est attribué par la base à la création
             (séquence MTI-000001, MTI-000002, …). Le proposer ici laisserait
             croire qu'il est modifiable, et un numéro calculé côté navigateur
             n'est unique que par chance. -->
        <span class="adm-auto">MTI-000XXX — attribué automatiquement</span>
      </div>
      <div class="adm-r">
        <label for="tb-mod">Parcours</label>
        <select id="tb-mod" v-model="nouveau.codeModele">
          <option v-for="m in store.modeles" :key="m.code" :value="m.code">
            {{ m.libelle }} (v{{ m.version }}, {{ m.nbProcessus }} processus)
          </option>
        </select>
      </div>
      <div class="aide" style="margin-left:129px;">
        La définition du modèle est recopiée dans le dossier à sa création : une
        évolution ultérieure du référentiel ne modifie pas les dossiers déjà ouverts.
      </div>
      <div class="adm-r">
        <label for="tb-nprod">Produit</label>
        <select id="tb-nprod" v-model="nouveau.produitId">
          <option value="">— à renseigner plus tard —</option>
          <option v-for="p in store.produits" :key="p.id" :value="p.id">
            {{ p.denomination }} — {{ p.dci }}
          </option>
        </select>
      </div>
      <div class="adm-r">
        <label for="tb-lot">N° de lot</label>
        <input id="tb-lot" type="text" v-model="nouveau.numeroLot" placeholder="Si déjà connu"/>
      </div>
      <div class="aide" style="margin-left:129px;">
        Aucune donnée patient n'est demandée : le dossier reste en attente d'allocation
        jusqu'à la préallocation ou la mise en fabrication.
      </div>
      <div class="adm-r" style="margin-bottom:0;">
        <label></label>
        <button class="adm-b adm-b-p" @click="demarrer()">Créer et ouvrir le parcours</button>
      </div>
    </div>

    <template v-if="!store.indisponible">
      <div class="tb-tuiles">
        <div v-for="(t, i) in tuiles" :key="i" class="tb-tuile" :class="[t.classe, {
               on: t.filtreAlarme ? filtreAlarme : (t.code && store.filtreStatut === t.code) }]"
             role="button" tabindex="0" @click="choisirTuile(t)">
          <div class="v">{{ t.valeur }}</div>
          <div class="l">{{ t.libelle }}</div>
        </div>
      </div>

      <div v-if="store.chargement && !store.dossiers.length" class="adm-vide">Chargement…</div>
      <div v-else-if="!dossiersAffiches.length" class="adm-vide">
        Aucun dossier ne correspond.
        <div style="margin-top:8px;font-size:12px;">
          Démarrez un parcours pour créer le premier.
        </div>
      </div>
      <table v-else class="adm-t">
        <thead>
          <tr>
            <th style="width:170px;">N° dossier</th>
            <th style="width:130px;">Produit</th>
            <th style="width:130px;">N° de lot</th>
            <th>Patient</th>
            <th style="width:78px;" title="La prescription a-t-elle été réalisée">Prescr.</th>
            <th>Étape en cours</th>
            <th style="width:120px;">Avancement</th>
            <th style="width:150px;">Statut</th>
            <th style="width:110px;">Dernière activité</th>
            <th style="width:34px;"></th>
          </tr>
          <!-- Ligne de filtres. Chacun part au serveur : la liste est plafonnée
               à 200 lignes, filtrer ici cacherait sans le dire les dossiers
               correspondants situés au-delà du plafond. -->
          <tr class="tb-filtres">
            <th>
              <input type="text" placeholder="Filtrer…" aria-label="Filtrer par n° de dossier"
                     v-model="store.filtreReference" @input="store.chargerDiffere()">
            </th>
            <th>
              <select aria-label="Filtrer par produit"
                      v-model="store.filtreProduit" @change="store.charger()">
                <option value="">Tous</option>
                <option v-for="p in store.produits" :key="p.id" :value="p.id">
                  {{ p.denomination }}
                </option>
              </select>
            </th>
            <th>
              <input type="text" placeholder="Filtrer…" aria-label="Filtrer par n° de lot"
                     v-model="store.filtreLot" @input="store.chargerDiffere()">
            </th>
            <th>
              <input type="text" placeholder="Nom ou référence…" aria-label="Filtrer par patient"
                     v-model="store.filtrePatient" @input="store.chargerDiffere()">
            </th>
            <th>
              <select aria-label="Filtrer par prescription"
                      v-model="store.filtrePrescription" @change="store.charger()">
                <option value="">Tous</option>
                <option value="oui">✓ faite</option>
                <option value="non">○ non</option>
              </select>
            </th>
            <th>
              <!-- Les étapes viennent des dossiers, pas du modèle actif : un
                   dossier ouvert sous une version précédente porte des
                   processus que le modèle ne connaît plus. -->
              <select aria-label="Filtrer par étape en cours"
                      v-model="store.filtreEtape" @change="store.charger()">
                <option value="">Toutes</option>
                <option v-for="e in store.etapes" :key="e" :value="e">{{ e }}</option>
              </select>
            </th>
            <th></th>
            <th>
              <select aria-label="Filtrer par statut"
                      v-model="store.filtreStatut" @change="store.charger()">
                <option value="">Tous</option>
                <option value="attente">En attente d'allocation</option>
                <option value="en_cours">En cours</option>
                <option value="valide">Clos</option>
              </select>
            </th>
            <th></th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in dossiersAffiches" :key="d.id" class="tb-ligne"
              :class="{ fini: d.statutAffiche === 'termine' || d.statutAffiche === 'non_conforme' }"
              tabindex="0" @click="emit('ouvrir', d.id)">
            <td class="ident">
              {{ d.reference }}
              <span v-if="d.nbAlarmes" class="tb-alarme" :title="`${d.nbAlarmes} relevé(s) hors seuil`">⚠</span>
            </td>
            <td>{{ d.produit || '—' }}</td>
            <td class="meta">{{ d.numeroLot || '—' }}</td>
            <td>
              <span v-if="d.patient">
                {{ d.patient.nom || d.patient.reference }}
                <span class="meta">({{ d.patient.preallocation ? 'préalloué' : 'alloué' }})</span>
              </span>
              <span v-else class="tb-attente">En attente d'allocation</span>
            </td>
            <td>
              <span :class="d.prescriptionFaite ? 'presc-oui' : 'presc-non'"
                    :title="d.prescriptionFaite ? 'Prescription réalisée' : 'Prescription non réalisée'">
                {{ d.prescriptionFaite ? '✓ faite' : '○ non' }}
              </span>
            </td>
            <td>{{ d.etape }}</td>
            <td>
              <span class="tb-jauge"><i :style="{ width: d.avancement + '%' }"></i></span>
              <span class="meta">&nbsp;{{ d.avancement }}&nbsp;%</span>
            </td>
            <td>
              <span class="prof" :class="'tb-s-' + d.statutAffiche">
                {{ LIB_STATUT[d.statutAffiche] }}
              </span>
            </td>
            <td class="meta">{{ dateCourte(d.derniereActivite) }}</td>
            <td class="meta" style="text-align:right;">›</td>
          </tr>
        </tbody>
      </table>

      <div style="padding:12px 14px;font-size:12px;color:#777;line-height:1.6;">
        {{ dossiersAffiches.length }} dossier(s) affiché(s).
        Un dossier terminé reste consultable : il est figé, pas effacé — toute correction
        passe par une nouvelle version.
      </div>
    </template>
  </div>
</template>
