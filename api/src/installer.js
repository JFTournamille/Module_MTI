/**
 * Installateur de la base MTI — à exécuter une seule fois, depuis le conteneur
 * de l'API (les scripts SQL et les référentiels y sont embarqués).
 *
 * Tout est écrit en Node plutôt qu'en shell : `psql` et `bash` ne sont pas
 * présents dans l'image node:22-alpine, contrairement à `node` et `pg`.
 *
 *   DATABASE_URL_ADMIN=postgresql://postgres:MDP_ROOT@srv-captain--mti-db:5432/mti \
 *     node src/installer.js
 *
 * Options :
 *   MTI_APP_PASSWORD   mot de passe du rôle applicatif (généré si absent)
 *   --verifier         ne fait que les contrôles, n'installe rien
 *
 * Idempotent : relançable sans effet de bord.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ici = dirname(fileURLToPath(import.meta.url))
const verifierSeulement = process.argv.includes('--verifier')
const roterMotDePasse = process.argv.includes('--nouveau-mot-de-passe')

const urlAdmin = process.env.DATABASE_URL_ADMIN
if (!urlAdmin) {
  console.error(
    "✗ DATABASE_URL_ADMIN est requis (compte superutilisateur de la base).\n" +
    "  Exemple : postgresql://postgres:MDP_ROOT@srv-captain--mti-db:5432/mti")
  process.exit(1)
}

/** Construit l'URL du rôle applicatif à partir de celle de l'administrateur. */
function urlApplicative (motDePasse) {
  const u = new URL(urlAdmin)
  u.username = 'mti_app'
  u.password = motDePasse
  return u.toString()
}

/** Relance un script du dépôt avec son propre DATABASE_URL. */
function lancer (script, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(ici, script)], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let sortie = ''
    p.stdout.on('data', (d) => { sortie += d; process.stdout.write('    ' + d) })
    p.stderr.on('data', (d) => { sortie += d; process.stderr.write('    ' + d) })
    p.on('close', (code) =>
      code === 0 ? resolve(sortie) : reject(new Error(`${script} a échoué (code ${code})`)))
  })
}

const etape = (n, titre) => console.log(`\n── ${n}. ${titre} ──`)

// Deux catégories distinctes : un défaut de cloisonnement est bloquant et met
// en cause l'installation ; un défaut de configuration se corrige sur la base
// installée. Les confondre rend le diagnostic trompeur.
let defautsCloisonnement = 0
let defautsConfiguration = 0

// ─────────────────────────────────────────────────────── Contrôle préalable ──

etape(1, 'Connexion au serveur')
const admin = new pg.Client({ connectionString: urlAdmin, connectionTimeoutMillis: 8000 })
try {
  await admin.connect()
} catch (e) {
  console.error(`✗ Connexion impossible : ${e.message}`)
  console.error('  Vérifier le nom d\'hôte (srv-captain--<nom-app>), le port et le mot de passe.')
  process.exit(1)
}
const { rows: [info] } = await admin.query(
  `SELECT current_database() AS base, current_user AS utilisateur,
          split_part(version(), ' ', 2) AS version,
          (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superutilisateur`)
console.log(`  base « ${info.base} », PostgreSQL ${info.version}, connecté en « ${info.utilisateur} »`)
if (!info.superutilisateur) {
  console.error(
    "✗ Ce compte n'est pas superutilisateur. Les migrations ont besoin de\n" +
    "  CREATE EXTENSION et CREATE ROLE. Utiliser le compte root de la base.")
  process.exit(1)
}
console.log('  ✓ droits superutilisateur confirmés')

// ────────────────────────────────────────────────────────────── Installation ──

let motDePasse = process.env.MTI_APP_PASSWORD ?? null
let motDePasseGenere = false

if (!verifierSeulement) {
  etape(2, 'Schéma, rôles et privilèges')
  await lancer('migrer.js', { DATABASE_URL: urlAdmin })

  etape(3, 'Mot de passe du rôle applicatif mti_app')

  // Une réexécution ne doit PAS faire tourner le mot de passe en silence :
  // l'application CapRover porte l'ancien dans sa configuration et cesserait de
  // fonctionner sans que rien ne l'indique.
  const { rows: [role] } = await admin.query(
    'SELECT rolpassword IS NOT NULL AS defini FROM pg_authid WHERE rolname = $1', ['mti_app'])

  if (role?.defini && !motDePasse && !roterMotDePasse) {
    console.error(
      "\n✗ mti_app a déjà un mot de passe : le régénérer casserait la configuration\n" +
      "  de l'application CapRover, qui porte l'ancien.\n\n" +
      "  À noter : dans PostgreSQL un rôle appartient au CLUSTER, pas à une base.\n" +
      "  Si vous installez une seconde base (recette, par exemple) sur la même\n" +
      "  instance, mti_app existe déjà et son mot de passe est commun aux deux.\n\n" +
      "  Pour poursuivre, fournir le mot de passe existant :\n" +
      "    MTI_APP_PASSWORD='...' node src/installer.js\n\n" +
      "  Pour en définir un nouveau volontairement (il faudra le reporter dans\n" +
      "  TOUTES les apps qui utilisent cette instance) :\n" +
      "    node src/installer.js --nouveau-mot-de-passe")
    await admin.end()
    process.exit(1)
  }

  if (!motDePasse) {
    // base64url : aucun caractère à encoder dans une URL.
    motDePasse = randomBytes(24).toString('base64url')
    motDePasseGenere = true
    console.log(role?.defini
      ? '  nouveau mot de passe généré (l\'ancien est révoqué)'
      : '  mot de passe généré (aucun caractère à encoder dans une URL)')
  }
  await lancer('definir-mot-de-passe.js', { DATABASE_URL: urlAdmin, MTI_APP_PASSWORD: motDePasse })

  etape(4, 'Référentiels et produits de référence')
  await lancer('seed.js', { DATABASE_URL: urlApplicative(motDePasse) })
} else if (!motDePasse) {
  console.error('\n✗ --verifier exige MTI_APP_PASSWORD pour tester le rôle applicatif.')
  process.exit(1)
}

// ──────────────────────────────────────────────────────────── Vérifications ──

etape(verifierSeulement ? 2 : 5, 'Cloisonnement du rôle applicatif')
const app = new pg.Client({ connectionString: urlApplicative(motDePasse), connectionTimeoutMillis: 8000 })
try {
  await app.connect()
  console.log('  ✓ mti_app se connecte')
} catch (e) {
  console.error(`  ✗ mti_app ne peut pas se connecter : ${e.message}`)
  process.exit(1)
}

/** Une opération qui DOIT être refusée. Si elle passe, l'audit est réécrivable. */
async function doitEchouer (libelle, sql) {
  try {
    await app.query('BEGIN')
    await app.query(sql)
    await app.query('ROLLBACK')
    console.error(`  ✗ ${libelle} : AUTORISÉ alors que ça devrait être refusé`)
    defautsCloisonnement++
  } catch (e) {
    await app.query('ROLLBACK').catch(() => {})
    if (/permission denied/i.test(e.message)) {
      console.log(`  ✓ ${libelle} : refusé`)
    } else {
      console.error(`  ✗ ${libelle} : refusé, mais pour une autre raison — ${e.message}`)
      defautsCloisonnement++
    }
  }
}

await doitEchouer('effacer une trace d\'audit', 'DELETE FROM mti.audit WHERE id = 1')
await doitEchouer('modifier une trace d\'audit', 'UPDATE mti.audit SET operation = \'INSERT\'')
await doitEchouer('modifier une signature posée', 'UPDATE mti.signature SET signe_le = now()')

// La lecture, elle, doit rester possible : sans ça, pas d'inspection.
try {
  const { rows: [{ n }] } = await app.query('SELECT count(*)::int AS n FROM mti.audit')
  console.log(`  ✓ lecture de l'audit autorisée (${n} trace(s))`)
} catch (e) {
  console.error(`  ✗ lecture de l'audit impossible : ${e.message}`)
  defautsCloisonnement++
}

etape(verifierSeulement ? 3 : 6, 'Contenu installé')
for (const [libelle, sql] of [
  ['modèles de parcours actifs', "SELECT code || ' v' || version FROM mti.modele_parcours WHERE actif"],
  ['catalogues actifs', "SELECT 'v' || version FROM mti.catalogue_processus WHERE actif"],
  ['produits de référence', 'SELECT denomination FROM mti.produit WHERE actif ORDER BY denomination'],
  ['utilisateurs', "SELECT titre || ' ' || nom || ' (' || identifiant || ')' FROM mti.utilisateur WHERE actif"]
]) {
  const { rows } = await app.query(sql)
  const valeurs = rows.map((r) => Object.values(r)[0])
  console.log(`  ${libelle} : ${valeurs.length ? valeurs.join(', ') : '(aucun)'}`)
}

// Le compte de développement n'est pas authentifié : en production, il
// attribuerait des saisies à un opérateur qui n'existe pas.
const { rows: [dev] } = await app.query(
  "SELECT count(*)::int AS n FROM mti.utilisateur WHERE identifiant = 'mdurand' AND actif")
if (dev.n > 0) {
  console.log(
    "\n  ⚠ Le compte de développement « mdurand » est actif. Il n'est pas\n" +
    "    authentifié : le désactiver avant mise en service, sinon des saisies\n" +
    "    pourront être attribuées à un opérateur inexistant.\n" +
    "\n    UPDATE mti.utilisateur SET actif = false WHERE identifiant = 'mdurand';\n" +
    "\n    (il n'est créé que si NODE_ENV n'est pas « production » au moment du seed)")
  defautsConfiguration++
}

const { rows: [{ n: nbUtilisateurs }] } =
  await app.query('SELECT count(*)::int AS n FROM mti.utilisateur WHERE actif')
if (nbUtilisateurs === 0) {
  console.log(
    "\n  ⚠ Aucun utilisateur actif. En AUTH_MODE=oidc, le SSO authentifie les\n" +
    "    opérateurs mais ne les crée pas : sans compte, les saisies n'auront pas\n" +
    "    d'auteur. Insérer au moins un compte, avec l'identifiant renvoyé par le SSO :\n" +
    "\n    INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction)\n" +
    "    VALUES ('jtournamille', 'TOURNAMILLE', 'Jean-François', 'Dr', 'pharmacien');")
}

await app.end()
await admin.end()

// ───────────────────────────────────────────────────────────── Récapitulatif ──

console.log('\n' + '═'.repeat(72))

// Codes de sortie distincts, pour que l'appelant puisse décider :
//   1 = défaut de cloisonnement — l'installation est en cause, rien ne doit
//       démarrer ;
//   2 = défaut de configuration — la base est saine, l'application peut
//       démarrer, mais il reste une correction à appliquer.
if (defautsCloisonnement) {
  console.error(
    `✗ ${defautsCloisonnement} défaut(s) de cloisonnement — le journal d'audit est ` +
    `réécrivable depuis l'application.\n` +
    `  NE PAS mettre en service. Les migrations ont-elles bien tourné avec le\n` +
    `  compte superutilisateur, et l'API utilise-t-elle bien mti_app ?`)
  process.exit(1)
}

console.log('✓ Cloisonnement du journal d\'audit vérifié.')

if (defautsConfiguration) {
  console.error(
    `\n✗ ${defautsConfiguration} point(s) de configuration à corriger avant mise en ` +
    `service (voir ci-dessus).\n` +
    `  La base est installée et saine ; il reste à appliquer ces corrections.`)
  process.exit(2)
}

console.log('✓ Base opérationnelle.')
if (!verifierSeulement) {
  console.log('\nÀ reporter dans les variables d\'environnement de l\'application CapRover :')
  console.log('\n  DATABASE_URL=' + urlApplicative(motDePasse))
  console.log('  NODE_ENV=production')
  console.log('  AUTH_MODE=oidc')
  if (motDePasseGenere) {
    console.log('\n⚠ Ce mot de passe n\'est affiché qu\'ici : le conserver dans votre')
    console.log('  gestionnaire de secrets avant de fermer ce terminal.')
  }
}
