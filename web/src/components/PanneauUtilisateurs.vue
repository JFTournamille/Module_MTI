<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useUtilisateurs } from '../stores/utilisateurs.js'

const store = useUtilisateurs()

const LIBELLES = {
  pharmacien: 'Pharmacien',
  preparateur: 'Préparateur',
  ide: 'IDE',
  qualite: 'Qualité',
  administrateur: 'Administrateur'
}
const libelleProfil = (p) => LIBELLES[p] ?? 'Non attribué'

const formulaireOuvert = ref(false)
const nouveau = reactive({ identifiant: '', nom: '', prenom: '', titre: '', fonction: '', profil: '' })

/** Édition en ligne : id du compte en cours de modification, ou null. */
const enEdition = ref(null)
const edition = reactive({ nom: '', prenom: '', titre: '', fonction: '', profil: '' })

onMounted(() => store.charger())

const complet = computed(() =>
  nouveau.identifiant.trim() && nouveau.nom.trim() && nouveau.prenom.trim())

function reinitialiser () {
  Object.assign(nouveau,
    { identifiant: '', nom: '', prenom: '', titre: '', fonction: '', profil: '' })
}

async function creer () {
  const ok = await store.creer({
    identifiant: nouveau.identifiant.trim(),
    nom: nouveau.nom.trim(),
    prenom: nouveau.prenom.trim(),
    titre: nouveau.titre.trim() || null,
    fonction: nouveau.fonction.trim() || null,
    profil: nouveau.profil || null
  })
  if (ok) { reinitialiser(); formulaireOuvert.value = false }
}

function ouvrirEdition (u) {
  enEdition.value = u.id
  Object.assign(edition, {
    nom: u.nom, prenom: u.prenom,
    titre: u.titre ?? '', fonction: u.fonction ?? '', profil: u.profil ?? ''
  })
}

async function enregistrerEdition (u) {
  const ok = await store.modifier(u.id, {
    nom: edition.nom.trim(),
    prenom: edition.prenom.trim(),
    titre: edition.titre.trim() || null,
    fonction: edition.fonction.trim() || null,
    profil: edition.profil || null
  })
  if (ok) enEdition.value = null
}
</script>

<template>
  <div class="adm">
    <div class="adm-bar">
      <label for="adm-q" style="font-weight:bold;color:#4a3880;">Rechercher :</label>
      <input id="adm-q" type="text" v-model="store.recherche" placeholder="Identifiant, nom, fonction…"
             style="width:230px;" @input="store.charger()"/>
      <label>
        <input type="checkbox" v-model="store.avecInactifs" @change="store.charger()"/>
        Afficher les comptes désactivés
      </label>
      <button class="adm-b adm-b-p" style="margin-left:auto;"
              @click="formulaireOuvert = !formulaireOuvert">
        {{ formulaireOuvert ? '✕ Annuler' : '+ Nouvel utilisateur' }}
      </button>
    </div>

    <div v-if="store.indisponible" class="adm-msg adm-msg-hs">
      Gestion des utilisateurs indisponible : {{ store.erreur }}
      <div style="margin-top:5px;font-size:12px;">
        Les comptes ne sont pas embarqués dans l'application — une liste lue hors ligne
        serait périmée, et créer un compte sans base n'aurait pas de sens.
      </div>
    </div>
    <div v-else-if="store.erreur" class="adm-msg adm-msg-ko">{{ store.erreur }}</div>

    <div v-if="formulaireOuvert && !store.indisponible" class="adm-form">
      <div class="adm-form-t">Nouvel utilisateur</div>
      <div class="adm-r">
        <label for="n-id">Identifiant *</label>
        <input id="n-id" type="text" v-model="nouveau.identifiant" placeholder="ewolff"/>
      </div>
      <div class="adm-aide">
        Le login du SSO de l'établissement. Non modifiable après création : il lie le
        compte à ses saisies.
      </div>
      <div class="adm-r">
        <label for="n-nom">Nom *</label>
        <input id="n-nom" type="text" v-model="nouveau.nom" placeholder="WOLFF"/>
        <label for="n-pre" style="width:auto;">Prénom *</label>
        <input id="n-pre" type="text" v-model="nouveau.prenom" placeholder="Élise"/>
      </div>
      <div class="adm-r">
        <label for="n-tit">Titre</label>
        <input id="n-tit" type="text" v-model="nouveau.titre" placeholder="Dr" style="min-width:90px;"/>
        <label for="n-fon" style="width:auto;">Fonction</label>
        <input id="n-fon" type="text" v-model="nouveau.fonction" placeholder="pharmacien praticien"/>
      </div>
      <div class="adm-r">
        <label for="n-pro">Profil</label>
        <select id="n-pro" v-model="nouveau.profil">
          <option value="">— non attribué —</option>
          <option v-for="p in store.profils" :key="p" :value="p">{{ libelleProfil(p) }}</option>
        </select>
      </div>
      <div class="adm-aide">
        Le profil ne conditionne encore aucun accès : il attend le branchement du SSO.
        En mode développement l'opérateur est fixe, un contrôle de droits n'y aurait
        pas de valeur.
      </div>
      <div class="adm-r" style="margin-bottom:0;">
        <label></label>
        <button class="adm-b adm-b-p" :disabled="!complet" @click="creer()">
          Créer le compte
        </button>
        <button class="adm-b" @click="formulaireOuvert = false; reinitialiser()">Annuler</button>
      </div>
    </div>

    <template v-if="!store.indisponible">
      <div class="adm-h">
        Comptes
        <span class="n">
          {{ store.actifs.length }} actif(s)<template v-if="store.avecInactifs">,
          {{ store.inactifs.length }} désactivé(s)</template>
        </span>
      </div>

      <div v-if="store.chargement && !store.liste.length" class="adm-vide">Chargement…</div>
      <div v-else-if="!store.liste.length" class="adm-vide">
        Aucun compte ne correspond.
      </div>
      <table v-else class="adm-t">
        <thead>
          <tr>
            <th style="width:130px;">Identifiant</th>
            <th>Nom</th>
            <th style="width:190px;">Fonction</th>
            <th style="width:130px;">Profil</th>
            <th style="width:90px;">État</th>
            <th style="width:180px;"></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="u in store.liste" :key="u.id">
            <tr :class="{ inactif: !u.actif }">
              <td class="ident">{{ u.identifiant }}</td>
              <td>{{ u.libelle }}</td>
              <td>{{ u.fonction || '—' }}</td>
              <td>
                <span class="prof" :class="u.profil ? 'prof-' + u.profil : 'prof-aucun'">
                  {{ libelleProfil(u.profil) }}
                </span>
              </td>
              <td>{{ u.actif ? 'Actif' : 'Désactivé' }}</td>
              <td style="text-align:right;">
                <button class="adm-b" @click="ouvrirEdition(u)"
                        v-if="enEdition !== u.id">Modifier</button>
                <button class="adm-b" style="margin-left:5px;"
                        @click="store.basculerActif(u.id, !u.actif)">
                  {{ u.actif ? 'Désactiver' : 'Réactiver' }}
                </button>
              </td>
            </tr>
            <tr v-if="enEdition === u.id">
              <td colspan="6" style="background:#f8f6ff;">
                <div class="adm-r" style="margin-bottom:7px;">
                  <label>Nom / Prénom</label>
                  <input type="text" v-model="edition.nom" style="min-width:140px;"/>
                  <input type="text" v-model="edition.prenom" style="min-width:140px;"/>
                  <label style="width:auto;">Titre</label>
                  <input type="text" v-model="edition.titre" style="min-width:70px;"/>
                </div>
                <div class="adm-r" style="margin-bottom:7px;">
                  <label>Fonction</label>
                  <input type="text" v-model="edition.fonction"/>
                  <label style="width:auto;">Profil</label>
                  <select v-model="edition.profil">
                    <option value="">— non attribué —</option>
                    <option v-for="p in store.profils" :key="p" :value="p">{{ libelleProfil(p) }}</option>
                  </select>
                </div>
                <div class="adm-r" style="margin-bottom:0;">
                  <label></label>
                  <button class="adm-b adm-b-p" @click="enregistrerEdition(u)">Enregistrer</button>
                  <button class="adm-b" @click="enEdition = null">Annuler</button>
                  <span style="font-size:12px;color:#777;">
                    L'identifiant « {{ u.identifiant }} » n'est pas modifiable.
                  </span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <div style="padding:12px 14px;font-size:12px;color:#777;line-height:1.6;">
        Un compte ne se supprime pas : il est l'auteur de saisies et de signatures, et
        l'effacer priverait la traçabilité de son auteur. La désactivation l'empêche de
        travailler tout en conservant ce qu'il a signé. Chaque création, modification et
        désactivation est tracée dans le journal d'audit, avec son auteur.
      </div>
    </template>
  </div>
</template>
