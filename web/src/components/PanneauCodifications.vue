<script setup>
/**
 * Codifications — les référentiels que le module consulte ou tient.
 *
 * Cinq listes qui n'ont pas la même nature, et l'écran doit le dire plutôt
 * que de les aligner comme si elles se valaient :
 *
 *   Utilisateurs — TENU ici. Les comptes sont créés et gérés dans le module.
 *   Services     — TENU ici. L'UF est la clé, le libellé la décrit.
 *   Produits     — TENU ici, mais court : dénomination, DCI, seuil de
 *                  conservation. Pas un livret thérapeutique.
 *   Stockage     — TENU ici, et le seul qui porte un ÉTAT plutôt qu'une liste :
 *                  une place est libre ou occupée, et c'est la base qui en
 *                  décide. L'écran la montre, il ne l'arbitre pas.
 *   Patients     — CONSULTÉ, jamais constitué. L'annuaire de référence est le
 *                  SIH (ou Pharma®/CHIMIO®) ; on ne montre ici que les
 *                  patients qu'un dossier a effectivement rattachés.
 *
 * Cette dernière distinction n'est pas cosmétique : constituer un référentiel
 * patients dans un module de traçabilité créerait un second annuaire, qui
 * divergerait du premier et qu'il faudrait tenir à jour.
 */
import { computed, onMounted, ref } from 'vue'
import { appel, messageErreur } from '../api.js'
import { useStockage } from '../stores/stockage.js'
import PanneauUtilisateurs from './PanneauUtilisateurs.vue'

const SOUS_ONGLETS = [
  ['utilisateurs', 'Utilisateurs'],
  ['services', 'Services'],
  ['produits', 'Produits'],
  /* Stockage — TENU ici, et c'est le seul de ces référentiels qui porte un
     ÉTAT plutôt qu'une simple liste : une place est libre ou occupée, et c'est
     la base qui en décide. L'écran la montre, il ne l'arbitre pas. */
  ['stockage', 'Stockage'],
  ['patients', 'Patients']
]
const sousOnglet = ref('utilisateurs')

const services = ref([])
const produits = ref([])
const patients = ref([])
const erreur = ref('')
const chargement = ref(false)
const voirInactifs = ref(false)
const recherche = ref('')

const nouveau = ref({ uf: '', libelle: '', pole: '' })
const formulaireOuvert = ref(false)

async function charger () {
  chargement.value = true
  erreur.value = ''
  try {
    const [rS, rP, rPat] = await Promise.all([
      appel(`/api/services?inactifs=${voirInactifs.value ? 'oui' : 'non'}`),
      appel('/api/produits'),
      appel('/api/patients?tous=oui')
    ])
    if (rS.ok) services.value = await rS.json()
    if (rP.ok) produits.value = await rP.json()
    if (rPat.ok) patients.value = await rPat.json()
    if (!rS.ok) erreur.value = await messageErreur(rS, `Services illisibles (${rS.status}).`)
  } catch (e) {
    erreur.value = e.message || 'API injoignable.'
  } finally {
    chargement.value = false
  }
}
onMounted(charger)

// ── Stockage : cuves, places, et le délai d'expiration ──
const stockage = useStockage()
onMounted(() => stockage.charger())

const nouvelleCuve = ref({
  code: '', libelle: '', genre: 'cuve', etages: 'A-J', emplacementsParEtage: 20
})
const formulaireCuve = ref(false)
const placesVues = ref([])
const cuveOuverte = ref(null)
const delaiSaisi = ref('')

/** « A-J » ou « A,B,C » : les deux s'écrivent, la première est plus rapide. */
function etagesDepuis (texte) {
  const brut = String(texte ?? '').trim().toUpperCase()
  const plage = brut.match(/^([A-Z])\s*-\s*([A-Z])$/)
  if (plage) {
    const [, a, b] = plage
    const [d, f] = [a.charCodeAt(0), b.charCodeAt(0)]
    if (d > f) return []
    return Array.from({ length: f - d + 1 }, (_, i) => String.fromCharCode(d + i))
  }
  return brut.split(',').map((e) => e.trim()).filter(Boolean)
}

const apercuEtages = computed(() => etagesDepuis(nouvelleCuve.value.etages))
const apercuPlaces = computed(() =>
  apercuEtages.value.length * (Number(nouvelleCuve.value.emplacementsParEtage) || 0))

async function creerCuve () {
  erreur.value = ''
  const etages = etagesDepuis(nouvelleCuve.value.etages)
  if (!etages.length) { erreur.value = 'Étages illisibles : « A-J » ou « A,B,C ».'; return }
  const fait = await stockage.creerContenant({
    code: nouvelleCuve.value.code,
    libelle: nouvelleCuve.value.libelle,
    genre: nouvelleCuve.value.genre,
    etages,
    emplacementsParEtage: Number(nouvelleCuve.value.emplacementsParEtage)
  })
  if (!fait) { erreur.value = stockage.erreur; return }
  nouvelleCuve.value = {
    code: '', libelle: '', genre: 'cuve', etages: 'A-J', emplacementsParEtage: 20
  }
  formulaireCuve.value = false
}

async function ouvrirCuve (c) {
  if (cuveOuverte.value === c.id) { cuveOuverte.value = null; return }
  cuveOuverte.value = c.id
  const r = await appel(`/api/contenants/${c.id}/emplacements`)
  placesVues.value = r.ok ? await r.json() : []
}

async function reglerDelai () {
  erreur.value = ''
  if (!(await stockage.reglerParametre('emplacement.expiration_heures', delaiSaisi.value))) {
    erreur.value = stockage.erreur
  }
}

const servicesFiltres = computed(() => {
  const q = recherche.value.trim().toLowerCase()
  if (!q) return services.value
  return services.value.filter((s) =>
    `${s.uf} ${s.libelle} ${s.pole ?? ''}`.toLowerCase().includes(q))
})

async function creerService () {
  erreur.value = ''
  const r = await appel('/api/services', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(nouveau.value)
  })
  if (!r.ok) { erreur.value = await messageErreur(r, `Création refusée (${r.status}).`); return }
  nouveau.value = { uf: '', libelle: '', pole: '' }
  formulaireOuvert.value = false
  await charger()
}

/** Un service ne se supprime pas : les dossiers qui le citent doivent rester
 *  lisibles. Il se désactive, et se réactive. */
async function basculerService (s) {
  erreur.value = ''
  const r = await appel(`/api/services/${s.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actif: !s.actif })
  })
  if (!r.ok) { erreur.value = await messageErreur(r, `Modification refusée (${r.status}).`); return }
  await charger()
}

async function enregistrerService (s, champ, valeur) {
  const v = String(valeur).trim()
  if (v === (s[champ] ?? '')) return
  erreur.value = ''
  const r = await appel(`/api/services/${s.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [champ]: v })
  })
  if (!r.ok) {
    erreur.value = await messageErreur(r, `Modification refusée (${r.status}).`)
    await charger()
    return
  }
  s[champ] = v
}
</script>

<template>
  <div class="adm">
    <nav class="cfg-sst" role="tablist" aria-label="Référentiel">
      <button v-for="[c, lbl] in SOUS_ONGLETS" :key="c"
              class="cfg-sst-b" :class="{ act: sousOnglet === c }" role="tab"
              :aria-selected="sousOnglet === c" @click="sousOnglet = c">{{ lbl }}</button>
    </nav>

    <div v-if="erreur" class="adm-msg adm-msg-ko">{{ erreur }}</div>

    <!-- ══ Utilisateurs — l'écran existant, repris tel quel ══ -->
    <PanneauUtilisateurs v-if="sousOnglet === 'utilisateurs'" />

    <!-- ══ Services ══ -->
    <template v-else-if="sousOnglet === 'services'">
      <div class="adm-bar">
        <input type="text" v-model="recherche" placeholder="UF, libellé ou pôle…">
        <label>
          <input type="checkbox" v-model="voirInactifs" @change="charger()">
          Afficher les services désactivés
        </label>
        <span style="flex:1"></span>
        <button class="adm-b-p" @click="formulaireOuvert = !formulaireOuvert">
          + Nouveau service
        </button>
      </div>

      <div v-if="formulaireOuvert" class="adm-form">
        <div class="adm-form-t">Nouveau service</div>
        <div class="adm-r">
          <label for="sv-uf">UF</label>
          <input id="sv-uf" type="text" v-model="nouveau.uf" style="min-width:120px;"
                 placeholder="1301">
          <span class="meta">Unité fonctionnelle telle que la porte le SIH.</span>
        </div>
        <div class="adm-r">
          <label for="sv-lib">Libellé</label>
          <input id="sv-lib" type="text" v-model="nouveau.libelle" style="min-width:340px;"
                 placeholder="Hématologie clinique — secteur protégé">
        </div>
        <div class="adm-r">
          <label for="sv-pole">Pôle</label>
          <input id="sv-pole" type="text" v-model="nouveau.pole" style="min-width:240px;"
                 placeholder="Facultatif">
        </div>
        <div class="adm-r" style="margin-bottom:0;">
          <label></label>
          <button class="adm-b" @click="formulaireOuvert = false">Annuler</button>
          <button class="adm-b-p" :disabled="!nouveau.uf.trim() || !nouveau.libelle.trim()"
                  @click="creerService()">Créer</button>
        </div>
      </div>

      <div class="adm-aide">
        L'<strong>UF identifie</strong>, le libellé décrit : c'est l'UF que porte le SIH
        et qui sert au rapprochement. Un service ne se supprime pas — les dossiers qui
        le citent doivent rester lisibles — il se désactive.
      </div>

      <table class="adm-t">
        <thead>
          <tr>
            <th style="width:90px;">UF</th>
            <th>Libellé</th>
            <th style="width:220px;">Pôle</th>
            <th style="width:110px;">État</th>
            <th style="width:120px;"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in servicesFiltres" :key="s.id" :class="{ 'adm-off': !s.actif }">
            <td><input class="ident sv-i" type="text" :value="s.uf"
                       @blur="enregistrerService(s, 'uf', $event.target.value)"></td>
            <td><input class="sv-i sv-l" type="text" :value="s.libelle"
                       @blur="enregistrerService(s, 'libelle', $event.target.value)"></td>
            <td><input class="sv-i" type="text" :value="s.pole ?? ''"
                       @blur="enregistrerService(s, 'pole', $event.target.value)"></td>
            <td>
              <span class="prof" :class="s.actif ? 'cfg-actif' : 'cfg-retire'">
                {{ s.actif ? 'Actif' : 'Désactivé' }}
              </span>
            </td>
            <td>
              <button class="adm-b" @click="basculerService(s)">
                {{ s.actif ? 'Désactiver' : 'Réactiver' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!servicesFiltres.length && !chargement" class="adm-vide">
        Aucun service ne correspond.
      </div>
    </template>

    <!-- ══ Produits ══ -->
    <template v-else-if="sousOnglet === 'produits'">
      <div class="adm-aide">
        Produits de référence proposés à la création d'un dossier. Le seuil est celui
        au-delà duquel un relevé de température déclenche l'alarme. Un MTI absent de
        cette liste reste commandable : le dossier porte alors une désignation libre.
      </div>
      <table class="adm-t">
        <thead>
          <tr>
            <th style="width:200px;">Dénomination</th>
            <th>DCI</th>
            <th style="width:200px;">Laboratoire</th>
            <th style="width:160px;">Seuil de conservation</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in produits" :key="p.id">
            <td class="ident">{{ p.denomination }}</td>
            <td>{{ p.dci }}</td>
            <td>{{ p.laboratoire }}</td>
            <td>{{ p.seuilTempC ?? p.seuil_temp_c }} °C</td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ══ Stockage ══ -->
    <template v-else-if="sousOnglet === 'stockage'">
      <div class="adm-aide">
        Les places d'une cuve sont <strong>énumérées une à une</strong> : c'est ce qui
        permet de mettre une cassette hors service sans toucher aux autres, et c'est en
        base qu'une place ne peut être prise qu'une fois. La liste affichée à l'opérateur
        n'est qu'un instantané — entre son affichage et le clic, une autre réception peut
        avoir pris la même place. C'est la base qui arbitre, et elle le dit.
      </div>

      <div class="adm-r stk-delai">
        <label for="stk-delai">Réservation non confirmée libérée après</label>
        <input id="stk-delai" type="number" min="1" max="8760" style="width:80px;"
               :value="delaiSaisi || stockage.delaiExpiration"
               @input="delaiSaisi = $event.target.value">
        <span>heures</span>
        <button class="adm-b" @click="reglerDelai()">Régler</button>
        <span class="meta">
          Une place gelée par un dossier abandonné finirait par remplir la cuve.
          Réglé haut : une place reprise sous les pieds d'un opérateur est plus grave.
        </span>
      </div>

      <div class="adm-bar">
        <span style="flex:1"></span>
        <button class="adm-b-p" @click="formulaireCuve = !formulaireCuve">
          + Nouveau contenant
        </button>
      </div>

      <div v-if="formulaireCuve" class="adm-form">
        <div class="adm-form-t">Nouveau contenant</div>
        <div class="adm-r">
          <label for="cv-code">Code</label>
          <input id="cv-code" type="text" v-model="nouvelleCuve.code" style="min-width:120px;"
                 placeholder="CUVE-2">
          <label for="cv-lib">Libellé</label>
          <input id="cv-lib" type="text" v-model="nouvelleCuve.libelle" style="min-width:300px;"
                 placeholder="Cuve d'azote n°2 — PUI">
        </div>
        <div class="adm-r">
          <label for="cv-genre">Genre</label>
          <select id="cv-genre" v-model="nouvelleCuve.genre">
            <option value="cuve">Cuve d'azote</option>
            <option value="congelateur">Congélateur</option>
            <option value="enceinte">Enceinte</option>
          </select>
          <label for="cv-etages">Étages</label>
          <input id="cv-etages" type="text" v-model="nouvelleCuve.etages" style="width:120px;"
                 placeholder="A-J">
          <label for="cv-par">Places par étage</label>
          <input id="cv-par" type="number" min="1" max="200" style="width:70px;"
                 v-model="nouvelleCuve.emplacementsParEtage">
          <span class="meta">
            {{ apercuEtages.length }} étage(s) × {{ nouvelleCuve.emplacementsParEtage }}
            = <strong>{{ apercuPlaces }}</strong> places
          </span>
        </div>
        <div class="adm-r">
          <button class="adm-b-p" :disabled="!apercuPlaces" @click="creerCuve()">Créer</button>
          <button class="adm-b" @click="formulaireCuve = false">Annuler</button>
        </div>
      </div>

      <table class="adm-t">
        <thead>
          <tr>
            <th style="width:120px;">Code</th>
            <th>Libellé</th>
            <th style="width:110px;">Genre</th>
            <th style="width:90px;">Places</th>
            <th style="width:90px;">Occupées</th>
            <th style="width:90px;">Libres</th>
            <th style="width:150px;"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="c in stockage.contenants" :key="c.id">
            <tr :class="{ inactif: !c.actif }">
              <td class="ident">{{ c.code }}</td>
              <td>{{ c.libelle }}</td>
              <td>{{ c.genre }}</td>
              <td>{{ c.nbPlaces }}</td>
              <td>{{ c.nbOccupees }}</td>
              <td :class="{ 'stk-plein': c.nbLibres === 0 }">{{ c.nbLibres }}</td>
              <td>
                <button class="adm-b" @click="ouvrirCuve(c)">
                  {{ cuveOuverte === c.id ? 'Replier' : 'Voir les places' }}
                </button>
                <!-- Un contenant ne se supprime pas : les occupations passées
                     disent où était un MTI à une date donnée. -->
                <button class="adm-b" @click="stockage.basculerContenant(c.id, !c.actif)">
                  {{ c.actif ? 'Désactiver' : 'Réactiver' }}
                </button>
              </td>
            </tr>
            <tr v-if="cuveOuverte === c.id">
              <td colspan="7">
                <div class="stk-grille">
                  <span v-for="e in placesVues" :key="e.id"
                        class="stk-case"
                        :class="{ occ: e.occupation, hs: !e.actif }"
                        :title="e.occupation
                          ? `${e.libelle} — dossier ${e.occupation.dossier}`
                          : (!e.actif ? `${e.libelle} — hors service : ${e.horsServiceMotif}`
                                      : `${e.libelle} — libre`)">
                    {{ e.etage }}{{ String(e.numero).padStart(2, '0') }}
                  </span>
                </div>
              </td>
            </tr>
          </template>
          <tr v-if="!stockage.contenants.length">
            <td colspan="7" class="meta">
              Aucun contenant. Sans référentiel, un point « emplacement » n'a rien à
              proposer.
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ══ Patients ══ -->
    <template v-else>
      <div class="adm-msg adm-msg-hs">
        Le module <strong>ne constitue pas de référentiel patients</strong> : l'annuaire
        de référence est le SIH (ou Pharma®/CHIMIO®). Cette liste montre uniquement les
        patients qu'un dossier a effectivement rattachés — elle ne se saisit pas ici, et
        elle ne fait pas autorité.
      </div>
      <table class="adm-t">
        <thead>
          <tr>
            <th style="width:150px;">N° patient</th>
            <th>Identité</th>
            <th style="width:130px;">Naissance</th>
            <th style="width:130px;">IPP</th>
            <th style="width:110px;">Source</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in patients" :key="p.id">
            <td class="ident">{{ p.reference }}</td>
            <td>{{ p.nom }}</td>
            <td>{{ p.dateNaissance ?? '—' }}</td>
            <td class="ident">{{ p.ipp ?? '—' }}</td>
            <td>
              <span class="prof" :class="p.source === 'DEMO' ? 'cfg-retire' : 'cfg-actif'">
                {{ p.source }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!patients.length && !chargement" class="adm-vide">
        Aucun patient rattaché à un dossier pour l'instant.
      </div>
    </template>
  </div>
</template>
