
import { requete } from './db.js'

/**
 * Authentification.
 *
 * Le double contrôle pharmacien et la signature électronique exigent des
 * identités authentifiées : un champ texte libre ne vaut pas signature. Le
 * fournisseur réel est le SSO/LDAP de l'établissement.
 *
 * Tant qu'il n'est pas branché, le mode `dev` permet de travailler avec un
 * utilisateur fixe. Ce mode est REFUSÉ hors développement : démarrer en
 * production sans authentification produirait une traçabilité sans valeur.
 */
export function verifierConfigurationAuth () {
  const mode = process.env.AUTH_MODE ?? 'dev'
  const env = process.env.NODE_ENV ?? 'development'

  if (mode === 'dev' && env === 'production') {
    throw new Error(
      "AUTH_MODE=dev est interdit avec NODE_ENV=production : la traçabilité MTI " +
      "exige des opérateurs authentifiés. Configurer le SSO de l'établissement " +
      "(AUTH_MODE=oidc) avant toute mise en service."
    )
  }
  if (!['dev', 'oidc'].includes(mode)) {
    throw new Error(`AUTH_MODE inconnu : ${mode} (attendu : dev | oidc)`)
  }
  return mode
}

/**
 * Opérateur du mode `dev`, résolu par son identifiant plutôt que par son UUID.
 *
 * Exiger DEV_UTILISATEUR_ID imposait de lire un UUID en base pour le recopier
 * dans la configuration — impossible sans accès shell. L'identifiant suffit :
 * il est stable et connu (« mdurand », créé par le seed).
 *
 * Résolu une fois puis mémorisé ; réessayé si la base n'était pas encore prête.
 */
let operateurDev = null

async function resoudreOperateurDev () {
  if (operateurDev) return operateurDev

  const explicite = process.env.DEV_UTILISATEUR_ID
  const identifiant = process.env.DEV_UTILISATEUR_IDENTIFIANT ?? 'mdurand'

  if (explicite) {
    operateurDev = {
      id: explicite,
      identifiant,
      nom: process.env.DEV_UTILISATEUR_NOM ?? 'M. Martin DURAND'
    }
    return operateurDev
  }

  const { rows } = await requete(
    `SELECT id, coalesce(titre || ' ', '') || prenom || ' ' || nom AS nom
       FROM mti.utilisateur WHERE identifiant = $1 AND actif LIMIT 1`,
    [identifiant])

  if (!rows.length) return null
  operateurDev = { id: rows[0].id, identifiant, nom: rows[0].nom }
  return operateurDev
}

/** Plugin Fastify : renseigne `request.utilisateur`. */
export function brancherAuth (app, mode) {
  app.decorateRequest('utilisateur', null)

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/sante') return

    if (mode === 'dev') {
      let operateur = null
      try {
        operateur = await resoudreOperateurDev()
      } catch (e) {
        return reply.code(503).send({
          erreur: "Base injoignable — impossible de résoudre l'opérateur de " +
                  'développement. Voir /api/sante.',
          detail: e.message
        })
      }

      if (!operateur) {
        return reply.code(503).send({
          erreur: `Aucun utilisateur actif « ${process.env.DEV_UTILISATEUR_IDENTIFIANT ?? 'mdurand'} » ` +
                  "en base. Lancer le seed, ou renseigner DEV_UTILISATEUR_IDENTIFIANT " +
                  'avec le login d\'un compte existant. Voir /api/sante.'
        })
      }

      request.utilisateur = operateur
      return
    }

    // AUTH_MODE=oidc : à brancher sur le fournisseur de l'établissement.
    return reply.code(501).send({
      erreur: "Authentification OIDC non configurée. Renseigner le fournisseur " +
              "d'identité de l'établissement avant mise en service."
    })
  })
}
