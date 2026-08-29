import { chromium } from 'playwright'
const S = process.argv[2]
const nav = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await nav.newPage({ viewport: { width: 1440, height: 1050 } })
const erreurs = []
page.on('pageerror', (e) => erreurs.push(e.message))
await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
await page.locator('.onglet', { hasText: 'Configuration' }).click()
await page.waitForTimeout(1800)
await page.locator('.cfg-sst-b', { hasText: 'Point de contrôle' }).click()
await page.waitForTimeout(800)
// Un point lié au médicament : la section reste, et l'aperçu se voit
await page.locator('.cfg-l .ci').filter({ hasText: 'Température cuve' }).first().click()
await page.waitForTimeout(600)
await page.locator('.cfg-r .apercu').scrollIntoViewIfNeeded()
await page.waitForTimeout(300)
await page.screenshot({ path: S + '/cfg-apercu.png' })
// Bulle d'aide sur le gabarit
await page.locator('.cfg-sst-b', { hasText: 'Processus' }).click()
await page.waitForTimeout(700)
const aides = await page.locator('.cfg-r .aide-i').count()
await page.locator('.cfg-r .aide-i').nth(1).hover()
await page.waitForTimeout(700)
await page.screenshot({ path: S + '/cfg-aide.png' })
console.log('aides dans le formulaire processus :', aides)
console.log('erreurs JS :', erreurs.length ? erreurs : 'aucune')
await nav.close()
