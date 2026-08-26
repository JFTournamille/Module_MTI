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

/**
 * Codes de sortie, pour que l'appelant (l'entrypoint) puisse décider :
 *   0 installation saine
 *   1 CLOISONNEMENT défaillant — le journal d'audit est réécrivable, rien ne
 *     doit démarrer
 *   2 défaut de configuration — la base est saine, l'application peut démarrer
 *   3 installation impossible (identifiants, droits, prérequis) — la base n'est
 *     pas installée, mais l'application peut démarrer pour rester diagnosticable
 */
const SORTIE = { OK: 0, CLOISONNEMENT: 1, CONFIGURATION: 2, IMPOSSIBLE: 3 }

// Le code 1 est RÉSERVÉ au défaut de cloisonnement : c'est le seul sur lequel
// l'entrypoint arrête le conteneur. Or une exception non rattrapée sort en 1
// sous Node — un mot de passe refusé ou une migration altérée seraient donc
// lus comme « le journal d'audit est réécrivable », et le conteneur
// redémarrerait en boucle sur un diagnostic faux. On les reclasse.
for (const evenement of ['unhandledRejection', 'uncaughtException']) {
  process.on(evenement, (e) => {
    console.error(`\n✗ interruption inattendue de l'installateur : ${e?.message ?? e}`)
    console.error("  Le cloisonnement du journal d'audit n'est pas en cause.")
    process.exit(SORTIE.IMPOSSIBLE)
  })
}

/**
 * Paramètres de connexion administrateur.
 *
 * Deux formes acceptées. Les variables séparées sont préférables : un mot de
 * passe contenant @ : / ? # % ou un espace doit être encodé en pourcentage
 * dans une URL, ce qui est une source d'échec fréquente — les mots de passe
 * générés par les hébergeurs en contiennent souvent.
 */
function connexionAdmin () {
  if (process.env.ADMIN_MOT_DE_PASSE) {
    return {
      host: process.env.ADMIN_HOTE ?? 'srv-captain--mti-db',
      port: Number(process.env.ADMIN_PORT ?? 5432),
      user: process.env.ADMIN_UTILISATEUR ?? 'postgres',
      password: process.env.ADMIN_MOT_DE_PASSE,
      database: process.env.ADMIN_BASE ?? 'mti'
    }
  }
  if (process.env.DATABASE_URL_ADMIN) {
    return { connectionString: process.env.DATABASE_URL_ADMIN }
  }
  return null
}

const configAdmin = connexionAdmin()
if (!configAdmin) {
  console.error(
    "✗ Identifiants administrateur de la base manquants. Deux formes possibles.\n\n" +
    "  Variables séparées — à préférer, aucun encodage nécessaire :\n" +
    "    ADMIN_HOTE=srv-captain--mti-db\n" +
    "    ADMIN_UTILISATEUR=postgres\n" +
    "    ADMIN_MOT_DE_PASSE=<le mot de passe, tel quel>\n" +
    "    ADMIN_BASE=mti\n\n" +
    "  Ou une URL unique :\n" +
    "    DATABASE_URL_ADMIN=postgresql://postgres:MOT_DE_PASSE@srv-captain--mti-db:5432/mti")
  process.exit(SORTIE.IMPOSSIBLE)
}

/** Paramètres de connexion du rôle applicatif, dérivés de ceux de l'admin. */
function connexionApplicative (motDePasse) {
  if (configAdmin.connectionString) {
    const u = new URL(configAdmin.connectionString)
    u.username = 'mti_app'
    u.password = motDePasse
    return { connectionString: u.toString() }
  }
  return { ...configAdmin, user: 'mti_app', password: motDePasse }
}

/** Représentation lisible, sans mot de passe, pour les messages. */
function descriptionAdmin () {
  if (configAdmin.connectionString) {
    try {
      const u = new URL(configAdmin.connectionString)
      return `${u.username}@${u.hostname}:${u.port || 5432}${u.pathname}`
    } catch { return '(URL illisible)' }
  }
  return `${configAdmin.user}@${configAdmin.host}:${configAdmin.port}/${configAdmin.database}`
}

/**
 * URL administrateur pour les scripts enfants (migrer.js, definir-mot-de-passe.js),
 * qui ne lisent qu'une DATABASE_URL. Avec les variables séparées, le mot de
 * passe est encodé ici : c'est le seul endroit où l'encodage est nécessaire, et
 * il est fait par le code plutôt que par l'opérateur.
 */
function urlAdminPourEnfant () {
  if (configAdmin.connectionString) return configAdmin.connectionString
  const { user, password, host, port, database } = configAdmin
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
         `@${host}:${port}/${database}`
}

/**
 * Même URL, mot de passe remplacé par un repère.
 *
 * L'installation au démarrage rejoue à CHAQUE déploiement, et sa sortie va
 * dans les journaux du conteneur, que l'hébergeur conserve et expose à qui
 * a accès à son interface. Un mot de passe fourni par l'exploitant n'a donc
 * rien à y faire : il le connaît déjà. Seul un mot de passe *généré* doit
 * s'afficher, faute d'autre moyen de le transmettre.
 */
function urlApplicativeMasquee (motDePasse) {
  const repere = '<votre MTI_APP_PASSWORD>'
  const encode = encodeURIComponent(motDePasse)
  let url = urlApplicative(motDePasse)
  if (encode !== motDePasse) url = url.replaceAll(encode, repere)
  return url.replaceAll(motDePasse, repere)
}

/** URL applicative, à afficher en fin d'installation. */
function urlApplicative (motDePasse) {
  const c = connexionApplicative(motDePasse)
  if (c.connectionString) return c.connectionString
  return `postgresql://mti_app:${encodeURIComponent(motDePasse)}` +
         `@${c.host}:${c.port}/${c.database}`
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

/**
 * Relance un script en qualifiant son échec. Un script qui sort en erreur est
 * un défaut d'installation (code 3), jamais un défaut de cloisonnement : la
 * base reste diagnosticable et l'application peut démarrer.
 */
async function lancerEtape (script, env, quoi) {
  try {
    return await lancer(script, env)
  } catch (e) {
    console.error(`\n✗ ${quoi} n'a pas abouti : ${e.message}`)
    console.error('  La cause est dans la sortie du script, juste au-dessus.')
    console.error("  Le cloisonnement du journal d'audit n'est pas en cause.")
    process.exit(SORTIE.IMPOSSIBLE)
  }
}

// Deux catégories distinctes : un défaut de cloisonnement est bloquant et met
// en cause l'installation ; un défaut de configuration se corrige sur la base
// installée. Les confondre rend le diagnostic trompeur.
let defautsCloisonnement = 0
let defautsConfiguration = 0

// ─────────────────────────────────────────────────────── Contrôle préalable ──

etape(1, 'Connexion au serveur')
// La construction du client peut échouer avant toute connexion : une URL mal
// formée (mot de passe contenant @ : / ? # non encodés) lève ici.
let admin
try {
  admin = new pg.Client({ ...configAdmin, connectionTimeoutMillis: 8000 })
} catch (e) {
  console.error(`✗ Paramètres de connexion invalides : ${e.message}`)
  console.error(
    "\n  L'URL est probablement mal formée. C'est le cas si le mot de passe\n" +
    "  contient @ : / ? # % ou un espace : ces caractères ont un sens dans une\n" +
    "  URL et la coupent.\n\n" +
    "  Utilisez les variables séparées, qui n'exigent aucun encodage :\n" +
    "    ADMIN_HOTE=srv-captain--mti-db\n" +
    "    ADMIN_UTILISATEUR=postgres\n" +
    "    ADMIN_MOT_DE_PASSE=<le mot de passe, tel quel, sans guillemets>\n" +
    "    ADMIN_BASE=mti")
  process.exit(SORTIE.IMPOSSIBLE)
}

try {
  await admin.connect()
} catch (e) {
  console.error(`✗ Connexion impossible à ${descriptionAdmin()} : ${e.message}`)
  if (/password authentication failed/i.test(e.message)) {
    console.error(
      "\n  Le serveur a été joint : seul le mot de passe est refusé.\n" +
      "  Deux causes fréquentes :\n" +
      "   • le mot de passe contient @ : / ? # % ou un espace, et l'URL le coupe.\n" +
      "     Utilisez alors les variables séparées, qui n'exigent aucun encodage :\n" +
      "       ADMIN_HOTE, ADMIN_UTILISATEUR, ADMIN_MOT_DE_PASSE, ADMIN_BASE\n" +
      "   • l'utilisateur root de la base n'est pas « postgres ».\n" +
      "  La valeur exacte se lit dans la configuration de l'app PostgreSQL\n" +
      "  (variables POSTGRES_USER et POSTGRES_PASSWORD).")
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(e.message)) {
    console.error(
      "\n  Nom d'hôte introuvable : vérifier ADMIN_HOTE / l'URL.\n" +
      "  Sur CapRover, c'est srv-captain--<nom-de-l-app-base>.")
  } else if (/ECONNREFUSED|timeout/i.test(e.message)) {
    console.error("\n  Hôte joignable mais rien n'écoute : l'app PostgreSQL est-elle démarrée ?")
  } else if (/does not exist/i.test(e.message)) {
    console.error("\n  La base n'existe pas : vérifier ADMIN_BASE (« mti » par défaut).")
  }
  process.exit(SORTIE.IMPOSSIBLE)
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
  process.exit(SORTIE.IMPOSSIBLE)
}
console.log('  ✓ droits superutilisateur confirmés')

// ────────────────────────────────────────────────────────────── Installation ──

let motDePasse = process.env.MTI_APP_PASSWORD ?? null
let motDePasseGenere = false

if (!verifierSeulement) {
  etape(2, 'Schéma, rôles et privilèges')
  await lancerEtape('migrer.js', { DATABASE_URL: urlAdminPourEnfant() },
    'l\'application des scripts SQL')

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
    process.exit(SORTIE.IMPOSSIBLE)
  }

  if (!motDePasse) {
    // base64url : aucun caractère à encoder dans une URL.
    motDePasse = randomBytes(24).toString('base64url')
    motDePasseGenere = true
    console.log(role?.defini
      ? '  nouveau mot de passe généré (l\'ancien est révoqué)'
      : '  mot de passe généré (aucun caractère à encoder dans une URL)')
  }
  await lancerEtape('definir-mot-de-passe.js',
    { DATABASE_URL: urlAdminPourEnfant(), MTI_APP_PASSWORD: motDePasse },
    'la définition du mot de passe de mti_app')

  etape(4, 'Référentiels et produits de référence')
  await lancerEtape('seed.js', { DATABASE_URL: urlApplicative(motDePasse) },
    'le chargement des référentiels')
} else if (!motDePasse) {
  console.error('\n✗ --verifier exige MTI_APP_PASSWORD pour tester le rôle applicatif.')
  process.exit(SORTIE.IMPOSSIBLE)
}

// ──────────────────────────────────────────────────────────── Vérifications ──

etape(verifierSeulement ? 2 : 5, 'Cloisonnement du rôle applicatif')
const app = new pg.Client({ ...connexionApplicative(motDePasse), connectionTimeoutMillis: 8000 })
try {
  await app.connect()
  console.log('  ✓ mti_app se connecte')
} catch (e) {
  console.error(`  ✗ mti_app ne peut pas se connecter : ${e.message}`)
  process.exit(SORTIE.IMPOSSIBLE)
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
  ['utilisateurs', "SELECT titre || ' ' || nom || ' (' || identifiant || ')' FROM mti.utilisateur WHERE actif"],
  ['patients fictifs', "SELECT reference FROM mti.patient WHERE source = 'DEMO' ORDER BY reference"]
]) {
  const { rows } = await app.query(sql)
  const valeurs = rows.map((r) => Object.values(r)[0])
  console.log(`  ${libelle} : ${valeurs.length ? valeurs.join(', ') : '(aucun)'}`)
}

// Le compte de développement n'est pas authentifié : en production, il
// attribuerait des saisies à un opérateur qui n'existe pas.
//
// Mais sur une instance de recette (AUTH_MODE=dev), c'est l'opérateur
// légitime : le signaler comme défaut à chaque démarrage serait du bruit, et
// le bruit finit par masquer les vrais signaux.
const enProduction = process.env.NODE_ENV === 'production' ||
                     process.env.AUTH_MODE === 'oidc'
const { rows: [dev] } = await app.query(
  "SELECT count(*)::int AS n FROM mti.utilisateur WHERE identifiant = 'mdurand' AND actif")
if (dev.n > 0 && enProduction) {
  console.log(
    "\n  ⚠ Le compte de développement « mdurand » est actif sur une instance de\n" +
    "    production. Il n'est pas authentifié : le désactiver, sinon des saisies\n" +
    "    pourront être attribuées à un opérateur inexistant.\n" +
    "\n    UPDATE mti.utilisateur SET actif = false WHERE identifiant = 'mdurand';")
  defautsConfiguration++
} else if (dev.n > 0) {
  console.log(
    "\n  · compte de développement « mdurand » actif — normal en recette,\n" +
    "    à désactiver avant une mise en service réelle.")
}

// Patients fictifs : utiles en recette, inacceptables en production.
const { rows: [fictifs] } = await app.query(
  "SELECT count(*)::int AS n FROM mti.patient WHERE source = 'DEMO'")
if (fictifs.n > 0) {
  console.log(
    `\n  ⚠ ${fictifs.n} patient(s) fictif(s) en base (source « DEMO »).\n` +
    "    Acceptable en recette. À purger avant mise en service : un patient\n" +
    "    fictif pourrait être rattaché à un dossier réel.\n" +
    "\n    node src/seed-demo.js --supprimer")
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
  process.exit(SORTIE.CLOISONNEMENT)
}

console.log('✓ Cloisonnement du journal d\'audit vérifié.')

if (defautsConfiguration) {
  console.error(
    `\n✗ ${defautsConfiguration} point(s) de configuration à corriger avant mise en ` +
    `service (voir ci-dessus).\n` +
    `  La base est installée et saine ; il reste à appliquer ces corrections.`)
  process.exit(SORTIE.CONFIGURATION)
}

console.log('✓ Base opérationnelle.')
if (!verifierSeulement) {
  console.log('\nÀ reporter dans les variables d\'environnement de l\'application CapRover :')
  console.log('\n  DATABASE_URL=' + (motDePasseGenere
    ? urlApplicative(motDePasse)
    : urlApplicativeMasquee(motDePasse)))
  console.log('  NODE_ENV=production')
  console.log('  AUTH_MODE=oidc')
  if (motDePasseGenere) {
    console.log('\n⚠ Ce mot de passe n\'est affiché qu\'ici : le conserver dans votre')
    console.log('  gestionnaire de secrets avant de fermer ce terminal.')
  } else {
    console.log('\n  Mot de passe masqué : reporter celui que vous avez fourni dans')
    console.log('  MTI_APP_PASSWORD. Il n\'est pas journalisé — ces lignes partent')
    console.log('  dans les logs du conteneur, que l\'hébergeur conserve.')
  }
}
