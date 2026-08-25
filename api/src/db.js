import pg from 'pg'

/**
 * Pool Postgres. En production, la base est une one-click app CapRover : le
 * nom d'hôte est donc le nom interne du service (srv-captain--mti-db).
 */
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
})

pool.on('error', (e) => {
  console.error('[db] erreur du pool :', e.message)
})

/**
 * Exécute un bloc dans une transaction, en positionnant l'acteur pour le
 * trigger d'audit.
 *
 * C'est le point de passage OBLIGATOIRE de toute écriture : sans
 * `mti.utilisateur_id`, le journal d'audit enregistre une modification sans
 * auteur, ce qui la rend inexploitable en cas d'inspection.
 */
export async function transaction (utilisateurId, contexte, travail) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT set_config($1, $2, true)', ['mti.utilisateur_id', utilisateurId ?? ''])
    await client.query('SELECT set_config($1, $2, true)', ['mti.contexte', contexte ?? ''])
    const resultat = await travail(client)
    await client.query('COMMIT')
    return resultat
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Lecture simple, hors transaction. */
export const requete = (sql, params) => pool.query(sql, params)
