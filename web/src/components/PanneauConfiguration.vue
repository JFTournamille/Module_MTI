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
import { computed, onMounted, ref } from 'vue'
import { useConfiguration, TYPES_POINT } from '../stores/configuration.js'

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
              <label>Code</label>
              <input type="text" v-model="store.processusCourant.code" @input="store.marquer()">
            </div>
            <div class="aide">
              Identifiant stable : c'est lui que désignent les parcours et les jeux
              de données. Le rang, lui, change dès qu'un processus est inséré ou
              retiré.
            </div>
            <div class="form-r">
              <label>Gabarit</label>
              <select v-model="store.processusCourant.gabarit" @change="store.marquer()">
                <option value="standard">standard</option>
                <option value="reception">réception (en-tête produit, préallocation)</option>
              </select>
            </div>
            <div class="form-r">
              <label>Réalisation</label>
              <label class="lbl-f">
                <input type="checkbox" v-model="store.processusCourant.externe"
                       @change="store.marquer()">
                Réalisé par un tiers (fabricant, autre service…)
              </label>
            </div>
            <div class="aide">
              Le processus reste au parcours et garde ses points de contrôle, mais
              il n'est pas saisi ici : il est réalisé ailleurs — par le fabricant,
              un autre service, un prestataire. L'écran le montre en consultation.
            </div>

            <div class="form-h">Sections et points de contrôle</div>
            <div v-for="(sc, iS) in store.processusCourant.sections" :key="iS" class="cfg-sec">
              <div class="cfg-sh">
                <input type="text" v-model="sc.titre" @input="store.marquer()">
                <button class="adm-b" @click="store.ajouterPoint(iS)">+ point</button>
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
            <div class="aide" style="margin-left:0;">
              Processus <strong>{{ store.iProcessus + 1 }}. {{ store.processusCourant.nom }}</strong>
              · section <strong>{{ store.sectionCourante.titre }}</strong>.
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
  </div>
</template>
