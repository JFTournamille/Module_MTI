/**
 * Jeu de démonstration : patients, comptes et dossiers fictifs.
 *
 * Sert à montrer l'application avec de la matière — un tableau de bord vide ne
 * démontre rien — et à éprouver la recherche, les filtres et les états du
 * parcours sans saisir dix dossiers à la main.
 *
 * Quatre précautions, parce qu'une donnée fictive dans une base MTI de
 * production pourrait être prise pour une vraie :
 *
 *  1. tout est identifiable par requête : patients `source = 'DEMO'`, comptes
 *     préfixés `demo.`, dossiers préfixés `DEMO-MTI-` ;
 *  2. en production, l'insertion exige SEED_DEMO=oui — un oubli ne suffit pas ;
 *  3. la présence de ces données est signalée comme défaut de configuration par
 *     `installer.js` et par `/api/sante`, tant qu'elles n'ont pas été purgées ;
 *  4. `--supprimer` les retire toutes, dans l'ordre des dépendances.
 *
 *   node src/seed-demo.js              # insère
 *   node src/seed-demo.js --regenerer  # insère et REFAIT tous les dossiers
 *   node src/seed-demo.js --supprimer  # purge
 *
 * Idempotent, à une exception près : un dossier de démonstration construit sur
 * une version du parcours qui n'est plus en service est REFAIT. Sans cela il
 * gardait indéfiniment des processus retirés depuis, et seule une purge suivie
 * d'une réinsertion — deux déploiements — le rafraîchissait. Un compte, un
 * patient ou un dossier déjà à jour est laissé tel quel : relancer le seed ne
 * détruit pas les saisies faites à l'écran sur un dossier à jour.
 *
 * `--regenerer` force la reprise de tous les dossiers, à jour ou non. C'est le
 * geste à faire après avoir changé les scénarios eux-mêmes, que la version du
 * modèle ne trahit pas.
 */
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { pool } from './db.js'

const SOURCE = 'DEMO'
const PREFIXE_COMPTE = 'demo.'
const PREFIXE_DOSSIER = 'DEMO-MTI-'

const supprimer = process.argv.includes('--supprimer')
const regenerer = process.argv.includes('--regenerer')
const production = process.env.NODE_ENV === 'production'

if (!supprimer && production && process.env.SEED_DEMO !== 'oui') {
  console.error(
    "✗ Insertion de données fictives refusée avec NODE_ENV=production.\n\n" +
    "  Un patient ou un dossier fictif pourrait être pris pour un vrai. Si c'est\n" +
    "  bien une instance de démonstration ou de recette, l'assumer\n" +
    "  explicitement :\n" +
    "    SEED_DEMO=oui node src/seed-demo.js\n\n" +
    "  Et les purger avant toute mise en service :\n" +
    "    node src/seed-demo.js --supprimer")
  process.exit(1)
}

/**
 * Identités fictives : `[reference, nom, prenom, initiales, naissance, ipp,
 * identifiants]`.
 *
 * Les patronymes sont choisis peu courants à dessein. Les dix noms de famille
 * les plus fréquents de France — MARTIN, BERNARD, DUBOIS… — étaient certes
 * anonymes, mais une démonstration devant un public y reconnaît toujours
 * quelqu'un. Aucun de ceux-ci ne désigne une personne réelle connue du projet.
 *
 * `ipp` est le pointeur vers le dossier du SIH ; les `identifiants` portent
 * leur propre libellé, modifiable, d'où deux exemples qui ne sont pas des
 * « N° patient 1 » : c'est ce que la démonstration doit montrer.
 */
const PATIENTS = [
  ['DEMO-00123', 'VAUTHIER', 'Sophie', 'VS', '1978-03-12', '80412907',
    [{ libelle: 'N° patient 1', valeur: 'A-2026-0141' }]],
  ['DEMO-00456', 'ESCANDE', 'Jean-Pierre', 'EJ', '1965-07-04', '80398214',
    [{ libelle: 'N° patient 1', valeur: 'A-2026-0158' },
      { libelle: 'N° séjour', valeur: 'SEJ-441209' }]],
  ['DEMO-00789', 'TRÉMOULET', 'Claire', 'TC', '1982-11-22', '80455063',
    [{ libelle: 'N° essai clinique', valeur: 'ZUMA-7-FR-0032' }]],
  ['DEMO-01011', 'BOURGAREL', 'Marie', 'BM', '1991-05-09', '80471338',
    [{ libelle: 'N° patient 1', valeur: 'A-2025-0907' }]],
  ['DEMO-01234', 'SENECHAUD', 'Alain', 'SA', '1955-01-30', '80206741',
    [{ libelle: 'N° patient 1', valeur: 'A-2025-0834' },
      { libelle: 'N° protocole', valeur: 'PROT-CART-11' }]],
  ['DEMO-01567', 'LAVERGNADE', 'Nathalie', 'LN', '1970-09-18', '80319552',
    [{ libelle: 'N° patient 1', valeur: 'A-2024-0663' }]],
  ['DEMO-01890', 'PEYRICHOU', 'Antoine', 'PA', '1988-12-03', '80488170',
    [{ libelle: 'N° patient 1', valeur: 'A-2024-0512' }]],
  ['DEMO-02123', 'MONTEFIORE', 'Isabelle', 'MI', '1962-04-27', '80174829', []],
  ['DEMO-02456', 'ZARAGOZA', 'Luis', 'ZL', '1969-03-19', '80503644', []],
  ['DEMO-02789', 'PHAM', 'Thi', 'PT', '1976-08-11', '80527091', []]
]

/**
 * Comptes fictifs, couvrant les cinq profils.
 *
 * Le préfixe `demo.` n'est pas décoratif : c'est ce qui les rend repérables par
 * requête, faute de colonne `source` sur `mti.utilisateur`.
 */
/* Aucun de ces noms ne désigne une personne réelle du projet ou de son
   entourage professionnel : c'est la seule contrainte qui compte ici. Une
   démonstration où l'auditoire reconnaît des collègues — ou l'auteur du
   logiciel — détourne l'attention de ce qu'elle est censée montrer. */
const COMPTES = [
  ['demo.hfauchereau', 'FAUCHEREAU', 'Hélène', 'Dr', 'pharmacien hospitalier', 'pharmacien'],
  ['demo.sandrieux', 'ANDRIEUX', 'Samuel', 'Dr', 'pharmacien praticien', 'pharmacien'],
  ['demo.nbelkacemi', 'BELKACEMI', 'Naïma', 'Dr', 'pharmacien assistant', 'pharmacien'],
  ['demo.cpommereau', 'POMMEREAU', 'Céline', 'Mme', 'préparatrice référente MTI', 'preparateur'],
  ['demo.tleguyader', 'LE GUYADER', 'Tristan', 'M.', 'préparateur', 'preparateur'],
  ['demo.lchavannes', 'CHAVANNES', 'Léa', 'Mme', 'IDE hématologie 4B', 'ide'],
  ['demo.jvilleret', 'VILLERET', 'Jérôme', 'M.', 'IDE hématologie 4A', 'ide'],
  ['demo.smercadier', 'MERCADIER', 'Sonia', 'Mme', 'assurance qualité', 'qualite'],
  ['demo.abeauchesne', 'BEAUCHESNE', 'Antoine', 'Dr', 'hématologue prescripteur', null],
  ['demo.fdelaunoy', 'DELAUNOY', 'Franck', 'M.', 'administrateur applicatif', 'administrateur']
]

/**
 * Dix scénarios, étalés sur le parcours pour que le tableau de bord montre
 * quelque chose : des dossiers en attente d'allocation, d'autres alloués, deux
 * clos, un avec une alarme de seuil, trois contresignés.
 *
 * `enCours` est le CODE du processus en cours ; tous ceux qui le précèdent sont
 * validés. Un code, pas un rang : le rang se décale à chaque version du modèle
 * — le retrait de l'aphérèse en v3 a fait glisser douze processus d'un cran —
 * et un rang codé en dur aurait silencieusement désigné le voisin. Un code
 * absent du modèle fait échouer le seed bruyamment, ce qui est le but.
 *
 * `information` alimente le bandeau d'alerte de l'en-tête : il n'est pas posé
 * partout, sinon on ne verrait pas la différence entre un dossier qui porte
 * une alerte et un dossier ordinaire.
 *
 * Aucun scénario ne pose le jalon d'aphérèse. Il existe toujours en en-tête —
 * c'est une demande explicite — mais un jeu de démonstration où il est déjà
 * coché partout ne montre pas le geste : la case se coche à l'écran, et c'est
 * ainsi qu'on la démontre.
 */
const SCENARIOS = [
  { ref: '0001', produit: 'KYMRIAH®', lot: null, enCours: 'COMMANDE_MTI', patient: null,
    prescription: false, jours: 2,
    note: 'commande passée, produit pas encore commandé au fabricant' },
  { ref: '0002', produit: 'YESCARTA®', lot: null, enCours: 'RATTACHEMENT', patient: null,
    prescription: true, jours: 5,
    note: 'aphérèse faite, rattachement patient en cours' },
  { ref: '0003', produit: 'CARVYKTI®', lot: 'LOT-CA-2606-A', enCours: 'RECEPTION', patient: 0,
    prescription: true, preallocation: true, jours: 8,
    note: 'réception en cours, patient préalloué' },
  { ref: '0004', produit: 'TECARTUS®', lot: 'LOT-TE-2606-B', enCours: 'RECEPTION', patient: null,
    prescription: false, alarme: true, jours: 9,
    note: 'réception avec alarme de température — le cas à montrer',
    information: 'Relevé hors seuil à la réception : conteneur consigné, '
      + 'litige transporteur ouvert. Ne pas déstocker sans accord pharmacien.' },
  { ref: '0005', produit: 'KYMRIAH®', lot: 'LOT-KY-2506-C', enCours: 'STOCKAGE_LEUCA', patient: 1,
    prescription: true, preallocation: true, contresigne: true, jours: 12,
    note: 'réception contresignée par une 2e personne' },
  /* ABECMA® n'est pas au catalogue des produits de référence : le dossier
     porte donc une désignation libre et `produit_id` à NULL. C'est voulu — un
     MTI commandé avant d'être référencé est un cas réel, et c'est le seul
     scénario qui exerce ce chemin. */
  { ref: '0006', produit: 'ABECMA®', lot: 'LOT-AB-2506-A', enCours: 'PREPARATION',
    patient: 2, prescription: true, jours: 16,
    note: 'produit hors catalogue ; préparation en UPC, dossier nominatif' },
  { ref: '0007', produit: 'YESCARTA®', lot: 'LOT-YE-2405-F', enCours: 'RECEPTION_SERVICE',
    patient: 3, prescription: true, contresigne: true, jours: 21,
    note: 'produit revenu du fabricant, réception service en cours',
    information: 'Administration programmée en hématologie 4B. Prévenir l\'IDE '
      + 'référente 30 min avant décongélation.' },
  { ref: '0008', produit: 'KYMRIAH®', lot: 'LOT-KY-2405-D', enCours: 'ADMINISTRATION',
    patient: 4, prescription: true, jours: 25,
    note: 'administration en cours' },
  { ref: '0009', produit: 'CARVYKTI®', lot: 'LOT-CA-2304-B', patient: 5,
    prescription: true, contresigne: true, clos: 'conforme', jours: 34,
    note: 'dossier clos conforme — consultable, figé' },
  { ref: '0010', produit: 'TECARTUS®', lot: 'LOT-TE-2204-A', patient: 6,
    prescription: true, clos: 'non_conforme', jours: 41,
    note: 'dossier clos non conforme : rupture de chaîne du froid au transport',
    information: 'Dossier clos NON CONFORME. Produit détruit, déclaration ANSM '
      + 'transmise le lendemain. Conservé pour la traçabilité.' }
]

/** Date décalée de n jours dans le passé, à heure fixe pour rester reproductible. */
function jadis (jours, heure = 9, minute = 30) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - jours)
  d.setUTCHours(heure, minute, 0, 0)
  return d
}
const iso = (d) => d.toISOString().slice(0, 10)

/**
 * Valeur plausible pour un point, selon son type.
 *
 * Le seuil est respecté sauf demande explicite d'alarme : un jeu de
 * démonstration où tout est hors seuil n'apprend rien, un jeu où rien ne l'est
 * jamais non plus.
 */
/**
 * Petite image PNG unie, fabriquée sans dépendance.
 *
 * Le jeu de démonstration doit porter de VRAIES pièces jointes : sans elles,
 * la cellule photo reste vide sur les dix dossiers et rien ne montre que la
 * fonction existe. Embarquer des photographies dans le dépôt serait lourd et
 * poserait la question de leur provenance ; une image générée est légère,
 * reproductible, et se reconnaît au premier coup d'œil pour ce qu'elle est —
 * un cliché de démonstration, pas la photo d'un vrai conteneur.
 *
 * Le PNG est écrit à la main : en-tête, IHDR, IDAT compressé par zlib, IEND.
 * C'est une vingtaine de lignes et zéro dépendance, contre une bibliothèque
 * d'images pour un seul usage.
 */
function imagePng (largeur, hauteur, [r, v, b]) {
  const brut = Buffer.alloc(hauteur * (1 + largeur * 3))
  for (let y = 0; y < hauteur; y++) {
    const ligne = y * (1 + largeur * 3)
    brut[ligne] = 0                       // filtre « None »
    for (let x = 0; x < largeur; x++) {
      /* Bande diagonale plus claire : deux vignettes de teintes voisines
         restent distinguables, et l'image ne passe pas pour un aplat raté. */
      const bande = ((x + y) % 96) < 24 ? 40 : 0
      const i = ligne + 1 + x * 3
      brut[i] = Math.min(255, r + bande)
      brut[i + 1] = Math.min(255, v + bande)
      brut[i + 2] = Math.min(255, b + bande)
    }
  }
  const bloc = (type, corps) => {
    const t = Buffer.from(type, 'ascii')
    const entete = Buffer.alloc(4)
    entete.writeUInt32BE(corps.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([t, corps])))
    return Buffer.concat([entete, t, corps, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largeur, 0)
  ihdr.writeUInt32BE(hauteur, 4)
  ihdr[8] = 8; ihdr[9] = 2                // 8 bits, couleur vraie
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(brut, { level: 9 })),
    bloc('IEND', Buffer.alloc(0))
  ])
}

/** CRC-32 du PNG. Table calculée une fois. */
const TABLE_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32 (buf) {
  let c = 0xffffffff
  for (const octet of buf) c = TABLE_CRC[(c ^ octet) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/* Une teinte par point photographié : les vignettes d'un même dossier ne se
   confondent pas. */
const TEINTES = [[74, 56, 128], [40, 96, 120], [120, 72, 40], [56, 112, 64], [128, 56, 96]]

function valeurPour (point, ctx) {
  switch (point.type) {
    case 'ouinon':
      return { reponse: ctx.non ? 'non' : 'oui' }
    case 'valeur': {
      const seuil = point.seuil ?? null
      if (seuil === null) {
        // Numération et viabilité cellulaires : pas de seuil au modèle.
        return { valeurNum: /iabilit/.test(point.libelle) ? 94.6 : 3.2 }
      }
      return { valeurNum: ctx.alarme ? seuil + 12 : seuil - 18, seuil }
    }
    case 'texte':
      return { valeurTexte: ctx.texte ?? 'Conforme' }
    case 'date':
      return { valeurTexte: iso(jadis(ctx.jours ?? 0)) }
    case 'timer':
      return {
        timerDebut: jadis(ctx.jours ?? 0, 10, 0),
        timerFin: jadis(ctx.jours ?? 0, 10, 4)
      }
    default:
      // photo : la pièce jointe est posée après la saisie, elle ne tient pas
      //   dans une colonne. auto : renseigné par le système à la validation.
      return {}
  }
}

const client = await pool.connect()
try {
  await client.query('BEGIN')

  const { rows: [operateurBase] } = await client.query(
    'SELECT id FROM mti.utilisateur WHERE actif ORDER BY cree_le LIMIT 1')
  if (!operateurBase && !supprimer) {
    throw new Error("Aucun utilisateur actif : les écritures n'auraient pas d'auteur. " +
                    'Lancer le seed des référentiels d\'abord.')
  }
  const acteur = async (id) => {
    await client.query('SELECT set_config($1, $2, true)',
      ['mti.utilisateur_id', id ?? operateurBase?.id ?? ''])
  }
  await acteur(null)
  await client.query('SELECT set_config($1, $2, true)',
    ['mti.contexte', supprimer ? 'purge du jeu de démonstration' : 'insertion du jeu de démonstration'])

  // ───────────────────────────────────────────────────────────────── Purge ──
  if (supprimer) {
    const { rowCount: nbDossiers } = await client.query(
      'DELETE FROM mti.dossier WHERE reference LIKE $1', [PREFIXE_DOSSIER + '%'])

    // Un patient fictif rattaché à un dossier NON fictif ne doit pas disparaître
    // en silence : la référence du dossier resterait pendante.
    const { rows: rattaches } = await client.query(
      `SELECT p.reference, count(d.id)::int AS dossiers
         FROM mti.patient p
         JOIN mti.dossier d ON d.patient_id = p.id
        WHERE p.source = $1
        GROUP BY p.reference`, [SOURCE])
    if (rattaches.length) {
      console.error(`✗ ${rattaches.length} patient(s) fictif(s) rattachés à des dossiers réels :`)
      for (const r of rattaches) console.error(`    ${r.reference} — ${r.dossiers} dossier(s)`)
      console.error(
        "\n  Les supprimer laisserait ces dossiers sans patient. Traiter ces\n" +
        "  dossiers d'abord.")
      await client.query('ROLLBACK')
      process.exit(1)
    }
    const { rowCount: nbPatients } = await client.query(
      'DELETE FROM mti.patient WHERE source = $1', [SOURCE])

    /* Un compte ne se supprime que s'il n'est l'auteur de rien : ailleurs, la
       traçabilité perdrait son auteur. Les autres sont désactivés — c'est la
       règle appliquée partout dans l'application.

       `mti.audit` compte au premier chef, et c'est le cas le moins visible :
       ses lignes survivent à la purge (elles ne sont pas effaçables, par
       construction) et elles ne portent PAS de clé étrangère vers
       `utilisateur`. Effacer un compte qui y figure ne casse donc rien à
       l'insertion — mais laisse des centaines de traces dont l'auteur n'est
       plus qu'un UUID que rien ne résout. C'est exactement ce que le journal
       est censé empêcher. */
    const { rows: comptes } = await client.query(
      `SELECT u.id, u.identifiant,
              EXISTS (SELECT 1 FROM mti.audit a WHERE a.utilisateur_id = u.id)
           OR EXISTS (SELECT 1 FROM mti.saisie s WHERE s.operateur_id = u.id)
           OR EXISTS (SELECT 1 FROM mti.signature g WHERE g.utilisateur_id = u.id)
           OR EXISTS (SELECT 1 FROM mti.dossier d
                       WHERE d.cree_par = u.id OR d.valide_par = u.id)
           OR EXISTS (SELECT 1 FROM mti.dossier_processus dp WHERE dp.valide_par = u.id)
              AS reference
         FROM mti.utilisateur u WHERE u.identifiant LIKE $1`, [PREFIXE_COMPTE + '%'])
    let supprimes = 0
    let desactives = 0
    for (const c of comptes) {
      if (c.reference) {
        await client.query('UPDATE mti.utilisateur SET actif = false WHERE id = $1', [c.id])
        desactives++
      } else {
        await client.query('DELETE FROM mti.utilisateur WHERE id = $1', [c.id])
        supprimes++
      }
    }

    await client.query('COMMIT')
    console.log(`✓ ${nbDossiers} dossier(s) fictif(s) supprimé(s)`)
    console.log(`✓ ${nbPatients} patient(s) fictif(s) supprimé(s)`)
    console.log(`✓ ${supprimes} compte(s) fictif(s) supprimé(s)` +
      (desactives ? `, ${desactives} désactivé(s) car auteurs de traçabilité` : ''))
    if (desactives) {
      console.log("  Un compte qui figure au journal d'audit ne s'efface pas :\n" +
                  "  la trace subsiste et perdrait son auteur.")
    }
  } else {
    // ────────────────────────────────────────────────────────── Insertion ──
    const { rows: [modele] } = await client.query(
      `SELECT id, definition FROM mti.modele_parcours WHERE actif ORDER BY version DESC LIMIT 1`)
    if (!modele) throw new Error('Aucun modèle de parcours actif — lancer le seed des référentiels.')
    const processusModele = modele.definition.processus ?? []

    // ── Patients ──
    const patients = []
    for (const [reference, nom, prenom, initiales, naissance, ipp, identifiants]
      of PATIENTS) {
      const { rows } = await client.query(
        `INSERT INTO mti.patient (reference, source) VALUES ($1, $2)
         ON CONFLICT (source, reference) DO NOTHING RETURNING id`, [reference, SOURCE])
      const id = rows[0]?.id ?? (await client.query(
        'SELECT id FROM mti.patient WHERE source = $1 AND reference = $2',
        [SOURCE, reference])).rows[0].id
      await client.query(
        `INSERT INTO mti.patient_identite
           (patient_id, nom, prenom, initiales, date_naissance, ipp, identifiants)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT (patient_id) DO UPDATE
           SET nom = EXCLUDED.nom, prenom = EXCLUDED.prenom,
               initiales = EXCLUDED.initiales, date_naissance = EXCLUDED.date_naissance,
               ipp = EXCLUDED.ipp, identifiants = EXCLUDED.identifiants,
               maj_le = now()`,
        [id, nom, prenom, initiales, naissance, ipp ?? null,
          JSON.stringify(identifiants ?? [])])
      patients.push({ id, reference, nom, prenom })
    }

    // ── Comptes ──
    const comptes = []
    for (const [identifiant, nom, prenom, titre, fonction, profil] of COMPTES) {
      const { rows } = await client.query(
        `INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction, profil)
         VALUES ($1, $2, $3, $4, $5, $6::mti.profil_utilisateur)
         ON CONFLICT (identifiant) DO UPDATE
           SET nom = EXCLUDED.nom, prenom = EXCLUDED.prenom, titre = EXCLUDED.titre,
               fonction = EXCLUDED.fonction, profil = EXCLUDED.profil, actif = true
         RETURNING id`,
        [identifiant, nom, prenom, titre, fonction, profil])
      comptes.push({ id: rows[0].id, identifiant, profil, libelle: `${titre} ${prenom} ${nom}` })
    }
    const pharmaciens = comptes.filter((c) => c.profil === 'pharmacien')
    const preparateurs = comptes.filter((c) => c.profil === 'preparateur')

    // ── Produits, pour rattacher chaque dossier au bon ──
    const { rows: produits } = await client.query(
      'SELECT id, denomination, seuil_temp_c FROM mti.produit WHERE actif')
    const produitPar = new Map(produits.map((p) => [p.denomination, p]))

    let crees = 0
    let existants = 0
    let refaits = 0
    for (const [i, sc] of SCENARIOS.entries()) {
      const reference = PREFIXE_DOSSIER + sc.ref
      /* Le dossier existant n'est pas seulement compté : on regarde SUR QUEL
         MODÈLE il a été construit. Le seed se contentait de le sauter, si bien
         qu'un jeu créé sur une version antérieure du parcours restait en place
         indéfiniment — il continuait d'afficher des processus retirés depuis,
         et aucune relance ne le rafraîchissait. Il fallait purger puis
         réinsérer, en deux déploiements, ce que personne ne devine.

         Un dossier de démonstration périmé est donc REFAIT. Ce sont des
         dossiers fictifs, préfixés, reconnaissables : les effacer ne détruit
         rien de réel, et la cascade emporte processus, saisies et signatures. */
      const { rows: deja } = await client.query(
        'SELECT id, modele_parcours_id FROM mti.dossier WHERE reference = $1', [reference])
      if (deja.length) {
        const aJour = deja[0].modele_parcours_id === modele.id
        if (aJour && !regenerer) { existants++; continue }
        await client.query('DELETE FROM mti.dossier WHERE id = $1', [deja[0].id])
        refaits++
      }

      /* L'auteur varie d'un dossier à l'autre : un journal d'audit où tout
         porte le même nom ne montre rien de la traçabilité. */
      const auteur = (i % 2 ? preparateurs : pharmaciens)[i % 3 % (i % 2 ? preparateurs.length : pharmaciens.length)]
        ?? comptes[0]
      await acteur(auteur.id)

      const produit = produitPar.get(sc.produit)
      const patient = sc.patient === null || sc.patient === undefined
        ? null : patients[sc.patient]
      const creeLe = jadis(sc.jours)

      const { rows: [dossier] } = await client.query(
        `INSERT INTO mti.dossier
           (reference, modele_parcours_id, produit_id, designation_produit, numero_lot,
            patient_id, preallocation, prescription_faite, cree_par, cree_le, commentaire,
            information_importante, apherese_faite, date_apherese)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [reference, modele.id, produit?.id ?? null, sc.produit, sc.lot,
          patient?.id ?? null, sc.preallocation === true, sc.prescription === true,
          auteur.id, creeLe, sc.note,
          sc.information ?? null, sc.apherese === true,
          sc.apherese ? iso(jadis(sc.jours + 21)) : null])

      /* Sur un dossier clos, tous les processus sont validés : un dossier
         validé dont le dernier processus serait encore « en cours » n'existe
         pas dans le parcours réel. */
      /* Résolu par CODE, et bruyamment : un scénario qui désigne un processus
         absent du modèle actif est un scénario faux, pas un scénario à placer
         au hasard. Mieux vaut arrêter le seed que peupler la démonstration de
         dossiers arrêtés au mauvais endroit. */
      let rangCourant = processusModele.length + 1
      if (!sc.clos) {
        const k = processusModele.findIndex((p) => p.code === sc.enCours)
        if (k < 0) {
          throw new Error(
            `Scénario ${reference} : le processus « ${sc.enCours} » n'existe pas ` +
            `dans le modèle ${modele.code ?? ''} actif. Processus disponibles : ` +
            processusModele.map((p) => p.code).join(', '))
        }
        rangCourant = k + 1
      }

      // ── Processus, avec l'état correspondant au scénario ──
      const processusIds = []
      for (const [k, p] of processusModele.entries()) {
        const ordre = k + 1
        const etat = ordre < rangCourant ? 'valide' : ordre === rangCourant ? 'en_cours' : 'a_venir'
        /* Un processus par jour, du plus ancien au plus récent : les saisies
           sont datées à partir de là, sinon elles précéderaient l'ouverture du
           processus qui les porte et le fil chronologique serait faux. */
        const jour = sc.jours - Math.min(k, sc.jours - 1)
        const ouvertLe = etat === 'a_venir' ? null : jadis(jour)
        const { rows: [dp] } = await client.query(
          `INSERT INTO mti.dossier_processus
             (dossier_id, ordre, code, nom, gabarit, externe, definition, etat,
              ouvert_le, valide_par, valide_le)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::mti.etat_processus,$9,$10,$11) RETURNING id`,
          [dossier.id, ordre, p.code, p.nom, p.gabarit ?? 'standard', p.externe === true,
            JSON.stringify({ sections: p.sections ?? [] }), etat, ouvertLe,
            etat === 'valide' ? auteur.id : null,
            etat === 'valide' ? jadis(jour, 11) : null])
        processusIds.push({
          id: dp.id, ordre, code: p.code, etat, jour, sections: p.sections ?? []
        })
      }

      // ── Saisies des processus validés, et du processus en cours ──
      for (const dp of processusIds) {
        if (dp.etat === 'a_venir') continue
        // Le processus en cours n'est rempli qu'à moitié : c'est ce qui le rend
        // « en cours » à l'écran plutôt que prêt à valider.
        const partiel = dp.etat === 'en_cours'
        for (const [iS, section] of dp.sections.entries()) {
          if (partiel && iS > 0) break
          for (const [iP, point] of (section.points ?? []).entries()) {
            const copies = Number(point.exemplaires) || 1
            for (let ex = 1; ex <= copies; ex++) {
              const alarme = sc.alarme === true && point.seuil != null && dp.code === 'RECEPTION'
                && /SMART PACK I —/.test(point.libelle)
              const non = sc.clos === 'non_conforme' && dp.code === 'RECEPTION'
                && /Alarme température durant|Alarme temp/.test(point.libelle)
              const v = valeurPour(point, { alarme, non, jours: dp.jour, texte: 'Conforme' })
              if (Object.keys(v).length === 0 && point.type !== 'auto' && point.type !== 'photo') continue

              const horsSeuil = v.seuil != null && v.valeurNum != null
                ? Number(v.valeurNum) > Number(v.seuil) : null
              /* L'opérateur change d'un processus à l'autre, et le second
                 exemplaire d'un point double est saisi par un pharmacien : un
                 dossier entier attribué à une seule personne ne montrerait ni
                 la relève ni le double contrôle. */
              const equipe = ex > 1 ? pharmaciens : preparateurs
              const operateur = equipe.length
                ? equipe[(dp.ordre + ex) % equipe.length]
                : auteur
              const saisieCreee = await client.query(
                `INSERT INTO mti.saisie
                   (dossier_processus_id, section_index, point_index, point_num, point_type,
                    exemplaire, operateur_role, obligatoire, reponse, valeur_num, valeur_texte,
                    seuil_applique, hors_seuil, horodatage, timer_debut, timer_fin,
                    operateur_id, commentaire, numero_serie, saisi_le)
                 VALUES ($1,$2,$3,$4,$5::mti.type_point,$6,'op1',$7,$8::mti.reponse_ouinon,
                         $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
                 ON CONFLICT (dossier_processus_id, section_index, point_index, exemplaire,
                              operateur_role) DO NOTHING
                 RETURNING id`,
                [dp.id, iS, iP, point.num ?? null, point.type, ex,
                  point.obligatoire === true, v.reponse ?? null,
                  v.valeurNum ?? null, v.valeurTexte ?? null,
                  v.seuil ?? null, horsSeuil,
                  jadis(dp.jour, 10, 15), v.timerDebut ?? null, v.timerFin ?? null,
                  operateur.id,
                  alarme
                    ? 'Relevé hors seuil — transporteur alerté, conteneur photographié.'
                    : (non ? 'Rupture de chaîne du froid constatée au déchargement.' : null),
                  point.numeroSerie ? `${point.num?.replace('.', '') ?? 'SN'}-${String(1000 + ex)}` : null,
                  jadis(dp.jour, 10, 15)])

              /* Un point photographique porte une pièce, sans quoi la cellule
                 reste vide sur les dix dossiers et rien ne montre la fonction.
                 `RETURNING id` ne renvoie rien si le DO NOTHING a joué : la
                 saisie était déjà là, donc sa photo aussi. */
              if (point.type === 'photo' && saisieCreee.rows.length) {
                const octets = imagePng(320, 240, TEINTES[(iS + iP + ex) % TEINTES.length])
                await client.query(
                  `INSERT INTO mti.piece_jointe
                     (saisie_id, libelle, nom_fichier, mime, taille, sha256, contenu,
                      ajoute_par, ajoute_le)
                   VALUES ($1,$2,$3,'image/png',$4,$5,$6,$7,$8)`,
                  [saisieCreee.rows[0].id,
                    `Cliché de démonstration — ${point.libelle.slice(0, 60)}`,
                    `demo-${dp.code.toLowerCase()}-${iS}${iP}${ex}.png`,
                    octets.length, createHash('sha256').update(octets).digest('hex'),
                    octets, operateur.id, jadis(dp.jour, 10, 15)])
              }
            }
          }
        }
      }

      // ── Contresignature de la réception, par une 2e personne ──
      if (sc.contresigne) {
        const reception = processusIds.find((p) => p.code === 'RECEPTION')
        const second = pharmaciens.find((c) => c.id !== auteur.id) ?? comptes[1]
        if (reception && second) {
          const points = reception.sections.flatMap((s) => s.points ?? [])
            .filter((pt) => pt.doubleValidation === true)
          if (points.length) {
            const contenu = JSON.stringify({
              processus: reception.id,
              nom: reception.code,
              points: points.map((pt) => ({ num: pt.num ?? null, libelle: pt.libelle })),
              contresignataire: second.id
            })
            await client.query(
              `INSERT INTO mti.signature (dossier_id, processus_id, role, utilisateur_id,
                                          empreinte, signe_le)
               VALUES ($1,$2,'verificateur',$3,$4,$5)
               ON CONFLICT (dossier_id, processus_id, role, utilisateur_id) DO NOTHING`,
              [dossier.id, reception.id, second.id,
                createHash('sha256').update(contenu).digest('hex'), jadis(reception.jour, 12)])
          }
        }
      }

      /* Clôture EN DERNIER : le trigger de lecture seule interdit toute saisie
         sur un dossier validé, y compris celles qu'on vient d'insérer. */
      if (sc.clos) {
        const signataire = pharmaciens[0] ?? comptes[0]
        // Le dossier se clôt APRÈS son dernier processus : daté sur la création
        // du dossier, il aurait été validé avant la moitié de son parcours.
        const dernier = processusIds[processusIds.length - 1]
        await client.query(
          `UPDATE mti.dossier
              SET statut = 'valide', conformite = $2::mti.conformite,
                  valide_par = $3, valide_le = $4
            WHERE id = $1`,
          [dossier.id, sc.clos, signataire.id, jadis(Math.max(dernier.jour - 1, 0), 17)])
      }
      crees++
    }

    await client.query('COMMIT')
    console.log(`✓ ${PATIENTS.length} patient(s) fictif(s) (source « ${SOURCE} »)`)
    console.log(`✓ ${COMPTES.length} comptes fictifs (préfixe « ${PREFIXE_COMPTE} »)`)
    console.log(`✓ ${crees} dossier(s) fictif(s) créé(s)` +
      (refaits ? `, dont ${refaits} refait(s) sur le parcours en service` : '') +
      (existants ? `, ${existants} déjà à jour et laissé(s) tels quels` : '') +
      ` (préfixe « ${PREFIXE_DOSSIER} »)`)
    console.log('  ⚠ À purger avant mise en service : node src/seed-demo.js --supprimer')
  }
} catch (e) {
  await client.query('ROLLBACK')
  console.error(`✗ ${e.message}`)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
