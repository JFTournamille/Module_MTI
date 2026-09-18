/**
 * Écriture de PDF, sans dépendance.
 *
 * POURQUOI PAS UNE BIBLIOTHÈQUE. Le dépôt tient à deux dépendances, et le
 * document produit ici est un document RÉGLEMENTAIRE : il peut être présenté à
 * un inspecteur. Or un PDF porte des métadonnées — Producer, Creator — qu'une
 * bibliothèque renseigne avec son propre nom et sa version. Sur un dossier
 * nominatif, ces champs partent avec le fichier, et c'est exactement ce que le
 * masquage du domaine cherche à éviter par ailleurs. En écrivant les octets
 * ici, aucun champ n'est posé sans qu'on l'ait décidé.
 *
 * CE QUE CE MODULE NE FAIT PAS, et il faut le savoir avant d'en attendre plus :
 * il n'embarque aucune police. Il n'utilise que les quatorze polices de base
 * que tout lecteur PDF possède (Helvetica et ses variantes), ce qui suffit
 * largement à un tableau de traçabilité mais limite le jeu de caractères à
 * WinAnsi. Les caractères hors de ce jeu sont remplacés par un équivalent
 * lisible plutôt que rendus en « ? » — un seuil « ≥ 5 » qui s'imprimerait
 * « ? 5 » serait un document faux.
 */

/** Largeur d'une page A4 en points PostScript (72 par pouce). */
export const A4 = { largeur: 595.28, hauteur: 841.89 }

/**
 * Équivalents WinAnsi des caractères que le jeu ne porte pas.
 *
 * Substituer plutôt que perdre : le document dit la même chose, avec les
 * signes que la police sait tracer. Un relevé « < −150 °C » rendu « < ?150 °C »
 * ne serait pas un défaut d'affichage mais une donnée fausse.
 */
const EQUIVALENTS = new Map(Object.entries({
  '≥': '>=', '≤': '<=', '≠': '!=', '−': '-', '–': '-', '×': 'x',
  '✓': 'OK', '✔': 'OK', '✗': 'X', '⚠': '/!\\', '★': '*', '☆': 'o',
  '⧉': '#', '⬛': '#', '▶': '>', '■': '#', '⚑': '>', '№': 'No',
  '…': '...', ' ': ' ', ' ': ' ', '’': "'"
}))

/** Table WinAnsi des positions 0x80–0x9F, qui diffèrent de Latin-1. */
const WINANSI_HAUT = new Map(Object.entries({
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e,
  'Ÿ': 0x9f
}))

/** Encode un texte en WinAnsi, en substituant ce que le jeu ne porte pas. */
export function winAnsi (texte) {
  const octets = []
  for (const c of String(texte ?? '')) {
    const remplace = EQUIVALENTS.get(c)
    if (remplace !== undefined) {
      for (const r of remplace) octets.push(r.charCodeAt(0) & 0xff)
      continue
    }
    const haut = WINANSI_HAUT.get(c)
    if (haut !== undefined) { octets.push(haut); continue }
    const code = c.codePointAt(0)
    if (code <= 0xff) { octets.push(code); continue }
    /* Dernier recours : un point d'interrogation vaut mieux qu'un octet
       arbitraire, qui afficherait un caractère faux sans le signaler. */
    octets.push(0x3f)
  }
  return Buffer.from(octets)
}

/** Échappe une chaîne pour un littéral PDF `( … )`. */
function litteral (texte) {
  const b = winAnsi(texte)
  const sortie = []
  for (const o of b) {
    if (o === 0x28 || o === 0x29 || o === 0x5c) sortie.push(0x5c)
    sortie.push(o)
  }
  return Buffer.from(sortie)
}

/**
 * Largeur approchée d'un texte, en points, pour une police base-14.
 *
 * Les largeurs exactes vivent dans les métriques AFM, qu'on n'embarque pas.
 * L'approximation suffit à ce qu'on en fait : tronquer une cellule trop longue
 * et centrer un titre. Elle SURESTIME légèrement, pour que la troncature se
 * fasse toujours du bon côté — un texte qui déborde de sa colonne est pire
 * qu'un texte coupé un caractère trop tôt.
 */
export function largeurTexte (texte, taille) {
  let unites = 0
  for (const c of String(texte ?? '')) {
    if ('iljt.,;:|!\'`'.includes(c)) unites += 0.30
    else if ('mwMW@'.includes(c)) unites += 0.90
    else if (c === ' ') unites += 0.28
    else if (c >= 'A' && c <= 'Z') unites += 0.70
    else unites += 0.53
  }
  return unites * taille
}

/** Tronque un texte à la largeur donnée, en le disant par une ellipse. */
export function tronquer (texte, largeur, taille) {
  const t = String(texte ?? '')
  if (largeurTexte(t, taille) <= largeur) return t
  let coupe = t
  while (coupe.length > 1 && largeurTexte(coupe + '...', taille) > largeur) {
    coupe = coupe.slice(0, -1)
  }
  return coupe.trimEnd() + '...'
}

/**
 * Document PDF en construction.
 *
 * Une page est un tampon d'instructions de contenu ; `terminer()` assemble les
 * objets, la table des références croisées et le pied de fichier.
 */
export class DocumentPdf {
  /**
   * @param {object} meta Métadonnées écrites dans le document. Elles sont
   *   POSÉES EXPLICITEMENT : rien n'est ajouté par défaut, et notamment aucun
   *   nom d'outil ni de machine.
   */
  constructor (meta = {}) {
    this.meta = meta
    this.pages = []
    this.courante = null
    this.nouvellePage()
  }

  nouvellePage () {
    this.courante = { flux: [], filigranes: [] }
    this.pages.push(this.courante)
    return this.courante
  }

  get nbPages () { return this.pages.length }

  /** Écrit un texte à (x, y), y mesuré depuis le BAS de la page. */
  texte (x, y, contenu, { taille = 9, police = 'F1', gris = 0 } = {}) {
    const f = this.courante.flux
    f.push(Buffer.from(`BT /${police} ${taille} Tf ${gris} g ${x.toFixed(2)} ${y.toFixed(2)} Td (`))
    f.push(litteral(contenu))
    f.push(Buffer.from(') Tj ET\n'))
  }

  /** Texte centré sur une largeur donnée. */
  texteCentre (x, largeur, y, contenu, options = {}) {
    const l = largeurTexte(contenu, options.taille ?? 9)
    this.texte(x + Math.max(0, (largeur - l) / 2), y, contenu, options)
  }

  /** Texte aligné à droite d'une position. */
  texteDroite (xDroite, y, contenu, options = {}) {
    this.texte(xDroite - largeurTexte(contenu, options.taille ?? 9), y, contenu, options)
  }

  ligne (x1, y1, x2, y2, { epaisseur = 0.5, gris = 0.6 } = {}) {
    this.courante.flux.push(Buffer.from(
      `${gris} G ${epaisseur} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ` +
      `${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`))
  }

  rectangle (x, y, l, h, { gris = 0.92 } = {}) {
    this.courante.flux.push(Buffer.from(
      `${gris} g ${x.toFixed(2)} ${y.toFixed(2)} ${l.toFixed(2)} ${h.toFixed(2)} re f\n`))
  }

  /**
   * Filigrane en travers de la page.
   *
   * POSÉ PAR LE SERVEUR, jamais demandé par le client : c'est la mention qui
   * dit si le document fait foi. Une page périmée pourrait sinon produire un
   * document sans filigrane sur un dossier qui ne l'est plus.
   */
  filigrane (texte, { taille = 46, gris = 0.86 } = {}) {
    this.courante.filigranes.push({ texte, taille, gris })
  }

  /** Assemble le fichier. `entete` est appelée par page pour le pied et l'en-tête. */
  terminer () {
    const objets = []
    const ajouter = (contenu) => { objets.push(contenu); return objets.length }

    const idPolices = {
      F1: ajouter('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),
      F2: ajouter('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),
      F3: ajouter('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>')
    }

    const idPages = objets.length + 1 + this.pages.length * 2 + 1
    const idsPage = []
    for (const page of this.pages) {
      /* Le filigrane est écrit EN PREMIER, donc sous le texte : par-dessus, il
         gênerait la lecture d'un document qu'on doit pouvoir relire. */
      const morceaux = []
      for (const f of page.filigranes) {
        const l = largeurTexte(f.texte, f.taille)
        const x = (A4.largeur - l * 0.72) / 2
        const y = A4.hauteur / 2 - 120
        morceaux.push(Buffer.from(
          `q ${f.gris} g BT /F2 ${f.taille} Tf ` +
          `0.72 0.69 -0.69 0.72 ${x.toFixed(2)} ${y.toFixed(2)} Tm (`))
        morceaux.push(litteral(f.texte))
        morceaux.push(Buffer.from(') Tj ET Q\n'))
      }
      const flux = Buffer.concat([...morceaux, ...page.flux])
      const idFlux = ajouter(Buffer.concat([
        Buffer.from(`<< /Length ${flux.length} >>\nstream\n`), flux,
        Buffer.from('\nendstream')
      ]))
      idsPage.push(ajouter(
        `<< /Type /Page /Parent ${idPages} 0 R ` +
        `/MediaBox [0 0 ${A4.largeur.toFixed(2)} ${A4.hauteur.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${idPolices.F1} 0 R /F2 ${idPolices.F2} 0 R ` +
        `/F3 ${idPolices.F3} 0 R >> >> /Contents ${idFlux} 0 R >>`))
    }

    const vraiIdPages = ajouter(
      `<< /Type /Pages /Kids [${idsPage.map((i) => `${i} 0 R`).join(' ')}] ` +
      `/Count ${idsPage.length} >>`)
    const idCatalogue = ajouter(`<< /Type /Catalog /Pages ${vraiIdPages} 0 R >>`)

    /* LES MÉTADONNÉES SONT CELLES QU'ON A DÉCIDÉES, et rien d'autre. Pas de
       Producer annonçant l'outil, pas de nom de machine : ces champs partent
       avec un document nominatif. */
    const champs = []
    const champTexte = (cle, valeur) => {
      /* Assemblé en Buffer et non par interpolation : `litteral()` rend des
         octets WinAnsi, et les glisser dans un gabarit de chaîne les
         re-encoderait en UTF-8 — un titre accentué sortait alors illisible
         dans les propriétés du document. */
      champs.push(Buffer.concat([
        Buffer.from(`/${cle} (`), litteral(valeur), Buffer.from(')')
      ]))
    }
    if (this.meta.titre) champTexte('Title', this.meta.titre)
    if (this.meta.sujet) champTexte('Subject', this.meta.sujet)
    if (this.meta.auteur) champTexte('Author', this.meta.auteur)
    if (this.meta.date) champs.push(Buffer.from(`/CreationDate (${datePdf(this.meta.date)})`))
    const idInfo = champs.length
      ? ajouter(Buffer.concat([
          Buffer.from('<< '),
          ...champs.flatMap((c, i) => (i ? [Buffer.from(' '), c] : [c])),
          Buffer.from(' >>')
        ]))
      : null

    const morceaux = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'binary')]
    let position = morceaux[0].length
    const positions = []
    objets.forEach((objet, i) => {
      positions.push(position)
      const tete = Buffer.from(`${i + 1} 0 obj\n`)
      const corps = Buffer.isBuffer(objet) ? objet : Buffer.from(objet)
      const queue = Buffer.from('\nendobj\n')
      morceaux.push(tete, corps, queue)
      position += tete.length + corps.length + queue.length
    })

    const debutXref = position
    const lignes = [`xref\n0 ${objets.length + 1}\n`, '0000000000 65535 f \n']
    for (const p of positions) lignes.push(`${String(p).padStart(10, '0')} 00000 n \n`)
    morceaux.push(Buffer.from(lignes.join('')))
    morceaux.push(Buffer.from(
      `trailer\n<< /Size ${objets.length + 1} /Root ${idCatalogue} 0 R` +
      `${idInfo ? ` /Info ${idInfo} 0 R` : ''} >>\n` +
      `startxref\n${debutXref}\n%%EOF\n`))

    return Buffer.concat(morceaux)
  }
}

/** Date au format PDF, en heure locale du serveur. */
function datePdf (d) {
  const p = (n) => String(n).padStart(2, '0')
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
