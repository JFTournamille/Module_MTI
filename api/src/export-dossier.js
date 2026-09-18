import { DocumentPdf, A4, largeurTexte, tronquer } from './pdf.js'

/**
 * Mise en forme du dossier de traçabilité, en PDF et en tableur.
 *
 * DOCUMENT RÉGLEMENTAIRE — décision du 18 septembre. En-tête d'établissement,
 * pagination, signatures, et mention « document non validé » en filigrane tant
 * que le dossier ne l'est pas. Un seul gabarit couvre les deux usages : on peut
 * éditer à tout moment, et le document DIT LUI-MÊME s'il fait foi.
 *
 * TOLÉRANT AUX INFORMATIONS PARTIELLES, et c'est la contrainte structurante :
 * un export n'est pas une validation. Il n'exige rien, ne bloque rien, et
 * **dit ce qui manque plutôt que de le taire**. Une case laissée vide sans
 * mention ferait croire à un contrôle non fait, alors qu'il s'agit d'un
 * contrôle non exporté — c'est la différence entre un dossier incomplet et un
 * dossier falsifié.
 *
 * LES SIGNATURES SONT CELLES QUE LA BASE CONNAÎT : l'auteur et la date de
 * chaque saisie, l'auteur et la date de la validation. Un champ de signature
 * libre ne prouverait rien.
 */

const MARGE = 34
const HAUT = A4.hauteur - MARGE
const BAS = MARGE + 26
const LARGEUR_UTILE = A4.largeur - 2 * MARGE

/** Colonnes du tableau des points, en fraction de la largeur utile. */
const COLONNES = [
  { cle: 'num', titre: 'N°', part: 0.05 },
  { cle: 'libelle', titre: 'Point de contrôle', part: 0.37 },
  { cle: 'unite', titre: 'Unité', part: 0.07 },
  { cle: 'valeur', titre: 'Relevé', part: 0.22 },
  { cle: 'horodatage', titre: 'Date et heure', part: 0.14 },
  { cle: 'operateur', titre: 'Opérateur', part: 0.15 }
]

const dateFr = (v) => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('fr-FR')
}

const dateHeureFr = (v) => {
  if (!v) return ''
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime())
    ? String(v)
    : `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', {
        hour: '2-digit', minute: '2-digit'
      })}`
}

/**
 * Valeur lisible d'une saisie, ou la mention de ce qui manque.
 *
 * « — non renseigné — » et non une case vide : c'est toute la différence entre
 * un contrôle non fait et un contrôle non exporté, et c'est au document de la
 * dire. La mention distingue en outre l'obligatoire du facultatif — sans quoi
 * un dossier de travail paraîtrait criblé de manques.
 */
export function valeurLisible (point, saisie, pieces = []) {
  const type = point?.type ?? saisie?.point_type
  if (!saisie) {
    return point?.obligatoire === true
      ? '— non renseigné (obligatoire) —'
      : '— non renseigné —'
  }
  const vide = () => (saisie.obligatoire === true
    ? '— non renseigné (obligatoire) —'
    : '— non renseigné —')

  switch (type) {
    case 'ouinon':
      return saisie.reponse ? (saisie.reponse === 'oui' ? 'Oui' : 'Non') : vide()
    case 'valeur': {
      if (saisie.valeur_num === null || saisie.valeur_num === undefined) return vide()
      const n = Number(saisie.valeur_num)
      /* Le hors-seuil est FIGÉ en base à la saisie : le document rapporte ce
         qui faisait foi au moment du contrôle, jamais un recalcul d'aujourd'hui
         sur un seuil qui aurait changé depuis. */
      return saisie.hors_seuil
        ? `${n} — HORS SEUIL (seuil ${saisie.seuil_applique ?? '?'})`
        : String(n)
    }
    case 'timer': {
      if (!saisie.timer_debut) return vide()
      const fin = saisie.timer_fin
        ? dateHeureFr(saisie.timer_fin)
        : 'en cours au moment de l\'export'
      return `de ${dateHeureFr(saisie.timer_debut)} à ${fin}`
    }
    case 'photo':
    case 'fichier': {
      const n = pieces.length
      if (!n) return vide()
      return `${n} pièce(s) : ${pieces.map((p) => p.nom_fichier ?? p.libelle ?? 'pièce').join(', ')}`
    }
    case 'date':
      return saisie.valeur_texte ? dateFr(saisie.valeur_texte) : vide()
    case 'emplacement':
      /* La place est résolue par l'appelant, qui a la jointure. À défaut, on
         n'imprime PAS l'identifiant technique : il n'apprendrait rien à un
         lecteur et donnerait l'illusion d'une information. */
      return saisie.emplacement_libelle ?? (saisie.valeur_texte ? '— place inconnue —' : vide())
    case 'auto':
      return saisie.valeur_texte || 'Renseigné par le système'
    default:
      return saisie.valeur_texte || vide()
  }
}

/** Mentions que le document doit porter en filigrane, dans l'ordre. */
export function mentionsDuDossier (dossier) {
  const m = []
  /* NON VALIDÉ d'abord : c'est la mention qui dit si le document fait foi, et
     elle prime sur tout le reste. */
  if (dossier.statut !== 'valide') m.push('DOCUMENT NON VALIDÉ')
  /* Un parcours arrêté en chemin doit le dire au même titre : sortir un PDF
     d'apparence ordinaire d'un dossier clos serait exactement l'erreur que la
     distinction « validé / clos » a servi à corriger. */
  if (dossier.statut === 'annule') m.push('PARCOURS CLOS')
  if (dossier.quarantaine === true) m.push('EN QUARANTAINE')
  return m
}

/**
 * Construit le PDF du dossier.
 *
 * @param {object} d Ce que la route a rassemblé : dossier, patient, processus,
 *   saisies, pièces, alertes, et le contexte d'édition.
 */
export function pdfDuDossier (d) {
  const {
    dossier, patient, processus, saisies, pieces, alertes = [],
    etablissement, genereLe, generePar
  } = d

  const doc = new DocumentPdf({
    titre: `Dossier de traçabilité MTI ${dossier.reference}`,
    sujet: 'Traçabilité d\'un médicament de thérapie innovante',
    auteur: etablissement,
    date: genereLe
  })

  const mentions = mentionsDuDossier(dossier)
  let y = 0

  /** Ouvre une page et y pose l'en-tête. Retourne l'ordonnée courante. */
  const ouvrirPage = (premiere = false) => {
    if (!premiere) doc.nouvellePage()
    for (const [i, m] of mentions.entries()) {
      doc.filigrane(m, { taille: 44 - i * 8, gris: 0.88 + i * 0.02 })
    }
    let yy = HAUT
    doc.texte(MARGE, yy, etablissement, { taille: 8.5, police: 'F2', gris: 0.3 })
    doc.texteDroite(A4.largeur - MARGE, yy,
      `Édité le ${dateHeureFr(genereLe)} par ${generePar}`, { taille: 7.5, gris: 0.45 })
    yy -= 16
    doc.texte(MARGE, yy, `Dossier de traçabilité MTI — ${dossier.reference}`,
      { taille: 14, police: 'F2' })
    yy -= 5
    doc.ligne(MARGE, yy, A4.largeur - MARGE, yy, { epaisseur: 1, gris: 0.35 })
    return yy - 16
  }

  y = ouvrirPage(true)

  /** Réserve `hauteur` points ; passe à la page suivante si besoin. */
  const place = (hauteur) => {
    if (y - hauteur < BAS) y = ouvrirPage()
    return y
  }

  // ── En-tête du dossier ────────────────────────────────────────────────────
  const champs = [
    ['Produit', dossier.designation_produit || '— non renseigné —'],
    ['N° de lot', dossier.numero_lot || '— non renseigné —'],
    ['Péremption', dossier.date_peremption ? dateFr(dossier.date_peremption) : '— non renseignée —'],
    ['N° d\'ordonnancier', dossier.numero_ordonnancier || '— non renseigné —'],
    /* LE PATIENT N'APPARAÎT QUE S'IL EXISTE. Le parcours est anonyme par
       défaut : imprimer « aucun patient » sur un dossier en attente
       d'allocation serait exact, mais imprimer un emplacement vide prêt à
       recevoir une identité ne l'est pas. */
    ['Patient', patient
      ? [patient.reference, patient.nom].filter(Boolean).join(' — ')
      : 'Parcours anonyme — aucun patient rattaché'],
    ['Statut', libelleStatut(dossier)],
    ['Conformité', libelleConformite(dossier)]
  ]

  for (const [etiquette, valeur] of champs) {
    place(13)
    doc.texte(MARGE, y, `${etiquette} :`, { taille: 8.5, police: 'F2', gris: 0.25 })
    doc.texte(MARGE + 105, y, String(valeur), { taille: 8.5 })
    y -= 13
  }
  y -= 6

  // ── Ce qui reste incertain : dit, jamais tu ───────────────────────────────
  if (alertes.length) {
    place(16 + alertes.length * 11)
    doc.rectangle(MARGE, y - 3 - alertes.length * 11, LARGEUR_UTILE,
      14 + alertes.length * 11, { gris: 0.95 })
    doc.texte(MARGE + 5, y, `Incohérences de dates signalées (${alertes.length})`,
      { taille: 8.5, police: 'F2', gris: 0.2 })
    y -= 12
    for (const a of alertes) {
      doc.texte(MARGE + 10, y,
        tronquer(a.message ?? a.libelle ?? '', LARGEUR_UTILE - 20, 7.5),
        { taille: 7.5, gris: 0.3 })
      y -= 11
    }
    y -= 8
  }

  // ── Les processus ─────────────────────────────────────────────────────────
  const largeurs = COLONNES.map((c) => c.part * LARGEUR_UTILE)
  const x0 = COLONNES.map((_, i) => MARGE + largeurs.slice(0, i).reduce((a, b) => a + b, 0))

  const enTeteTableau = () => {
    doc.rectangle(MARGE, y - 3, LARGEUR_UTILE, 13, { gris: 0.88 })
    COLONNES.forEach((c, i) => {
      doc.texte(x0[i] + 2, y, c.titre, { taille: 7.5, police: 'F2', gris: 0.2 })
    })
    y -= 15
  }

  const parProcessus = new Map()
  for (const s of saisies) {
    if (!parProcessus.has(s.dossier_processus_id)) parProcessus.set(s.dossier_processus_id, [])
    parProcessus.get(s.dossier_processus_id).push(s)
  }
  const piecesParSaisie = new Map()
  for (const p of pieces ?? []) {
    if (!piecesParSaisie.has(p.saisie_id)) piecesParSaisie.set(p.saisie_id, [])
    piecesParSaisie.get(p.saisie_id).push(p)
  }

  for (const proc of processus) {
    place(34)
    doc.rectangle(MARGE, y - 3, LARGEUR_UTILE, 15, { gris: 0.80 })
    doc.texte(MARGE + 4, y, `${proc.ordre}. ${proc.nom}`,
      { taille: 9.5, police: 'F2', gris: 0.15 })
    doc.texteDroite(A4.largeur - MARGE - 4, y, libelleEtat(proc),
      { taille: 8, police: 'F2', gris: 0.25 })
    y -= 19
    enTeteTableau()

    const lignes = lignesDuProcessus(proc, parProcessus.get(proc.id) ?? [], piecesParSaisie)
    if (!lignes.length) {
      doc.texte(MARGE + 4, y, 'Aucun point de contrôle défini pour ce processus.',
        { taille: 8, police: 'F3', gris: 0.45 })
      y -= 16
      continue
    }

    for (const l of lignes) {
      if (l.genre === 'section') {
        place(16)
        doc.texte(MARGE + 2, y, l.titre, { taille: 8, police: 'F2', gris: 0.35 })
        y -= 13
        continue
      }
      place(13)
      const cellules = [l.num, l.libelle, l.unite, l.valeur, l.horodatage, l.operateur]
      cellules.forEach((c, i) => {
        const texte = tronquer(c ?? '', largeurs[i] - 5, 7.5)
        doc.texte(x0[i] + 2, y, texte, {
          taille: 7.5,
          /* Un relevé hors seuil se lit d'abord : sur un document imprimé en
             noir et blanc, c'est la graisse qui le distingue, pas la couleur. */
          police: l.horsSeuil && i === 3 ? 'F2' : 'F1',
          gris: l.manquant && i === 3 ? 0.45 : 0
        })
      })
      doc.ligne(MARGE, y - 3, A4.largeur - MARGE, y - 3, { epaisseur: 0.25, gris: 0.85 })
      y -= 12
    }
    y -= 8
  }

  // ── Signatures ────────────────────────────────────────────────────────────
  place(60)
  y -= 6
  doc.ligne(MARGE, y, A4.largeur - MARGE, y, { epaisseur: 0.8, gris: 0.35 })
  y -= 14
  doc.texte(MARGE, y, 'Signatures', { taille: 9.5, police: 'F2' })
  y -= 14
  for (const l of signatures(d)) {
    place(12)
    doc.texte(MARGE + 4, y, l, { taille: 8 })
    y -= 12
  }

  // ── Pied de page, une fois le nombre de pages connu ───────────────────────
  const total = doc.nbPages
  doc.pages.forEach((page, i) => {
    doc.courante = page
    doc.ligne(MARGE, BAS - 6, A4.largeur - MARGE, BAS - 6, { epaisseur: 0.4, gris: 0.7 })
    doc.texte(MARGE, BAS - 16,
      `${dossier.reference} — ${mentions.length ? mentions.join(' · ') : 'Dossier validé'}`,
      { taille: 7, gris: 0.45 })
    doc.texteDroite(A4.largeur - MARGE, BAS - 16, `Page ${i + 1} sur ${total}`,
      { taille: 7, gris: 0.45 })
  })

  return doc.terminer()
}

function libelleStatut (dossier) {
  if (dossier.statut === 'valide') return 'Parcours validé'
  if (dossier.statut === 'annule') {
    return `Parcours clos — ${dossier.motif_cloture ?? 'motif non renseigné'}`
  }
  return 'Parcours en cours'
}

function libelleConformite (dossier) {
  if (!dossier.conformite) return 'Non conclue à ce jour'
  const base = dossier.conformite === 'conforme' ? 'Conforme' : 'Non conforme'
  /* Le caractère AUTOMATIQUE est dit : une conformité constatée par la machine
     et une conformité prononcée par un pharmacien n'ont pas la même portée, et
     le document ne doit pas les confondre. */
  return dossier.conformite_automatique
    ? `${base} — constatée automatiquement (toutes les coches vertes)`
    : `${base} — conclusion pharmaceutique`
}

function libelleEtat (proc) {
  return { valide: 'Validé', en_cours: 'En cours', a_venir: 'À venir', annule: 'Annulé' }[proc.etat] ??
    proc.etat
}

/** Lignes d'un processus : sections, puis points avec leurs relevés. */
function lignesDuProcessus (proc, saisiesDuProcessus, piecesParSaisie) {
  const index = new Map()
  for (const s of saisiesDuProcessus) {
    index.set(`${s.section_index}|${s.point_index}|${s.exemplaire}|${s.secours ? 's' : 'n'}`, s)
  }
  const lignes = []
  const sections = proc.definition?.sections ?? []
  sections.forEach((sec, iS) => {
    lignes.push({ genre: 'section', titre: sec.titre ?? `Section ${iS + 1}` })
    ;(sec.points ?? []).forEach((point, iP) => {
      /* Les relevés existants font foi sur le nombre d'exemplaires : la fiche a
         pu être remplie sous un compte différent de celui d'aujourd'hui, et
         c'est ce qui a été relevé qu'on exporte. */
      const presents = saisiesDuProcessus
        .filter((s) => s.section_index === iS && s.point_index === iP)
        .sort((a, b) => (a.secours === b.secours
          ? a.exemplaire - b.exemplaire
          : (a.secours ? 1 : -1)))
      const aExporter = presents.length
        ? presents
        : [null]
      for (const s of aExporter) {
        const marque = !s
          ? ''
          : (s.secours
              ? ` (secours ${s.exemplaire})`
              : (presents.filter((x) => !x.secours).length > 1 ? ` (${s.exemplaire})` : ''))
        const pieces = s ? (piecesParSaisie.get(s.id) ?? []) : []
        const valeur = valeurLisible(point, s, pieces)
        const manquant = valeur.startsWith('— non renseigné')
        lignes.push({
          genre: 'point',
          num: point.num ?? '',
          libelle: (point.libelle ?? '') + marque,
          unite: point.multi ? (point.multi === 'photo' ? 'photo' : 'cuve') : '',
          valeur,
          horsSeuil: s?.hors_seuil === true,
          manquant,
          /* UNE LIGNE SANS RELEVÉ NE PORTE NI DATE NI OPÉRATEUR. La base garde
             pourtant les deux : une ligne de saisie est créée dès qu'on
             effleure un point, et `saisi_le` date cette création. Les
             imprimer à côté de « non renseigné » ferait lire la ligne comme un
             relevé fait par quelqu'un, à une heure précise — alors que rien
             n'a été constaté. Sur une fiche de traçabilité, c'est la
             différence entre un blanc et un faux. */
          horodatage: s && !manquant ? dateHeureFr(s.horodatage ?? s.saisi_le) : '',
          operateur: manquant ? '' : (s?.operateur_libelle ?? '')
        })
      }
    })
  })
  return lignes
}

/** Les signatures que la base connaît, et rien d'autre. */
export function signatures (d) {
  const { dossier, generePar, genereLe } = d
  const lignes = []
  if (dossier.statut === 'valide') {
    lignes.push(`Parcours validé le ${dateHeureFr(dossier.valide_le)} ` +
      `par ${dossier.valide_par_libelle ?? 'opérateur non résolu'}.`)
    lignes.push(libelleConformite(dossier))
  } else if (dossier.statut === 'annule') {
    lignes.push(`Parcours clos le ${dateHeureFr(dossier.clos_le)} ` +
      `par ${dossier.clos_par_libelle ?? 'opérateur non résolu'}.`)
    lignes.push(`Motif : ${dossier.motif_cloture ?? 'non renseigné'}.`)
    /* Clore n'est pas valider : personne ne conclut sur la conformité d'un
       parcours inachevé, et le document ne doit pas le laisser croire. */
    lignes.push('Aucune conclusion de conformité : un parcours clos n\'est pas allé au bout.')
  } else {
    lignes.push('Parcours NON VALIDÉ à la date de cette édition : ce document ne fait pas foi.')
    lignes.push('Il rend compte de l\'état du dossier à l\'instant où il a été produit.')
  }
  if (dossier.quarantaine === true) {
    lignes.push(`Produit EN QUARANTAINE depuis le ${dateHeureFr(dossier.quarantaine_le)} — ` +
      `${dossier.quarantaine_motif ?? 'motif non renseigné'}.`)
  }
  lignes.push('')
  lignes.push(`Édition demandée par ${generePar}, le ${dateHeureFr(genereLe)}.`)
  return lignes
}

/**
 * Tableur du dossier, au format SpreadsheetML 2003.
 *
 * POURQUOI CE FORMAT. Un vrai `.xlsx` est une archive ZIP, qu'il faudrait
 * assembler à la main ou par une dépendance de plus. SpreadsheetML est du XML
 * simple, qu'Excel et LibreOffice ouvrent tous les deux, et qui a le mérite
 * d'être LISIBLE : un fichier de traçabilité qu'on peut relire dans un éditeur
 * de texte se vérifie sans outil. Le revers est connu et assumé : l'extension
 * est `.xls`, et Excel affiche un avertissement de format à l'ouverture sur
 * certaines configurations.
 */
export function tableurDuDossier (d) {
  const { dossier, patient, processus, saisies, pieces, genereLe, generePar, etablissement } = d

  const echapper = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    /* Les caractères de contrôle ne sont pas représentables en XML 1.0 : les
       laisser passer produirait un fichier qu'aucun tableur n'ouvre. */
    .replace(/[ --]/g, '')

  const cellule = (v, style = '') =>
    `<Cell${style ? ` ss:StyleID="${style}"` : ''}>` +
    `<Data ss:Type="String">${echapper(v)}</Data></Cell>`
  const ligne = (cellules) => `<Row>${cellules.join('')}</Row>`

  const piecesParSaisie = new Map()
  for (const p of pieces ?? []) {
    if (!piecesParSaisie.has(p.saisie_id)) piecesParSaisie.set(p.saisie_id, [])
    piecesParSaisie.get(p.saisie_id).push(p)
  }
  const parProcessus = new Map()
  for (const s of saisies) {
    if (!parProcessus.has(s.dossier_processus_id)) parProcessus.set(s.dossier_processus_id, [])
    parProcessus.get(s.dossier_processus_id).push(s)
  }

  const lignes = []
  lignes.push(ligne([cellule(`Dossier de traçabilité MTI — ${dossier.reference}`, 'titre')]))
  lignes.push(ligne([cellule(etablissement, 'sous')]))
  for (const m of mentionsDuDossier(dossier)) {
    lignes.push(ligne([cellule(m, 'mention')]))
  }
  lignes.push(ligne([cellule(`Édité le ${dateHeureFr(genereLe)} par ${generePar}`, 'sous')]))
  lignes.push(ligne([]))
  lignes.push(ligne([cellule('Produit', 'gras'), cellule(dossier.designation_produit || '— non renseigné —')]))
  lignes.push(ligne([cellule('N° de lot', 'gras'), cellule(dossier.numero_lot || '— non renseigné —')]))
  lignes.push(ligne([cellule('Patient', 'gras'), cellule(patient
    ? [patient.reference, patient.nom].filter(Boolean).join(' — ')
    : 'Parcours anonyme — aucun patient rattaché')]))
  lignes.push(ligne([cellule('Statut', 'gras'), cellule(libelleStatut(dossier))]))
  lignes.push(ligne([cellule('Conformité', 'gras'), cellule(libelleConformite(dossier))]))
  lignes.push(ligne([]))
  lignes.push(ligne(['Processus', 'Section', 'N°', 'Point de contrôle', 'Unité',
    'Relevé', 'Hors seuil', 'Date et heure', 'Opérateur']
    .map((t) => cellule(t, 'entete'))))

  for (const proc of processus) {
    const lignesProc = lignesDuProcessus(proc, parProcessus.get(proc.id) ?? [], piecesParSaisie)
    let section = ''
    for (const l of lignesProc) {
      if (l.genre === 'section') { section = l.titre; continue }
      lignes.push(ligne([
        cellule(`${proc.ordre}. ${proc.nom}`), cellule(section), cellule(l.num),
        cellule(l.libelle), cellule(l.unite), cellule(l.valeur),
        cellule(l.horsSeuil ? 'OUI' : ''), cellule(l.horodatage), cellule(l.operateur)
      ]))
    }
  }

  lignes.push(ligne([]))
  lignes.push(ligne([cellule('Signatures', 'gras')]))
  for (const s of signatures(d)) if (s) lignes.push(ligne([cellule(s)]))

  return Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n' +
    ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    ' <Styles>\n' +
    '  <Style ss:ID="titre"><Font ss:Bold="1" ss:Size="14"/></Style>\n' +
    '  <Style ss:ID="sous"><Font ss:Italic="1" ss:Color="#555555"/></Style>\n' +
    '  <Style ss:ID="mention"><Font ss:Bold="1" ss:Color="#B00000"/></Style>\n' +
    '  <Style ss:ID="gras"><Font ss:Bold="1"/></Style>\n' +
    '  <Style ss:ID="entete"><Font ss:Bold="1"/>' +
    '<Interior ss:Color="#DDDDDD" ss:Pattern="Solid"/></Style>\n' +
    ' </Styles>\n' +
    ' <Worksheet ss:Name="Dossier">\n  <Table>\n' +
    lignes.map((l) => `   ${l}\n`).join('') +
    '  </Table>\n </Worksheet>\n</Workbook>\n', 'utf8')
}
