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
