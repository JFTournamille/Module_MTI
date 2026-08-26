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

// ── 1. Structure d'ensemble ──
console.log('\n1. Structure')
for (const [sel, nom] of [['.dlg', 'fenêtre'], ['.titlebar', 'barre de titre'],
  ['.sidebar', 'barre latérale'], ['.main', 'panneau principal'], ['.footer', 'pied']]) {
  await page.locator(sel).count() ? ok(nom) : ko(nom)
}
const nbProc = await page.locator('.proc').count()
nbProc === 12 ? ok(`12 processus dans la barre latérale`) : ko(`${nbProc} processus au lieu de 12`)

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
await page.locator('.proc').nth(4).click()                          // processus 5
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
nbProcApres === 13 ? ok('13 processus après ajout') : ko(`${nbProcApres} processus`)
const nomAjoute = await page.locator('.proc').nth(12).locator('.pname').innerText()
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
  await page.locator('.proc').first().click()
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

// ── Retour au scénario : l'état du parcours ne doit pas avoir été perdu ──
await page.locator('.onglet', { hasText: 'Scénario' }).click()
await page.waitForTimeout(400)
await page.locator('.proc').count() >= 12
  ? ok('retour au scénario, processus toujours présents')
  : ko('le scénario a perdu ses processus')

console.log('\n15. Console du navigateur et réseau')
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

await page.locator('.proc').first().click()
await page.waitForTimeout(300)
if (process.argv[2]) await page.screenshot({ path: process.argv[2] })
await nav.close()
console.log(process.exitCode ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
