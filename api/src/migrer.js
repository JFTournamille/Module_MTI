/**
 * Applique les scripts SQL de `db/` dans l'ordre, une seule fois chacun.
 *
 * Volontairement minimal : pas d'ORM, pas de rollback automatique. Sur un
 * logiciel soumis aux BPP, une migration est un acte de change control ;
 * elle doit être lisible et rejouable à l'identique.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { pool } from './db.js'

const dossierSql = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'db')

await pool.query(`
  CREATE TABLE IF NOT EXISTS public.migration (
    fichier     text PRIMARY KEY,
    empreinte   text NOT NULL,
    applique_le timestamptz NOT NULL DEFAULT now()
  )`)

const fichiers = (await readdir(dossierSql))
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort()

for (const fichier of fichiers) {
  const sql = await readFile(join(dossierSql, fichier), 'utf8')
  const empreinte = createHash('sha256').update(sql).digest('hex')

  const { rows } = await pool.query(
    'SELECT empreinte FROM public.migration WHERE fichier = $1', [fichier])

  if (rows.length) {
    if (rows[0].empreinte !== empreinte) {
      console.error(
        `✗ ${fichier} a changé depuis son application.\n` +
        `  Une migration appliquée ne se modifie pas : créer un nouveau fichier.`)
      process.exit(1)
    }
    console.log(`· ${fichier} déjà appliqué`)
    continue
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query(
      'INSERT INTO public.migration (fichier, empreinte) VALUES ($1, $2)',
      [fichier, empreinte])
    await client.query('COMMIT')
    console.log(`✓ ${fichier} appliqué`)
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`✗ ${fichier} : ${e.message}`)
    process.exit(1)
  } finally {
    client.release()
  }
}

await pool.end()
console.log('Migrations terminées.')
