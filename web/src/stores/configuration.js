import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { appel, messageErreur } from '../api.js'

/**
 * Onglet Configuration : le modèle de parcours et ses points de contrôle.
 *
 * Une seule règle gouverne tout ce fichier : **on ne modifie pas un modèle, on
 * en publie une nouvelle version.** L'édition se fait donc sur un BROUILLON
 * local — une copie profonde de la version active — et « Publier » crée
 * `version + 1` côté serveur.
 *
 * Ce n'est pas de la prudence excessive. `dossier_processus.definition` porte
 * une copie figée de la définition à la création du dossier : modifier le
 * modèle en place ne toucherait de toute façon pas aux dossiers ouverts, mais
 * ferait perdre la trace de ce qui a été appliqué à quel dossier. Or ce qui a
 * été contrôlé doit rester relisible tel qu'il a été prescrit au moment du
 * contrôle.
 */
/* Le code n'est plus figé : l'établissement suit plusieurs parcours — CAR-T
   autologue, allogénique, thérapie génique, MTI préparé ponctuellement — et
   chacun a ses processus. Le code par défaut n'est qu'un point de départ. */
const CODE_DEFAUT = 'PARCOURS_CART_AUTOLOGUE'

/** Types de points, alignés sur l'enum `mti.type_point`. */
export const TYPES_POINT = [
  ['ouinon', 'Oui / Non'],
  ['valeur', 'Valeur (°C, numération…)'],
  ['texte', 'Texte libre'],
  ['date', 'Date'],
  ['photo', 'Photo'],
  ['timer', 'Minuteur'],
  ['auto', 'Automatique (à la validation)']
]

const copie = (x) => JSON.parse(JSON.stringify(x))

/* Le brouillon survit à un rechargement.
   Éditer un parcours de quinze processus prend du temps ; le brouillon ne
   vivait qu'en mémoire, si bien qu'un rechargement, un onglet fermé par
   mégarde ou une session expirée effaçaient tout le travail sans un mot. Il
   est donc recopié dans le stockage local à chaque modification.
   Ce n'est PAS une sauvegarde : rien n'est publié tant qu'on n'a pas cliqué
   « Publier », et le brouillon reste propre au poste. C'est un filet. */
const CLE_BROUILLON = 'mti.configuration.brouillon'

function lireBrouillonLocal () {
  try {
    const brut = localStorage.getItem(CLE_BROUILLON)
    return brut ? JSON.parse(brut) : null
  } catch { return null }
}

function ecrireBrouillonLocal (valeur) {
  try {
    if (valeur) localStorage.setItem(CLE_BROUILLON, JSON.stringify(valeur))
    else localStorage.removeItem(CLE_BROUILLON)
  } catch { /* navigation privée, quota atteint : on continue sans filet */ }
}

/**
 * Un point est-il « lié au médicament » ?
 *
 * C'est la coche qui commande l'affichage de la section « Exemplaires et
 * identification » : un point qui porte sur le dossier ou sur le local n'a ni
 * exemplaires, ni n° de série, ni kit, et la section n'avait rien à faire là.
 *
 * La valeur est DÉDUITE quand la coche est absente, plutôt qu'imposée : les
 * parcours déjà publiés ne la portent pas, et exiger le drapeau ferait perdre
 * leurs exemplaires au premier republiement. Un point qui compte des
 * exemplaires, porte un n° de série ou appartient à un kit est lié au
 * médicament, qu'on l'ait écrit ou non.
 */
export function lieAuMedicament (pt) {
  if (typeof pt?.lieAuMedicament === 'boolean') return pt.lieAuMedicament
  return Number(pt?.exemplaires) > 1 || Boolean(pt?.multi) ||
         pt?.numeroSerie === true || Boolean(pt?.kit)
}

export const useConfiguration = defineStore('configuration', () => {
  /** Parcours en cours d'édition, et liste des parcours disponibles. */
  const code = ref(CODE_DEFAUT)
  const parcoursDisponibles = ref([])

  /** Brouillon éditable — jamais la version active elle-même. */
  const brouillon = ref(null)
  const versionBase = ref(null)
  const versions = ref([])
  const chargement = ref(false)
  const erreur = ref('')
  const message = ref('')
  const indisponible = ref(false)

  const iProcessus = ref(0)
  const iSection = ref(0)
  const iPoint = ref(0)

  const processus = computed(() => brouillon.value?.processus ?? [])
  const processusCourant = computed(() => processus.value[iProcessus.value] ?? null)
  const sectionCourante = computed(() =>
    processusCourant.value?.sections?.[iSection.value] ?? null)
  const pointCourant = computed(() =>
    sectionCourante.value?.points?.[iPoint.value] ?? null)

  /* Tous les points du parcours, à plat et groupés par processus : c'est la
     liste de l'onglet « Point de contrôle », où l'on cherche un point sans
     savoir dans quel processus il se trouve. La position complète est portée
     par chaque entrée — un point ne se désigne pas par son rang seul. */
  const tousLesPoints = computed(() => {
    const liste = []
    processus.value.forEach((p, iP) => {
      (p.sections ?? []).forEach((sc, iS) => {
        (sc.points ?? []).forEach((pt, iPt) => {
          liste.push({ iP, iS, iPt, processus: p, section: sc, point: pt })
        })
      })
    })
    return liste
  })

  /** Sélectionne un point où qu'il soit dans le parcours. */
  function choisirPointAbsolu (e) {
    iProcessus.value = e.iP; iSection.value = e.iS; iPoint.value = e.iPt
  }

  /* Nombre de dossiers ouverts sous la version active : c'est ce qui dit à
     l'utilisateur ce que publier ne changera PAS. Sans ce chiffre, « publier »
     a l'air d'une modification rétroactive. */
  const versionActive = computed(() => versions.value.find((v) => v.actif) ?? null)

  /** Vrai dès que le brouillon diffère de la version dont il est issu. */
  const modifie = ref(false)
  /** Vrai quand le brouillon a été repris du stockage local, pas du serveur. */
  const restaure = ref(false)

  /* L'écriture est différée : `marquer()` part à chaque frappe dans un champ,
     et sérialiser quinze processus à chaque caractère ferait ramer la saisie
     pour rien. Une seconde d'inactivité suffit à ne rien perdre. */
  let minuteurEcriture = null
  function memoriser () {
    clearTimeout(minuteurEcriture)
    minuteurEcriture = setTimeout(() => {
      if (modifie.value && brouillon.value) {
        ecrireBrouillonLocal({
          code: code.value, versionBase: versionBase.value, brouillon: brouillon.value
        })
      }
    }, 800)
  }

  const marquer = () => { modifie.value = true; message.value = ''; memoriser() }

  /** Oublie le filet : après une publication, ou un abandon délibéré. */
  function oublierBrouillonLocal () {
    clearTimeout(minuteurEcriture)
    ecrireBrouillonLocal(null)
    restaure.value = false
  }

  /**
   * Charge la version en service et en fait un brouillon.
   *
   * `garderBrouillon` protège un travail en cours : le panneau est démonté à
   * chaque changement d'onglet, et son `onMounted` rappelait cette fonction —
   * revenir au tableau de bord une seconde effaçait donc silencieusement une
   * demi-heure d'édition. Un brouillon modifié n'est plus écrasé ; seul un
   * abandon explicite, une publication ou un changement de parcours le remplace.
   */
  async function charger ({ garderBrouillon = false } = {}) {
    if (garderBrouillon && modifie.value && brouillon.value) return
    chargement.value = true
    erreur.value = ''
    try {
      /* La liste des parcours est relue à chaque fois : publier une version
         change le nombre de processus affiché dans le sélecteur, et une liste
         mise en cache le ferait mentir. */
      const rL = await appel('/api/modeles')
      if (rL.ok) {
        parcoursDisponibles.value = await rL.json()
        // Le code par défaut peut ne pas exister sur une base donnée : on se
        // rabat sur le premier plutôt que d'afficher un écran vide.
        if (!parcoursDisponibles.value.some((m) => m.code === code.value)) {
          code.value = parcoursDisponibles.value[0]?.code ?? CODE_DEFAUT
        }
      }
      const [rM, rV] = await Promise.all([
        appel(`/api/modeles/${code.value}`),
        appel(`/api/modeles/${code.value}/versions`)
      ])
      if (!rM.ok) throw new Error(await messageErreur(rM, `Modèle illisible (${rM.status}).`))
      if (!rV.ok) throw new Error(await messageErreur(rV, `Versions illisibles (${rV.status}).`))
      const m = await rM.json()
      versions.value = await rV.json()
      versionBase.value = m.version
      brouillon.value = copie(m)
      modifie.value = false
      restaure.value = false
      indisponible.value = false
      iProcessus.value = 0; iSection.value = 0; iPoint.value = 0

      /* Reprise du filet, si et seulement s'il porte sur CE parcours et sur la
         version qui est toujours en service. Un brouillon bâti sur une version
         que quelqu'un d'autre a depuis remplacée ne se rejoue pas : le publier
         écraserait ses modifications sans que personne l'ait voulu. Dans ce
         cas on l'écarte, en le disant. */
      const filet = lireBrouillonLocal()
      if (filet && filet.code === code.value) {
        if (filet.versionBase === versionBase.value) {
          brouillon.value = filet.brouillon
          modifie.value = true
          restaure.value = true
        } else {
          oublierBrouillonLocal()
          message.value = `Un brouillon non publié a été écarté : il partait de la ` +
            `version ${filet.versionBase}, or la version ${versionBase.value} est ` +
            'entre-temps en service. Le republier aurait effacé ce qu\'elle apporte.'
        }
      }
    } catch (e) {
      indisponible.value = true
      erreur.value = e.message || 'API injoignable.'
      brouillon.value = null
    } finally {
      chargement.value = false
    }
  }

  function choisirProcessus (i) {
    iProcessus.value = i; iSection.value = 0; iPoint.value = 0
  }
  function choisirPoint (iS, iP) { iSection.value = iS; iPoint.value = iP }

  // ── Processus ─────────────────────────────────────────────────────────────

  function ajouterProcessus () {
    const n = processus.value.length + 1
    processus.value.push({
      code: `NOUVEAU_${n}`,
      nom: `Nouveau processus ${n}`,
      gabarit: 'standard',
      externe: false,
      sections: [{
        titre: 'Section 1',
        kits: [],
        points: [{ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false }]
      }]
    })
    choisirProcessus(processus.value.length - 1)
    marquer()
  }

  function retirerProcessus (i) {
    if (processus.value.length <= 1) return
    processus.value.splice(i, 1)
    choisirProcessus(Math.min(i, processus.value.length - 1))
    marquer()
  }

  function deplacerProcessus (i, sens) {
    const j = i + sens
    if (j < 0 || j >= processus.value.length) return
    const [p] = processus.value.splice(i, 1)
    processus.value.splice(j, 0, p)
    choisirProcessus(j)
    marquer()
  }

  // ── Sections, kits et points ──────────────────────────────────────────────

  function ajouterSection () {
    const p = processusCourant.value
    if (!p) return
    p.sections.push({
      titre: `Section ${p.sections.length + 1}`,
      kits: [],
      points: [{ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false }]
    })
    choisirPoint(p.sections.length - 1, 0)
    marquer()
  }

  function retirerSection (iS) {
    const p = processusCourant.value
    if (!p || p.sections.length <= 1) return
    p.sections.splice(iS, 1)
    choisirPoint(Math.min(iS, p.sections.length - 1), 0)
    marquer()
  }

  function ajouterPoint (iS) {
    const sc = processusCourant.value?.sections?.[iS]
    if (!sc) return
    sc.points.push({ libelle: 'Nouveau point de contrôle', type: 'ouinon', obligatoire: false })
    choisirPoint(iS, sc.points.length - 1)
    marquer()
  }

  function retirerPoint (iS, iP) {
    const sc = processusCourant.value?.sections?.[iS]
    if (!sc || sc.points.length <= 1) return
    sc.points.splice(iP, 1)
    choisirPoint(iS, Math.min(iP, sc.points.length - 1))
    marquer()
  }

  /**
   * Retire le point actuellement ouvert, où qu'il soit.
   *
   * `retirerPoint` refuse de vider une section — une section sans point n'est
   * pas publiable. Depuis l'onglet « Point de contrôle » on ne voit pourtant
   * pas les sections, et un refus muet passerait pour un bouton cassé. Ici, on
   * emporte donc la section devenue vide, et on ne refuse que le dernier point
   * du dernier processus : là, il ne resterait plus rien à publier.
   *
   * Retourne un message quand le retrait n'a pas eu lieu, sinon une chaîne vide.
   */
  function retirerPointCourant () {
    const p = processusCourant.value
    const sc = sectionCourante.value
    if (!p || !sc) return 'Aucun point sélectionné.'
    if (sc.points.length > 1) {
      sc.points.splice(iPoint.value, 1)
      iPoint.value = Math.min(iPoint.value, sc.points.length - 1)
      marquer()
      return ''
    }
    if (p.sections.length > 1) {
      p.sections.splice(iSection.value, 1)
      iSection.value = Math.min(iSection.value, p.sections.length - 1)
      iPoint.value = 0
      marquer()
      return ''
    }
    if (processus.value.length > 1) {
      const i = iProcessus.value
      processus.value.splice(i, 1)
      choisirProcessus(Math.min(i, processus.value.length - 1))
      marquer()
      return ''
    }
    return 'C\'est le dernier point du parcours : un parcours sans point ne se ' +
      'publie pas. Ajouter un autre point avant de retirer celui-ci.'
  }

  /**
   * Change une propriété du point courant, en tenant les dépendances.
   *
   * Ces règles sont les mêmes que celles du serveur, appliquées ici pour que
   * l'écran n'autorise pas une combinaison qu'il refusera à la publication :
   * un seuil n'a de sens que sur un relevé de valeur, un n° de série suppose
   * plusieurs exemplaires.
   */
  function poser (champ, valeur) {
    const pt = pointCourant.value
    if (!pt) return
    pt[champ] = valeur
    if (champ === 'type' && valeur !== 'valeur') delete pt.seuil
    if (champ === 'exemplaires') {
      const n = Number(valeur)
      if (!Number.isInteger(n) || n < 2) { delete pt.exemplaires; pt.numeroSerie = false }
      else pt.exemplaires = n
    }
    if (champ === 'numeroSerie' && valeur && !(Number(pt.exemplaires) > 1 || pt.multi)) {
      pt.exemplaires = 2
    }
    /* Décocher « lié au médicament » ne se contente pas de masquer la section :
       il efface ce qu'elle portait. Laisser un `exemplaires: 3` invisible
       produirait trois lignes à l'écran de saisie sans que rien, dans la
       configuration, ne l'explique. */
    if (champ === 'lieAuMedicament' && !valeur) {
      delete pt.exemplaires
      delete pt.multi
      delete pt.kit
      pt.numeroSerie = false
    }
    marquer()
  }

  function ajouterKit () {
    const sc = sectionCourante.value
    if (!sc) return
    sc.kits = sc.kits ?? []
    const n = sc.kits.length + 1
    sc.kits.push({ id: `KIT_${n}`, nom: `Kit ${n}`, composition: '' })
    marquer()
  }

  function retirerKit (i) {
    const sc = sectionCourante.value
    if (!sc?.kits) return
    const [k] = sc.kits.splice(i, 1)
    // Un point rattaché à un kit disparu porterait une référence morte, que le
    // serveur refuserait à la publication.
    for (const pt of sc.points ?? []) if (pt.kit === k?.id) delete pt.kit
    marquer()
  }

  // ── Publication ───────────────────────────────────────────────────────────

  /**
   * Publie le brouillon comme version suivante, et la rend active.
   *
   * Le `code` du brouillon est écarté sous un AUTRE nom que `code` : le
   * déstructurer tel quel masquait la ref du store dans toute la fonction, si
   * bien que `code.value` — appliqué à une chaîne — valait `undefined`, et que
   * la requête partait vers `/api/modeles/undefined/versions`. La publication
   * n'a jamais abouti, et l'utilisateur lisait « Aucun modèle pour le code
   * undefined », message qui ne désigne rien de ce qu'il a sous les yeux.
   */
  async function publier () {
    if (!brouillon.value) return false
    erreur.value = ''
    message.value = ''
    const { code: _code, version, actif, ...definition } = brouillon.value
    const r = await appel(`/api/modeles/${code.value}/versions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ definition })
    })
    if (!r.ok) {
      erreur.value = await messageErreur(r, `Publication refusée (${r.status}).`)
      return false
    }
    const publie = await r.json()
    oublierBrouillonLocal()
    await charger()
    /* Le message est posé APRÈS le rechargement : `charger()` remet
       `message` à zéro, et l'utilisateur n'aurait rien vu de la publication
       qu'il vient de déclencher. */
    message.value = `Version ${publie.version} publiée et mise en service. ` +
      'Les dossiers déjà ouverts conservent leur définition figée.'
    return true
  }

  /**
   * Crée un parcours : un code nouveau, en version 1.
   *
   * `source` désigne le parcours à reprendre, `processusCodes` ceux qu'on en
   * garde, dans l'ordre voulu. Reprendre puis amputer est le geste réel : on
   * part rarement d'une page blanche, on part d'un parcours voisin.
   */
  async function creerParcours ({ nouveauCode, libelle, source, processusCodes }) {
    erreur.value = ''
    message.value = ''
    const corps = { code: nouveauCode, libelle }
    if (source) {
      corps.sourceCode = source
      if (Array.isArray(processusCodes)) corps.processusCodes = processusCodes
    } else {
      /* Un parcours vide n'existe pas côté base : la définition doit porter au
         moins un processus et un point. On amorce donc le minimum publiable,
         que l'utilisateur renommera. */
      corps.definition = {
        processus: [{
          code: 'ETAPE_1',
          nom: 'Première étape',
          gabarit: 'standard',
          externe: false,
          sections: [{
            titre: 'Section 1',
            kits: [],
            points: [{ libelle: 'Premier point de contrôle', type: 'ouinon', obligatoire: false }]
          }]
        }]
      }
    }
    const r = await appel('/api/modeles', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corps)
    })
    if (!r.ok) {
      erreur.value = await messageErreur(r, `Création refusée (${r.status}).`)
      return false
    }
    const cree = await r.json()
    /* Le brouillon en cours porte sur un AUTRE parcours : le garder ferait
       publier ses processus sous le nouveau code. */
    oublierBrouillonLocal()
    modifie.value = false
    code.value = cree.code
    await charger()
    message.value = `Parcours « ${cree.libelle} » créé (${cree.nbProcessus} processus) ` +
      'et ouvert en édition. Adapter les processus et les points, puis publier.'
    return true
  }

  /** Abandonne le brouillon et repart de la version active. */
  async function annuler () {
    oublierBrouillonLocal()
    await charger()
  }

  /** Change de parcours. Le brouillon en cours est abandonné : le garder d'un
   *  parcours à l'autre publierait les processus de l'un sous le code de
   *  l'autre. */
  async function choisirParcours (nouveau) {
    if (nouveau === code.value) return
    oublierBrouillonLocal()
    code.value = nouveau
    await charger()
  }

  return {
    code, parcoursDisponibles, choisirParcours,
    brouillon, versionBase, versions, versionActive, chargement, erreur, message,
    indisponible, modifie, restaure,
    iProcessus, iSection, iPoint,
    processus, processusCourant, sectionCourante, pointCourant,
    tousLesPoints, choisirPointAbsolu,
    charger, choisirProcessus, choisirPoint, marquer,
    ajouterProcessus, retirerProcessus, deplacerProcessus,
    ajouterSection, retirerSection, ajouterPoint, retirerPoint,
    poser, ajouterKit, retirerKit, retirerPointCourant,
    publier, annuler, creerParcours
  }
})
