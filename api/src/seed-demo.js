/**
 * Patients fictifs, pour éprouver la recherche patient sans annuaire SIH.
 *
 * Trois précautions, parce qu'un patient fictif dans une base MTI de
 * production pourrait être rattaché à un dossier réel :
 *
 *  1. ils portent `source = 'DEMO'` et une référence préfixée `DEMO-`, donc
 *     ils sont identifiables par requête ;
 *  2. en production, l'insertion exige SEED_DEMO=oui — un simple oubli ne
 *     suffit pas ;
 *  3. leur présence est signalée comme défaut de configuration par
 *     `installer.js` et par `/api/sante`, tant qu'ils n'ont pas été purgés.
 *
 *   node src/seed-demo.js              # insère
 *   node src/seed-demo.js --supprimer  # purge
 */
import { pool } from './db.js'

const SOURCE = 'DEMO'
const supprimer = process.argv.includes('--supprimer')
const production = process.env.NODE_ENV === 'production'

if (!supprimer && production && process.env.SEED_DEMO !== 'oui') {
  console.error(
    "✗ Insertion de patients fictifs refusée avec NODE_ENV=production.\n\n" +
    "  Un patient fictif pourrait être rattaché à un dossier réel. Si c'est\n" +
    "  bien une instance de démonstration ou de recette, l'assumer\n" +
    "  explicitement :\n" +
    "    SEED_DEMO=oui node src/seed-demo.js\n\n" +
    "  Et les purger avant toute mise en service :\n" +
    "    node src/seed-demo.js --supprimer")
  process.exit(1)
}

/** Identités fictives — mêmes noms que les maquettes, pour la continuité. */
const PATIENTS = [
  ['DEMO-00123', 'MARTIN',  'Sophie',       'MS', '1978-03-12'],
  ['DEMO-00456', 'DURAND',  'Jean-Pierre',  'DJ', '1965-07-04'],
  ['DEMO-00789', 'BERNARD', 'Claire',       'BC', '1982-11-22'],
  ['DEMO-01011', 'PETIT',   'Marie',        'PM', '1991-05-09'],
  ['DEMO-01234', 'ROBERT',  'Alain',        'RA', '1955-01-30'],
  ['DEMO-01567', 'DUBOIS',  'Nathalie',     'DN', '1970-09-18'],
  ['DEMO-01890', 'MOREAU',  'Antoine',      'MA', '1988-12-03'],
  ['DEMO-02123', 'LEROY',   'Isabelle',     'LI', '1962-04-27']
]

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // L'acteur des écritures, pour le journal d'audit.
  const { rows: [operateur] } = await client.query(
    'SELECT id FROM mti.utilisateur WHERE actif ORDER BY cree_le LIMIT 1')
  await client.query('SELECT set_config($1, $2, true)',
    ['mti.utilisateur_id', operateur?.id ?? ''])
  await client.query('SELECT set_config($1, $2, true)',
    ['mti.contexte', supprimer ? 'purge des patients fictifs' : 'insertion de patients fictifs'])

  if (supprimer) {
    // Un patient rattaché à un dossier ne doit pas disparaître en silence :
    // la référence d'un dossier resterait pendante.
    const { rows: rattaches } = await client.query(
      `SELECT p.reference, count(d.id)::int AS dossiers
         FROM mti.patient p
         JOIN mti.dossier d ON d.patient_id = p.id
        WHERE p.source = $1
        GROUP BY p.reference`, [SOURCE])

    if (rattaches.length) {
      console.error(
        `✗ ${rattaches.length} patient(s) fictif(s) sont rattachés à des dossiers :`)
      for (const r of rattaches) console.error(`    ${r.reference} — ${r.dossiers} dossier(s)`)
      console.error(
        "\n  Les supprimer laisserait ces dossiers sans patient. Traiter les\n" +
        "  dossiers concernés d'abord — ce sont probablement des essais à\n" +
        "  supprimer eux aussi.")
      await client.query('ROLLBACK')
      process.exit(1)
    }

    const { rowCount } = await client.query(
      'DELETE FROM mti.patient WHERE source = $1', [SOURCE])
    await client.query('COMMIT')
    console.log(`✓ ${rowCount} patient(s) fictif(s) supprimé(s)`)
  } else {
    for (const [reference, nom, prenom, initiales, naissance] of PATIENTS) {
      const { rows } = await client.query(
        `INSERT INTO mti.patient (reference, source) VALUES ($1, $2)
         ON CONFLICT (source, reference) DO NOTHING RETURNING id`,
        [reference, SOURCE])
      const id = rows[0]?.id ?? (await client.query(
        'SELECT id FROM mti.patient WHERE source = $1 AND reference = $2',
        [SOURCE, reference])).rows[0].id

      await client.query(
        `INSERT INTO mti.patient_identite (patient_id, nom, prenom, initiales, date_naissance)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (patient_id) DO UPDATE
           SET nom = EXCLUDED.nom, prenom = EXCLUDED.prenom,
               initiales = EXCLUDED.initiales, date_naissance = EXCLUDED.date_naissance,
               maj_le = now()`,
        [id, nom, prenom, initiales, naissance])
    }
    await client.query('COMMIT')
    console.log(`✓ ${PATIENTS.length} patients fictifs (source « ${SOURCE} », références « DEMO-… »)`)
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
