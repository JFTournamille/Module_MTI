/**
 * Charge les référentiels de `shared/` dans la base et crée l'utilisateur de
 * développement. Idempotent : rejouable sans effet de bord.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lire = async (f) => JSON.parse(await readFile(join(racine, 'shared', f), 'utf8'))

const parcours = await lire('parcours-cart-v1.json')
const catalogue = await lire('catalogue-processus-v1.json')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // ── Modèle de parcours ──
  await client.query(
    `INSERT INTO mti.modele_parcours (code, version, libelle, definition, actif, publie_le)
     VALUES ($1, $2, $3, $4, true, now())
     ON CONFLICT (code, version) DO UPDATE
       SET definition = EXCLUDED.definition, libelle = EXCLUDED.libelle`,
    [parcours.code, parcours.version, parcours.libelle, JSON.stringify(parcours)]
  )
  console.log(`✓ modèle ${parcours.code} v${parcours.version} — ${parcours.processus.length} processus`)

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
