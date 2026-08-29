<script setup>
/**
 * Prise de vue par la caméra du poste.
 *
 * Un point de contrôle photographique se relève avec ce qu'on a sous la main :
 * une webcam sur le poste de la ZAC, une caméra de tablette à la cuve. Passer
 * par un fichier suppose de photographier, transférer, retrouver — trois
 * gestes de trop, et autant d'occasions de rattacher le mauvais cliché.
 *
 * `getUserMedia` exige un contexte sécurisé : HTTPS, ou localhost. Sur une
 * instance servie en clair, l'API n'existe tout simplement pas dans le
 * navigateur — le composant le dit plutôt que d'échouer sans raison visible.
 */
import { onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps({ ouvert: { type: Boolean, required: true } })
const emit = defineEmits(['fermer', 'capturer'])

const video = ref(null)
const flux = ref(null)
const erreur = ref('')
const cameras = ref([])
const cameraChoisie = ref('')
const occupe = ref(false)

/** Côté long maximal de l'image envoyée. */
const COTE_MAX = 1600

function arreter () {
  if (flux.value) {
    flux.value.getTracks().forEach((t) => t.stop())
    flux.value = null
  }
}

async function listerCameras () {
  /* L'énumération ne nomme les périphériques qu'une fois l'autorisation
     accordée : on la fait donc APRÈS avoir ouvert un premier flux, sinon la
     liste ne contient que des entrées anonymes. */
  try {
    const tous = await navigator.mediaDevices.enumerateDevices()
    cameras.value = tous.filter((d) => d.kind === 'videoinput')
  } catch { cameras.value = [] }
}

async function demarrer () {
  erreur.value = ''
  arreter()
  if (!navigator.mediaDevices?.getUserMedia) {
    erreur.value = "Ce navigateur n'expose pas la caméra. L'accès exige une " +
      'connexion sécurisée (HTTPS) — en clair, l\'API n\'est pas disponible. ' +
      'Le choix d\'un fichier reste possible.'
    return
  }
  try {
    /* `environment` demande la caméra arrière sur une tablette et n'a aucun
       effet sur un poste fixe, où il n'y en a qu'une. */
    const contraintes = cameraChoisie.value
      ? { video: { deviceId: { exact: cameraChoisie.value } } }
      : { video: { facingMode: 'environment', width: { ideal: 1920 } } }
    flux.value = await navigator.mediaDevices.getUserMedia(contraintes)
    if (video.value) {
      video.value.srcObject = flux.value
      await video.value.play().catch(() => {})
    }
    await listerCameras()
  } catch (e) {
    erreur.value = e.name === 'NotAllowedError'
      ? "Accès à la caméra refusé. L'autoriser dans le navigateur, puis rouvrir."
      : e.name === 'NotFoundError'
        ? 'Aucune caméra détectée sur ce poste.'
        : `Caméra indisponible : ${e.message}`
  }
}

/** Capture l'image affichée, réduite, et la remonte en base64. */
function prendre () {
  const v = video.value
  if (!v || !v.videoWidth) return
  occupe.value = true
  const echelle = Math.min(1, COTE_MAX / Math.max(v.videoWidth, v.videoHeight))
  const toile = document.createElement('canvas')
  toile.width = Math.round(v.videoWidth * echelle)
  toile.height = Math.round(v.videoHeight * echelle)
  toile.getContext('2d').drawImage(v, 0, 0, toile.width, toile.height)
  /* JPEG plutôt que PNG : une photo de conteneur en PNG pèse dix fois plus
     pour un rendu identique, et c'est la base qui la porte. */
  const url = toile.toDataURL('image/jpeg', 0.85)
  occupe.value = false
  emit('capturer', {
    octets: url.slice(url.indexOf(',') + 1),
    mime: 'image/jpeg',
    nomFichier: `capture-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
  })
}

watch(() => props.ouvert, (o) => { if (o) demarrer(); else arreter() })
watch(cameraChoisie, () => { if (props.ouvert) demarrer() })
onBeforeUnmount(arreter)
</script>

<template>
  <div v-if="ouvert" class="cmodal-ov show" @click.self="emit('fermer')">
    <div class="cmodal cam-modal">
      <div class="cmodal-hd">
        <span>Prendre une photo</span>
        <span style="cursor:pointer" @click="emit('fermer')">✕</span>
      </div>
      <div class="cmodal-bd">
        <div v-if="erreur" class="adm-msg adm-msg-ko">{{ erreur }}</div>
        <video v-show="!erreur" ref="video" class="cam-v" playsinline muted></video>
        <div v-if="cameras.length > 1" class="cam-sel">
          <label for="cam-d">Caméra</label>
          <select id="cam-d" v-model="cameraChoisie">
            <option v-for="(c, i) in cameras" :key="c.deviceId" :value="c.deviceId">
              {{ c.label || `Caméra ${i + 1}` }}
            </option>
          </select>
        </div>
      </div>
      <div class="cmodal-ft">
        <button class="adm-b" @click="emit('fermer')">Annuler</button>
        <button class="adm-b adm-b-p" :disabled="!!erreur || occupe" @click="prendre">
          ◉ Prendre la photo
        </button>
      </div>
    </div>
  </div>
</template>
