<script setup>
/**
 * Statistiques d'ACTIVITÉ — quantitatives, décision du 18 septembre.
 *
 * Ce que l'écran montre, et pourquoi dans cette forme :
 *
 *   · une RANGÉE DE CHIFFRES (dossiers ouverts, en cours, validés, clos). Quatre
 *     nombres de tête ne sont pas un graphique : les mettre en barres
 *     obligerait à lire une longueur pour retrouver un chiffre qu'on peut
 *     écrire.
 *   · l'activité PAR MOIS en barres empilées. Un dossier est dans un seul état,
 *     donc le mois est un tout et ses trois états en sont les parts : c'est la
 *     définition d'un empilement. Trois séries seulement, donc la couleur reste
 *     confortable — et la légende est là quand même.
 *   · les ventilations PAR PARCOURS et PAR PRODUIT en barres simples, d'une
 *     seule teinte : elles comparent des grandeurs, pas des identités.
 *
 * LA COULEUR NE PORTE JAMAIS SEULE. Chaque segment porte son nombre dès qu'il
 * tient, la légende est toujours là, et le tableau complet est sous les
 * graphiques — c'est lui qui répond quand une teinte ne se distingue pas, à
 * l'impression ou pour un daltonien. Le trio a été passé au validateur de
 * palette : séparation CVD et plancher en vision normale au vert, contraste de
 * l'aqua sous 3:1, d'où l'obligation — tenue — des étiquettes et du tableau.
 */
import { computed, onMounted, ref } from 'vue'
import { appel } from '../api.js'

const stats = ref(null)
const erreur = ref('')
const chargement = ref(false)
const depuis = ref('')
const jusqua = ref('')
const vueTableau = ref(false)

const ETATS = [
  { cle: 'enCours', libelle: 'En cours', classe: 'st-c1' },
  { cle: 'valides', libelle: 'Validés', classe: 'st-c2' },
  { cle: 'clos', libelle: 'Clos', classe: 'st-c3' }
]

async function charger () {
  chargement.value = true
  erreur.value = ''
  try {
    const q = new URLSearchParams()
    if (depuis.value) q.set('depuis', depuis.value)
    if (jusqua.value) q.set('jusqua', jusqua.value)
    const r = await appel(`/api/statistiques?${q}`)
    if (!r.ok) { erreur.value = `Statistiques indisponibles (${r.status}).`; return }
    stats.value = await r.json()
  } catch (e) {
    erreur.value = e.message || 'API injoignable.'
  } finally {
    chargement.value = false
  }
}
onMounted(charger)

/** Mois en toutes lettres : « 2026-09 » ne se lit pas, « sept. 2026 » se lit. */
const moisLisible = (cle) => {
  const [a, m] = String(cle).split('-')
  const d = new Date(Number(a), Number(m) - 1, 1)
  return Number.isNaN(d.getTime())
    ? cle
    : d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' })
}

/* L'échelle est commune à toutes les barres d'un même graphique : une barre
   mise à l'échelle de sa propre valeur ferait paraître égaux un mois à 3
   dossiers et un mois à 300. */
const maxMois = computed(() =>
  Math.max(1, ...(stats.value?.parMois ?? []).map((m) => m.total)))

const maxParcours = computed(() =>
  Math.max(1, ...(stats.value?.parParcours ?? []).map((p) => p.total)))

const maxProduit = computed(() =>
  Math.max(1, ...(stats.value?.parProduit ?? []).map((p) => p.total)))

/** Part d'un segment, en pourcentage de l'échelle du graphique. */
const part = (valeur, max) => (valeur / max) * 100

/* Une étiquette n'est posée DANS un segment que si elle y tient : un nombre
   tronqué ou débordant est pire qu'un nombre absent, le tableau étant là pour
   le donner. Le seuil est empirique — trois caractères à 10 px dans une barre
   de 22 px de haut. */
const etiquetteTient = (valeur, max) =>
  part(valeur, max) >= 9 && String(valeur).length <= 4
</script>

<template>
  <div class="adm st-root">
    <div class="adm-aide">
      Décompte d'<strong>activité</strong> : combien de dossiers ont été ouverts, et où
      ils en sont. Un dossier est compté <strong>une seule fois</strong>, au mois de sa
      création et dans son état d'aujourd'hui. Les totaux portent sur toute la base, pas
      sur la liste affichée au tableau de bord — qui est plafonnée.
    </div>

    <!-- Filtres en une rangée, au-dessus des graphiques. -->
    <div class="adm-bar st-filtres">
      <label for="st-depuis">Du</label>
      <input id="st-depuis" type="date" v-model="depuis" @change="charger()">
      <label for="st-jusqua">au</label>
      <input id="st-jusqua" type="date" v-model="jusqua" @change="charger()">
      <button class="adm-b" @click="depuis = ''; jusqua = ''; charger()">Toute la période</button>
      <span style="flex:1"></span>
      <button class="adm-b" @click="vueTableau = !vueTableau">
        {{ vueTableau ? 'Voir les graphiques' : 'Voir le tableau' }}
      </button>
    </div>

    <div v-if="erreur" class="adm-msg adm-msg-ko">{{ erreur }}</div>
    <div v-else-if="chargement" class="meta">Chargement…</div>

    <template v-else-if="stats">
      <!-- Quatre nombres de tête : ce ne sont pas des graphiques, et il ne faut
           pas les en faire. -->
      <div class="st-tuiles">
        <div class="st-tuile">
          <div class="st-t-v">{{ stats.total.total }}</div>
          <div class="st-t-l">dossiers ouverts</div>
        </div>
        <div class="st-tuile">
          <div class="st-t-v">{{ stats.total.enCours }}</div>
          <div class="st-t-l">en cours</div>
        </div>
        <div class="st-tuile">
          <div class="st-t-v">{{ stats.total.valides }}</div>
          <div class="st-t-l">validés</div>
        </div>
        <div class="st-tuile">
          <div class="st-t-v">{{ stats.total.clos }}</div>
          <div class="st-t-l">clos en chemin</div>
        </div>
      </div>

      <template v-if="!vueTableau">
        <!-- ══ Par mois — empilement : un mois est un tout, ses états en sont
             les parts ══ -->
        <div class="st-bloc">
          <div class="st-titre">Dossiers ouverts par mois, et où ils en sont</div>
          <div class="st-legende">
            <span v-for="e in ETATS" :key="e.cle" class="st-lg">
              <span class="st-pastille" :class="e.classe"></span>{{ e.libelle }}
            </span>
          </div>
          <div v-if="!stats.parMois.length" class="meta">Aucun dossier sur la période.</div>
          <div v-for="m in stats.parMois" :key="m.cle" class="st-ligne">
            <div class="st-ll">{{ moisLisible(m.cle) }}</div>
            <div class="st-piste">
              <div v-for="e in ETATS" :key="e.cle" class="st-seg" :class="e.classe"
                   :style="{ width: part(m[e.cle], maxMois) + '%' }"
                   :title="`${e.libelle} : ${m[e.cle]}`">
                <span v-if="etiquetteTient(m[e.cle], maxMois)" class="st-in">{{ m[e.cle] }}</span>
              </div>
            </div>
            <div class="st-lv">{{ m.total }}</div>
          </div>
        </div>

        <!-- ══ Par parcours et par produit — une seule teinte : on compare des
             grandeurs, pas des identités ══ -->
        <div class="st-bloc">
          <div class="st-titre">Dossiers par parcours</div>
          <div v-for="p in stats.parParcours" :key="p.cle" class="st-ligne">
            <div class="st-ll" :title="p.cle">{{ p.cle }}</div>
            <div class="st-piste">
              <div class="st-seg st-seul" :style="{ width: part(p.total, maxParcours) + '%' }"></div>
            </div>
            <div class="st-lv">{{ p.total }}</div>
          </div>
        </div>

        <div class="st-bloc">
          <div class="st-titre">Dossiers par produit</div>
          <div v-for="p in stats.parProduit.slice(0, 12)" :key="p.cle" class="st-ligne">
            <div class="st-ll" :title="p.cle">{{ p.cle }}</div>
            <div class="st-piste">
              <div class="st-seg st-seul" :style="{ width: part(p.total, maxProduit) + '%' }"></div>
            </div>
            <div class="st-lv">{{ p.total }}</div>
          </div>
          <div v-if="stats.parProduit.length > 12" class="meta">
            Les douze premiers produits ; le tableau porte les
            {{ stats.parProduit.length }} au complet.
          </div>
        </div>
      </template>

      <!-- ══ Vue tableau — ce qui répond quand une teinte ne se distingue pas,
           à l'impression comme pour un daltonien ══ -->
      <template v-else>
        <div class="st-bloc">
          <div class="st-titre">Par mois</div>
          <table class="adm-t">
            <thead>
              <tr>
                <th style="width:160px;">Mois</th>
                <th style="width:110px;">En cours</th>
                <th style="width:110px;">Validés</th>
                <th style="width:110px;">Clos</th>
                <th style="width:110px;">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in stats.parMois" :key="m.cle">
                <td class="ident">{{ moisLisible(m.cle) }}</td>
                <td>{{ m.enCours }}</td><td>{{ m.valides }}</td>
                <td>{{ m.clos }}</td><td><strong>{{ m.total }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="st-bloc">
          <div class="st-titre">Par parcours</div>
          <table class="adm-t">
            <thead>
              <tr>
                <th>Parcours</th><th style="width:110px;">En cours</th>
                <th style="width:110px;">Validés</th><th style="width:110px;">Clos</th>
                <th style="width:110px;">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in stats.parParcours" :key="p.cle">
                <td class="ident">{{ p.cle }}</td>
                <td>{{ p.enCours }}</td><td>{{ p.valides }}</td>
                <td>{{ p.clos }}</td><td><strong>{{ p.total }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="st-bloc">
          <div class="st-titre">Par produit</div>
          <table class="adm-t">
            <thead>
              <tr>
                <th>Produit</th><th style="width:110px;">En cours</th>
                <th style="width:110px;">Validés</th><th style="width:110px;">Clos</th>
                <th style="width:110px;">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in stats.parProduit" :key="p.cle">
                <td class="ident">{{ p.cle }}</td>
                <td>{{ p.enCours }}</td><td>{{ p.valides }}</td>
                <td>{{ p.clos }}</td><td><strong>{{ p.total }}</strong></td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- Ce qui MANQUE est dit, plutôt que rendu par une colonne vide. -->
      <div v-if="stats.serviceIndisponible" class="adm-msg adm-msg-hs st-manque">
        <strong>Pas de ventilation par service.</strong> {{ stats.serviceIndisponible }}
      </div>
    </template>
  </div>
</template>
