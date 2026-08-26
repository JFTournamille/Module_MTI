
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

/** En-tête par lequel le front désigne l'opérateur, en mode `dev` seulement. */
export const EN_TETE_OPERATEUR = 'x-mti-operateur'

/** Colonnes d'un opérateur, avec son libellé prêt à afficher. */
const CHAMPS_OPERATEUR = `id, identifiant, profil,
  coalesce(titre || ' ', '') || prenom || ' ' || nom AS nom`

/**
 * Opérateur explicitement désigné par le front.
 *
 * DISPONIBLE EN MODE `dev` UNIQUEMENT. Laisser le client choisir son identité
 * est une usurpation : c'est acceptable en démonstration, où il n'y a pas
 * d'identité à usurper, et inacceptable dès qu'un dossier réel est en jeu.
 * Le garde-fou tient en deux points, tous deux nécessaires :
 *   1. l'en-tête n'est lu que si `mode === 'dev'` (voir `brancherAuth`) ;
 *   2. `verifierConfigurationAuth` refuse `dev` avec `NODE_ENV=production`.
 *
 * Volontairement NON mémorisé, contrairement à l'opérateur par défaut : un
 * compte désactivé depuis l'onglet Utilisateurs doit cesser d'être utilisable
 * immédiatement, sans redémarrage.
 */
async function resoudreOperateurDesigne (id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  const { rows } = await requete(
    `SELECT ${CHAMPS_OPERATEUR} FROM mti.utilisateur WHERE id = $1 AND actif LIMIT 1`, [id])
  return rows.length ? rows[0] : null
}

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
    `SELECT ${CHAMPS_OPERATEUR} FROM mti.utilisateur WHERE identifiant = $1 AND actif LIMIT 1`,
    [identifiant])

  if (!rows.length) return null
  operateurDev = rows[0]
  return operateurDev
}

/** Plugin Fastify : renseigne `request.utilisateur`. */
export function brancherAuth (app, mode) {
  app.decorateRequest('utilisateur', null)

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/sante') return

    if (mode === 'dev') {
      let operateur = null

      // L'en-tête n'est lu qu'ici, sous la condition `mode === 'dev'`.
      const designe = request.headers[EN_TETE_OPERATEUR]
      if (designe) {
        let choisi = null
        try {
          choisi = await resoudreOperateurDesigne(String(designe))
        } catch (e) {
          return reply.code(503).send({
            erreur: "Base injoignable — impossible de résoudre l'opérateur désigné.",
            detail: e.message
          })
        }
        if (!choisi) {
          // `code` permet au front de repérer ce cas précis et de remettre sa
          // sélection à zéro, plutôt que de rester bloqué sur un compte parti.
          return reply.code(409).send({
            code: 'operateur_inconnu',
            erreur: "L'opérateur sélectionné n'existe plus ou a été désactivé. " +
                    'Choisissez-en un autre.'
          })
        }
        request.utilisateur = choisi
        return
      }

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
