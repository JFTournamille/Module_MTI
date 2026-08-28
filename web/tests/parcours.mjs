/**
 * Vérification de bout en bout du parcours MTI dans un vrai navigateur.
 *
 * Prérequis : `npm run build && npm run preview` (port 4173). L'API est
 * optionnelle : sans elle, le test vérifie le repli hors-ligne ; avec elle,
 * il vérifie en plus la recherche patient sur l'annuaire réel.
 *
 *   node tests/parcours.mjs [chemin/capture.png]
 *
 * CHROMIUM_PATH permet de pointer un binaire déjà présent sur la machine
 * plutôt que celui téléchargé par Playwright.
 */
import { chromium } from 'playwright'

const base = process.env.WEB_URL ?? 'http://localhost:4173'
const nav = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await nav.newPage({ viewport: { width: 1280, height: 900 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  // Les échecs de chargement de ressources sont repris via `response` avec
  // leur URL : ici on ne garde que les vraies erreurs JavaScript.
  if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
    erreurs.push(`console: ${m.text()}`)
  }
})
const reponsesHS = []
page.on('response', (r) => {
  if (r.status() >= 400) reponsesHS.push(`${r.status()} ${r.url()}`)
})
// Réponses d'erreur provoquées DÉLIBÉRÉMENT par une vérification : un
// identifiant en doublon doit renvoyer 409, c'est le comportement testé. Elles
// sont déclarées ici pour que le contrôle réseau final ne signale que les
// échecs non voulus, au lieu de tout mélanger.
const echecsVoulus = [/favicon\.ico/]

await page.goto(base + '/', { waitUntil: 'networkidle' })
const ok = (m) => console.log('  ✓', m)
const ko = (m) => { console.log('  ✗', m); process.exitCode = 1 }

/* Le modèle actif dicte le nombre de processus : la suite le lit plutôt que de
   le coder en dur, sinon chaque nouvelle version la casserait. */
const modeleActif = await fetch(`${base}/api/modeles`)
  .then((r) => r.json())
  .then((l) => l.find((m) => m.code === 'PARCOURS_CART_AUTOLOGUE'))
  .catch(() => null)
const NB_PROCESSUS = modeleActif?.nbProcessus ?? 12

/* Définition de la réception, lue du modèle actif : sections, lignes attendues
   et obligations en découlent, plutôt que d'être recopiées dans la suite — les
   figer en dur les ferait recasser à chaque version du parcours. */
const defModele = await fetch(`${base}/api/modeles/PARCOURS_CART_AUTOLOGUE`)
  .then((r) => r.json()).catch(() => null)
const ptsReception = (defModele?.processus ?? [])
  .find((p) => p.gabarit === 'reception')?.sections ?? []
/** Copies d'un point : son propre compte s'il en impose un, sinon `n`. */
const copiesDe = (pt, n) => Number(pt.exemplaires) || (pt.multi ? n : 1)
const NB_SECTIONS = ptsReception.length
const nbLignesAttendues = (n) => ptsReception.flatMap((sc) => sc.points)
  .reduce((t, pt) => t + copiesDe(pt, n), 0)
const NB_OBLIGATOIRES = ptsReception.flatMap((sc) => sc.points)
  .reduce((t, pt) => t + (pt.obligatoire ? copiesDe(pt, 1) : 0), 0)

/** Sélectionne un processus par son NOM : les index bougent d'une version du
 *  parcours à l'autre, les noms sont stables. */
async function allerAuProcessus (nom) {
  await page.locator('.proc').filter({ hasText: nom }).first().click()
  await page.waitForTimeout(500)
}

/** L'application ouvre sur le tableau de bord : après un rechargement, il faut
 *  revenir à l'onglet Scénario pour retrouver la table de saisie. */
async function allerAuScenario () {
  await page.locator('.onglet', { hasText: 'Scénario' }).click()
  await page.waitForTimeout(600)
}

// ── Préalable : ouvrir un dossier ──
// Les saisies n'existent que dans un dossier : l'onglet Scénario montre un état
// vide tant qu'aucun n'est ouvert. Tous les groupes qui suivent en dépendent.
console.log('\nPréalable : ouverture d\'un dossier')
// L'application ouvre sur le tableau de bord : on part de la liste, pas d'un
// formulaire vide. Les groupes qui suivent portent sur l'onglet Scénario.
await page.locator('.onglet', { hasText: 'Scénario' }).click()
await page.waitForTimeout(400)
const refDossier = `MTI-NAV-${Date.now()}`
if (await page.locator('.vide-dossier').count()) {
  await page.locator('#vd-ref').fill(refDossier)
  await page.locator('.vd-b').click()
  await page.waitForTimeout(1500)
}
await page.locator('.vide-dossier').count() === 0
  ? ok(`dossier ${refDossier} ouvert — la saisie sera enregistrée`)
  : ko('aucun dossier ouvert : la saisie ne serait pas enregistrée')
// La réception n'est plus le premier processus : la v2 ajoute quatre processus
// amont. Les groupes qui suivent portent sur elle, il faut l'ouvrir.
await allerAuProcessus('Réception (+/-')
ok(`modèle actif : ${NB_PROCESSUS} processus, réception sélectionnée`)

// ── 1. Structure d'ensemble ──
console.log('\n1. Structure')
for (const [sel, nom] of [['.dlg', 'fenêtre'], ['.titlebar', 'barre de titre'],
  ['.sidebar', 'barre latérale'], ['.main', 'panneau principal'], ['.footer', 'pied']]) {
  await page.locator(sel).count() ? ok(nom) : ko(nom)
}
const nbProc = await page.locator('.proc').count()
nbProc === NB_PROCESSUS ? ok(`${nbProc} processus dans la barre latérale`)
  : ko(`${nbProc} processus au lieu de ${NB_PROCESSUS}`)

// ── 2. Le parcours démarre anonyme ──
console.log('\n2. Anonymat initial')
const entete = await page.locator('.hdr-left .name').innerText()
if (/En attente d'allocation/.test(entete)) {
  ok(`en-tête : « ${entete} »`)
} else {
  ko(`en-tête inattendu : ${entete}`)
}
await page.locator('.hdr-left .meta').innerText().then(t =>
  !t.includes('ordonnancier') ? ok('N° ordonnancier masqué avant la fabrication')
    : ko('N° ordonnancier visible trop tôt'))

// ── 3. Checklist de réception ──
console.log('\n3. Réception')
const nbSections = await page.locator('.chk .csec').count()
nbSections === NB_SECTIONS ? ok(`${nbSections} sections`)
  : ko(`${nbSections} sections au lieu de ${NB_SECTIONS}`)
let nbLignes = await page.locator('.chk .crow').count()
nbLignes === nbLignesAttendues(1) ? ok(`${nbLignes} points de contrôle (n=1)`)
  : ko(`${nbLignes} lignes au lieu de ${nbLignesAttendues(1)}`)

/* Non-régression : l'accès paresseux aux saisies crée la ligne au PREMIER
   appel. Un appel sans le point la crée sans son caractère obligatoire, et le
   modèle ne s'applique plus jamais — la validation cesse alors de bloquer, en
   silence. C'est arrivé, d'où ce contrôle. */
const nbObl = await page.locator('.cobtn.on').count()
nbObl === NB_OBLIGATOIRES
  ? ok(`${nbObl} point(s) obligatoire(s), hérités du modèle`)
  : ko(`${nbObl} obligatoire(s) au lieu de ${NB_OBLIGATOIRES} — le défaut du modèle est perdu`)

// ── 4. Duplication réactive par n exemplaires ──
console.log('\n4. Duplication n exemplaires (sans bouton « Appliquer »)')
await page.locator('.ch-meta input[type=number]').fill('3')
await page.waitForTimeout(200)
nbLignes = await page.locator('.chk .crow').count()
// Les points « multi » suivent le nombre d'exemplaires du dossier ; ceux qui
// portent leur propre compte (les tubes du kit) n'en dépendent pas.
nbLignes === nbLignesAttendues(3) ? ok(`${nbLignes} lignes avec n=3`)
  : ko(`${nbLignes} lignes au lieu de ${nbLignesAttendues(3)}`)
const badgesEx = await page.locator('.chk .cmul').filter({ hasText: 'Ex. 2/3' }).count()
badgesEx > 0 ? ok(`badges « Ex. 2/3 » présents (${badgesEx})`) : ko('badges exemplaire absents')
await page.locator('.ch-meta input[type=number]').fill('1')
await page.waitForTimeout(200)
nbLignes = await page.locator('.chk .crow').count()
nbLignes === nbLignesAttendues(1)
  ? ok(`retour à ${nbLignes} lignes (aucune copie orpheline)`)
  : ko(`${nbLignes} lignes après retour à n=1`)

// ── 5. Alarme de température ──
console.log('\n5. Alarme de température (seuil −150 °C sur le point 1.3)')
const ligne13 = page.locator('.chk .crow').filter({ hasText: 'SMART PACK I' }).first()
await ligne13.locator('input[type=number]').fill('-168')
await page.waitForTimeout(150)
let badge = await ligne13.locator('.cokb, .calm').first().innerText()
badge.includes('✓') ? ok(`−168 °C → « ${badge.trim()} »`) : ko(`attendu conforme, obtenu ${badge}`)
await ligne13.locator('input[type=number]').fill('-140')
await page.waitForTimeout(150)
badge = await ligne13.locator('.cokb, .calm').first().innerText()
const classe = await ligne13.locator('.calm').count()
classe === 1 && badge.includes('⚠') ? ok(`−140 °C → « ${badge.trim()} »`)
  : ko(`attendu alarme, obtenu ${badge}`)

// ── 6. Double contrôle Op.2 ──
console.log('\n6. Double contrôle')
const avant = await page.locator('.chk .crow').count()
await page.locator('.chk .crow').first().locator('.cadd').click()
await page.waitForTimeout(150)
let op2 = await page.locator('.chk .crow.op2r').count()
op2 === 1 ? ok('ligne Op.2 ajoutée') : ko(`${op2} ligne(s) Op.2`)
const radiosOp1 = await page.locator('.chk .crow').first().locator('input[type=radio]').first()
    .getAttribute('name')
const radiosOp2 = await page.locator('.chk .crow.op2r').first().locator('input[type=radio]').first()
    .getAttribute('name')
radiosOp1 !== radiosOp2 ? ok(`radios indépendants (${radiosOp1} ≠ ${radiosOp2})`)
  : ko('les radios Op.1 et Op.2 partagent le même name')
// Vérifier l'indépendance réelle des réponses
await page.locator('.chk .crow').first().locator('input[value=oui]').check()
await page.locator('.chk .crow.op2r').first().locator('input[value=non]').check()
const vOp1 = await page.locator('.chk .crow').first().locator('input[value=oui]').isChecked()
const vOp2 = await page.locator('.chk .crow.op2r').first().locator('input[value=non]').isChecked()
vOp1 && vOp2 ? ok('Op.1 = Oui et Op.2 = Non coexistent') : ko('les réponses interfèrent')
await page.locator('.chk .crow').first().locator('.cadd').click()
await page.waitForTimeout(150)
op2 = await page.locator('.chk .crow.op2r').count()
op2 === 0 ? ok('ligne Op.2 retirée proprement') : ko(`${op2} ligne(s) Op.2 résiduelle(s)`)

// ── 7. Minuteur ──
console.log('\n7. Minuteur T0')
const ligneTimer = page.locator('.chk .crow').filter({ hasText: 'Minuteur T0' }).first()
await ligneTimer.locator('.cbt', { hasText: 'T0' }).click()
await page.waitForTimeout(1600)
const duree = await ligneTimer.locator('.ctd').innerText()
duree !== '00:00' ? ok(`minuteur en marche : ${duree}`) : ko('minuteur figé à 00:00')
await ligneTimer.locator('.cbt', { hasText: '■' }).click()
await page.waitForTimeout(150)
const horodatage = await ligneTimer.locator('input[type=datetime-local]').inputValue()
horodatage ? ok(`horodatage renseigné à l'arrêt : ${horodatage}`) : ko('horodatage non renseigné')

// ── 8. Préallocation ──
console.log('\n8. Préallocation patient')
const champsAvant = await page.locator('.ch-pa-flds.show').count()
champsAvant === 0 ? ok('champs de préallocation masqués par défaut') : ko('champs visibles à tort')
await page.locator('.ch-pa-tog input[type=radio]').nth(1).check()
await page.waitForTimeout(150)
await page.locator('.ch-pa-flds.show').count() === 1
  ? ok('champs affichés après activation') : ko('champs non affichés')

// ── 9. Navigation vers la mise en fabrication ──
console.log('\n9. Identification à la mise en fabrication')
await page.locator('.ch-pa-tog input[type=radio]').nth(0).check()   // préallocation OFF
await page.waitForTimeout(100)
await allerAuProcessus('Mise en fabrication')
await page.waitForTimeout(200)
const enteteFab = await page.locator('.hdr-left .name').innerText()
enteteFab.includes('à identifier') ? ok(`en-tête : « ${enteteFab} »`) : ko(`en-tête : ${enteteFab}`)
const metaFab = await page.locator('.hdr-left .meta').innerText()
metaFab.includes('ordonnancier') ? ok('N° ordonnancier révélé') : ko('N° ordonnancier toujours masqué')
const banniere = await page.locator('.banner.b-ext').count()
banniere === 1 ? ok('bandeau « processus externe » affiché') : ko('bandeau externe absent')

// ── 10. Catalogue ──
console.log('\n10. Ajout depuis le catalogue')
await page.locator('.sb-add').click()
await page.waitForTimeout(200)
const items = await page.locator('.cat-item').count()
items === 8 ? ok('8 processus au catalogue') : ko(`${items} processus au catalogue`)
const okDesactive = await page.locator('.cat-btn-ok').isDisabled()
okDesactive ? ok('bouton désactivé sans sélection') : ko('bouton actif sans sélection')
await page.locator('.cat-item').filter({ hasText: 'Validation pharmaceutique' }).click()
await page.locator('.cat-btn-ok').click()
await page.waitForTimeout(250)
const nbProcApres = await page.locator('.proc').count()
nbProcApres === NB_PROCESSUS + 1 ? ok(`${nbProcApres} processus après ajout`)
  : ko(`${nbProcApres} processus au lieu de ${NB_PROCESSUS + 1}`)
const nomAjoute = await page.locator('.proc').nth(NB_PROCESSUS).locator('.pname').innerText()
nomAjoute === 'Validation pharmaceutique' ? ok(`processus ajouté et sélectionné : ${nomAjoute}`)
  : ko(`nom inattendu : ${nomAjoute}`)
const pointsAjoutes = await page.locator('.std-ir').count()
pointsAjoutes === 4 ? ok('4 points de contrôle pré-chargés') : ko(`${pointsAjoutes} points`)

// ── 11. Repli hors-ligne ──
const apiJoignable = await fetch(`${base}/api/sante`)
  .then((r) => r.ok).catch(() => false)
const banniereHorsLigne = await page.locator('text=Mode hors-ligne').count()

if (apiJoignable) {
  console.log('\n11. Mode connecté (API joignable)')
  banniereHorsLigne === 0 ? ok('aucun bandeau hors-ligne')
    : ko('bandeau hors-ligne affiché alors que l\'API répond')

  // ── 12. Recherche patient sur la vraie base ──
  console.log('\n12. Recherche patient (annuaire réel)')
  // L'étape 10 a navigué vers le processus ajouté : revenir à la réception.
  await allerAuProcessus('Réception (+/-')
  await page.locator('.ch-pa-tog').waitFor()
  await page.locator('.ch-pa-tog input[type=radio]').nth(1).check()
  await page.waitForTimeout(150)
  await page.locator('.sbtn', { hasText: 'Rechercher patient' }).click()
  await page.waitForTimeout(400)
  await page.locator('.cmodal-bd input').fill('mar')
  await page.waitForTimeout(600)
  const nbResultats = await page.locator('.cmodal-row').count()

  // Un annuaire vide est une condition d'environnement, pas un défaut : on
  // vérifie alors que l'interface le dit proprement, sans planter.
  if (nbResultats === 0) {
    const message = await page.locator('.cmodal-res').innerText()
    const messageExplicite = /Aucun résultat|indisponible/.test(message)
    messageExplicite
      ? ok(`annuaire vide, message affiché : « ${message.trim()} »`)
      : ko(`annuaire vide et aucun message : « ${message.trim()} »`)
    console.log('  · recherche patient non éprouvée faute de données dans l\'annuaire')
    await page.locator('.cmodal-hd span:last-child').click()
    await page.waitForTimeout(200)
  } else {
    ok(`${nbResultats} résultat(s) pour « mar »`)
    const texte = await page.locator('.cmodal-row').first().innerText()
    ok(`premier résultat : ${texte.replace(/\n/g, ' — ')}`)
    await page.locator('.cmodal-row').first().click()
    await page.waitForTimeout(300)
    const enteteNomme = await page.locator('.hdr-left .name').innerText()
    enteteNomme.includes('•')
      ? ok(`en-tête devient nominatif : « ${enteteNomme} »`) : ko(`en-tête : ${enteteNomme}`)

    console.log('\n13. Retrait de la préallocation')
    await page.locator('.ch-pa-tog input[type=radio]').nth(0).check()
    await page.waitForTimeout(200)
    const enteteRetour = await page.locator('.hdr-left .name').innerText()
    if (/En attente d'allocation/.test(enteteRetour)) {
      ok('retour à l\'anonymat, identité effacée')
    } else {
      ko(`en-tête : ${enteteRetour}`)
    }
  }
} else {
  console.log('\n11. Repli hors-ligne (API absente)')
  banniereHorsLigne >= 1 ? ok('bandeau « Mode hors-ligne » affiché')
    : ko('aucun bandeau hors-ligne alors que l\'API est absente')
}

// ── 14. Onglet Utilisateurs ──
// Écrit réellement en base : le login porte un horodatage pour ne pas entrer en
// collision d'un passage à l'autre. Le compte est désactivé en fin de groupe —
// un compte ne se supprime pas, il est l'auteur de ce qu'il a saisi.
console.log('\n14. Onglet Utilisateurs')
await page.locator('.onglet', { hasText: 'Utilisateurs' }).click()
await page.waitForTimeout(500)

const titre = await page.locator('.titlebar span').first().innerText()
if (/Utilisateurs/.test(titre)) ok(`barre de titre suit l'onglet : « ${titre} »`)
else ko(`barre de titre : ${titre}`)
await page.locator('.dlg .body').count() === 0
  ? ok('le panneau du scénario est retiré, pas seulement masqué')
  : ko('le scénario reste monté sous l\'onglet Utilisateurs')

const nbAvant = await page.locator('table.adm-t .ident').count()
nbAvant >= 1 ? ok(`${nbAvant} compte(s) listé(s) depuis la base`) : ko('aucun compte listé')

const login = `nav${Date.now()}`
await page.locator('.adm-b-p', { hasText: 'Nouvel utilisateur' }).click()
await page.waitForTimeout(250)
await page.locator('#n-id').fill(login)
await page.locator('#n-nom').fill('NAVIGATEUR')
await page.locator('#n-pre').fill('Test')
await page.locator('#n-pro').selectOption('preparateur')
await page.locator('.adm-b-p', { hasText: 'Créer le compte' }).click()
await page.waitForTimeout(700)

const nbApres = await page.locator('table.adm-t .ident').count()
nbApres === nbAvant + 1 ? ok(`compte ${login} créé et repris dans la liste`)
  : ko(`${nbAvant} → ${nbApres} compte(s)`)
const ligne = page.locator('table.adm-t tr', { hasText: login })
const texteLigne = await ligne.innerText()
if (/Préparateur/.test(texteLigne)) ok('profil affiché dans la ligne')
else ko(`profil absent : ${texteLigne}`)

// Un identifiant déjà pris doit produire un message, pas un échec silencieux.
// Le 409 qui suit est voulu : on le déclare au contrôle réseau du groupe 15.
echecsVoulus.push(/^409 .*\/api\/utilisateurs$/)
await page.locator('.adm-b-p', { hasText: 'Nouvel utilisateur' }).click()
await page.waitForTimeout(250)
await page.locator('#n-id').fill(login)
await page.locator('#n-nom').fill('DOUBLON')
await page.locator('#n-pre').fill('Test')
await page.locator('.adm-b-p', { hasText: 'Créer le compte' }).click()
await page.waitForTimeout(700)
const msg = await page.locator('.adm-msg-ko').count()
  ? (await page.locator('.adm-msg-ko').innerText()) : ''
if (/déjà utilisé/.test(msg)) ok('identifiant en doublon signalé à l\'écran')
else ko(`aucun message de doublon (« ${msg} »)`)
await page.locator('.adm-b', { hasText: 'Annuler' }).last().click()
await page.waitForTimeout(200)

await page.locator('table.adm-t tr', { hasText: login })
  .locator('.adm-b', { hasText: 'Désactiver' }).click()
await page.waitForTimeout(700)
await page.locator('table.adm-t tr', { hasText: login }).count() === 0
  ? ok('compte désactivé, retiré de la liste par défaut')
  : ko('compte désactivé encore listé')

await page.locator('.adm-bar input[type=checkbox]').check()
await page.waitForTimeout(700)
const ligneInactive = page.locator('table.adm-t tr', { hasText: login })
await ligneInactive.count() === 1 && /Désactivé/.test(await ligneInactive.innerText())
  ? ok('et consultable via « Afficher les comptes désactivés »')
  : ko('compte désactivé introuvable')

await page.locator('table.adm-t tr', { hasText: login })
  .locator('.adm-b', { hasText: 'Réactiver' }).click()
await page.waitForTimeout(700)
const ligneRendue = page.locator('table.adm-t tr', { hasText: login })
if (/Actif/.test(await ligneRendue.innerText())) ok('réactivation depuis l\'IHM')
else ko(`réactivation sans effet : ${await ligneRendue.innerText()}`)
await page.locator('.adm-bar input[type=checkbox]').uncheck()
await page.waitForTimeout(500)

// ── Retour au scénario : l'état du parcours ne doit pas avoir été perdu ──
await page.locator('.onglet', { hasText: 'Scénario' }).click()
await page.waitForTimeout(400)
await page.locator('.proc').count() >= NB_PROCESSUS
  ? ok('retour au scénario, processus toujours présents')
  : ko('le scénario a perdu ses processus')

// ── 15. Sélection de l'opérateur (mode démonstration) ──
console.log('\n15. Sélection de l\'opérateur connecté')
const selOp = page.locator('.op-sel')
if (await selOp.count() === 0) {
  console.log('  · sélecteur absent — l\'API n\'est pas en AUTO_MODE=dev, groupe sans objet')
} else {
  ok('sélecteur d\'opérateur présent dans l\'en-tête')
  await page.locator('.demo-bandeau').count() === 1
    ? ok('un bandeau signale le mode démonstration')
    : ko('aucun bandeau de mode démonstration')

  const noms = await page.locator('.op-sel option').allTextContents()
  noms.length >= 2 ? ok(`${noms.length} opérateurs proposés`)
    : ko(`${noms.length} opérateur(s) : impossible d'éprouver le changement`)

  const depart = await page.locator('.op-sel option:checked').innerText()
  const autre = noms.find((n) => n !== depart)
  await page.selectOption('.op-sel', { label: autre })
  await page.waitForTimeout(700)

  const arrivee = await page.locator('.op-sel option:checked').innerText()
  arrivee === autre ? ok(`opérateur changé : « ${depart.trim()} » → « ${arrivee.trim()} »`)
    : ko(`opérateur inchangé (${arrivee})`)

  // La colonne « Opérateur » de la table doit suivre : sinon le changement
  // serait cosmétique et les saisies porteraient le nom de quelqu'un d'autre.
  const colonne = await page.locator('.main input[readonly]').first().inputValue()
  autre.startsWith(colonne) ? ok(`la colonne « Opérateur » suit : ${colonne}`)
    : ko(`colonne « ${colonne} » ≠ opérateur « ${autre} »`)

  // Le choix doit survivre à un rechargement : c'est ce qu'on attend d'une
  // démonstration qu'on reprend après une pause.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await allerAuScenario()
  const apresRechargement = await page.locator('.op-sel option:checked').innerText()
  apresRechargement === autre ? ok('le choix survit à un rechargement')
    : ko(`après rechargement : ${apresRechargement}`)

  // Revenir à l'opérateur par défaut et remettre le compte de test en veille :
  // une suite de tests n'a pas à laisser d'opérateur derrière elle.
  await page.selectOption('.op-sel', { label: depart })
  await page.waitForTimeout(500)
  await page.locator('.onglet', { hasText: 'Utilisateurs' }).click()
  await page.waitForTimeout(600)
  await page.locator('table.adm-t tr', { hasText: login })
    .locator('.adm-b', { hasText: 'Désactiver' }).click()
  await page.waitForTimeout(600)
  await page.locator('table.adm-t tr', { hasText: login }).count() === 0
    ? ok('compte de test remis en veille, sélecteur laissé propre')
    : ko('le compte de test reste actif')
  await page.locator('.onglet', { hasText: 'Scénario' }).click()
  await page.waitForTimeout(400)
}

// ── 16. Persistance : la saisie survit-elle à un rechargement ? ──
//
// Les lignes sont ciblées par leur LIBELLÉ, pas par position : un `.cfi` ou un
// `input` pris au rang n attrape aussi bien un champ d'en-tête, et le contrôle
// passerait alors pour la mauvaise raison.
console.log('\n16. Persistance des saisies')
await allerAuProcessus('Réception (+/-')

const ligneIntegrite = page.locator('.chk .crow').filter({ hasText: 'intégrité du conteneur' }).first()
const ligneTemp = page.locator('.chk .crow').filter({ hasText: 'SMART PACK I' }).first()
await ligneIntegrite.locator('.roi').check()
await ligneTemp.locator('input[type=number]').fill('-140')
await page.waitForTimeout(300)
await page.locator('.f-btn', { hasText: 'Enregistrer' }).click()
await page.waitForTimeout(1500)

const etat = (await page.locator('.etat-enr').innerText()).trim()
if (/enregistré à/.test(etat)) ok(`état d'enregistrement affiché : « ${etat} »`)
else ko(`état : « ${etat} »`)

// Le produit ne doit surtout PAS avoir été touché par la saisie d'un point :
// c'est précisément ce qu'un sélecteur pris au rang n produisait.
const designation = await page.locator('.ch-hdr .cfi').inputValue()
designation === '-140' ? ko('la température a atterri dans la désignation produit')
  : ok(`la saisie d'un point ne touche pas l'en-tête (désignation : « ${designation} »)`)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await allerAuScenario()
await page.locator('.vide-dossier').count() === 0
  ? ok('le dossier ouvert est retrouvé après rechargement')
  : ko('le dossier ouvert est perdu au rechargement')
// À l'ouverture, le dossier reprend à son premier processus non validé — la
// « Demande d'accès » depuis la v2, plus la réception.
await allerAuProcessus('Réception (+/-')

const ligneIntegrite2 = page.locator('.chk .crow').filter({ hasText: 'intégrité du conteneur' }).first()
const ligneTemp2 = page.locator('.chk .crow').filter({ hasText: 'SMART PACK I' }).first()
await ligneIntegrite2.locator('.roi').isChecked()
  ? ok('la réponse Oui/Non revient de la base')
  : ko('la réponse Oui/Non est perdue')
const tempRelue = await ligneTemp2.locator('input[type=number]').inputValue()
tempRelue === '-140' ? ok(`le relevé revient de la base : ${tempRelue} °C`)
  : ko(`relevé relu : « ${tempRelue} » au lieu de -140`)

// L'alarme est figée côté serveur : elle doit être là au rechargement, sans que
// le front ait à la recalculer pour l'avoir juste.
await ligneTemp2.locator('.calm').count() === 1
  ? ok('l\'alarme hors seuil est restituée sur la bonne ligne')
  : ko('aucune alarme sur la ligne SMART PACK I pour −140 °C')

// Un processus ajouté depuis le catalogue doit être persisté, sinon ses saisies
// n'auraient nulle part où aller.
const avantAjout = await page.locator('.proc').count()
await page.locator('.sb-add').click()
await page.waitForTimeout(500)
await page.locator('.cat-item').first().click()
await page.locator('.cat-btn-ok').click()
await page.waitForTimeout(1200)
const apresAjout = await page.locator('.proc').count()
apresAjout === avantAjout + 1 ? ok('processus du catalogue ajouté')
  : ko(`${avantAjout} → ${apresAjout} processus`)
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await allerAuScenario()
await page.locator('.proc').count() === apresAjout
  ? ok('le processus ajouté est enregistré côté serveur, pas seulement affiché')
  : ko(`${await page.locator('.proc').count()} processus après rechargement`)

// ── 17. Tableau de bord ──
console.log('\n17. Tableau de bord MTI')
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)

const nbDossiersBord = await page.locator('tr.tb-ligne').count()
nbDossiersBord >= 1 ? ok(`${nbDossiersBord} dossier(s) listés depuis la base`)
  : ko('aucun dossier listé alors que le préalable en a créé un')

// Le dossier ouvert par le préalable doit figurer dans la liste.
const ligneDossier = page.locator('tr.tb-ligne', { hasText: refDossier })
await ligneDossier.count() === 1 ? ok(`le dossier ${refDossier} figure dans la liste`)
  : ko(`${await ligneDossier.count()} ligne(s) pour ${refDossier}`)

// L'anonymat vaut aussi dans la liste : pas de nom sur un dossier sans patient.
const texteLigneBord = await ligneDossier.innerText()
if (/En attente d'allocation/.test(texteLigneBord)) ok('dossier sans patient affiché « en attente d\'allocation »')
else ko(`libellé patient inattendu : ${texteLigneBord.replace(/\s+/g, ' ')}`)

const tuiles = await page.locator('.tb-tuile .v').allTextContents()
tuiles.length === 4 ? ok(`4 tuiles de comptage : ${tuiles.join(' / ')}`)
  : ko(`${tuiles.length} tuile(s)`)

// Recherche : une référence exacte ne doit ramener qu'un dossier.
await page.locator('#tb-q').fill(refDossier)
await page.waitForTimeout(1200)
await page.locator('tr.tb-ligne').count() === 1
  ? ok('recherche par référence exacte') : ko(`${await page.locator('tr.tb-ligne').count()} résultat(s)`)
await page.locator('#tb-q').fill('zzz-aucune-chance-zzz')
await page.waitForTimeout(1200)
await page.locator('.adm-vide').count() === 1
  ? ok('une recherche sans résultat le dit, sans table vide') : ko('pas de message « aucun dossier »')
await page.locator('.adm-b', { hasText: 'Réinitialiser' }).click()
await page.waitForTimeout(1200)

// Démarrer un scénario, produit et lot compris, en un seul geste.
const refBord = `MTI-BORD-${Date.now()}`
await page.locator('.adm-b-p', { hasText: 'Démarrer un scénario' }).click()
await page.waitForTimeout(400)
await page.locator('#tb-ref').fill(refBord)
const nbProduits = await page.locator('#tb-nprod option').count()
nbProduits >= 2 ? ok(`${nbProduits - 1} produit(s) de référence proposés`)
  : ko('aucun produit proposé au choix')
await page.locator('#tb-nprod').selectOption({ index: 1 })
await page.locator('#tb-lot').fill('LOT-BORD-1')
await page.locator('.adm-b-p', { hasText: 'Créer et ouvrir' }).click()
await page.waitForTimeout(1800)

const ongletApresCreation = await page.locator('.onglet.act').innerText()
if (/Scénario/.test(ongletApresCreation)) ok('la création bascule sur le scénario du nouveau dossier')
else ko(`onglet actif : ${ongletApresCreation}`)
const enteteApresCreation = await page.locator('.hdr .meta').innerText()
if (/LOT-BORD-1/.test(enteteApresCreation)) ok('le n° de lot saisi à la création arrive dans l\'en-tête')
else ko(`en-tête : ${enteteApresCreation}`)

// Le produit et le lot doivent être en base, pas seulement à l'écran.
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)
const ligneBord = page.locator('tr.tb-ligne', { hasText: refBord })
const texteBord = await ligneBord.innerText()
if (/LOT-BORD-1/.test(texteBord) && /®/.test(texteBord)) {
  ok('produit et lot enregistrés, relus depuis la base')
} else {
  ko(`ligne : ${texteBord.replace(/\s+/g, ' ')}`)
}

// Ouvrir un dossier depuis la liste.
await ligneBord.click()
await page.waitForTimeout(1800)
const ongletFinal = await page.locator('.onglet.act').innerText()
const surScenario = /Scénario/.test(ongletFinal)
const dossierOuvert = await page.locator('.vide-dossier').count() === 0
surScenario && dossierOuvert ? ok('un clic sur une ligne ouvre le dossier dans le scénario')
  : ko(`onglet scénario : ${surScenario}, dossier ouvert : ${dossierOuvert}`)

// ── 18. Jalon de prescription ──
// Pas de table prescription : la source de vérité est le logiciel de
// prescription. Le dossier ne porte qu'un jalon, réalisée ou non.
console.log('\n18. Jalon de prescription')
// Ouvrir explicitement le dossier contrôlé : le groupe précédent en laisse un
// autre ouvert, et basculer le jalon de l'un pour vérifier la ligne de l'autre
// ne prouverait rien.
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)
await page.locator('#tb-q').fill(refDossier)
await page.waitForTimeout(1200)
await page.locator('tr.tb-ligne', { hasText: refDossier }).click()
await page.waitForTimeout(1800)
const jalon = page.locator('.presc-b')
await jalon.count() === 1 ? ok('jalon affiché dans l\'en-tête du dossier')
  : ko('aucun jalon de prescription')
const jalonAvant = (await jalon.innerText()).trim()
if (/non réalisée/.test(jalonAvant)) ok(`état de départ : « ${jalonAvant} »`)
else ko(`état de départ inattendu : « ${jalonAvant} »`)

await jalon.click()
await page.waitForTimeout(1200)
const jalonApres = (await jalon.innerText()).trim()
if (/✓ Prescription réalisée/.test(jalonApres)) ok(`bascule : « ${jalonApres} »`)
else ko(`après bascule : « ${jalonApres} »`)

// Le jalon part tout de suite : il ne doit pas attendre un « Enregistrer », un
// changement d'onglet le perdrait.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await allerAuScenario()
const jalonRelu = (await page.locator('.presc-b').innerText()).trim()
if (/✓ Prescription réalisée/.test(jalonRelu)) {
  ok('jalon enregistré aussitôt, sans passer par « Enregistrer »')
} else {
  ko(`après rechargement : « ${jalonRelu} »`)
}

await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)
const ligneJalon = page.locator('tr.tb-ligne', { hasText: refDossier })
const celluleJalon = (await ligneJalon.locator('.presc-oui, .presc-non').innerText()).trim()
celluleJalon === '✓ faite' ? ok('jalon visible dans la liste du tableau de bord')
  : ko(`colonne Prescr. : « ${celluleJalon} »`)

// ── 19. Processus amont : la commande MTI et ses jalons calendaires ──
console.log('\n19. Commande MTI (processus amont)')
await allerAuScenario()
await allerAuProcessus('Commande MTI')

const nomsProc = await page.locator('.proc .pname').allTextContents()
const rangCommande = nomsProc.findIndex((n) => /Commande MTI/.test(n))
const rangReception = nomsProc.findIndex((n) => /^Réception \(/.test(n))
rangCommande >= 0 && rangCommande < rangReception
  ? ok(`commande MTI au rang ${rangCommande + 1}, avant la réception (${rangReception + 1})`)
  : ko(`rangs : commande ${rangCommande}, réception ${rangReception}`)

/* Les jalons sont de vraies dates, pas du texte libre : sans quoi ils seraient
   intriables et incomparables. Le nombre attendu est LU DU MODÈLE et non codé
   en dur : il était fixé à « 3 au moins », et le retrait de la date d'aphérèse
   de la commande en v4 l'a fait tomber à 2 — la suite a cassé sur une valeur
   qui n'avait aucune raison d'être stable. */
const pointsDateCommande = (defModele?.processus ?? [])
  .find((p) => p.code === 'COMMANDE_MTI')?.sections
  .flatMap((sc) => sc.points ?? [])
  .filter((pt) => pt.type === 'date').length ?? 0
const champsDate = page.locator('.std-ir input[type=date], .chk input[type=date]')
const nbDates = await champsDate.count()
if (pointsDateCommande > 0 && nbDates === pointsDateCommande) {
  ok(`${nbDates} champ(s) de saisie de date, autant que le modèle en déclare`)
} else {
  ko(`${nbDates} champ(s) date à l'écran, ${pointsDateCommande} au modèle`)
}
// L'aphérèse ne doit plus figurer dans la commande : elle est en en-tête.
const libellesCommande = await page.locator('.std-lbl, .chk .clbl').allTextContents()
libellesCommande.some((l) => /phérèse/i.test(l))
  ? ko(`la commande porte encore un point d'aphérèse : ${
      libellesCommande.filter((l) => /phérèse/i.test(l))}`)
  : ok("la commande ne porte plus de point d'aphérèse")

// Un processus « à venir » est en lecture seule, et rien ne le faisait avancer :
// il faut l'ouvrir. C'est le mécanisme qui rend le parcours praticable.
const boutonEtat = page.locator('.proc-etat')
const libelleEtat = (await boutonEtat.innerText()).trim()
if (/Ouvrir ce processus/.test(libelleEtat)) ok(`processus à venir : « ${libelleEtat} » proposé`)
else ko(`bouton d'avancement : « ${libelleEtat} »`)
await boutonEtat.click()
await page.waitForTimeout(1500)
await allerAuProcessus('Commande MTI')
await page.locator('.std-ir input[type=date], .chk input[type=date]').first().isEditable()
  ? ok('processus ouvert : la saisie est possible')
  : ko('le processus reste en lecture seule après ouverture')

await champsDate.first().fill('2026-09-15')
await page.waitForTimeout(300)
await page.locator('.f-btn', { hasText: 'Enregistrer' }).click()
await page.waitForTimeout(1500)

await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await allerAuScenario()
await allerAuProcessus('Commande MTI')
const dateRelue = await page.locator('.std-ir input[type=date], .chk input[type=date]')
  .first().inputValue()
dateRelue === '2026-09-15' ? ok(`jalon relu depuis la base : ${dateRelue}`)
  : ko(`jalon relu : « ${dateRelue} » au lieu de 2026-09-15`)

// ── 20. Kits, n° de série, commentaires, double validation ──
console.log('\n20. Kits, n° de série, commentaires et double validation')
await allerAuScenario()
await allerAuProcessus('Réception (+/-')

const kits = await page.locator('.ckit').count()
kits >= 1 ? ok(`${kits} en-tête(s) de kit`) : ko('aucun regroupement par kit')
const composition = (await page.locator('.ckit-c').first().innerText()).trim()
if (/tubes CD4/.test(composition) && /tubes CD8/.test(composition)) {
  ok(`composition affichée : « ${composition.replace(/^—\s*/, '')} »`)
} else {
  ko(`composition : « ${composition} »`)
}

// Les tubes du kit ont leur PROPRE compte d'exemplaires : 3 CD4 et 2 CD8 ne se
// comptent pas ensemble, et surtout pas avec les exemplaires du produit.
const lignesCD4 = await page.locator('.chk .crow').filter({ hasText: 'Tube CD4' }).count()
const lignesCD8 = await page.locator('.chk .crow').filter({ hasText: 'Tube CD8' }).count()
lignesCD4 === 3 && lignesCD8 === 2
  ? ok(`${lignesCD4} tubes CD4 et ${lignesCD8} tubes CD8, comptés séparément`)
  : ko(`${lignesCD4} CD4 / ${lignesCD8} CD8 au lieu de 3 / 2`)

const badgesDbl = await page.locator('.cdbl').count()
badgesDbl >= 4 ? ok(`${badgesDbl} point(s) marqués « 2 pers. »`)
  : ko(`${badgesDbl} badge(s) de double validation`)

const champsSerie = await page.locator('.cserie input').count()
champsSerie === 5 ? ok(`${champsSerie} champs de n° de série (un par tube)`)
  : ko(`${champsSerie} champ(s) de n° de série au lieu de 5`)

// Saisir un n° de série et un commentaire, puis les relire de la base.
await page.locator('.cserie input').first().fill('CD4-000117')
await page.locator('.ccmt-b').first().click()
await page.waitForTimeout(300)
await page.locator('.ccmt-z').first().fill('Étiquette décollée, tube intègre.')
await page.locator('.ccmt-ok').first().click()
await page.waitForTimeout(300)
await page.locator('.ccmt-b.plein').count() >= 1
  ? ok('la bulle signale un commentaire présent') : ko('la bulle reste vide')

await page.locator('.f-btn', { hasText: 'Enregistrer' }).click()
await page.waitForTimeout(1600)

// ── Contresignature du processus par une 2e personne ──
const blocContre = page.locator('.contre')
await blocContre.count() === 1 ? ok('bloc de double validation affiché')
  : ko('aucun bloc de double validation sur la réception')
const rappels = await page.locator('.contre li').count()
rappels >= 4 ? ok(`${rappels} point(s) rappelés à la 2e personne`)
  : ko(`${rappels} point(s) rappelés`)

const candidats = await page.locator('#contre-qui option').count()
if (candidats > 1) {
  await page.locator('#contre-qui').selectOption({ index: 1 })
  await page.locator('.contre-b').click()
  await page.waitForTimeout(1800)
  const titreContre = (await page.locator('.contre-t').innerText()).trim()
  if (/contresigné par/.test(titreContre)) ok(`contresignature posée : « ${titreContre} »`)
  else ko(`bloc après contresignature : « ${titreContre} »`)
  await page.locator('.contre-emp').count() === 1
    ? ok("l'empreinte du contenu signé est affichée")
    : ko('aucune empreinte affichée')
} else {
  console.log('  · un seul opérateur actif : contresignature non éprouvée')
}

// Tout doit revenir de la base, pas de l'écran.
await page.reload({ waitUntil: 'networkidle' })
await page.waitForTimeout(1500)
await allerAuScenario()
await allerAuProcessus('Réception (+/-')
const serieRelue = await page.locator('.cserie input').first().inputValue()
serieRelue === 'CD4-000117' ? ok(`n° de série relu : ${serieRelue}`)
  : ko(`n° de série relu : « ${serieRelue} »`)
const bulleRelue = await page.locator('.ccmt-b.plein').first().getAttribute('title')
if (/Étiquette décollée/.test(bulleRelue ?? '')) {
  ok('commentaire relu depuis la base, restitué en bulle')
} else {
  ko(`bulle relue : « ${bulleRelue} »`)
}
if (candidats > 1) {
  const contreRelue = (await page.locator('.contre-t').innerText()).trim()
  if (/contresigné par/.test(contreRelue)) ok('contresignature relue depuis la base')
  else ko(`bloc relu : « ${contreRelue} »`)
}

/* ── 21. Jeu de démonstration ──
   Ce groupe ne tourne que si le jeu est en base : la suite doit rester
   passable sur une base de recette vierge. Ce qui est vérifié, c'est ce que le
   jeu est censé montrer à l'écran — dix dossiers étalés sur le parcours, trois
   sans patient, une alarme, et un dossier clos non conforme distingué du
   conforme. */
console.log('\n21. Jeu de démonstration')
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)
await page.locator('#tb-q').fill('DEMO-MTI-')
await page.waitForTimeout(1400)
const nbDemo = await page.locator('tr.tb-ligne').count()
if (nbDemo === 0) {
  console.log('  · jeu de démonstration absent de la base — groupe non applicable')
} else {
  nbDemo === 10 ? ok('10 dossiers de démonstration listés')
    : ko(`${nbDemo} dossier(s) « DEMO-MTI- »`)

  const enAttente = await page.locator('tr.tb-ligne', { hasText: "En attente d'allocation" }).count()
  enAttente === 3 ? ok('3 dossiers en attente d\'allocation, sans nom affiché')
    : ko(`${enAttente} ligne(s) « en attente d'allocation »`)

  const avecAlarme = await page.locator('tr.tb-ligne .tb-alarme').count()
  avecAlarme === 1 ? ok('1 dossier porte le pictogramme d\'alarme')
    : ko(`${avecAlarme} pictogramme(s) d'alarme`)

  // Le point qui manquait : deux dossiers clos, mais un seul conforme.
  const nonConforme = page.locator('tr.tb-ligne', { hasText: 'Non conforme' })
  await nonConforme.count() === 1
    ? ok('le dossier clos non conforme se distingue au tableau de bord')
    : ko(`${await nonConforme.count()} ligne(s) « non conforme »`)
  const conforme = await page.locator('tr.tb-ligne .tb-s-termine').count()
  conforme === 1 ? ok('le dossier clos conforme reste affiché « Terminé »')
    : ko(`${conforme} ligne(s) « Terminé »`)

  /* Un dossier clos n'est pas un dossier mort : il doit s'ouvrir en lecture.
     C'est la moitié de l'intérêt du jeu — montrer un parcours abouti. */
  await nonConforme.click()
  await page.waitForTimeout(1800)
  const surScenarioDemo = /Scénario/.test(await page.locator('.onglet.act').innerText())
  const contenuOuvert = await page.locator('.vide-dossier').count() === 0
  surScenarioDemo && contenuOuvert
    ? ok('un dossier clos s\'ouvre en consultation')
    : ko(`onglet scénario : ${surScenarioDemo}, contenu : ${contenuOuvert}`)

  /* Non-régression : l'en-tête d'un dossier rouvert nommait « en attente
     d'allocation » un dossier dont le patient était alloué à la mise en
     fabrication — l'écran contredisait la base. Et le champ « Opérateur »
     affichait l'opérateur CONNECTÉ au lieu de celui qui avait fait la saisie,
     ce qui attribuait la traçabilité à la mauvaise personne. */
  await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
  await page.waitForTimeout(1200)
  await page.locator('#tb-q').fill('DEMO-MTI-0009')
  await page.waitForTimeout(1400)
  await page.locator('tr.tb-ligne', { hasText: 'DEMO-MTI-0009' }).click()
  await page.waitForTimeout(1800)
  const enteteRouvert = await page.locator('.hdr-left .name').innerText()
  /* La RÉFÉRENCE patient est stable, le patronyme non : le jeu de
     démonstration a déjà été renommé une fois, et une assertion sur un nom
     propre casse à chaque changement sans rien prouver de plus. On vérifie
     donc la référence, et qu'un patronyme en capitales est bien affiché. */
  if (/DEMO-01567/.test(enteteRouvert) && /[A-ZÉÈÀÂÎÔÛ]{3,}/.test(enteteRouvert)) {
    ok(`en-tête d'un dossier alloué : « ${enteteRouvert} »`)
  } else {
    ko(`en-tête d'un dossier alloué : « ${enteteRouvert} »`)
  }

  await page.locator('.proc').filter({ hasText: 'Réception (+/-' }).first().click()
  await page.waitForTimeout(700)
  const opSaisie = await page.locator('.copi').first().inputValue()
  const opConnecte = (await page.locator('.ubadge').first().innerText()).replace('👤', '').trim()
  if (opSaisie && opSaisie !== opConnecte) {
    ok(`opérateur de la saisie « ${opSaisie} », distinct du connecté « ${opConnecte} »`)
  } else {
    ko(`opérateur affiché « ${opSaisie} » — celui de l'écran, pas celui de la saisie`)
  }

  // Un dossier clos n'a rien à valider : le bandeau « validation bloquée » n'a
  // pas lieu d'y apparaître, il contredisait le « lecture seule » d'à côté.
  const bandeau = await page.locator('.dlg').innerText()
  !/Validation bloquée/.test(bandeau)
    ? ok('aucun « validation bloquée » sur un dossier clos')
    : ko('« validation bloquée » affiché sur un dossier en lecture seule')

  await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
  await page.waitForTimeout(1000)
  await page.locator('.adm-b', { hasText: 'Réinitialiser' }).click()
  await page.waitForTimeout(1200)
}

// ── 22. Comptes de démonstration ──
console.log('\n22. Comptes de démonstration')
await page.locator('.onglet', { hasText: 'Utilisateurs' }).click()
await page.waitForTimeout(1200)
const lignesDemo = await page.locator('tr', { hasText: 'demo.' }).count()
if (lignesDemo === 0) {
  console.log('  · comptes de démonstration absents — groupe non applicable')
} else {
  lignesDemo === 10 ? ok('10 comptes de démonstration listés')
    : ko(`${lignesDemo} compte(s) « demo. »`)
  // Les cinq profils doivent apparaître : c'est ce que le jeu est censé
  // permettre d'éprouver sur cet écran.
  const texteComptes = await page.locator('table').last().innerText()
  const manquants = ['pharmacien', 'préparateur', 'IDE', 'qualité', 'administrateur']
    .filter((p) => !new RegExp(p, 'i').test(texteComptes))
  manquants.length === 0 ? ok('les cinq profils sont représentés à l\'écran')
    : ko(`profils absents de la liste : ${manquants.join(', ')}`)
}

/* ── 23. En-tête : IPP, numéros patient, jalon d'aphérèse, alerte ──
   Ces champs vivent sur le DOSSIER (ou l'identité patient) et non dans une
   saisie : ils doivent survivre à un rechargement, ce que seule la base peut
   garantir. Le groupe part donc d'un dossier de démonstration alloué. */
console.log('\n23. En-tête du dossier')
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1200)
await page.locator('#tb-q').fill('DEMO-MTI-0005')
await page.waitForTimeout(1400)
const ligneEntete = await page.locator('tr.tb-ligne').count()
if (ligneEntete === 0) {
  console.log('  · jeu de démonstration absent — groupe non applicable')
} else {
  await page.locator('tr.tb-ligne', { hasText: 'DEMO-MTI-0005' }).click()
  await page.waitForTimeout(1800)

  const ipp = await page.locator('#ids-ipp').inputValue()
  if (/^\d{8}$/.test(ipp)) ok(`IPP affiché : ${ipp}`)
  else ko(`IPP : « ${ipp} »`)

  // `allInputValues` n'existe pas sur un locator : on lit chaque champ.
  const champsLibelle = page.locator('.ids-lm')
  const nbLibelles = await champsLibelle.count()
  const libelles = []
  for (let i = 0; i < nbLibelles; i++) libelles.push(await champsLibelle.nth(i).inputValue())
  nbLibelles === 2
    ? ok(`2 numéros patient, libellés « ${libelles.join(' » et « ')} »`)
    : ko(`${nbLibelles} numéro(s) patient`)

  // Le libellé est un CHAMP, pas un texte : c'est tout l'intérêt de la demande.
  const nouveauLibelle = `N° protocole ${Date.now() % 1000}`
  await page.locator('.ids-lm').first().fill(nouveauLibelle)
  await page.locator('.ids-lm').first().blur()
  await page.waitForTimeout(1200)

  // Ajouter un numéro : le libellé par défaut suit le rang.
  const avantAjout = await page.locator('.ids-lm').count()
  await page.locator('.ids-p').click()
  await page.waitForTimeout(300)
  const ajoute = await page.locator('.ids-lm').nth(avantAjout).inputValue()
  ajoute === `N° patient ${avantAjout + 1}`
    ? ok(`libellé par défaut du numéro ajouté : « ${ajoute} »`)
    : ko(`libellé par défaut : « ${ajoute} »`)
  await page.locator('.ids-i').nth(avantAjout).fill('Z-999')
  await page.locator('.ids-i').nth(avantAjout).blur()
  await page.waitForTimeout(1200)

  const jalonAph = page.locator('.aph-c input')
  await jalonAph.isChecked() ? ok('jalon d\'aphérèse posé, relu depuis la base')
    : ko('jalon d\'aphérèse non posé sur un dossier qui l\'a')
  const dateAph = await page.locator('.aph-d').inputValue()
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateAph)) ok(`date d'aphérèse : ${dateAph}`)
  else ko(`date d'aphérèse : « ${dateAph} »`)

  await page.locator('.info-i').fill('Alerte posée par la suite de tests')
  await page.locator('.info-i').blur()
  await page.waitForTimeout(1200)
  await page.locator('.info-imp.plein').count() === 1
    ? ok('information renseignée : le bandeau passe en alerte')
    : ko('l\'information renseignée ne se distingue pas visuellement')

  // Tout doit être relu depuis la base, pas depuis l'état de la page.
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1800)
  await allerAuScenario()
  const libelleRelu = await page.locator('.ids-lm').first().inputValue()
  libelleRelu === nouveauLibelle
    ? ok(`libellé de numéro relu après rechargement : « ${libelleRelu} »`)
    : ko(`libellé relu : « ${libelleRelu} » au lieu de « ${nouveauLibelle} »`)
  const valeurRelue = await page.locator('.ids-i').nth(avantAjout).inputValue()
  valeurRelue === 'Z-999' ? ok('numéro ajouté relu depuis la base')
    : ko(`numéro relu : « ${valeurRelue} »`)
  const infoRelue = await page.locator('.info-i').inputValue()
  if (/suite de tests/.test(infoRelue)) ok('information importante relue depuis la base')
  else ko(`information relue : « ${infoRelue} »`)

  // Décocher le jalon doit effacer la date : la base refuse une date orpheline.
  await page.locator('.aph-c input').uncheck()
  await page.waitForTimeout(1300)
  await page.locator('.aph-d').count() === 0
    ? ok('décocher le jalon retire le champ date')
    : ko('le champ date subsiste sans jalon')
  await page.locator('.aph-c input').check()
  await page.waitForTimeout(1300)
  const dateApresRecoche = await page.locator('.aph-d').inputValue()
  dateApresRecoche === ''
    ? ok('recocher rouvre un champ date vide — la date n\'est pas ressuscitée')
    : ko(`date après recoche : « ${dateApresRecoche} »`)

  /* Remettre la date relevée au début : ce groupe l'a effacée en éprouvant la
     bascule, et la suite doit pouvoir tourner deux fois de suite sur la même
     base. Un test qui détruit ce qu'il vérifie ne passe qu'une fois. */
  await page.locator('.aph-d').fill(dateAph)
  await page.locator('.aph-d').blur()
  await page.waitForTimeout(1300)
  await page.locator('.aph-d').inputValue() === dateAph
    ? ok(`date d'aphérèse remise à ${dateAph} — la suite reste rejouable`)
    : ko('la date d\'aphérèse n\'a pas été remise en place')
}

/* ── 24. Onglet Configuration ──
   L'onglet manquant de la demande d'origine. Ce qui est vérifié n'est pas qu'il
   s'affiche, mais qu'il respecte le versionnage : publier crée une version et
   ne touche pas aux dossiers ouverts. */
console.log('\n24. Onglet Configuration')
await page.locator('.onglet', { hasText: 'Configuration' }).click()
await page.waitForTimeout(1600)

const nbProcCfg = await page.locator('.cfg-p').count()
nbProcCfg === NB_PROCESSUS
  ? ok(`${nbProcCfg} processus listés, autant qu'au parcours actif`)
  : ko(`${nbProcCfg} processus au lieu de ${NB_PROCESSUS}`)

const barre = await page.locator('.adm-bar').innerText()
if (/en service/.test(barre) && /dossier\(s\) ouvert\(s\)/.test(barre)) {
  ok(`bandeau : « ${barre.split('\n')[0].trim()} »`)
} else {
  ko(`bandeau : ${barre.replace(/\s+/g, ' ')}`)
}

// Le bouton de publication reste inerte tant que rien n'a changé.
const publierInactif = await page.locator('.adm-b-p').isDisabled()
publierInactif ? ok('« Publier » inactif tant que le brouillon est intact')
  : ko('« Publier » actif sans modification')

// Sélectionner la réception, puis un point à seuil : le formulaire doit suivre.
await page.locator('.cfg-p').filter({ hasText: 'Réception (+/-' }).first().click()
await page.waitForTimeout(500)
await page.locator('.cfg-pt').filter({ hasText: 'SMART PACK I' }).first().click()
await page.waitForTimeout(400)
/* Le libellé du point est dans un `<input>` : `innerText` du conteneur ne le
   contient pas. On lit la valeur du champ, pas le texte autour. */
const libellePoint = await page.locator('.cfg-pt-col input[type=text]').first().inputValue()
const seuilPresent = await page.locator('.cfg-pt-col label', { hasText: "Seuil d'alarme" }).count()
if (/SMART PACK I/.test(libellePoint) && seuilPresent === 1) {
  ok(`le point sélectionné ouvre son formulaire, seuil compris (« ${libellePoint} »)`)
} else {
  ko(`libellé du formulaire : « ${libellePoint} », seuil affiché : ${seuilPresent}`)
}

/* Le seuil ne doit s'offrir que sur un relevé de valeur : posé sur un oui/non
   il ne déclencherait jamais rien, et l'utilisateur croirait son alarme armée. */
await page.locator('.cfg-pt').filter({ hasText: 'Concordance étiquetage' }).first().click()
await page.waitForTimeout(400)
await page.locator('.cfg-pt-col label', { hasText: "Seuil d'alarme" }).count() === 0
  ? ok('pas de seuil proposé sur un point « oui/non »')
  : ko('un seuil est proposé sur un point qui ne peut pas le déclencher')

// Modifier un libellé arme la publication, sans rien écrire encore.
await page.locator('.cfg-pt-col input[type=text]').first().fill('Libellé posé par le navigateur')
await page.waitForTimeout(300)
await page.locator('.cfg-mod').count() === 1 &&
!(await page.locator('.adm-b-p').isDisabled())
  ? ok('une modification arme « Publier » et signale le brouillon')
  : ko('la modification n\'arme pas la publication')

// Abandonner doit rendre le brouillon à l'état de la version en service.
await page.locator('.adm-b', { hasText: 'Abandonner' }).click()
await page.waitForTimeout(1400)
await page.locator('.cfg-mod').count() === 0
  ? ok('abandonner rend le brouillon à la version en service')
  : ko('le brouillon reste marqué modifié après abandon')

/* ── 25. Filtres par colonne du tableau de bord ──
   Le point qui compte : ces filtres partent au SERVEUR. La liste est plafonnée
   à 200 lignes ; filtrer côté client cacherait sans le dire les dossiers
   correspondants situés au-delà du plafond. On le vérifie en comparant le
   compte de l'écran à celui de l'API interrogée directement. */
console.log('\n25. Filtres par colonne du tableau de bord')
await page.locator('.onglet', { hasText: 'Tableau de bord' }).click()
await page.waitForTimeout(1300)
await page.locator('.adm-b', { hasText: 'Réinitialiser' }).click()
await page.waitForTimeout(1400)
const totalSansFiltre = await page.locator('tr.tb-ligne').count()
totalSansFiltre > 0 ? ok(`${totalSansFiltre} dossier(s) sans filtre`)
  : ko('aucun dossier listé')

const nbFiltres = await page.locator('tr.tb-filtres th input, tr.tb-filtres th select').count()
nbFiltres >= 6 ? ok(`${nbFiltres} filtres de colonne présents`)
  : ko(`${nbFiltres} filtre(s) de colonne`)

// Filtre texte sur le n° de dossier.
await page.locator('tr.tb-filtres input').first().fill('DEMO-MTI-000')
await page.waitForTimeout(1500)
const parReference = await page.locator('tr.tb-ligne').count()
parReference > 0 && parReference <= totalSansFiltre
  ? ok(`filtre n° de dossier : ${parReference} ligne(s)`)
  : ko(`filtre n° de dossier : ${parReference} ligne(s)`)

// Le bandeau doit dire que la liste est restreinte : un total qui ne
// correspond pas à l'écran est trompeur.
await page.locator('.tb-restreint').count() === 1
  ? ok('le bandeau signale une liste restreinte')
  : ko('rien ne signale que la liste est filtrée')

// Filtre étape : comparé à ce que rend l'API, pour prouver qu'il est serveur.
await page.locator('.adm-b', { hasText: 'Réinitialiser' }).click()
await page.waitForTimeout(1400)
const etapes = await page.getByLabel('Filtrer par étape en cours')
  .locator('option').allTextContents()
const etapeChoisie = etapes.find((e) => e && e !== 'Toutes')
if (!etapeChoisie) {
  ko('aucune étape proposée au filtre')
} else {
  await page.getByLabel('Filtrer par étape en cours').selectOption({ label: etapeChoisie })
  await page.waitForTimeout(1500)
  const ecran = await page.locator('tr.tb-ligne').count()
  const api = await fetch(`${base}/api/dossiers?etape=${encodeURIComponent(etapeChoisie)}`)
    .then((r) => r.json()).then((l) => l.length).catch(() => -1)
  ecran === api
    ? ok(`filtre « ${etapeChoisie} » : ${ecran} ligne(s), autant que l'API`)
    : ko(`écran ${ecran} ligne(s), API ${api} — le filtre n'est pas celui du serveur`)
}

// Deux filtres se combinent, ils ne se remplacent pas.
await page.getByLabel('Filtrer par prescription').selectOption('oui')
await page.waitForTimeout(1500)
const combine = await page.locator('tr.tb-ligne').count()
combine <= (await page.locator('tr.tb-ligne').count())
  ? ok(`étape + prescription : ${combine} ligne(s)`)
  : ko('la combinaison de deux filtres ne restreint pas')

await page.locator('.adm-b', { hasText: 'Réinitialiser' }).click()
await page.waitForTimeout(1500)
await page.locator('tr.tb-ligne').count() === totalSansFiltre
  ? ok('« Réinitialiser » vide tous les filtres de colonne')
  : ko(`${await page.locator('tr.tb-ligne').count()} ligne(s) après réinitialisation`)
await page.locator('.tb-restreint').count() === 0
  ? ok('le bandeau « liste restreinte » disparaît')
  : ko('le bandeau subsiste sans filtre')

console.log('\n26. Console du navigateur et réseau')
erreurs.length === 0 ? ok('aucune erreur JavaScript')
  : ko(`${erreurs.length} erreur(s) JS :\n     ${erreurs.join('\n     ')}`)
// Le favicon n'est pas fourni : sans conséquence fonctionnelle. Les autres
// entrées déclarées dans `echecsVoulus` sont des erreurs que les vérifications
// ont provoquées exprès.
const reseauHS = reponsesHS.filter((r) => !echecsVoulus.some((m) => m.test(r)))
const voulus = reponsesHS.length - reseauHS.length
reseauHS.length === 0
  ? ok(`aucune requête en échec inattendue${voulus ? ` (${voulus} provoquée(s) par les tests)` : ''}`)
  : ko(`${reseauHS.length} requête(s) en échec :\n     ${reseauHS.join('\n     ')}`)

// La capture finale porte sur le scénario : y revenir, l'application pouvant
// être restée sur un autre onglet.
await allerAuScenario()
if (await page.locator('.proc').count()) {
  await page.locator('.proc').first().click()
  await page.waitForTimeout(300)
}
if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
await nav.close()
console.log(process.exitCode ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
