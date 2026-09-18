<script setup>
/**
 * Cellule « Valeur / Détail » d'un point de contrôle.
 *
 * Un seul composant couvre les six types du modèle. Les maquettes
 * construisaient ce fragment par concaténation de chaînes HTML
 * (`cDetail()` / `renderMain()`), ce qui interdisait toute liaison
 * bidirectionnelle : la valeur saisie n'existait que dans le DOM.
 */
import { computed, ref, watch } from 'vue'
import { useParcours } from '../stores/parcours.js'
import { useStockage } from '../stores/stockage.js'
import CapturePhoto from './CapturePhoto.vue'

const props = defineProps({
  point: { type: Object, required: true },
  cle: { type: String, required: true },
  lectureSeule: { type: Boolean, default: false }
})

const store = useParcours()
const stockage = useStockage()
const saisie = computed(() => store.saisie(props.cle, props.point))
const alarme = computed(() => store.alarme(props.cle, props.point))

// ── Emplacement de stockage ──
const contenantChoisi = ref('')
const places = ref([])
const refusPlace = computed(() => store.refusEmplacement[props.cle] ?? '')

/** Libellé de la place tenue, pour que la ligne dise où est le MTI. */
const placeTenue = computed(() =>
  places.value.find((e) => e.id === saisie.value.valeurTexte)?.libelle ?? null)

const detailOccupation = computed(() => {
  const e = places.value.find((x) => x.id === saisie.value.valeurTexte)
  if (!e?.occupation) return 'Place réservée à l\'enregistrement'
  const jusque = e.occupation.expireLe
    ? new Date(e.occupation.expireLe).toLocaleString('fr-FR')
    : null
  return jusque
    ? `Réservée jusqu'au ${jusque} si le processus reste ouvert`
    : 'Réservée'
})

async function chargerPlaces (force = false) {
  places.value = contenantChoisi.value
    ? await stockage.chargerPlaces(contenantChoisi.value, store.dossierId, force)
    : []
}

async function changerContenant () {
  /* `v-model` a déjà posé la valeur : cette fonction ne fait que recharger la
     liste des places, et vérifier que la place choisie appartient encore à la
     cuve affichée. */
  await chargerPlaces()
  if (saisie.value.valeurTexte &&
      !places.value.some((e) => e.id === saisie.value.valeurTexte)) {
    saisie.value.valeurTexte = ''
  }
}

/* Vrai quand la fiche porte une place que ce dossier NE TIENT PLUS : la
   réservation a expiré, ou elle a été libérée ailleurs. Le cas est réel — c'est
   tout l'objet du délai d'expiration — et il ne doit pas se traduire par un
   menu vide sans explication : l'opérateur croirait à une panne, alors que la
   seule chose à faire est d'en choisir une autre.

   CALCULÉ et non mémorisé : un drapeau posé une fois restait allumé après que
   l'opérateur avait choisi une autre place, et l'écran continuait d'annoncer un
   problème résolu. Ce qui fait foi est la liste des places du moment. */
const placePerdue = computed(() =>
  Boolean(saisie.value.valeurTexte) && places.value.length > 0 &&
  !places.value.some((e) => e.id === saisie.value.valeurTexte))

if (props.point.type === 'emplacement') {
  /* La cuve se déduit de la place déjà enregistrée : à la réouverture d'une
     fiche, l'opérateur doit retrouver son choix, pas un menu vide. */
  watch(() => [stockage.contenants.length, saisie.value.valeurTexte], async () => {
    if (contenantChoisi.value) return
    const actifs = stockage.contenantsActifs
    if (!actifs.length) return
    for (const c of actifs) {
      const liste = await stockage.chargerPlaces(c.id, store.dossierId)
      if (!saisie.value.valeurTexte || liste.some((e) => e.id === saisie.value.valeurTexte)) {
        contenantChoisi.value = c.id
        places.value = liste
        return
      }
    }
    /* Aucune cuve ne propose la place enregistrée : on ouvre quand même la
       première, pour que le menu soit utilisable. `placePerdue` le dira. */
    contenantChoisi.value = actifs[0].id
    places.value = await stockage.chargerPlaces(actifs[0].id, store.dossierId)
  }, { immediate: true })

  /* Après chaque enregistrement, les places sont relues : une réservation
     vient d'être posée ou déplacée, et la liste en mémoire ne porte plus la
     bonne date d'expiration. `force` court-circuite le cache, que
     l'enregistrement a de toute façon vidé. */
  watch(() => store.dernierEnregistrement, () => { chargerPlaces(true) })
}

// ── Pièces jointes : photos d'un côté, documents de l'autre ──
const champFichier = ref(null)
const champDocument = ref(null)
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

async function imagesChoisies (evenement) {
  const fichiers = [...(evenement.target.files ?? [])]
  evenement.target.value = ''   // le même fichier doit pouvoir être repris
  envoiEnCours.value = true
  try {
    for (const f of fichiers) {
      const image = await reduire(f).catch((e) => { store.erreurDossier = e.message; return null })
      if (image) await store.deposerPiece(props.cle, { ...image, libelle: f.name })
    }
  } finally { envoiEnCours.value = false }
}

async function photoCapturee (image) {
  cameraOuverte.value = false
  envoiEnCours.value = true
  try { await store.deposerPiece(props.cle, { ...image, libelle: 'Prise de vue' }) }
  finally { envoiEnCours.value = false }
}

/**
 * Documents téléversés — un point « fichier ».
 *
 * AUCUNE réduction ici, contrairement aux photos : un certificat de conformité
 * se transmet tel qu'il a été reçu et signé. Le recompresser, ce serait
 * produire un document qui n'est plus celui du fabricant, et une pièce de
 * traçabilité altérée ne vaut rien.
 */
const TAILLE_MAX = 20 * 1024 * 1024
function lireTelQuel (fichier) {
  return new Promise((resoudre, rejeter) => {
    const lecteur = new FileReader()
    lecteur.onerror = () => rejeter(new Error('Fichier illisible.'))
    lecteur.onload = () => {
      const url = String(lecteur.result)
      resoudre({
        octets: url.slice(url.indexOf(',') + 1),
        /* Le type déclaré par le navigateur, pas deviné de l'extension : le
           serveur le vérifiera de toute façon contre sa liste. */
        mime: fichier.type || 'application/octet-stream',
        nomFichier: fichier.name
      })
    }
    lecteur.readAsDataURL(fichier)
  })
}

async function documentsChoisis (evenement) {
  const fichiers = [...(evenement.target.files ?? [])]
  evenement.target.value = ''
  envoiEnCours.value = true
  try {
    for (const f of fichiers) {
      /* Refus AVANT lecture : lire 40 Mio en mémoire pour apprendre que le
         serveur les refusera n'a aucun intérêt, et fige l'onglet le temps de
         l'encodage en base64. */
      if (f.size > TAILLE_MAX) {
        store.erreurDossier = `« ${f.name} » pèse ${Math.round(f.size / 1024 / 1024)} Mio, ` +
          `plafond ${TAILLE_MAX / 1024 / 1024} Mio.`
        continue
      }
      const doc = await lireTelQuel(f).catch((e) => { store.erreurDossier = e.message; return null })
      if (doc) await store.deposerPiece(props.cle, { ...doc, libelle: f.name })
    }
  } finally { envoiEnCours.value = false }
}

/** Taille lisible : « 412 Kio », « 3,2 Mio ». */
const poids = (o) => o >= 1024 * 1024
  ? `${(o / 1024 / 1024).toFixed(1).replace('.', ',')} Mio`
  : `${Math.round(o / 1024)} Kio`

/** Pictogramme du document, d'après son type déclaré. */
const icone = (mime) => {
  if (mime === 'application/pdf') return '📕'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('text/')) return '📃'
  return '📎'
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
      v-for="photo in saisie.pieces" :key="photo.id"
      class="cph" :href="store.urlPiece(photo.id)" target="_blank" rel="noopener"
      :title="`${photo.libelle || photo.nomFichier} — ${poids(photo.taille)}`
        + (photo.ajoutePar ? ` — ${photo.ajoutePar}` : '')"
    >
      <img :src="store.urlPiece(photo.id)" :alt="photo.libelle || photo.nomFichier">
      <span
        v-if="!lectureSeule" class="cph-x" title="Retirer cette photo"
        @click.prevent.stop="store.retirerPiece(cle, photo.id)"
      >✕</span>
    </a>

    <template v-if="!lectureSeule">
      <button
        class="cth2" title="Choisir une image" :disabled="envoiEnCours"
        @click="champFichier.click()"
      >📁</button>
      <button
        class="cth2" title="Prendre une photo avec la caméra du poste"
        :disabled="envoiEnCours" @click="cameraOuverte = true"
      >📷</button>
      <span v-if="envoiEnCours" class="cph-att">envoi…</span>
      <!-- `accept="image/*"` : un point photo ne reçoit que des images, et le
           serveur le vérifie de nouveau. Ici, c'est pour éviter à l'opérateur
           de choisir un PDF qui sera refusé. -->
      <input
        ref="champFichier" type="file" accept="image/*" multiple hidden
        @change="imagesChoisies"
      >
    </template>
    <span v-else-if="!saisie.pieces.length" class="cph-att">aucune photo</span>

    <CapturePhoto
      :ouvert="cameraOuverte"
      @fermer="cameraOuverte = false"
      @capturer="photoCapturee"
    />
  </div>

  <!-- Documents téléversés.
       DISSOCIÉ de la photo, et pas seulement par le type accepté : une photo
       se regarde en vignette, un certificat de conformité se lit par son nom,
       son poids et son auteur. Une miniature de PDF ne dit rien ; ce qu'on
       veut voir, c'est « certificat-lot-4471.pdf, 2,3 Mio, déposé par
       Dr Fauchereau ». Pas de caméra ici, et aucune recompression : un
       document signé se transmet tel qu'il a été reçu. -->
  <div v-else-if="point.type === 'fichier'" class="cdoc">
    <a
      v-for="doc in saisie.pieces" :key="doc.id"
      class="cdoc-l" :href="store.urlPiece(doc.id)" target="_blank" rel="noopener"
      :title="doc.ajoutePar ? `Déposé par ${doc.ajoutePar}` : 'Télécharger'"
    >
      <span class="cdoc-i">{{ icone(doc.mime) }}</span>
      <span class="cdoc-n">{{ doc.libelle || doc.nomFichier }}</span>
      <span class="cdoc-p">{{ poids(doc.taille) }}</span>
      <span
        v-if="!lectureSeule" class="cdoc-x" title="Retirer ce document"
        @click.prevent.stop="store.retirerPiece(cle, doc.id)"
      >✕</span>
    </a>

    <template v-if="!lectureSeule">
      <button
        class="cdoc-b" :disabled="envoiEnCours" @click="champDocument.click()"
        title="Joindre un document (PDF, image, texte, Word, Excel)"
      >📎 Joindre un document</button>
      <span v-if="envoiEnCours" class="cph-att">envoi…</span>
      <input
        ref="champDocument" type="file" multiple hidden
        accept="application/pdf,image/*,text/plain,text/csv,.doc,.docx,.xls,.xlsx"
        @change="documentsChoisis"
      >
    </template>
    <span v-else-if="!saisie.pieces.length" class="cph-att">aucun document</span>
  </div>

  <!-- Liste de valeurs.
       Un choix arrêté plutôt qu'un texte libre : « IV », « i.v. » et « voie
       veineuse » sont trois écritures d'une même chose, qu'aucun décompte ne
       rapproche. Les valeurs viennent de la DÉFINITION du point, donc de la
       version du modèle : une liste modifiée plus tard ne réécrit pas ce qui a
       été choisi. -->
  <select
    v-else-if="point.type === 'liste'" class="cfi cse"
    :value="saisie.valeurTexte" :disabled="lectureSeule"
    @change="saisie.valeurTexte = $event.target.value"
  >
    <option value="">— à renseigner —</option>
    <option v-for="o in point.options ?? []" :key="o" :value="o">{{ o }}</option>
    <!-- Une valeur enregistrée puis retirée de la liste doit rester lisible :
         le dossier a été rempli avec, l'effacer réécrirait l'historique. -->
    <option v-if="saisie.valeurTexte && !(point.options ?? []).includes(saisie.valeurTexte)"
            :value="saisie.valeurTexte">{{ saisie.valeurTexte }} (retirée de la liste)</option>
  </select>

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

  <!-- Emplacement de stockage.
       Un choix dans le référentiel, jamais du texte libre : « A3 »,
       « étage A n°3 » et « A-03 » désignaient la même cassette sans que rien
       ne les rapproche — et rien n'empêchait deux réceptions de prendre la
       même. Choisir ici RÉSERVE la place, dès la saisie.

       La liste affichée n'est qu'un instantané : c'est la base qui arbitre, et
       son refus revient sous les yeux de l'opérateur avec la seule réaction
       utile — en choisir une autre. -->
  <div v-else-if="point.type === 'emplacement'" class="cemp">
    <!-- `v-model` et non `:value` : sur un `<select>`, une liaison manuelle
         posée dans la même passe de rendu que ses `<option>` ne prend pas — le
         DOM refuse une valeur dont l'option n'existe pas encore, et le menu
         restait vide alors que la donnée était là. `v-model` applique la
         valeur après le rendu des options, c'est tout son intérêt ici. -->
    <select class="cfi cse" v-model="contenantChoisi" :disabled="lectureSeule"
            @change="changerContenant()">
      <option value="">— cuve —</option>
      <option v-for="c in stockage.contenantsActifs" :key="c.id" :value="c.id">
        {{ c.libelle }} ({{ c.nbLibres }} libre{{ c.nbLibres > 1 ? 's' : '' }})
      </option>
    </select>
    <select class="cfi cse" v-model="saisie.valeurTexte"
            :disabled="lectureSeule || !contenantChoisi">
      <option value="">— place —</option>
      <option v-for="e in places" :key="e.id" :value="e.id">{{ e.libelle }}</option>
    </select>
    <!-- Le refus de la base, dit comme il doit l'être. -->
    <div v-if="refusPlace" class="cemp-refus">{{ refusPlace }}</div>
    <div v-else-if="placePerdue" class="cemp-refus">
      La place enregistrée n'est plus tenue par ce dossier — réservation expirée
      ou libérée. En choisir une autre.
    </div>
    <div v-else-if="placeTenue" class="cemp-ok" :title="detailOccupation">
      ⬛ {{ placeTenue }}
    </div>
  </div>

  <!-- Automatique : renseigné par le système à la validation -->
  <span v-else style="font-size:10px;color:#777;font-style:italic;">
    {{ point.valeurAuto ?? 'Automatique' }}
  </span>
</template>
