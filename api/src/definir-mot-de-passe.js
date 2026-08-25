/**
 * Définit le mot de passe du rôle applicatif `mti_app`.
 *
 * `002_roles.sql` crée le rôle sans mot de passe : un mot de passe n'a pas sa
 * place dans une migration versionnée. Ce script comble l'étape, à exécuter
 * avec une DATABASE_URL superutilisateur.
 *
 *   DATABASE_URL=postgresql://postgres:...@hote:5432/mti \
 *   MTI_APP_PASSWORD='...' node src/definir-mot-de-passe.js
 */
import { pool } from './db.js'

const motDePasse = process.env.MTI_APP_PASSWORD

if (!motDePasse) {
  console.error('✗ MTI_APP_PASSWORD est requis.')
  process.exit(1)
}
if (motDePasse.length < 16) {
  console.error(`✗ MTI_APP_PASSWORD trop court (${motDePasse.length} caractères, 16 minimum).`)
  process.exit(1)
}

try {
  const { rows } = await pool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', ['mti_app'])
  if (!rows.length) {
    console.error("✗ Le rôle mti_app n'existe pas — exécuter d'abord `node src/migrer.js`.")
    process.exit(1)
  }

  // ALTER ROLE n'accepte pas de paramètre lié pour le mot de passe : on passe
  // par une chaîne littérale échappée par le serveur (quote_literal), jamais
  // par une concaténation manuelle.
  const { rows: [{ ordre }] } = await pool.query(
    `SELECT format('ALTER ROLE mti_app PASSWORD %L', $1::text) AS ordre`, [motDePasse])
  await pool.query(ordre)

  console.log('✓ mot de passe de mti_app défini')
  console.log('  Reporter ce mot de passe dans la DATABASE_URL de l\'application.')
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
} finally {
  await pool.end()
}
