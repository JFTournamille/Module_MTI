<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BarreLaterale from './components/BarreLaterale.vue'
import PanneauReception from './components/PanneauReception.vue'
import PanneauStandard from './components/PanneauStandard.vue'
import ModalePatient from './components/ModalePatient.vue'
import ModaleCatalogue from './components/ModaleCatalogue.vue'
import PanneauCodifications from './components/PanneauCodifications.vue'
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
  parcours: 'Parcours MTI — Processus chronologique',
  codifications: 'Codifications — Utilisateurs, services, produits, patients',
  configuration: 'Configuration — Processus et points de contrôle'
}

/* « Parcours » n'est pas un onglet de la barre : on n'y accède qu'en ouvrant un
   dossier depuis le tableau de bord, et un onglet permanent menait à un écran
   vide portant un formulaire de création qui faisait doublon avec celui du
   tableau de bord. La vue s'ouvre sur un dossier et se referme vers la liste. */
const ONGLETS = [
  ['bord', 'Tableau de bord'],
  ['configuration', 'Configuration'],
  ['codifications', 'Codifications']
]

/** Ouvre un dossier depuis le tableau de bord et bascule sur son parcours. */
async function ouvrirDepuisBord (id) {
  if (await store.ouvrirDossier(id)) onglet.value = 'parcours'
}

/** Revient à la liste sans fermer le dossier : il reste ouvert en fond. */
function retourAuBord () { onglet.value = 'bord' }

/**
 * Ferme le parcours ouvert et ramène au tableau de bord.
 *
 * Fermer le dossier sans changer d'onglet laissait l'écran sur un onglet
 * devenu vide, qu'il fallait quitter à la main : la fermeture doit rendre à
 * l'endroit d'où l'on vient, c'est-à-dire à la liste des dossiers.
 *
 * Rien n'est perdu : les saisies partent au fil de l'eau, et l'onglet se
 * rouvre en cliquant la ligne du dossier au tableau de bord.
 */
function fermerParcours () {
  store.fermerDossier()
  onglet.value = 'bord'
}
const modalePatient = ref(false)

/* Clôture d'un parcours avorté. Le motif vit ici et non dans le store : c'est
   la saisie d'une fenêtre, pas un état du dossier — le dossier ne porte le
   motif qu'une fois clos, et il ne se reprend pas. */
const clotureOuverte = ref(false)
const motifCloture = ref('')

/* Réouverture d'un parcours clos. Le droit est tenu par le SERVEUR (403 sur un
   profil insuffisant) ; ce calcul ne sert qu'à ne pas proposer un bouton dont
   le clic serait refusé. */
const PROFILS_DECLOTURE = ['pharmacien', 'administrateur']
const peutDeclore = computed(() =>
  PROFILS_DECLOTURE.includes(session.operateur?.profil))
const reouvertures = computed(() =>
  store.clotures.filter((c) => c.reouvert_le).length)
const declotureOuverte = ref(false)
const motifDecloture = ref('')

/* Quarantaine. Poser est ouvert à tous ; lever demande un profil avancé —
   même liste que la réouverture d'un parcours clos, et c'est le SERVEUR qui
   refuse. Ce calcul ne sert qu'à ne pas proposer un geste qui sera refusé. */
const quarantaineOuverte = ref(false)
const motifQuarantaine = ref('')
const leveeOuverte = ref(false)
const motifLevee = ref('')
async function poserQuarantaine () {
  if (await store.mettreEnQuarantaine(motifQuarantaine.value)) {
    quarantaineOuverte.value = false
    motifQuarantaine.value = ''
  }
}
async function leverQuarantaine () {
  if (await store.leverQuarantaine(motifLevee.value)) {
    leveeOuverte.value = false
    motifLevee.value = ''
  }
}
async function declore () {
  if (await store.declore(motifDecloture.value)) {
    declotureOuverte.value = false
    motifDecloture.value = ''
  }
}
async function clore () {
  if (await store.clore(motifCloture.value)) {
    clotureOuverte.value = false
    motifCloture.value = ''
    /* Retour au tableau de bord : le dossier est figé, il n'y a plus rien à y
       faire, et c'est là que la ligne close doit être vue. */
    retourAuBord()
  }
}
/* Quand la modale est ouverte pour poser le jalon de prescription, le patient
   choisi doit AUSSI faire basculer le jalon : c'est un seul geste pour
   l'utilisateur, même s'il traverse deux écrans. */
const patientPourPrescription = ref(false)

/**
 * Bascule le jalon de prescription.
 *
 * Déclarer une prescription réalisée sur un dossier sans patient laisserait un
 * jalon qui ne se rattache à personne : une prescription est nominative par
 * nature. On impose donc le rattachement au moment où le jalon est posé, plutôt
 * que de laisser l'incohérence s'installer et d'avoir à la rattraper plus tard.
 * Le retrait du jalon, lui, ne demande rien.
 */
async function basculerPrescription () {
  if (!store.dossier.prescriptionFaite && !store.dossier.patient) {
    patientPourPrescription.value = true
    modalePatient.value = true
    return
  }
  await store.basculerPrescription()
}

/** Patient choisi dans la modale : on le rattache, et on pose le jalon si
 *  c'est lui qu'on cherchait à poser. */
async function patientChoisi (patient) {
  store.choisirPatient(patient)
  if (patientPourPrescription.value) {
    patientPourPrescription.value = false
    store.dossier.prescriptionFaite = true
  }
  await store.enregistrerEntete()
}
const modaleCatalogue = ref(false)

onMounted(async () => {
  await session.charger()
  await store.charger()
  // Reprendre le dossier laissé ouvert. S'il a disparu, on retombe sur l'état
  // vide plutôt que sur un formulaire qui n'enregistrerait rien.
  const memorise = store.dossierMemorise()
  if (memorise) await store.ouvrirDossier(memorise)
})

onBeforeUnmount(() => store.arreterHorloge())

const enReception = computed(() => store.processusCourant?.gabarit === 'reception')

/** Ce qui reste rouge sur le processus affiché, en une ligne puis en détail. */
const resumeCoches = computed(() => {
  const r = store.coches.nonVertes
  if (!r.length) return ''
  const t = r.slice(0, 2)
    .map((c) => `${c.point_num ? c.point_num + ' ' : ''}${c.raison}`)
    .join(' · ')
  return r.length > 2 ? `${t} · +${r.length - 2}` : t
})
const detailCoches = computed(() =>
  store.coches.nonVertes
    .map((c) => `${c.point_num ?? '—'} ${c.libelle} — ${c.raison}`)
    .join('\n'))

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
  /* La conformité n'est plus à conclure à la main quand le serveur constate
     que tout est vert sur le dossier : c'est la décision prise. Le blocage ne
     subsiste donc que si rien n'est coché ET que quelque chose est rouge. */
  if (!store.dossier.conformite && !store.conformiteAutomatiquePossible) {
    raisons.push(store.cochesDossier.nonVertes.length
      ? `conformité non conclue (${store.cochesDossier.nonVertes.length} point(s) ` +
        'obligatoire(s) à traiter — les points facultatifs laissés vides ne comptent pas)'
      : 'conformité non conclue')
  }
  return raisons
})
</script>

<template>
  <div class="dlg">
    <div class="titlebar">
      <span>{{ TITRES[onglet] }}</span>

      <!-- L'opérateur connecté vivait dans l'en-tête du DOSSIER : il
           disparaissait donc du tableau de bord, de la configuration et des
           codifications — c'est-à-dire partout où l'on travaille sans dossier
           ouvert. Or savoir SOUS QUEL NOM on agit vaut pour tous les écrans :
           c'est ce nom qui signera la prochaine saisie, et c'est lui qu'il
           faut changer avant de commencer, pas après. La barre de titre est
           le seul bandeau présent sur tous les onglets. -->
      <div class="op-barre">
        <template v-if="session.selectionPossible">
          <label for="op-sel">Opérateur</label>
          <select id="op-sel" class="op-sel"
                  :value="session.operateur?.id ?? ''"
                  @change="session.choisir($event.target.value)">
            <option v-for="o in session.operateurs" :key="o.id" :value="o.id">
              {{ o.nom }}{{ o.profil ? ` — ${o.profil}` : '' }}
            </option>
          </select>
        </template>
        <template v-else>
          <label>Opérateur</label>
          <span class="op-nom">{{ store.operateurConnecte.nom }}</span>
        </template>
      </div>
      <!-- Ce bouton venait de la maquette et ne faisait RIEN : il avait
           l'apparence d'une fermeture de fenêtre, or il n'y a pas de fenêtre à
           fermer dans un navigateur. Il ferme donc ce qui est réellement
           fermable — le parcours ouvert — et se désarme quand il n'y en a
           pas, plutôt que de rester rouge et inerte. -->
      <button class="x" :disabled="!store.dossierId"
              :title="store.dossierId
                ? `Fermer le parcours ${store.dossier.reference || ''} et revenir au tableau de bord`
                : 'Aucun parcours ouvert à fermer'"
              @click="fermerParcours()">✕</button>
    </div>

    <nav class="onglets" role="tablist" aria-label="Navigation principale">
      <button v-for="[code, libelle] in ONGLETS" :key="code"
              class="onglet" :class="{ act: onglet === code }" role="tab"
              :aria-selected="onglet === code" @click="onglet = code">
        {{ libelle }}
      </button>
      <!-- Le parcours ouvert apparaît en fin de barre, et seulement tant qu'un
           dossier est ouvert : c'est un contexte de travail, pas une
           destination. -->
      <span v-if="store.dossierId" class="onglet onglet-doss"
            :class="{ act: onglet === 'parcours' }">
        <button class="onglet-doss-l" role="tab" :aria-selected="onglet === 'parcours'"
                @click="onglet = 'parcours'">
          ▸ {{ store.dossier.reference || 'Parcours' }}
        </button>
        <!-- La fermeture est SUR l'onglet, comme dans un navigateur : c'est là
             qu'on la cherche. Elle vit dans son propre bouton et non dans le
             bouton d'onglet — un bouton dans un bouton n'est pas du HTML
             valide, et le clic de fermeture activerait l'onglet au passage. -->
        <button class="onglet-x" title="Fermer ce parcours"
                aria-label="Fermer ce parcours" @click.stop="fermerParcours()">✕</button>
      </span>
    </nav>

    <PanneauTableauBord v-if="onglet === 'bord'" @ouvrir="ouvrirDepuisBord" />

    <template v-else-if="onglet === 'parcours'">
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
          <!-- L'ordonnancier est transmis par CHIMIO au moment de la
               préparation ; il est recopié à la main pour l'instant. Il
               n'apparaît qu'une fois le patient identifiable : une inscription
               au registre est nominative, elle n'a pas de sens sur un dossier
               anonyme. -->
          <template v-if="store.ordonnancierVisible">
            &nbsp;|&nbsp;
            <label for="ent-ordo">N° ordonnancier :</label>
            <span v-if="store.lectureSeule">{{ store.dossier.numeroOrdonnancier || '—' }}</span>
            <input v-else id="ent-ordo" class="ent-ordo" type="text" placeholder="—"
                   v-model="store.dossier.numeroOrdonnancier"
                   title="Numéro transmis par CHIMIO à la préparation">
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
          <!-- « + N° » et non « + » seul : le bouton doit dire ce qu'il ajoute,
               il est entouré d'autres champs. -->
          <button v-if="!store.lectureSeule" class="ids-p" title="Ajouter un numéro patient"
                  @click="store.ajouterIdentifiant()">+&nbsp;N°</button>
        </div>

        <div v-if="store.dossierId" class="presc-jalon">
          <button class="presc-b" :class="{ faite: store.dossier.prescriptionFaite }"
                  :disabled="store.lectureSeule"
                  :title="store.lectureSeule ? 'Dossier validé — lecture seule'
                    : 'Basculer le jalon de prescription'"
                  @click="basculerPrescription()">
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
          <!-- Plus de formulaire de création ici : il faisait doublon avec
               celui du tableau de bord, et deux endroits pour créer un dossier
               laissaient l'utilisateur choisir sans savoir ce qui les
               distinguait. Cet état n'est plus atteint que si le dossier
               mémorisé a disparu entre-temps. -->
          <div class="vide-dossier">
            <div class="vd-t">Aucun dossier ouvert</div>
            <p>
              Les saisies ne sont enregistrées que dans un dossier. Ouvrez-en un
              depuis le tableau de bord, ou démarrez-y un nouveau parcours.
            </p>
            <div class="vd-f">
              <button class="vd-b" @click="retourAuBord()">← Aller au tableau de bord</button>
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

    <!-- Le pied de page mêlait deux portées : ce qui valide LE PROCESSUS
         affiché et ce qui conclut LE PARCOURS. Deux boutons presque
         identiques — « Valider ce processus » et « ✓ Valider » — se
         touchaient, et la conformité entre les deux n'annonçait ni l'une ni
         l'autre. Deux groupes nommés, séparés, et le parcours à gauche. -->
    <div class="footer" v-if="store.dossierId">

      <!-- ── LE PROCESSUS AFFICHÉ ── sa conformité, son avancement, sa
           sauvegarde. Tout ce qui ne concerne QUE l'écran en cours. -->
      <div class="pied-grp pied-processus">
        <span class="pied-lbl">{{ store.processusCourant?.nom ?? 'Processus' }}</span>
        <!-- Conformité DU PROCESSUS EN COURS, pas du dossier : « ce qui est
             conforme » doit désigner ce qu'on est en train de valider, et non
             un dossier dont l'opérateur ne voit qu'un onzième à l'écran.
             Le verdict vient du serveur (`store.coches`) : le recalculer ici
             donnerait deux réponses qui divergeraient. -->
        <!-- L'incohérence de dates est À CÔTÉ du verdict, jamais dedans : elle
             alerte sans interdire, donc elle ne peut pas entrer dans un
             décompte de « points à traiter » — mais elle doit être sous les
             yeux de celui qui valide. Signalée ailleurs que là où se prend la
             décision, elle ne serait pas signalée. -->
        <div v-if="store.incoherences.length" class="conf-alerte"
             :title="store.incoherences.map((i) => i.message).join('\n')">
          <span>⚠</span>
          <span class="ca-t">
            <strong>{{ store.incoherences.length }} incohérence(s) de dates</strong>
            <span class="ca-d">{{ store.incoherences[0].message }}</span>
          </span>
        </div>
        <div class="conf-grp" :class="{ 'conf-vert': store.coches.charge && store.coches.toutVert,
                                        'conf-rouge': store.coches.nonVertes.length > 0 }">
          <template v-if="store.coches.charge && store.coches.toutVert">
            <span class="conf-ico">✓</span>
            <span class="conf-t">
              <strong>Conforme</strong>
              <span class="conf-s">toutes les coches sont vertes</span>
            </span>
          </template>
          <template v-else-if="store.coches.nonVertes.length">
            <span class="conf-ico">⚠</span>
            <span class="conf-t">
              <strong>{{ store.coches.nonVertes.length }} point(s) obligatoire(s) à traiter</strong>
              <span class="conf-s" :title="detailCoches">{{ resumeCoches }}</span>
            </span>
            <!-- Une non-conformité reste un jugement : elle se coche à la main.
                 Le module constate le vert, il ne prononce pas l'inverse. -->
            <label class="conf-r">
              <input type="radio" name="conformite" value="non_conforme"
                     :disabled="store.lectureSeule"
                     v-model="store.dossier.conformite"> Non conforme
            </label>
            <label class="conf-r">
              <input type="radio" name="conformite" value="conforme"
                     :disabled="store.lectureSeule"
                     v-model="store.dossier.conformite"> Conforme malgré tout
            </label>
          </template>
          <template v-else>
            Conformité :
            <label class="conf-r">
              <input type="radio" name="conformite" value="non_conforme"
                     :disabled="store.lectureSeule"
                     v-model="store.dossier.conformite"> Non conforme
            </label>
            <label class="conf-r">
              <input type="radio" name="conformite" value="conforme"
                     :disabled="store.lectureSeule"
                     v-model="store.dossier.conformite"> Conforme
            </label>
          </template>
        </div>
        <!-- Avancement du processus courant : sans lui, un processus « à venir »
             reste en lecture seule et le parcours ne peut pas progresser. -->
        <button v-if="!store.lectureSeule && store.processusCourant"
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
        <!-- Le cadenas rouvre un processus déjà validé, pour y compléter ou
             corriger des éléments. Il n'existe QUE pour un processus, jamais
             pour le dossier : un dossier validé est définitif, et la base le
             tient (`interdire_devalidation`). Un processus validé dans un
             dossier encore en cours, lui, peut légitimement reprendre — d'où
             ce bouton, et le fait qu'il disparaisse dès que le dossier est
             validé ou clos (`store.lectureSeule`).
             La réouverture efface la conformité constatée du processus : elle
             n'a plus lieu d'être tant qu'il n'est pas revalidé. -->
        <button v-if="!store.lectureSeule && store.processusCourant?.etat === 'valide'"
                class="btn-cadenas"
                title="Rouvrir ce processus pour compléter ou corriger des éléments"
                @click="store.changerEtatProcessus('en_cours')">🔓</button>
        <!-- « Enregistrer » laissait croire à un geste terminal, alors que le
             processus reste ouvert et reprenable : c'est une mise en attente,
             pas une conclusion. Le geste terminal, c'est « Valider ce
             processus », juste à côté. -->
        <button class="f-btn" v-if="!store.lectureSeule"
                :disabled="store.enregistrement"
                title="Enregistrer les saisies et laisser le processus ouvert"
                @click="store.enregistrerEntete().then(() => store.enregistrerProcessus())">
          Laisser en attente
        </button>
        <span class="etat-enr">
          <template v-if="store.enregistrement">enregistrement…</template>
          <template v-else-if="store.clos">parcours clos — lecture seule</template>
          <template v-else-if="store.lectureSeule">parcours validé — lecture seule</template>
          <template v-else-if="store.dernierEnregistrement">
            enregistré à {{ store.dernierEnregistrement.toLocaleTimeString('fr-FR',
              { hour: '2-digit', minute: '2-digit' }) }}
          </template>
          <template v-else>non enregistré</template>
        </span>
      </div>

      <!-- ── LE PARCOURS ── conclure, clore, rouvrir. Les gestes rares et
           lourds de conséquence, tenus à l'écart des gestes de saisie. -->
      <div class="pied-grp pied-parcours">
        <span class="pied-lbl">Parcours {{ store.dossier.reference }}</span>
        <button
          class="btn-val" :disabled="blocages.length > 0 || store.lectureSeule"
          :title="blocages.length ? `Validation bloquée : ${blocages.join(' ; ')}`
            : store.dossier.conformite
              ? `Valider le parcours — conformité conclue à la main : ${store.dossier.conformite}`
              : 'Valider le parcours — conformité constatée automatiquement, toutes les coches sont vertes'"
          :style="(blocages.length || store.lectureSeule) ? 'opacity:.5;cursor:not-allowed;' : ''"
          @click="store.validerDossier()"
        >{{ !store.dossier.conformite && store.conformiteAutomatiquePossible
          ? '✓ Valider le parcours — conforme (auto)' : '✓ Valider le parcours' }}</button>
        <button
          class="btn-quar" v-if="!store.lectureSeule && !store.dossier.quarantaine"
          title="Signaler un doute sur ce traitement : filigrane et mention au tableau de bord"
          @click="quarantaineOuverte = true"
        >⚠ Quarantaine</button>
        <button
          class="btn-clore" v-if="!store.lectureSeule"
          title="Le parcours s'est arrêté sans aboutir : clore la ligne du tableau de bord"
          @click="clotureOuverte = true"
        >Clore le parcours</button>
        <!-- La réouverture est un droit de profil, refusé côté serveur : le
             bouton n'est masqué ici que pour ne pas proposer un geste qui
             serait refusé. Ce n'est pas lui qui protège. -->
        <button
          class="btn-declore" v-if="store.clos && peutDeclore"
          title="Rouvrir ce parcours : la clôture reste tracée"
          @click="declotureOuverte = true"
        >Rouvrir le parcours</button>

        <!-- Ces deux boutons venaient de la maquette et n'ont JAMAIS rien
             fait : aucun gestionnaire, aucun export. Les laisser d'apparence
             active laissait croire à un export qui n'existe pas — le même
             défaut que la croix de la barre de titre. Désarmés en attendant
             l'export réel (§8 : PDF et XLS, l'impression se faisant depuis le
             document exporté).
             Ils sont sur la ligne du PARCOURS parce qu'on exporte un dossier,
             pas l'écran qu'on regarde. -->
        <button class="f-btn" disabled title="Export non encore implémenté">Exporter PDF</button>
        <button class="f-btn" disabled title="Export non encore implémenté">Exporter XLS</button>
        <button class="btn-ann" @click="fermerParcours()">Fermer</button>
      </div>

    </div>

    <!-- Bandeau d'état : hors-ligne et points bloquants -->
    <!-- Un dossier clos ne dit rien de lui-même : les boutons disparaissent,
         les champs se figent, et rien n'explique pourquoi. Le bandeau porte le
         motif — c'est la seule information qui compte sur un parcours avorté. -->
    <div v-if="store.clos" class="clo-bandeau">
      <div class="clo-l1">Parcours clos — {{ store.dossier.motifCloture }}</div>
      <span class="clo-note">
        Aucune conclusion de conformité : le parcours s'est arrêté avant son terme.
        <template v-if="reouvertures">
          Déjà rouvert {{ reouvertures }} fois — chaque arrêt et chaque reprise
          restent tracés.
        </template>
        <template v-else-if="!peutDeclore">
          Le rouvrir demande un profil pharmacien ou administrateur.
        </template>
      </span>
    </div>

    <!-- FILIGRANE DE QUARANTAINE.
         Il couvre tout l'écran et suit le défilement : un bandeau en haut de
         page se perd dès qu'on descend dans un tableau de trente points, et
         c'est précisément à ce moment-là qu'il faut se souvenir que le
         traitement est douteux.
         `pointer-events: none` : il signale, il ne gêne pas. À ce stade la
         quarantaine N'INTERDIT rien — la saisie, la validation et
         l'administration restent possibles. Rendre le filigrane cliquable
         n'aurait fait qu'empêcher de travailler sans rien protéger. -->
    <div v-if="store.dossier.quarantaine" class="quar-filigrane" aria-hidden="true">
      <div class="quar-motif">QUARANTAINE</div>
    </div>

    <!-- Et une mention lisible, elle, qui porte le motif : un filigrane dit
         qu'il y a un problème, il ne dit pas lequel. -->
    <div v-if="store.dossier.quarantaine" class="quar-bandeau">
      <strong>⚠ Traitement en quarantaine</strong> — {{ store.dossier.quarantaineMotif }}
      <button v-if="peutDeclore" class="quar-b" @click="leveeOuverte = true">
        Lever la quarantaine
      </button>
      <span v-else class="quar-note">
        La levée demande un profil pharmacien ou administrateur.
      </span>
    </div>

    <!-- Mise en quarantaine : ouverte à tous. Quiconque constate un doute doit
         pouvoir le signaler dans la seconde ; attendre une autorisation serait
         le mauvais réflexe. -->
    <div class="cat-ov" :class="{ show: quarantaineOuverte }" @click.self="quarantaineOuverte = false">
      <div class="cat-dlg clo-dlg">
        <div class="cat-hd">
          Mettre le traitement en quarantaine
          <button title="Annuler" @click="quarantaineOuverte = false">✕</button>
        </div>
        <div class="clo-corps">
          <p class="clo-p">
            Le traitement du dossier <strong>{{ store.dossier.reference }}</strong> sera
            signalé en quarantaine : filigrane sur tout l'écran, mention au tableau
            de bord.
          </p>
          <p class="clo-p clo-att">
            <strong>La quarantaine signale, elle n'interdit rien à ce stade.</strong>
            La saisie, la validation et l'administration restent possibles — le
            blocage sera écrit quand le circuit aura été arrêté. Traiter le
            signalement reste un acte humain.
          </p>
          <label class="clo-l" for="quar-motif">Motif — ce qui fait douter</label>
          <textarea id="quar-motif" class="clo-t" rows="3" v-model="motifQuarantaine"
                    placeholder="Aspect de la poche, alarme de cuve, écart de température, doute sur l'identité du lot…"></textarea>
        </div>
        <div class="clo-b">
          <button class="btn-ann" @click="quarantaineOuverte = false">Annuler</button>
          <button class="btn-quar-ok" :disabled="motifQuarantaine.trim().length < 5"
                  @click="poserQuarantaine()">Mettre en quarantaine</button>
        </div>
      </div>
    </div>

    <!-- Levée : réservée aux profils avancés, refusée par le serveur. -->
    <div class="cat-ov" :class="{ show: leveeOuverte }" @click.self="leveeOuverte = false">
      <div class="cat-dlg clo-dlg">
        <div class="cat-hd">
          Lever la quarantaine
          <button title="Annuler" @click="leveeOuverte = false">✕</button>
        </div>
        <div class="clo-corps">
          <p class="clo-p">
            Motif de la mise en quarantaine : <em>{{ store.dossier.quarantaineMotif }}</em>
          </p>
          <p class="clo-p clo-att">
            Lever la quarantaine, c'est <strong>déclarer que le doute est levé</strong>.
            L'épisode reste tracé — motif, auteur et date des deux gestes.
          </p>
          <label class="clo-l" for="levee-motif">Motif — ce qui lève le doute</label>
          <textarea id="levee-motif" class="clo-t" rows="3" v-model="motifLevee"
                    placeholder="Contrôle refait conforme, certificat reçu, avis du fabricant…"></textarea>
        </div>
        <div class="clo-b">
          <button class="btn-ann" @click="leveeOuverte = false">Annuler</button>
          <button class="btn-declore-ok" :disabled="motifLevee.trim().length < 5"
                  @click="leverQuarantaine()">Lever</button>
        </div>
      </div>
    </div>

    <!-- Clôture : la confirmation dit ce que le geste engage. Cette fenêtre
         avait disparu en réécrivant le pied de page — le bouton restait, la
         fenêtre non, et c'est la suite navigateur qui l'a vu. -->
    <div class="cat-ov" :class="{ show: clotureOuverte }" @click.self="clotureOuverte = false">
      <div class="cat-dlg clo-dlg">
        <div class="cat-hd">
          Clore un parcours avorté
          <button title="Annuler" @click="clotureOuverte = false">✕</button>
        </div>
        <div class="clo-corps">
          <p class="clo-p">
            Le parcours <strong>{{ store.dossier.reference }}</strong> s'est arrêté sans
            aboutir. La clôture le retire des dossiers en cours et le fige en lecture
            seule.
          </p>
          <p class="clo-p clo-att">
            Personne ne conclut sur sa conformité : un parcours inachevé n'est ni
            conforme ni non conforme. La clôture est tracée — motif, auteur, date —
            et le restera même si un profil avancé rouvre le parcours plus tard.
          </p>
          <label class="clo-l" for="clo-motif">Motif — ce qui a interrompu le parcours</label>
          <textarea id="clo-motif" class="clo-t" rows="3" v-model="motifCloture"
                    placeholder="Décès du patient, aphérèse non exploitable, échec de fabrication, décision médicale…"></textarea>
        </div>
        <div class="clo-b">
          <button class="btn-ann" @click="clotureOuverte = false">Annuler</button>
          <button class="btn-clore-ok" :disabled="motifCloture.trim().length < 5"
                  @click="clore()">Clore définitivement</button>
        </div>
      </div>
    </div>

    <!-- Réouverture : le motif est obligatoire, comme pour la clôture. -->
    <div class="cat-ov" :class="{ show: declotureOuverte }" @click.self="declotureOuverte = false">
      <div class="cat-dlg clo-dlg">
        <div class="cat-hd">
          Rouvrir un parcours clos
          <button title="Annuler" @click="declotureOuverte = false">✕</button>
        </div>
        <div class="clo-corps">
          <p class="clo-p">
            Le parcours <strong>{{ store.dossier.reference }}</strong> avait été clos :
            <em>{{ store.dossier.motifCloture }}</em>. Le rouvrir le rend de nouveau
            modifiable et le fait réapparaître parmi les dossiers en cours.
          </p>
          <p class="clo-p clo-att">
            <strong>La clôture n'est pas effacée.</strong> Son motif, son auteur et sa
            date restent tracés, et cette réouverture le sera aussi. Le dossier
            pourra dire, plus tard, combien de fois il a été arrêté et repris.
          </p>
          <label class="clo-l" for="declo-motif">Motif — pourquoi le parcours reprend</label>
          <textarea id="declo-motif" class="clo-t" rows="3" v-model="motifDecloture"
                    placeholder="Clôture par erreur, reprise du traitement décidée en RCP…"></textarea>
        </div>
        <div class="clo-b">
          <button class="btn-ann" @click="declotureOuverte = false">Annuler</button>
          <button class="btn-declore-ok" :disabled="motifDecloture.trim().length < 5"
                  @click="declore()">Rouvrir</button>
        </div>
      </div>
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
    <PanneauCodifications v-else-if="onglet === 'codifications'" />
  </div>

  <ModalePatient
    :ouvert="modalePatient"
    :motif="patientPourPrescription
      ? 'Une prescription est nominative : choisir le patient auquel elle se rattache.'
      : ''"
    @fermer="modalePatient = false; patientPourPrescription = false"
    @choisir="patientChoisi"
  />
  <ModaleCatalogue
    :ouvert="modaleCatalogue"
    :catalogue="store.catalogue"
    @fermer="modaleCatalogue = false"
    @ajouter="store.ajouterProcessus"
  />
</template>
