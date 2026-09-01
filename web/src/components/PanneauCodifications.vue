<script setup>
/**
 * Codifications — les référentiels que le module consulte ou tient.
 *
 * Quatre listes qui n'ont pas la même nature, et l'écran doit le dire plutôt
 * que de les aligner comme si elles se valaient :
 *
 *   Utilisateurs — TENU ici. Les comptes sont créés et gérés dans le module.
 *   Services     — TENU ici. L'UF est la clé, le libellé la décrit.
 *   Produits     — TENU ici, mais court : dénomination, DCI, seuil de
 *                  conservation. Pas un livret thérapeutique.
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
import PanneauUtilisateurs from './PanneauUtilisateurs.vue'

const SOUS_ONGLETS = [
  ['utilisateurs', 'Utilisateurs'],
  ['services', 'Services'],
  ['produits', 'Produits'],
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
