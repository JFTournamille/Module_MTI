
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

/** Plugin Fastify : renseigne `request.utilisateur`. */
export function brancherAuth (app, mode) {
  app.decorateRequest('utilisateur', null)

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/sante') return

    if (mode === 'dev') {
      request.utilisateur = {
        id: process.env.DEV_UTILISATEUR_ID ?? null,
        nom: process.env.DEV_UTILISATEUR_NOM ?? 'M. Martin DURAND',
        identifiant: process.env.DEV_UTILISATEUR_IDENTIFIANT ?? 'mdurand'
      }
      if (!request.utilisateur.id) {
        return reply.code(503).send({
          erreur: 'DEV_UTILISATEUR_ID non configuré — exécuter npm run seed pour ' +
                  "créer l'utilisateur de développement."
        })
      }
      return
    }

    // AUTH_MODE=oidc : à brancher sur le fournisseur de l'établissement.
    return reply.code(501).send({
      erreur: "Authentification OIDC non configurée. Renseigner le fournisseur " +
              "d'identité de l'établissement avant mise en service."
    })
  })
}
