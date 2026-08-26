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
entete.includes('Non affecté') ? ok(`en-tête : « ${entete} »`) : ko(`en-tête inattendu : ${entete}`)
await page.locator('.hdr-left .meta').innerText().then(t =>
  !t.includes('ordonnancier') ? ok('N° ordonnancier masqué avant la fabrication')
    : ko('N° ordonnancier visible trop tôt'))

// ── 3. Checklist de réception ──
console.log('\n3. Réception')
const nbSections = await page.locator('.chk .csec').count()
nbSections === 6 ? ok('6 sections') : ko(`${nbSections} sections au lieu de 6`)
let nbLignes = await page.locator('.chk .crow').count()
nbLignes === 24 ? ok('24 points de contrôle (n=1)') : ko(`${nbLignes} lignes au lieu de 24`)

// ── 4. Duplication réactive par n exemplaires ──
console.log('\n4. Duplication n exemplaires (sans bouton « Appliquer »)')
await page.locator('.ch-meta input[type=number]').fill('3')
await page.waitForTimeout(200)
nbLignes = await page.locator('.chk .crow').count()
// 24 points dont 8 marqués multi (1.5, 2.1, 2.2, 2.3, 3.2, 5.1, 5.2, 5.3) → 24 + 8*2 = 40
nbLignes === 40 ? ok('40 lignes avec n=3 (8 points multi × 3)')
  : ko(`${nbLignes} lignes au lieu de 40`)
const badgesEx = await page.locator('.chk .cmul').filter({ hasText: 'Ex. 2/3' }).count()
badgesEx > 0 ? ok(`badges « Ex. 2/3 » présents (${badgesEx})`) : ko('badges exemplaire absents')
await page.locator('.ch-meta input[type=number]').fill('1')
await page.waitForTimeout(200)
nbLignes = await page.locator('.chk .crow').count()
nbLignes === 24 ? ok('retour à 24 lignes (aucune copie orpheline)') : ko(`${nbLignes} lignes après retour à n=1`)

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
    enteteRetour.includes('Non affecté')
      ? ok('retour à l\'anonymat, identité effacée') : ko(`en-tête : ${enteteRetour}`)
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
console.log('\n19. Commande MTI (parcours v2)')
await allerAuScenario()
await allerAuProcessus('Commande MTI')

const nomsProc = await page.locator('.proc .pname').allTextContents()
const rangCommande = nomsProc.findIndex((n) => /Commande MTI/.test(n))
const rangReception = nomsProc.findIndex((n) => /^Réception \(/.test(n))
rangCommande >= 0 && rangCommande < rangReception
  ? ok(`commande MTI au rang ${rangCommande + 1}, avant la réception (${rangReception + 1})`)
  : ko(`rangs : commande ${rangCommande}, réception ${rangReception}`)

// Les jalons sont de vraies dates, pas du texte libre : sans quoi ils seraient
// intriables et incomparables.
const champsDate = page.locator('.std-ir input[type=date], .chk input[type=date]')
const nbDates = await champsDate.count()
nbDates >= 3 ? ok(`${nbDates} champ(s) de saisie de date`)
  : ko(`${nbDates} champ(s) date au lieu de 3 au moins`)

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

console.log('\n20. Console du navigateur et réseau')
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
