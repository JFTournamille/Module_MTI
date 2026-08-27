import Fastify from 'fastify'
import { pool } from './db.js'
import { brancherAuth, verifierConfigurationAuth } from './auth.js'
import referentiels from './routes/referentiels.js'
import patients from './routes/patients.js'
import dossiers from './routes/dossiers.js'
import utilisateurs from './routes/utilisateurs.js'
import session from './routes/session.js'

const mode = verifierConfigurationAuth()

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 2 * 1024 * 1024
})

brancherAuth(app, mode)

/**
 * État de santé, consultable au navigateur sans authentification.
 *
 * C'est le seul canal de diagnostic disponible quand on n'a ni accès shell au
 * serveur ni logs applicatifs dans l'interface d'hébergement : il indique si
 * la base est installée et si le cloisonnement du journal d'audit est en
 * place.
 *
 * Volontairement sans détail exploitable : ni version du serveur, ni noms
 * d'utilisateurs, ni identité de patients. Des compteurs et des booléens.
 */
app.get('/api/sante', async () => {
  const base = {
    joignable: false,
    schemaInstalle: false,
    migrationsAppliquees: null,
    modeleActif: null,
    referentielsCharges: false,
    cloisonnementAudit: null,
    utilisateursActifs: null,
    patientsFictifs: null
  }
  let statut = 'degrade'
  let diagnostic = null

  try {
    await pool.query('SELECT 1')
    base.joignable = true
  } catch (e) {
    // Un échec d'authentification du rôle applicatif a deux causes très
    // différentes, et PostgreSQL renvoie le même message dans les deux cas :
    // le rôle peut ne pas exister du tout (installation jamais lancée), ou
    // avoir un mot de passe qui diffère de celui de DATABASE_URL.
    let diagnostic
    if (/password authentication failed/i.test(e.message)) {
      diagnostic =
        "Le serveur de base est joint, mais le rôle applicatif est refusé. " +
        "Deux causes possibles : (1) l'installation n'a jamais tourné, donc le " +
        "rôle mti_app n'existe pas ou n'a pas de mot de passe — renseigner " +
        "ADMIN_HOTE, ADMIN_UTILISATEUR, ADMIN_MOT_DE_PASSE, ADMIN_BASE et " +
        "MTI_APP_PASSWORD puis redéployer ; (2) MTI_APP_PASSWORD et le mot de " +
        "passe de DATABASE_URL diffèrent — ils doivent être identiques."
    } else if (/ENOTFOUND|EAI_AGAIN/i.test(e.message)) {
      diagnostic = "Nom d'hôte introuvable dans DATABASE_URL. Sur CapRover, " +
                   "c'est srv-captain--<nom-de-l-app-base>."
    } else if (/ECONNREFUSED/i.test(e.message)) {
      diagnostic = "Hôte joignable mais rien n'écoute : l'app PostgreSQL est-elle démarrée ?"
    } else if (/does not exist/i.test(e.message)) {
      diagnostic = "La base nommée dans DATABASE_URL n'existe pas."
    } else {
      diagnostic = "Base injoignable — vérifier DATABASE_URL et que l'app " +
                   "PostgreSQL est démarrée."
    }
    return { statut: 'hors_service', authMode: mode, base, diagnostic, detail: e.message }
  }

  try {
    const { rows: [t] } = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'mti'`)
    base.schemaInstalle = t.n > 0

    if (!base.schemaInstalle) {
      return {
        statut: 'non_installe',
        authMode: mode,
        base,
        diagnostic: "Base joignable mais vide : les migrations n'ont pas été " +
                    "appliquées. Renseigner DATABASE_URL_ADMIN et MTI_APP_PASSWORD " +
                    "puis redéployer, ou lancer node src/installer.js."
      }
    }

    // Le cloisonnement est vérifié directement auprès du serveur : le rôle
    // courant doit être incapable d'effacer une trace d'audit.
    const { rows: [p] } = await pool.query(
      `SELECT has_table_privilege('mti.audit', 'DELETE') AS peut_effacer,
              has_table_privilege('mti.audit', 'SELECT') AS peut_lire`)
    base.cloisonnementAudit = !p.peut_effacer && p.peut_lire
      ? 'verifie'
      : (p.peut_effacer ? 'DEFAILLANT' : 'lecture_impossible')

    // La table de suivi des migrations peut ne pas exister (schéma appliqué
    // à la main) : son absence n'est pas une anomalie.
    try {
      const { rows: [m] } = await pool.query(
        'SELECT count(*)::int AS n FROM public.migration')
      base.migrationsAppliquees = m.n
    } catch {
      base.migrationsAppliquees = null
    }

    const { rows: mod } = await pool.query(
      `SELECT code, version FROM mti.modele_parcours WHERE actif LIMIT 1`)
    base.modeleActif = mod.length ? `${mod[0].code} v${mod[0].version}` : null

    const { rows: [c] } = await pool.query(
      `SELECT (SELECT count(*) FROM mti.catalogue_processus WHERE actif) > 0
              AND (SELECT count(*) FROM mti.produit WHERE actif) > 0 AS ok`)
    base.referentielsCharges = c.ok === true

    const { rows: [u] } = await pool.query(
      `SELECT count(*)::int AS n FROM mti.utilisateur WHERE actif`)
    base.utilisateursActifs = u.n

    /* Le jeu de démonstration ne se résume pas aux patients : il pose aussi
       des comptes et des dossiers. Ne compter que les patients laissait un
       diagnostic « ok » sur une base qui contient dix dossiers fictifs et dix
       comptes qui n'existent dans aucun annuaire. */
    const { rows: [f] } = await pool.query(
      `SELECT (SELECT count(*) FROM mti.patient WHERE source = 'DEMO')::int AS patients,
              (SELECT count(*) FROM mti.utilisateur
                WHERE identifiant LIKE 'demo.%' AND actif)::int AS comptes,
              (SELECT count(*) FROM mti.dossier
                WHERE reference LIKE 'DEMO-MTI-%')::int AS dossiers`)
    base.patientsFictifs = f.patients
    base.comptesFictifs = f.comptes
    base.dossiersFictifs = f.dossiers

    if (base.cloisonnementAudit === 'DEFAILLANT') {
      statut = 'hors_service'
      diagnostic = "Le rôle applicatif peut effacer le journal d'audit. " +
                   "L'API tourne probablement en superutilisateur : la traçabilité " +
                   "n'a aucune valeur en l'état. Ne pas mettre en service."
    } else if (!base.modeleActif || !base.referentielsCharges) {
      diagnostic = "Schéma installé mais référentiels absents — lancer le seed."
    } else if (base.utilisateursActifs === 0) {
      diagnostic = "Aucun utilisateur actif : les saisies n'auraient pas d'auteur. " +
                   "Insérer au moins un compte correspondant au login du SSO."
    } else if (base.patientsFictifs > 0 || base.comptesFictifs > 0 ||
               base.dossiersFictifs > 0) {
      const details = [
        base.dossiersFictifs ? `${base.dossiersFictifs} dossier(s)` : null,
        base.patientsFictifs ? `${base.patientsFictifs} patient(s)` : null,
        base.comptesFictifs ? `${base.comptesFictifs} compte(s)` : null
      ].filter(Boolean).join(', ')
      diagnostic = `Jeu de démonstration présent : ${details}. ` +
                   "Acceptable en recette, à purger avant mise en service " +
                   "(node src/seed-demo.js --supprimer) : un dossier fictif est " +
                   "indiscernable d'un dossier réel dans le tableau de bord, et un " +
                   "compte fictif ne correspond à personne dans l'annuaire."
    } else {
      statut = 'ok'
    }
  } catch (e) {
    return { statut: 'degrade', authMode: mode, base, diagnostic: e.message }
  }

  return { statut, authMode: mode, base, ...(diagnostic ? { diagnostic } : {}) }
})

await app.register(referentiels)
await app.register(patients)
await app.register(dossiers)
await app.register(utilisateurs)
await app.register(session)

const port = Number(process.env.PORT ?? 3000)

// Dans l'image combinée, nginx tourne dans le MÊME conteneur et relaie vers
// 127.0.0.1 : l'API n'a alors aucune raison d'être joignable depuis le réseau
// de l'orchestrateur, où d'autres conteneurs pourraient l'atteindre en
// contournant nginx. HOST=127.0.0.1 ferme cette porte.
// En topologie à deux apps, nginx est dans un autre conteneur : 0.0.0.0 y est
// nécessaire, d'où le défaut conservé.
const host = process.env.HOST ?? '0.0.0.0'
try {
  await app.listen({ port, host })
  app.log.info(`API MTI démarrée sur ${host}:${port} (auth : ${mode})`)
  if (mode === 'dev') {
    app.log.warn(
      "AUTH_MODE=dev : l'opérateur est choisi depuis l'interface, sans " +
      'authentification. Acceptable en démonstration ; la signature et le ' +
      'double contrôle sont sans valeur probante dans cet état.')
  }
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
