<script setup>
/**
 * Cellule « Valeur / Détail » d'un point de contrôle.
 *
 * Un seul composant couvre les six types du modèle. Les maquettes
 * construisaient ce fragment par concaténation de chaînes HTML
 * (`cDetail()` / `renderMain()`), ce qui interdisait toute liaison
 * bidirectionnelle : la valeur saisie n'existait que dans le DOM.
 */
import { computed, ref } from 'vue'
import { useParcours } from '../stores/parcours.js'
import CapturePhoto from './CapturePhoto.vue'

const props = defineProps({
  point: { type: Object, required: true },
  cle: { type: String, required: true },
  lectureSeule: { type: Boolean, default: false }
})

const store = useParcours()
const saisie = computed(() => store.saisie(props.cle, props.point))
const alarme = computed(() => store.alarme(props.cle, props.point))

// ── Photos ──
const champFichier = ref(null)
const cameraOuverte = ref(false)
const envoiEnCours = ref(false)

/** Côté long maximal envoyé au serveur. */
const COTE_MAX = 1600

/**
 * Réduit une image avant l'envoi.
 *
 * Un appareil récent produit 4 à 8 Mio par cliché. Les envoyer tels quels
 * ferait grossir la base d'un ordre de grandeur pour un rendu que personne ne
 * regarde à cette résolution : ce qu'on veut relire, c'est l'état du conteneur
 * ou l'étiquette de la cuve, pas le grain du capteur.
 */
function reduire (fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => rejeter(new Error('Fichier illisible.'))
    lecteur.onload = () => {
      const img = new Image()
      img.onerror = () => rejeter(new Error("Ce fichier n'est pas une image lisible."))
      img.onload = () => {
        const echelle = Math.min(1, COTE_MAX / Math.max(img.width, img.height))
        const toile = document.createElement('canvas')
        toile.width = Math.round(img.width * echelle)
        toile.height = Math.round(img.height * echelle)
        toile.getContext('2d').drawImage(img, 0, 0, toile.width, toile.height)
        const url = toile.toDataURL('image/jpeg', 0.85)
        resoudre({
          octets: url.slice(url.indexOf(',') + 1),
          mime: 'image/jpeg',
          nomFichier: fichier.name.replace(/\.[^.]+$/, '') + '.jpg'
        })
      }
      img.src = lecteur.result
    }
    lecteur.readAsDataURL(fichier)
  })
}

async function fichiersChoisis (evenement) {
  const fichiers = [...(evenement.target.files ?? [])]
  evenement.target.value = ''   // le même fichier doit pouvoir être repris
  envoiEnCours.value = true
  try {
    for (const f of fichiers) {
      const image = await reduire(f).catch((e) => { store.erreurDossier = e.message; return null })
      if (image) await store.deposerPhoto(props.cle, { ...image, libelle: f.name })
    }
  } finally { envoiEnCours.value = false }
}

async function photoCapturee (image) {
  cameraOuverte.value = false
  envoiEnCours.value = true
  try { await store.deposerPhoto(props.cle, { ...image, libelle: 'Prise de vue' }) }
  finally { envoiEnCours.value = false }
}

/** Heure d'un jalon de minuteur, ou « — » tant qu'il n'est pas posé. */
function heure (epoch) {
  if (!epoch) return '—'
  const d = new Date(epoch)
  const p = (v) => String(v).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
</script>

<template>
  <!-- Oui / Non — deux boutons, pas deux radios.
       Une radio se vise mal et se lit mal de loin ; deux boutons dont l'un
       s'allume disent l'état de la ligne d'un coup d'œil, ce qu'un opérateur
       qui parcourt trente points fait en permanence. C'est le choix de la
       maquette v12. -->
  <div v-if="point.type === 'ouinon'" class="cyn">
    <button
      class="ctl-b" :class="{ on: saisie.reponse === 'oui' }" :disabled="lectureSeule"
      @click="saisie.reponse = saisie.reponse === 'oui' ? null : 'oui'"
    >Oui</button>
    <button
      class="ctl-b no" :class="{ on: saisie.reponse === 'non' }" :disabled="lectureSeule"
      @click="saisie.reponse = saisie.reponse === 'non' ? null : 'non'"
    >Non</button>
  </div>

  <!-- Valeur numérique, avec alarme de seuil -->
  <div v-else-if="point.type === 'valeur'" class="cval">
    <input
      class="cfi" :class="{ 'hors-seuil': alarme?.horsSeuil }" type="number" step="0.1"
      :placeholder="point.seuil !== undefined ? '− °C' : 'Valeur'"
      style="width:82px;"
      v-model="saisie.valeurNum" :disabled="lectureSeule"
    >
    <span v-if="alarme" :class="alarme.horsSeuil ? 'calm' : 'cokb'">
      {{ alarme.horsSeuil
        ? `⚠ ${alarme.valeur} °C > ${alarme.seuil} °C`
        : `✓ ${alarme.valeur} °C` }}
    </span>
  </div>

  <!-- Photos.
       La cellule ne cochait qu'un pictogramme : ✅ s'affichait sans qu'aucune
       image existe nulle part. Sur un dossier de traçabilité, une coche qui
       atteste d'un contrôle visuel sans en garder la preuve est pire que pas
       de photo du tout. Elle porte maintenant de vraies pièces. -->
  <div v-else-if="point.type === 'photo'" class="cthr">
    <a
      v-for="photo in saisie.photos" :key="photo.id"
      class="cph" :href="store.urlPhoto(photo.id)" target="_blank" rel="noopener"
      :title="`${photo.libelle || photo.nomFichier} — ${Math.round(photo.taille / 1024)} Kio`
        + (photo.ajoutePar ? ` — ${photo.ajoutePar}` : '')"
    >
      <img :src="store.urlPhoto(photo.id)" :alt="photo.libelle || photo.nomFichier">
      <span
        v-if="!lectureSeule" class="cph-x" title="Retirer cette photo"
        @click.prevent.stop="store.retirerPhoto(cle, photo.id)"
      >✕</span>
    </a>

    <template v-if="!lectureSeule">
      <button
        class="cth2" title="Choisir un fichier image" :disabled="envoiEnCours"
        @click="champFichier.click()"
      >📁</button>
      <button
        class="cth2" title="Prendre une photo avec la caméra du poste"
        :disabled="envoiEnCours" @click="cameraOuverte = true"
      >📷</button>
      <span v-if="envoiEnCours" class="cph-att">envoi…</span>
      <input
        ref="champFichier" type="file" accept="image/*" multiple hidden
        @change="fichiersChoisis"
      >
    </template>
    <span v-else-if="!saisie.photos.length" class="cph-att">aucune photo</span>

    <CapturePhoto
      :ouvert="cameraOuverte"
      @fermer="cameraOuverte = false"
      @capturer="photoCapturee"
    />
  </div>

  <!-- Minuteur.
       Repris de `checklist_cart_reception_v2.html` : afficheur monospace vert
       sur noir, ▶ T0 pour lancer, ■ Fin pour arrêter, et la ligne Début / Fin
       en dessous. Cette dernière manquait à l'application : sans elle,
       l'afficheur donne une durée sans dire de quand à quand, ce qui est
       précisément ce qu'un relevé de traçabilité doit établir. -->
  <div v-else-if="point.type === 'timer'">
    <div class="ctrow">
      <button
        class="cbt" :disabled="lectureSeule || !!saisie.timerDebut"
        @click="store.demarrerMinuteur(cle)"
      >▶ T0</button>
      <span class="ctd">{{ store.dureeMinuteur(cle) }}</span>
      <button
        class="cbt stop" :disabled="lectureSeule || !store.minuteurEnCours(cle)"
        @click="store.arreterMinuteur(cle)"
      >■ Fin</button>
    </div>
    <div class="ctse">
      Début : <b>{{ heure(saisie.timerDebut) }}</b>&nbsp;&nbsp;
      Fin : <b>{{ heure(saisie.timerFin) }}</b>
    </div>
  </div>

  <!-- Texte -->
  <input
    v-else-if="point.type === 'texte'"
    class="cfi" type="text" placeholder="Saisir…"
    v-model="saisie.valeurTexte" :disabled="lectureSeule"
  >

  <!-- Date — jalon calendaire (aphérèse, lymphodéplétion, réception prévue).
       La valeur vit dans valeurTexte au format ISO, comme la rend l'input. -->
  <input
    v-else-if="point.type === 'date'"
    class="cfi" type="date" style="width:150px;"
    v-model="saisie.valeurTexte" :disabled="lectureSeule"
  >

  <!-- Automatique : renseigné par le système à la validation -->
  <span v-else style="font-size:10px;color:#777;font-style:italic;">
    {{ point.valeurAuto ?? 'Automatique' }}
  </span>
</template>
