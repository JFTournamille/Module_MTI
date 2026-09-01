<script setup>
/**
 * Onglet Configuration, en trois sous-onglets.
 *
 * La demande d'origine était d'accéder « à la configuration d'un point de
 * contrôle » et « à la configuration d'un processus ». Les deux ne se lisent
 * pas au même niveau de zoom, et les mélanger dans un seul écran obligeait à
 * dérouler trois écrans entre le point qu'on venait de choisir et son
 * formulaire. Trois sous-onglets, donc :
 *
 *   Parcours          — le modèle dans son ensemble : versions, publication
 *   Processus         — un processus, ses sections, ses points
 *   Point de contrôle — un point, où qu'il soit dans le parcours
 *
 * Le bandeau du haut est commun : il porte le choix du parcours et
 * l'avertissement qui compte — publier crée une version, les dossiers ouverts
 * gardent la leur.
 *
 * Les styles reprennent ceux de `docs/reference/scenario_mti_dialog_v12.html`
 * (`.cfg-l`, `.cfg-r`, `.form-h`, `.form-r`, `.aide`, `.apercu`), plus nets et
 * plus contrastés que ce que portait la première version de cet écran.
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useConfiguration, TYPES_POINT, lieAuMedicament } from '../stores/configuration.js'
import ModalePoint from './ModalePoint.vue'

const store = useConfiguration()
/* `garderBrouillon` : ce panneau est démonté à chaque changement d'onglet, et
   ce `onMounted` rappelait `charger()` — revenir une seconde au tableau de bord
   effaçait donc tout le travail d'édition en cours, sans un mot. */
onMounted(() => store.charger({ garderBrouillon: true }))

const sousOnglet = ref('processus')
const SOUS_ONGLETS = [
  ['parcours', 'Parcours'],
  ['processus', 'Processus'],
  ['point', 'Point de contrôle']
]

const LIB_TYPE = Object.fromEntries(TYPES_POINT)

/* Aides au survol. Trois champs se règlent d'un clic mais engagent le parcours
   entier, et rien à l'écran ne disait ce qu'ils font. Le texte est ici plutôt
   qu'en dur dans le gabarit : il est long, et il est le même à plusieurs
   endroits. */
const AIDE = {
  code: "Identifiant stable du parcours ou du processus. C'est lui que désignent " +
    'les jeux de données, les scénarios et le jeu de démonstration. Le rang, lui, ' +
    "change dès qu'un élément est inséré ou retiré : retirer l'aphérèse a décalé " +
    'douze processus d\'un cran. Majuscules non accentuées, chiffres et soulignés.',
  gabarit: "Détermine comment le processus s'affiche à la saisie. « standard » affiche les sections et leurs " +
    'points. « réception » y ajoute l\'en-tête produit — désignation, n° de lot, ' +
    'péremption, code-barres — et la préallocation patient. Un parcours n\'a ' +
    'normalement qu\'un seul processus de réception.',
  tiers: 'Le processus reste au parcours et garde ses points de contrôle, mais il ' +
    "n'est pas saisi ici : il est réalisé ailleurs — dans Chimio, un autre " +
    'service ou chez un prestataire. L\'écran le montre en consultation, avec ' +
    'un bandeau, au lieu d\'ouvrir la saisie.',
  medicament: 'Un point lié au médicament porte sur le produit lui-même : il se ' +
    'répète par exemplaire (poche, tube, cuve), peut exiger un n° de série et ' +
    "appartenir à un kit. Un point qui porte sur le dossier, le local ou " +
    "l'organisation n'a rien de tout cela — la section reste alors masquée."
}

/** Nombre de lignes qu'un point produira à l'écran de saisie. */
const copies = (pt) => Number(pt.exemplaires) || (pt.multi ? '1 à n' : 1)

/** Les marqueurs que portera la ligne, dans l'ordre où l'opérateur les voit. */
function marqueurs (pt) {
  const m = []
  if (pt.seuil != null) m.push(['seuil', `seuil ${pt.seuil} °C`])
  if (pt.doubleValidation) m.push(['dbl', '2 pers.'])
  if (copies(pt) !== 1) m.push(['dup', `× ${copies(pt)}`])
  if (pt.numeroSerie) m.push(['ser', 'n° de série'])
  if (pt.kit) m.push(['kit', pt.kit])
  return m
}

/** Point choisi depuis la liste à plat : on bascule sur son formulaire. */
function ouvrirPoint (e) {
  store.choisirPointAbsolu(e)
  sousOnglet.value = 'point'
}

const nbPoints = computed(() => store.tousLesPoints.length)

// ── Ajout d'un point : reprendre, ou créer ──
//
// « + point » posait directement un « Nouveau point de contrôle » vierge, qu'il
// fallait retaper. Il ouvre maintenant le catalogue des points déjà formulés,
// dans ce parcours comme dans les autres.
const modalePoint = ref(false)
const sectionAjout = ref(0)

function ouvrirAjoutPoint (iS) {
  sectionAjout.value = iS
  modalePoint.value = true
}
function pointRepris (point) {
  store.ajouterPoint(sectionAjout.value, point)
  sousOnglet.value = 'point'
}
function pointCree (libelle) {
  store.ajouterPoint(sectionAjout.value,
    libelle ? { libelle, type: 'ouinon', obligatoire: false } : null)
  sousOnglet.value = 'point'
}

/* Message de refus du retrait d'un point : affiché à côté du bouton plutôt que
   dans le bandeau d'erreur, qui est réservé à ce que dit le serveur. */
const refusRetrait = ref('')
function retirerLePoint () {
  refusRetrait.value = store.retirerPointCourant()
}

// ── Création d'un parcours ──
//
// Le geste réel n'est pas « partir d'une page blanche » mais « reprendre le
// parcours voisin et l'adapter » : un CAR-T allogénique se déduit de
// l'autologue, une thérapie génique en reprend la moitié. Le formulaire met
// donc la reprise en avant, et la page blanche en second.
const creation = reactive({ ouvert: false, libelle: '', code: '', source: '', retenus: [] })
const creationEnCours = ref(false)

/**
 * Code proposé d'après le libellé : majuscules, sans accent, souligné.
 *
 * Le préfixe n'est ajouté que s'il manque : les libellés commencent presque
 * tous par « Parcours MTI — … », et préfixer sans regarder donnait
 * `PARCOURS_PARCOURS_MTI_…`.
 */
function codeDepuisLibelle (libelle) {
  const slug = libelle
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!slug) return ''
  return (slug.startsWith('PARCOURS') ? slug : `PARCOURS_${slug}`).slice(0, 64)
}

/* Le code suit le libellé tant que l'utilisateur ne l'a pas touché lui-même :
   le laisser vide obligerait à inventer un identifiant, le figer d'emblée
   produirait un code qui ne correspond plus au nom. */
const codeTouche = ref(false)
const codePropose = computed(() =>
  codeTouche.value ? creation.code : codeDepuisLibelle(creation.libelle || ''))

/** Processus du parcours repris, pour en choisir les étapes. */
const processusSource = ref([])
async function chargerSource () {
  processusSource.value = []
  creation.retenus = []
  if (!creation.source) return
  const r = await fetch(`/api/modeles/${creation.source}`)
  if (!r.ok) return
  const m = await r.json()
  processusSource.value = (m.processus ?? []).map((p) => ({
    code: p.code,
    nom: p.nom,
    nbPoints: (p.sections ?? []).reduce((t, sc) => t + (sc.points?.length ?? 0), 0)
  }))
  creation.retenus = processusSource.value.map((p) => p.code)
}

function basculerRetenu (code) {
  const i = creation.retenus.indexOf(code)
  if (i >= 0) creation.retenus.splice(i, 1)
  else creation.retenus.push(code)
}

/* L'ordre de la liste source fait foi, pas l'ordre des clics : cocher au
   hasard ne doit pas mélanger les étapes du parcours. Le réordonnancement se
   fait ensuite dans l'onglet Processus, avec les flèches. */
const retenusOrdonnes = computed(() =>
  processusSource.value.filter((p) => creation.retenus.includes(p.code)).map((p) => p.code))

function ouvrirCreation (source = '') {
  Object.assign(creation, { ouvert: true, libelle: '', code: '', source, retenus: [] })
  codeTouche.value = false
  if (source) chargerSource()
}

/** Duplique le parcours ouvert : même chose, source pré-remplie. */
function dupliquerCourant () {
  ouvrirCreation(store.code)
  const actuel = store.parcoursDisponibles.find((m) => m.code === store.code)
  creation.libelle = `${actuel?.libelle ?? store.code} (copie)`
}

async function validerCreation () {
  creationEnCours.value = true
  try {
    const ok = await store.creerParcours({
      nouveauCode: codePropose.value,
      libelle: creation.libelle.trim(),
      source: creation.source || null,
      processusCodes: creation.source ? retenusOrdonnes.value : null
    })
    if (ok) {
      creation.ouvert = false
      sousOnglet.value = 'processus'
    }
  } finally { creationEnCours.value = false }
}

const creationValide = computed(() =>
  creation.libelle.trim().length > 2 &&
  /^[A-Z][A-Z0-9_]{2,63}$/.test(codePropose.value) &&
  (!creation.source || retenusOrdonnes.value.length > 0))
</script>

<template>
  <div class="adm cfg-tab">
    <!-- ── Bandeau commun ── -->
    <div class="adm-bar">
      <label for="cfg-parcours" style="font-weight:bold;color:#4a3880;">Parcours :</label>
      <select id="cfg-parcours" :value="store.code"
              @change="store.choisirParcours($event.target.value)">
        <option v-for="m in store.parcoursDisponibles" :key="m.code" :value="m.code">
          {{ m.libelle }} — {{ m.nbProcessus }} processus
        </option>
      </select>
      <template v-if="store.versionActive">
        <span class="cfg-v">Version {{ store.versionActive.version }} en service</span>
        <span class="meta">
          {{ store.versionActive.nbDossiers }} dossier(s) ouvert(s) sous cette version
        </span>
      </template>
      <span v-if="store.modifie" class="cfg-mod">
        ● brouillon modifié<template v-if="store.restaure"> — repris de ce poste</template>
      </span>
      <span style="flex:1"></span>
      <button class="adm-b" :disabled="!store.modifie" @click="store.annuler()">
        Abandonner les modifications
      </button>
      <button class="adm-b-p" :disabled="!store.modifie" @click="store.publier()">
        ▶ Publier la version {{ (store.versionBase ?? 0) + 1 }}
      </button>
    </div>

    <nav class="cfg-sst" role="tablist" aria-label="Niveau de configuration">
      <button v-for="[c, lbl] in SOUS_ONGLETS" :key="c"
              class="cfg-sst-b" :class="{ act: sousOnglet === c }" role="tab"
              :aria-selected="sousOnglet === c" @click="sousOnglet = c">{{ lbl }}</button>
    </nav>

    <div v-if="store.indisponible" class="adm-msg adm-msg-hs">
      Configuration indisponible : {{ store.erreur }}
    </div>
    <div v-else-if="store.erreur" class="adm-msg adm-msg-ko">{{ store.erreur }}</div>
    <div v-if="store.message" class="adm-msg adm-msg-ok">{{ store.message }}</div>
    <!-- Un brouillon retrouvé doit se signaler : sans cela, l'écran affiche des
         modifications que l'utilisateur ne se souvient pas d'avoir laissées, et
         il ne sait pas qu'elles ne sont toujours pas publiées. -->
    <div v-if="store.restaure" class="adm-msg adm-msg-hs">
      Brouillon non publié retrouvé sur ce poste et rechargé. Il n'est enregistré
      nulle part d'autre : « Publier » le met en service, « Abandonner » le jette.
    </div>

    <div v-if="store.brouillon" class="cfg">

      <!-- ══ 1. Parcours ══ -->
      <template v-if="sousOnglet === 'parcours'">
        <div class="cfg-r">
          <div class="form">
            <div class="form-h">Le parcours</div>
            <div class="aide">
              Une modification ne touche <strong>jamais</strong> un dossier déjà
              ouvert : chaque dossier porte une copie de la définition, figée à sa
              création. Publier crée une <strong>nouvelle version</strong> du modèle
              et la met en service ; les précédentes restent en base, consultables.
              C'est ce qui permet de relire un contrôle tel qu'il a été prescrit au
              moment où il a été fait.
            </div>
            <div class="form-r">
              <label>Libellé</label>
              <input type="text" v-model="store.brouillon.libelle" @input="store.marquer()">
            </div>
            <div class="form-r">
              <label>Code</label>
              <span class="ident">{{ store.code }}</span>
              <span class="meta">Le code identifie le parcours et ne se change pas.</span>
            </div>
            <div class="form-r">
              <label>Composition</label>
              <span>{{ store.processus.length }} processus · {{ nbPoints }} points de contrôle</span>
            </div>

            <div class="form-h">Ouvrir un autre parcours</div>
            <div class="aide" style="margin-left:0;">
              Un parcours nouveau porte un <strong>code nouveau</strong> : il n'entre
              pas dans l'historique de celui-ci, et aucun dossier ouvert n'en dépend.
              Le plus souvent on ne part pas d'une page blanche — on reprend le
              parcours voisin, on retire ce qui ne s'applique pas, et on adapte.
            </div>
            <div v-if="!creation.ouvert" class="form-r">
              <label>Créer</label>
              <button class="adm-b" @click="ouvrirCreation(store.code)">
                Reprendre ce parcours
              </button>
              <button class="adm-b" @click="dupliquerCourant()">Dupliquer à l'identique</button>
              <button class="adm-b" @click="ouvrirCreation('')">Partir d'un parcours vide</button>
            </div>

            <div v-else class="cfg-crea">
              <div class="form-r">
                <label>Libellé</label>
                <input type="text" v-model="creation.libelle" style="min-width:320px;"
                       placeholder="Parcours MTI — …">
              </div>
              <div class="form-r">
                <label>Code
                  <span class="aide-i" tabindex="0" :data-aide="AIDE.code">?</span>
                </label>
                <input type="text" :value="codePropose" style="min-width:260px;"
                       @input="codeTouche = true; creation.code = $event.target.value.toUpperCase()">
                <span class="meta">Proposé d'après le libellé ; modifiable tant qu'il n'est pas créé.</span>
              </div>
              <div class="form-r">
                <label>Reprendre</label>
                <select v-model="creation.source" @change="chargerSource()">
                  <option value="">— parcours vide —</option>
                  <option v-for="m in store.parcoursDisponibles" :key="m.code" :value="m.code">
                    {{ m.libelle }} — {{ m.nbProcessus }} processus
                  </option>
                </select>
              </div>

              <template v-if="creation.source">
                <div class="aide" style="margin-left:0;">
                  Décocher les étapes qui ne s'appliquent pas. L'ordre du parcours
                  d'origine est conservé ; il se réordonne ensuite dans l'onglet
                  <strong>Processus</strong>, comme les points de contrôle s'y adaptent.
                </div>
                <div class="cfg-pick">
                  <label v-for="p in processusSource" :key="p.code" class="cfg-pick-l">
                    <input type="checkbox" :checked="creation.retenus.includes(p.code)"
                           @change="basculerRetenu(p.code)">
                    <span class="n">{{ p.nom }}</span>
                    <span class="d">{{ p.code }} · {{ p.nbPoints }} pt</span>
                  </label>
                </div>
                <div class="meta" style="margin:4px 0 8px 129px;">
                  {{ retenusOrdonnes.length }} processus retenu(s) sur {{ processusSource.length }}.
                </div>
              </template>

              <div class="form-r">
                <label></label>
                <button class="adm-b" @click="creation.ouvert = false">Annuler</button>
                <button class="adm-b-p" :disabled="!creationValide || creationEnCours"
                        @click="validerCreation()">
                  {{ creationEnCours ? 'Création…' : 'Créer et ouvrir en édition' }}
                </button>
              </div>
            </div>

            <div class="form-h">Versions</div>
            <table class="adm-t cfg-vt">
              <thead>
                <tr>
                  <th style="width:80px;">Version</th>
                  <th style="width:110px;">État</th>
                  <th style="width:110px;">Processus</th>
                  <th style="width:160px;">Dossiers ouverts</th>
                  <th>Publiée le</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="v in store.versions" :key="v.version" :class="{ act: v.actif }">
                  <td class="ident">v{{ v.version }}</td>
                  <td>
                    <span class="prof" :class="v.actif ? 'cfg-actif' : 'cfg-retire'">
                      {{ v.actif ? 'En service' : 'Hors service' }}
                    </span>
                  </td>
                  <td>{{ v.nbProcessus }}</td>
                  <td>{{ v.nbDossiers }}</td>
                  <td class="meta">{{ v.publieLe ? String(v.publieLe).slice(0, 10) : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <div class="aide" style="margin-left:0;">
              Une version retirée du service reste en base : sans elle, les dossiers
              qui la référencent deviendraient illisibles.
            </div>
          </div>
        </div>
      </template>

      <!-- ══ 2. Processus ══ -->
      <template v-else-if="sousOnglet === 'processus'">
        <div class="cfg-l">
          <div class="cfg-grp">Processus du parcours</div>
          <div v-for="(p, i) in store.processus" :key="i"
               class="ci" :class="{ cis: i === store.iProcessus }"
               @click="store.choisirProcessus(i)">
            <div class="n">{{ i + 1 }}. {{ p.nom }}</div>
            <div class="d">
              {{ p.code }}<template v-if="p.externe"> · tiers</template>
              <template v-if="p.gabarit === 'reception'"> · réception</template>
              · {{ (p.sections ?? []).reduce((t, s) => t + (s.points?.length ?? 0), 0) }} pt
            </div>
            <div class="ci-mv">
              <button title="Monter" :disabled="i === 0"
                      @click.stop="store.deplacerProcessus(i, -1)">↑</button>
              <button title="Descendre" :disabled="i === store.processus.length - 1"
                      @click.stop="store.deplacerProcessus(i, 1)">↓</button>
              <button title="Retirer ce processus" class="sup"
                      :disabled="store.processus.length <= 1"
                      @click.stop="store.retirerProcessus(i)">×</button>
            </div>
          </div>
          <button class="adm-b" style="margin:10px;" @click="store.ajouterProcessus()">
            + Ajouter un processus
          </button>
        </div>

        <div class="cfg-r">
          <div v-if="store.processusCourant" class="form">
            <div class="form-h">Configuration du processus</div>
            <div class="form-r">
              <label>Nom</label>
              <input type="text" v-model="store.processusCourant.nom" @input="store.marquer()">
            </div>
            <div class="form-r">
              <label>Code
                <span class="aide-i" tabindex="0" :data-aide="AIDE.code">?</span>
              </label>
              <input type="text" v-model="store.processusCourant.code" @input="store.marquer()">
            </div>
            <div class="aide">
              Identifiant stable : c'est lui que désignent les parcours et les jeux
              de données. Le rang, lui, change dès qu'un processus est inséré ou
              retiré.
            </div>
            <div class="form-r">
              <!-- « Gabarit » est le nom de la CLÉ dans la définition ; à l'écran,
                   il ne disait rien à qui ne l'avait pas écrite. -->
              <label>Type d'affichage
                <span class="aide-i" tabindex="0" :data-aide="AIDE.gabarit">?</span>
              </label>
              <select v-model="store.processusCourant.gabarit" @change="store.marquer()">
                <option value="standard">standard</option>
                <option value="reception">réception (en-tête produit, préallocation)</option>
              </select>
            </div>
            <div class="form-r">
              <label>Réalisation
                <span class="aide-i" tabindex="0" :data-aide="AIDE.tiers">?</span>
              </label>
              <label class="lbl-f">
                <input type="checkbox" v-model="store.processusCourant.externe"
                       @change="store.marquer()">
                Réalisé par un tiers (Chimio, autre service…)
              </label>
            </div>
            <div class="aide">
              Le processus reste au parcours et garde ses points de contrôle, mais
              il n'est pas saisi ici : il est réalisé ailleurs — dans Chimio,
              un autre service, chez un prestataire. L'écran le montre en consultation.
            </div>

            <div class="form-h">Sections et points de contrôle</div>
            <div v-for="(sc, iS) in store.processusCourant.sections" :key="iS" class="cfg-sec">
              <div class="cfg-sh">
                <input type="text" v-model="sc.titre" @input="store.marquer()">
                <button class="adm-b" @click="ouvrirAjoutPoint(iS)">+ point</button>
                <button class="adm-b" :disabled="store.processusCourant.sections.length <= 1"
                        @click="store.retirerSection(iS)">− section</button>
              </div>
              <div v-for="(pt, iPt) in sc.points" :key="iPt"
                   class="cfg-pt" :class="{ sel: iS === store.iSection && iPt === store.iPoint }"
                   @click="ouvrirPoint({ iP: store.iProcessus, iS, iPt })">
                <span class="cfg-pl">{{ pt.libelle }}</span>
                <span class="bt" :class="'bt-' + pt.type">{{ LIB_TYPE[pt.type] ?? pt.type }}</span>
                <span v-if="pt.obligatoire" class="cfg-obl" title="Obligatoire par défaut">★</span>
                <span v-for="[cl, txt] in marqueurs(pt)" :key="cl" class="tagc" :class="'tagc-' + cl">
                  {{ txt }}
                </span>
                <!-- L'ordre des points EST l'ordre d'exécution des contrôles à
                     l'écran de saisie : il se règle donc à la main, comme celui
                     des processus. Un point ajouté se pose en fin de section,
                     alors qu'il appartient souvent au milieu. -->
                <button class="cfg-mv" title="Monter ce point" :disabled="iPt === 0"
                        @click.stop="store.deplacerPoint(iS, iPt, -1)">↑</button>
                <button class="cfg-mv" title="Descendre ce point"
                        :disabled="iPt === sc.points.length - 1"
                        @click.stop="store.deplacerPoint(iS, iPt, 1)">↓</button>
                <button class="cfg-x" title="Retirer ce point" :disabled="sc.points.length <= 1"
                        @click.stop="store.retirerPoint(iS, iPt)">×</button>
              </div>
            </div>
            <button class="adm-b" @click="store.ajouterSection()">+ Ajouter une section</button>
          </div>
        </div>
      </template>

      <!-- ══ 3. Point de contrôle ══ -->
      <template v-else>
        <div class="cfg-l">
          <div class="cfg-grp">{{ nbPoints }} points du parcours</div>
          <template v-for="(e, k) in store.tousLesPoints" :key="k">
            <div v-if="k === 0 || store.tousLesPoints[k - 1].iP !== e.iP"
                 class="cfg-grp cfg-grp-p">{{ e.iP + 1 }}. {{ e.processus.nom }}</div>
            <div class="ci"
                 :class="{ cis: e.iP === store.iProcessus && e.iS === store.iSection
                                 && e.iPt === store.iPoint }"
                 @click="store.choisirPointAbsolu(e)">
              <div class="n">{{ e.point.libelle }}</div>
              <div class="d">
                {{ e.section.titre }} · {{ LIB_TYPE[e.point.type] ?? e.point.type }}
                <template v-if="e.point.doubleValidation"> · 2 pers.</template>
                <template v-if="copies(e.point) !== 1"> · ×{{ copies(e.point) }}</template>
              </div>
            </div>
          </template>
        </div>

        <div class="cfg-r">
          <div v-if="store.pointCourant" class="form">
            <div class="form-h">Configuration d'un point de contrôle</div>
            <!-- Retour au processus d'où l'on vient.
                 Ajouter ou choisir un point bascule sur ce sous-onglet pour
                 qu'on puisse le régler ; sans chemin de retour, il fallait
                 revenir par « Processus » PUIS retrouver le processus dans la
                 liste — deux gestes pour défaire un enchaînement automatique.
                 Le processus est celui du point ouvert : le bouton nomme donc
                 toujours la bonne destination. -->
            <div class="form-r cfg-retour">
              <button class="adm-b" @click="sousOnglet = 'processus'">
                ← Revenir au processus {{ store.iProcessus + 1 }}.
                {{ store.processusCourant.nom }}
              </button>
              <span class="meta">section « {{ store.sectionCourante.titre }} »</span>
            </div>

            <div class="form-r">
              <label>Libellé</label>
              <input type="text" v-model="store.pointCourant.libelle" @input="store.marquer()">
            </div>
            <div class="form-r">
              <label>Sous-libellé</label>
              <input type="text" v-model="store.pointCourant.sousLibelle"
                     placeholder="Consigne affichée sous le libellé" @input="store.marquer()">
            </div>
            <div class="form-r">
              <label>Numéro</label>
              <input type="text" v-model="store.pointCourant.num" style="min-width:90px;"
                     placeholder="1.3" @input="store.marquer()">
            </div>
            <div class="form-r">
              <label>Type de saisie</label>
              <select :value="store.pointCourant.type"
                      @change="store.poser('type', $event.target.value)">
                <option v-for="[k, lbl] in TYPES_POINT" :key="k" :value="k">{{ lbl }}</option>
              </select>
              <span class="bt" :class="'bt-' + store.pointCourant.type">
                {{ LIB_TYPE[store.pointCourant.type] }}
              </span>
            </div>
            <div v-if="store.pointCourant.type === 'valeur'" class="form-r">
              <label>Seuil d'alarme</label>
              <input type="number" step="any" style="min-width:120px;"
                     :value="store.pointCourant.seuil ?? ''"
                     @input="store.poser('seuil', $event.target.value === ''
                       ? null : Number($event.target.value))">
            </div>
            <!-- Valeurs proposées : elles vivent dans la définition du point,
                 donc dans la version du modèle. Une liste modifiée plus tard ne
                 réécrit pas ce qui a été choisi dans les dossiers ouverts. -->
            <template v-if="store.pointCourant.type === 'liste'">
              <div class="form-r" style="align-items:flex-start;">
                <label style="padding-top:5px;">Valeurs proposées</label>
                <div class="cfg-opts">
                  <div v-for="(o, i) in store.pointCourant.options ?? []" :key="i" class="cfg-opt">
                    <input type="text" :value="o"
                           @input="store.pointCourant.options[i] = $event.target.value;
                                   store.marquer()">
                    <button class="cfg-mv" title="Monter" :disabled="i === 0"
                            @click="store.deplacerOption(i, -1)">↑</button>
                    <button class="cfg-mv" title="Descendre"
                            :disabled="i === (store.pointCourant.options?.length ?? 0) - 1"
                            @click="store.deplacerOption(i, 1)">↓</button>
                    <button class="cfg-x" title="Retirer cette valeur"
                            :disabled="(store.pointCourant.options?.length ?? 0) <= 2"
                            @click="store.retirerOption(i)">×</button>
                  </div>
                  <button class="adm-b" @click="store.ajouterOption()">+ valeur</button>
                </div>
              </div>
              <div class="aide">
                Deux valeurs au minimum : à une seule, le choix n'en est plus un.
                L'ordre est celui du menu déroulant. Une valeur retirée plus tard
                reste lisible dans les dossiers qui la portent — elle y est
                signalée comme retirée, elle n'y est pas effacée.
              </div>
            </template>

            <div v-if="store.pointCourant.type === 'valeur'" class="aide">
              Une valeur <strong>supérieure</strong> au seuil déclenche l'alarme, figée
              à l'enregistrement. Laisser vide pour un relevé sans seuil.
            </div>
            <div class="form-r">
              <label>Obligatoire</label>
              <label class="lbl-f">
                <input type="checkbox" :checked="store.pointCourant.obligatoire === true"
                       @change="store.poser('obligatoire', $event.target.checked)">
                Obligatoire par défaut
              </label>
            </div>
            <div class="aide">L'opérateur peut le basculer ligne par ligne (★).</div>

            <div class="form-h">Validation</div>
            <div class="form-r">
              <label>Nombre de personnes</label>
              <select :value="store.pointCourant.doubleValidation ? '2' : '1'"
                      @change="store.poser('doubleValidation', $event.target.value === '2')">
                <option value="1">1 personne (défaut)</option>
                <option value="2">2 personnes — double validation</option>
              </select>
            </div>
            <div class="aide">
              En double validation, la 2<sup>e</sup> personne contresigne l'ensemble du
              processus, avec identification nominative et rappel des points concernés.
            </div>

            <div class="form-h">Portée du point</div>
            <div class="form-r">
              <label>Lié au médicament
                <span class="aide-i" tabindex="0" :data-aide="AIDE.medicament">?</span>
              </label>
              <label class="lbl-f">
                <input type="checkbox" class="cfg-med"
                       :checked="lieAuMedicament(store.pointCourant)"
                       @change="store.poser('lieAuMedicament', $event.target.checked)">
                Ce point porte sur le produit lui-même
              </label>
            </div>
            <div class="aide">
              Un point qui porte sur le dossier, le local ou l'organisation n'a ni
              exemplaires, ni n° de série, ni kit : décoché, la section ci-dessous
              disparaît et ce qu'elle portait est effacé.
            </div>

            <template v-if="lieAuMedicament(store.pointCourant)">
            <div class="form-h">Exemplaires et identification</div>
            <div class="form-r">
              <label>Exemplaires</label>
              <input type="number" min="1" max="12" style="min-width:90px;"
                     :value="store.pointCourant.exemplaires ?? 1"
                     @input="store.poser('exemplaires', $event.target.value)">
              <span class="meta">1 = pas de duplication.</span>
            </div>
            <div class="form-r">
              <label>N° de série</label>
              <label class="lbl-f">
                <input type="checkbox" :checked="store.pointCourant.numeroSerie === true"
                       @change="store.poser('numeroSerie', $event.target.checked)">
                Un n° de série par exemplaire, en complément du n° de lot
              </label>
            </div>
            <div class="aide">Suppose plusieurs exemplaires : cocher en pose deux.</div>
            <div class="form-r">
              <label>Rattachement à un kit</label>
              <select :value="store.pointCourant.kit ?? ''"
                      @change="store.poser('kit', $event.target.value || undefined)">
                <option value="">— hors kit —</option>
                <option v-for="k in store.sectionCourante?.kits ?? []" :key="k.id" :value="k.id">
                  {{ k.nom }}
                </option>
              </select>
              <button class="adm-b" @click="store.ajouterKit()">+ kit sur cette section</button>
            </div>
            <div v-for="(k, i) in store.sectionCourante?.kits ?? []" :key="'k' + i" class="form-r">
              <label>Kit {{ i + 1 }}</label>
              <input type="text" v-model="k.id" style="min-width:130px;" @input="store.marquer()">
              <input type="text" v-model="k.nom" style="min-width:170px;" @input="store.marquer()">
              <input type="text" v-model="k.composition" placeholder="1 boîte = 3 tubes…"
                     @input="store.marquer()">
              <button class="cfg-x" title="Retirer ce kit" @click="store.retirerKit(i)">×</button>
            </div>
            </template>

            <div class="form-h">Retirer ce point</div>
            <div class="form-r">
              <label></label>
              <button class="adm-b cfg-sup" @click="retirerLePoint()">
                × Retirer ce point de contrôle
              </button>
              <span class="meta">
                Le retrait n'est effectif qu'à la publication de la version suivante.
              </span>
            </div>
            <div v-if="refusRetrait" class="adm-msg adm-msg-hs" style="margin:6px 0 10px;">
              {{ refusRetrait }}
            </div>

            <!-- Aperçu : ce que l'opérateur verra. Une case cochée dans un
                 formulaire ne dit pas grand-chose ; la ligne, si. -->
            <div class="apercu">
              <div class="apercu-t">Aperçu de la ligne telle qu'elle apparaîtra à l'opérateur</div>
              <div class="apercu-c">
                <span v-if="store.pointCourant.num" class="apercu-n">{{ store.pointCourant.num }}</span>
                <span class="apercu-l">
                  {{ store.pointCourant.libelle }}
                  <span v-if="store.pointCourant.sousLibelle" class="apercu-s">
                    {{ store.pointCourant.sousLibelle }}
                  </span>
                </span>
                <span class="bt" :class="'bt-' + store.pointCourant.type">
                  {{ LIB_TYPE[store.pointCourant.type] }}
                </span>
                <span class="apercu-o" :class="{ on: store.pointCourant.obligatoire }">★</span>
                <span v-for="[cl, txt] in marqueurs(store.pointCourant)" :key="cl"
                      class="tagc" :class="'tagc-' + cl">{{ txt }}</span>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>

    <ModalePoint
      :ouvert="modalePoint"
      :points-courants="store.tousLesPoints.map((e) => ({
        point: e.point,
        origine: `Ce parcours · ${e.iP + 1}. ${e.processus.nom} · ${e.section.titre}`
      }))"
      :code-courant="store.code"
      @fermer="modalePoint = false"
      @choisir="pointRepris"
      @creer="pointCree"
    />
  </div>
</template>
