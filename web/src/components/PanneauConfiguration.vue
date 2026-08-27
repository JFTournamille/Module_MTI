<script setup>
/**
 * Onglet Configuration : paramétrer un processus et un point de contrôle.
 *
 * L'écran est en deux temps volontairement : la colonne de gauche donne la
 * structure du parcours, celle de droite le détail du point sélectionné. C'est
 * la demande d'origine — « accéder à la configuration d'un point de contrôle »
 * et « à la configuration d'un processus » — et les deux ne se lisent pas au
 * même niveau de zoom.
 *
 * Le bandeau du haut porte l'avertissement qui compte : rien n'est modifié en
 * place, publier crée une nouvelle version et les dossiers ouverts gardent leur
 * définition figée.
 */
import { onMounted } from 'vue'
import { useConfiguration, TYPES_POINT } from '../stores/configuration.js'

const store = useConfiguration()
onMounted(() => store.charger())

/** Nombre de lignes qu'un point produira à l'écran de saisie. */
function copies (pt) {
  return Number(pt.exemplaires) || (pt.multi ? '1 à n' : 1)
}
</script>

<template>
  <div class="adm">
    <div class="adm-bar">
      <template v-if="store.versionActive">
        <span class="cfg-v">Version {{ store.versionActive.version }} en service</span>
        <span class="meta">
          {{ store.versionActive.nbProcessus }} processus ·
          {{ store.versionActive.nbDossiers }} dossier(s) ouvert(s) sous cette version
        </span>
      </template>
      <span v-if="store.modifie" class="cfg-mod">● brouillon modifié</span>
      <span style="flex:1"></span>
      <button class="adm-b" :disabled="!store.modifie" @click="store.annuler()">
        Abandonner les modifications
      </button>
      <button class="adm-b-p" :disabled="!store.modifie" @click="store.publier()">
        ▶ Publier la version {{ (store.versionBase ?? 0) + 1 }}
      </button>
    </div>

    <div v-if="store.indisponible" class="adm-msg adm-msg-hs">
      Configuration indisponible : {{ store.erreur }}
    </div>
    <div v-else-if="store.erreur" class="adm-msg adm-msg-ko">{{ store.erreur }}</div>
    <div v-if="store.message" class="adm-msg adm-msg-ok">{{ store.message }}</div>

    <div class="cfg-aide">
      Une modification ne touche <strong>jamais</strong> un dossier déjà ouvert :
      chaque dossier porte une copie de la définition, figée à sa création.
      Enregistrer publie une <strong>nouvelle version</strong> du modèle et la met
      en service ; les précédentes restent en base, consultables. C'est ce qui
      permet de relire un contrôle tel qu'il a été prescrit au moment où il a été
      fait.
    </div>

    <div v-if="store.brouillon" class="cfg">
      <!-- ── Colonne gauche : structure du parcours ── -->
      <div class="cfg-col">
        <div class="cfg-h">Processus du parcours</div>
        <div class="cfg-liste">
          <div v-for="(p, i) in store.processus" :key="i"
               class="cfg-p" :class="{ sel: i === store.iProcessus }"
               @click="store.choisirProcessus(i)">
            <span class="cfg-n">{{ i + 1 }}</span>
            <span class="cfg-nm">{{ p.nom }}</span>
            <span class="cfg-d">
              {{ p.code }}<template v-if="p.externe"> · externe</template>
              <template v-if="p.gabarit === 'reception'"> · réception</template>
              ·
              {{ (p.sections ?? []).reduce((t, s) => t + (s.points?.length ?? 0), 0) }} pt
            </span>
            <span class="cfg-mv">
              <button title="Monter" :disabled="i === 0"
                      @click.stop="store.deplacerProcessus(i, -1)">↑</button>
              <button title="Descendre" :disabled="i === store.processus.length - 1"
                      @click.stop="store.deplacerProcessus(i, 1)">↓</button>
              <button title="Retirer ce processus" class="sup"
                      :disabled="store.processus.length <= 1"
                      @click.stop="store.retirerProcessus(i)">×</button>
            </span>
          </div>
        </div>
        <button class="adm-b" style="margin:8px;" @click="store.ajouterProcessus()">
          + Ajouter un processus
        </button>
      </div>

      <!-- ── Colonne droite : le processus, ses sections, ses points ── -->
      <div class="cfg-det">
        <template v-if="store.processusCourant">
          <div class="cfg-h">Configuration du processus</div>
          <div class="cfg-f">
            <label>Nom</label>
            <input type="text" v-model="store.processusCourant.nom" @input="store.marquer()">
          </div>
          <div class="cfg-f">
            <label>Code</label>
            <input type="text" v-model="store.processusCourant.code" @input="store.marquer()">
            <span class="meta">Identifiant stable — c'est lui que désignent les scénarios.</span>
          </div>
          <div class="cfg-f">
            <label>Gabarit</label>
            <select v-model="store.processusCourant.gabarit" @change="store.marquer()">
              <option value="standard">standard</option>
              <option value="reception">réception (en-tête produit, préallocation)</option>
            </select>
          </div>
          <div class="cfg-f">
            <label>Réalisation</label>
            <label class="cfg-cb">
              <input type="checkbox" v-model="store.processusCourant.externe"
                     @change="store.marquer()">
              Processus externe — réalisé par le fabricant
            </label>
          </div>

          <div class="cfg-h">Sections et points de contrôle</div>
          <div v-for="(sc, iS) in store.processusCourant.sections" :key="iS" class="cfg-sec">
            <div class="cfg-sh">
              <input type="text" v-model="sc.titre" @input="store.marquer()">
              <button class="adm-b" @click="store.ajouterPoint(iS)">+ point</button>
              <button class="adm-b" :disabled="store.processusCourant.sections.length <= 1"
                      @click="store.retirerSection(iS)">− section</button>
            </div>
            <div v-for="(pt, iP) in sc.points" :key="iP"
                 class="cfg-pt" :class="{ sel: iS === store.iSection && iP === store.iPoint }"
                 @click="store.choisirPoint(iS, iP)">
              <span class="cfg-pl">{{ pt.libelle }}</span>
              <span class="cfg-pd">
                {{ pt.type }}<template v-if="pt.obligatoire"> · obligatoire</template>
                <template v-if="pt.seuil != null"> · seuil {{ pt.seuil }} °C</template>
                <template v-if="pt.doubleValidation"> · 2 pers.</template>
                <template v-if="copies(pt) !== 1"> · ×{{ copies(pt) }}</template>
                <template v-if="pt.numeroSerie"> · n° série</template>
                <template v-if="pt.kit"> · {{ pt.kit }}</template>
              </span>
              <button class="cfg-x" title="Retirer ce point" :disabled="sc.points.length <= 1"
                      @click.stop="store.retirerPoint(iS, iP)">×</button>
            </div>
          </div>
          <button class="adm-b" style="margin:6px 0 14px;" @click="store.ajouterSection()">
            + Ajouter une section
          </button>

        </template>
      </div>

      <!-- ── Colonne droite : le point sélectionné ──
           Une colonne à part, et non un bloc sous la liste : sur la réception
           (7 sections, 28 points) le formulaire se retrouvait trois écrans plus
           bas que le point qu'on venait de choisir. -->
      <div class="cfg-pt-col">
          <template v-if="store.pointCourant">
            <div class="cfg-h">Configuration du point de contrôle</div>
            <div class="cfg-f">
              <label>Libellé</label>
              <input type="text" v-model="store.pointCourant.libelle" @input="store.marquer()">
            </div>
            <div class="cfg-f">
              <label>Sous-libellé</label>
              <input type="text" v-model="store.pointCourant.sousLibelle"
                     placeholder="Consigne affichée sous le libellé" @input="store.marquer()">
            </div>
            <div class="cfg-f">
              <label>Numéro</label>
              <input type="text" v-model="store.pointCourant.num" style="width:80px;"
                     placeholder="1.3" @input="store.marquer()">
            </div>
            <div class="cfg-f">
              <label>Type de saisie</label>
              <select :value="store.pointCourant.type"
                      @change="store.poser('type', $event.target.value)">
                <option v-for="[k, lbl] in TYPES_POINT" :key="k" :value="k">{{ lbl }}</option>
              </select>
            </div>
            <div v-if="store.pointCourant.type === 'valeur'" class="cfg-f">
              <label>Seuil d'alarme</label>
              <input type="number" step="any" style="width:110px;"
                     :value="store.pointCourant.seuil ?? ''"
                     @input="store.poser('seuil', $event.target.value === ''
                       ? null : Number($event.target.value))">
              <span class="meta">
                Une valeur <strong>supérieure</strong> au seuil déclenche l'alarme, figée
                à l'enregistrement. Laisser vide pour un relevé sans seuil.
              </span>
            </div>
            <div class="cfg-f">
              <label>Obligatoire</label>
              <label class="cfg-cb">
                <input type="checkbox" :checked="store.pointCourant.obligatoire === true"
                       @change="store.poser('obligatoire', $event.target.checked)">
                Obligatoire par défaut
              </label>
              <span class="meta">L'opérateur peut le basculer ligne par ligne (★).</span>
            </div>
            <div class="cfg-f">
              <label>Validation</label>
              <label class="cfg-cb">
                <input type="checkbox" :checked="store.pointCourant.doubleValidation === true"
                       @change="store.poser('doubleValidation', $event.target.checked)">
                Double validation — contresignature du processus
              </label>
            </div>
            <div class="cfg-f">
              <label>Exemplaires</label>
              <input type="number" min="1" max="12" style="width:80px;"
                     :value="store.pointCourant.exemplaires ?? 1"
                     @input="store.poser('exemplaires', $event.target.value)">
              <span class="meta">La ligne est dupliquée autant de fois. 1 = pas de duplication.</span>
            </div>
            <div class="cfg-f">
              <label>N° de série</label>
              <label class="cfg-cb">
                <input type="checkbox" :checked="store.pointCourant.numeroSerie === true"
                       @change="store.poser('numeroSerie', $event.target.checked)">
                Un n° de série par exemplaire, en complément du n° de lot
              </label>
              <span class="meta">Suppose plusieurs exemplaires : cocher en pose deux.</span>
            </div>
            <div class="cfg-f">
              <label>Kit</label>
              <select :value="store.pointCourant.kit ?? ''"
                      @change="store.poser('kit', $event.target.value || undefined)">
                <option value="">— hors kit —</option>
                <option v-for="k in store.sectionCourante?.kits ?? []" :key="k.id" :value="k.id">
                  {{ k.nom }}
                </option>
              </select>
              <button class="adm-b" @click="store.ajouterKit()">+ kit sur cette section</button>
            </div>
            <div v-for="(k, i) in store.sectionCourante?.kits ?? []" :key="'k' + i" class="cfg-f">
              <label>Kit {{ i + 1 }}</label>
              <input type="text" v-model="k.id" style="width:130px;" @input="store.marquer()">
              <input type="text" v-model="k.nom" style="width:180px;" @input="store.marquer()">
              <input type="text" v-model="k.composition" placeholder="1 boîte = 3 tubes…"
                     @input="store.marquer()">
              <button class="cfg-x" title="Retirer ce kit" @click="store.retirerKit(i)">×</button>
            </div>
          </template>
      </div>
    </div>
  </div>
</template>
