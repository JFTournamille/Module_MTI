import Fastify from 'fastify'
import { pool } from './db.js'
import { brancherAuth, verifierConfigurationAuth } from './auth.js'
import referentiels from './routes/referentiels.js'
import patients from './routes/patients.js'
import dossiers from './routes/dossiers.js'

const mode = verifierConfigurationAuth()

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 2 * 1024 * 1024
})

brancherAuth(app, mode)

app.get('/api/sante', async () => {
  const { rows } = await pool.query('SELECT 1 AS ok')
  return { statut: 'ok', base: rows[0].ok === 1, authMode: mode }
})

await app.register(referentiels)
await app.register(patients)
await app.register(dossiers)

const port = Number(process.env.PORT ?? 3000)
try {
  await app.listen({ port, host: '0.0.0.0' })
  app.log.info(`API MTI démarrée sur le port ${port} (auth : ${mode})`)
} catch (e) {
  app.log.error(e)
  process.exit(1)
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`${signal} reçu — arrêt propre`)
    await app.close()
    await pool.end()
    process.exit(0)
  })
}
