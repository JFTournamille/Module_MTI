/**
 * Accès à l'API, avec l'opérateur courant.
 *
 * En mode démonstration (AUTH_MODE=dev), il n'y a pas de fournisseur
 * d'identité : l'opérateur est choisi dans l'interface et transmis en en-tête.
 * Le serveur ne lit cet en-tête QUE dans ce mode — en `oidc`, l'identité vient
 * du SSO et le choix du client est ignoré.
 *
 * Le choix vit dans localStorage : il survit à un rechargement, ce qu'on attend
 * d'une démonstration, et reste propre au poste.
 */
const EN_TETE = 'x-mti-operateur'
const CLE = 'mti.operateur'

export function operateurChoisi () {
  try { return localStorage.getItem(CLE) || '' } catch { return '' }
}

export function memoriserOperateur (id) {
  try {
    if (id) localStorage.setItem(CLE, id)
    else localStorage.removeItem(CLE)
  } catch { /* navigation privée, stockage refusé : on continue sans mémoire */ }
}

/**
 * `fetch` enrichi de l'en-tête d'opérateur.
 *
 * Si le compte sélectionné a disparu ou été désactivé entre-temps, le serveur
 * répond 409 avec `code: 'operateur_inconnu'`. On oublie alors le choix et on
 * rejoue une fois avec l'opérateur par défaut, plutôt que de laisser
 * l'application bloquée sur une sélection périmée.
 */
export async function appel (url, options = {}) {
  const entetes = { ...(options.headers ?? {}) }
  const id = operateurChoisi()
  if (id) entetes[EN_TETE] = id

  let reponse = await fetch(url, { ...options, headers: entetes })

  if (reponse.status === 409 && entetes[EN_TETE]) {
    const corps = await reponse.clone().json().catch(() => null)
    if (corps?.code === 'operateur_inconnu') {
      memoriserOperateur('')
      delete entetes[EN_TETE]
      reponse = await fetch(url, { ...options, headers: entetes })
    }
  }
  return reponse
}

/**
 * Message d'erreur lisible pour une réponse en échec.
 *
 * Le cas 501 mérite son propre texte. Le serveur y répond « Authentification
 * OIDC non configurée » — exact, mais qui envoie chercher du côté du SSO ou
 * des données alors que la cause est une variable d'environnement : en
 * `AUTH_MODE=oidc`, TOUTES les routes répondent 501 et l'application est
 * entièrement muette, sans que rien ne dise que c'est une configuration et non
 * une panne. Le diagnostic a réellement coûté un aller-retour ; il est écrit
 * ici une fois pour toutes.
 */
export async function messageErreur (reponse, defaut) {
  let message = defaut
  try {
    const corps = await reponse.json()
    if (corps?.erreur) message = corps.erreur
  } catch { /* corps vide ou non JSON : on garde le message par défaut */ }

  if (reponse.status === 501) {
    return message +
      " L'instance tourne en AUTH_MODE=oidc, où l'API refuse toutes les " +
      'requêtes tant que le fournisseur d\'identité n\'est pas branché. ' +
      'Pour une démonstration, repasser en AUTH_MODE=dev avec ' +
      'NODE_ENV=development.'
  }
  return message
}
