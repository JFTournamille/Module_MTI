/**
 * Charge les référentiels de `shared/` dans la base et crée l'utilisateur de
 * développement. Idempotent : rejouable sans effet de bord.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lire = async (f) => JSON.parse(await readFile(join(racine, 'shared', f), 'utf8'))

/**
 * Tous les parcours de `shared/`, pas seulement le dernier connu du code.
 *
 * Les modèles sont versionnés et une seule version est active par code : une
 * version retirée du service doit rester EN BASE, sinon les dossiers qui la
 * référencent deviendraient illisibles — ce qui viderait de son sens le
 * figement de la définition dans le dossier.
 *
 * La version la plus haute de chaque code devient l'active. Les autres sont
 * chargées ou rafraîchies, puis désactivées.
 */
const fichiersParcours = (await readdir(join(racine, 'shared')))
  .filter((f) => /^parcours-.*\.json$/.test(f))
  .sort()
const parcours = await Promise.all(fichiersParcours.map(lire))
const versionActive = new Map()
for (const p of parcours) {
  const courant = versionActive.get(p.code)
  if (!courant || p.version > courant.version) versionActive.set(p.code, p)
}

const catalogue = await lire('catalogue-processus-v1.json')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // ── Modèles de parcours ──
  // Insertion en INACTIF d'abord : la base n'admet qu'une version active par
  // code, activer avant d'avoir désactivé l'ancienne violerait la contrainte.
  for (const p of parcours) {
    await client.query(
      `INSERT INTO mti.modele_parcours (code, version, libelle, definition, actif, publie_le)
       VALUES ($1, $2, $3, $4, false, now())
       ON CONFLICT (code, version) DO UPDATE
         SET definition = EXCLUDED.definition, libelle = EXCLUDED.libelle`,
      [p.code, p.version, p.libelle, JSON.stringify(p)]
    )
  }
  for (const [code, active] of versionActive) {
    await client.query(
      'UPDATE mti.modele_parcours SET actif = false WHERE code = $1 AND version <> $2',
      [code, active.version])
    await client.query(
      'UPDATE mti.modele_parcours SET actif = true WHERE code = $1 AND version = $2',
      [code, active.version])
    const retirees = parcours.filter((p) => p.code === code && p.version !== active.version)
    console.log(
      `✓ modèle ${code} v${active.version} actif — ${active.processus.length} processus` +
      (retirees.length
        ? ` (v${retirees.map((p) => p.version).join(', v')} conservée(s) hors service)`
        : ''))
  }

  // ── Catalogue ──
  await client.query(
    `INSERT INTO mti.catalogue_processus (code, version, definition, actif)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (code, version) DO UPDATE SET definition = EXCLUDED.definition`,
    [catalogue.code, catalogue.version, JSON.stringify(catalogue)]
  )
  const nbItems = catalogue.groupes.reduce((a, g) => a + g.items.length, 0)
  console.log(`✓ catalogue v${catalogue.version} — ${nbItems} processus disponibles`)

  // ── Produits de référence ──
  const produits = [
    ['KYMRIAH®', 'tisagenlecleucel', 'Novartis', -150],
    ['YESCARTA®', 'axicabtagene ciloleucel', 'Kite/Gilead', -150],
    ['TECARTUS®', 'brexucabtagene autoleucel', 'Kite/Gilead', -150],
    ['CARVYKTI®', 'ciltacabtagene autoleucel', 'Janssen', -150]
  ]
  for (const [denomination, dci, labo, seuil] of produits) {
    await client.query(
      `INSERT INTO mti.produit (denomination, dci, laboratoire, seuil_temp_c)
       VALUES ($1, $2, $3, $4) ON CONFLICT (denomination) DO NOTHING`,
      [denomination, dci, labo, seuil])
  }
  console.log(`✓ ${produits.length} produits de référence`)

  // ── Utilisateur de développement ──
  if ((process.env.AUTH_MODE ?? 'dev') === 'dev' && process.env.NODE_ENV !== 'production') {
    const { rows } = await client.query(
      `INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction)
       VALUES ('mdurand', 'DURAND', 'Martin', 'M.', 'préparateur')
       ON CONFLICT (identifiant) DO UPDATE SET actif = true
       RETURNING id`)
    console.log(`✓ utilisateur de développement — DEV_UTILISATEUR_ID=${rows[0].id}`)
  }

  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  console.error(`✗ seed : ${e.message}`)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
