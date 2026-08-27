<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BarreLaterale from './components/BarreLaterale.vue'
import PanneauReception from './components/PanneauReception.vue'
import PanneauStandard from './components/PanneauStandard.vue'
import ModalePatient from './components/ModalePatient.vue'
import ModaleCatalogue from './components/ModaleCatalogue.vue'
import PanneauUtilisateurs from './components/PanneauUtilisateurs.vue'
import PanneauConfiguration from './components/PanneauConfiguration.vue'
import PanneauTableauBord from './components/PanneauTableauBord.vue'
import { useParcours } from './stores/parcours.js'
import { useSession } from './stores/session.js'

const session = useSession()
const store = useParcours()

/** Onglet affiché. Le tableau de bord est le point d'entrée : on part de la
 *  liste des dossiers, pas d'un formulaire vide. */
const onglet = ref('bord')
const TITRES = {
  bord: 'Tableau de bord MTI',
  scenario: 'Scénario MTI — Processus chronologique',
  utilisateurs: 'Administration — Utilisateurs',
  configuration: 'Configuration — Processus et points de contrôle'
}

/** Ouvre un dossier depuis le tableau de bord et bascule sur le scénario. */
async function ouvrirDepuisBord (id) {
  if (await store.ouvrirDossier(id)) onglet.value = 'scenario'
}
const modalePatient = ref(false)
const modaleCatalogue = ref(false)

const referenceNouveau = ref('')

onMounted(async () => {
  await session.charger()
  await store.charger()
  // Reprendre le dossier laissé ouvert. S'il a disparu, on retombe sur l'état
  // vide plutôt que sur un formulaire qui n'enregistrerait rien.
  const memorise = store.dossierMemorise()
  if (memorise) await store.ouvrirDossier(memorise)
})

/** Référence par défaut : lisible, et unique sans avoir à interroger la base. */
function referenceProposee () {
  const n = new Date()
  const p = (v) => String(v).padStart(2, '0')
  return `MTI-${n.getFullYear()}-${p(n.getMonth() + 1)}${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}`
}

async function creer () {
  const ref = (referenceNouveau.value || '').trim() || referenceProposee()
  if (await store.creerDossier(ref)) referenceNouveau.value = ''
}
onBeforeUnmount(() => store.arreterHorloge())

const enReception = computed(() => store.processusCourant?.gabarit === 'reception')

/** La validation reste bloquée tant qu'un point obligatoire n'est pas renseigné
 *  et qu'aucune conclusion de conformité n'est posée. */
const blocages = computed(() => {
  /* Un dossier déjà validé n'a rien à valider : annoncer « validation bloquée »
     sur un dossier clos en lecture seule décrivait un obstacle qui n'existe
     pas, à côté du message « lecture seule » qui dit le contraire. */
  if (store.lectureSeule) return []
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
      <button class="onglet" :class="{ act: onglet === 'bord' }" role="tab"
              :aria-selected="onglet === 'bord'" @click="onglet = 'bord'">
        Tableau de bord
      </button>
      <button class="onglet" :class="{ act: onglet === 'scenario' }" role="tab"
              :aria-selected="onglet === 'scenario'" @click="onglet = 'scenario'">
        Scénario
      </button>
      <button class="onglet" :class="{ act: onglet === 'configuration' }" role="tab"
              :aria-selected="onglet === 'configuration'" @click="onglet = 'configuration'">
        Configuration
      </button>
      <button class="onglet" :class="{ act: onglet === 'utilisateurs' }" role="tab"
              :aria-selected="onglet === 'utilisateurs'" @click="onglet = 'utilisateurs'">
        Utilisateurs
      </button>
    </nav>

    <PanneauTableauBord v-if="onglet === 'bord'" @ouvrir="ouvrirDepuisBord" />

    <template v-else-if="onglet === 'scenario'">
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
        <!-- Identifiants du patient : l'IPP pointe vers le dossier du SIH, les
             autres numéros portent un libellé modifiable. Rien ne s'affiche
             tant qu'aucun patient n'est rattaché — l'anonymat vaut ici aussi. -->
        <div v-if="store.dossier.patient" class="ids-pat">
          <label class="ids-l" for="ids-ipp">IPP</label>
          <input id="ids-ipp" class="ids-i" type="text" placeholder="—"
                 v-model="store.dossier.patient.ipp"
                 :disabled="store.lectureSeule"
                 @change="store.enregistrerIdentifiants()">
          <template v-for="(num, i) in store.dossier.patient.identifiants ?? []" :key="i">
            <!-- Le libellé est un champ, pas un texte : c'est tout l'intérêt. -->
            <input class="ids-lm" type="text" v-model="num.libelle"
                   :disabled="store.lectureSeule"
                   title="Libellé du numéro — modifiable"
                   @change="store.enregistrerIdentifiants()">
            <input class="ids-i" type="text" placeholder="—" v-model="num.valeur"
                   :disabled="store.lectureSeule"
                   @change="store.enregistrerIdentifiants()">
            <button v-if="!store.lectureSeule" class="ids-x" title="Retirer ce numéro"
                    @click="store.retirerIdentifiant(i); store.enregistrerIdentifiants()">−</button>
          </template>
          <button v-if="!store.lectureSeule" class="ids-p" title="Ajouter un numéro patient"
                  @click="store.ajouterIdentifiant()">+</button>
        </div>

        <div v-if="store.dossierId" class="presc-jalon">
          <button class="presc-b" :class="{ faite: store.dossier.prescriptionFaite }"
                  :disabled="store.lectureSeule"
                  :title="store.lectureSeule ? 'Dossier validé — lecture seule'
                    : 'Basculer le jalon de prescription'"
                  @click="store.basculerPrescription()">
            {{ store.dossier.prescriptionFaite ? '✓ Prescription réalisée' : '○ Prescription non réalisée' }}
          </button>
          <!-- L'aphérèse n'est plus un processus : c'est une date facultative,
               qui n'apparaît que si le jalon est posé. -->
          <label class="aph-c" :title="store.lectureSeule ? 'Dossier validé — lecture seule'
                   : 'Aphérèse réalisée ?'">
            <input type="checkbox" :checked="store.dossier.aphereseFaite"
                   :disabled="store.lectureSeule"
                   @change="store.basculerApherese()">
            Aphérèse&nbsp;?
          </label>
          <input v-if="store.dossier.aphereseFaite" class="aph-d" type="date"
                 v-model="store.dossier.dateApherese"
                 :disabled="store.lectureSeule"
                 title="Date de l'aphérèse"
                 @change="store.enregistrerEntete()">
        </div>

        <!-- Information importante : une ligne libre, toujours visible. Vide,
             elle ne prend pas de place ; renseignée, elle doit se voir. -->
        <div v-if="store.dossierId" class="info-imp" :class="{ plein: !!store.dossier.informationImportante }">
          <span class="info-ic" aria-hidden="true">⚑</span>
          <!-- `title` en plus du champ : une alerte plus longue que la largeur
               disponible doit rester lisible au survol. -->
          <input class="info-i" type="text"
                 :placeholder="store.lectureSeule ? '—' : 'Information importante à signaler…'"
                 :title="store.dossier.informationImportante || ''"
                 v-model="store.dossier.informationImportante"
                 :disabled="store.lectureSeule"
                 @change="store.enregistrerEntete()">
        </div>
      </div>
      <div class="op-badge">
        <template v-if="session.selectionPossible">
          <label for="op-sel">Opérateur connecté</label>
          <select id="op-sel" class="op-sel"
                  :value="session.operateur?.id ?? ''"
                  @change="session.choisir($event.target.value)">
            <option v-for="o in session.operateurs" :key="o.id" :value="o.id">
              {{ o.nom }}{{ o.profil ? ` — ${o.profil}` : '' }}
            </option>
          </select>
        </template>
        <template v-else>
          Opérateur connecté<span>{{ store.operateurConnecte.nom }}</span>
        </template>
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
        <template v-else-if="!store.dossierId">
          <div class="vide-dossier">
            <div class="vd-t">Aucun dossier ouvert</div>
            <p>
              Les saisies ne sont enregistrées que dans un dossier. Créez-en un, ou
              ouvrez-en un depuis le tableau de bord.
            </p>
            <div class="vd-f">
              <label for="vd-ref">Référence</label>
              <input id="vd-ref" type="text" v-model="referenceNouveau"
                     :placeholder="referenceProposee()"/>
              <button class="vd-b" @click="creer()">Créer le dossier</button>
            </div>
            <p v-if="store.erreurDossier" class="vd-e">{{ store.erreurDossier }}</p>
          </div>
        </template>
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
      <span v-if="store.dossierId" class="etat-enr">
        <template v-if="store.enregistrement">enregistrement…</template>
        <template v-else-if="store.lectureSeule">dossier validé — lecture seule</template>
        <template v-else-if="store.dernierEnregistrement">
          enregistré à {{ store.dernierEnregistrement.toLocaleTimeString('fr-FR',
            { hour: '2-digit', minute: '2-digit' }) }}
        </template>
        <template v-else>non enregistré</template>
      </span>
      <button class="btn-ann" v-if="store.dossierId" @click="store.fermerDossier()">Fermer</button>
      <!-- Avancement du processus courant : sans lui, un processus « à venir »
           reste en lecture seule et le parcours ne peut pas progresser. -->
      <button v-if="store.dossierId && !store.lectureSeule && store.processusCourant"
              class="f-btn proc-etat" :disabled="store.processusCourant.etat === 'valide'"
              :title="store.processusCourant.etat === 'a_venir'
                ? 'Ouvrir ce processus à la saisie'
                : store.processusCourant.etat === 'valide'
                  ? 'Processus déjà validé'
                  : 'Valider ce processus et ouvrir le suivant'"
              @click="store.changerEtatProcessus(
                store.processusCourant.etat === 'a_venir' ? 'en_cours' : 'valide')">
        {{ store.processusCourant.etat === 'a_venir' ? 'Ouvrir ce processus'
           : store.processusCourant.etat === 'valide' ? '✓ Processus validé'
           : 'Valider ce processus' }}
      </button>
      <button class="f-btn" v-if="store.dossierId && !store.lectureSeule"
              :disabled="store.enregistrement"
              @click="store.enregistrerEntete().then(() => store.enregistrerProcessus())">
        Enregistrer
      </button>
      <button
        class="btn-val" :disabled="blocages.length > 0 || !store.dossierId || store.lectureSeule"
        :title="blocages.length ? `Validation bloquée : ${blocages.join(' ; ')}` : 'Valider le dossier'"
        :style="(blocages.length || !store.dossierId || store.lectureSeule) ? 'opacity:.5;cursor:not-allowed;' : ''"
        @click="store.validerDossier()"
      >✓ Valider</button>
    </div>

    <!-- Bandeau d'état : hors-ligne et points bloquants -->
    <div v-if="session.avertissement" class="demo-bandeau">
      ⚠ {{ session.avertissement }}
    </div>

    <div v-if="store.horsLigne || blocages.length || store.erreurDossier"
         style="background:#fffbf0;border-top:1px solid #d0b060;padding:4px 14px;
                font-size:11px;color:#7a5000;display:flex;gap:14px;flex-wrap:wrap;">
      <span v-if="store.horsLigne">
        ⚠ Mode hors-ligne — référentiels embarqués, saisies non synchronisées.
      </span>
      <span v-if="blocages.length">Validation bloquée : {{ blocages.join(' ; ') }}</span>
      <span v-if="store.erreurDossier" style="color:#c62828;font-weight:bold;">
        {{ store.erreurDossier }}
      </span>
    </div>
    </template>

    <PanneauConfiguration v-else-if="onglet === 'configuration'" />
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
