import { requete } from '../db.js'
import { EN_TETE_OPERATEUR } from '../auth.js'

/**
 * Session courante : qui travaille, et peut-on en changer.
 *
 * Le front ne devinait pas l'opérateur — il l'avait en dur. Il le lit ici.
 *
 * `selectionPossible` n'est vrai qu'en `AUTH_MODE=dev`. C'est la démonstration :
 * on choisit l'opérateur dans l'interface, faute de fournisseur d'identité.
 * En `oidc`, l'identité vient du SSO et n'est pas négociable côté client — le
 * sélecteur disparaît, et l'en-tête `x-mti-operateur` est ignoré par auth.js.
 */
export default async function session (app) {
  app.get('/api/session', async (request) => {
    const mode = process.env.AUTH_MODE ?? 'dev'
    const selectionPossible = mode === 'dev'

    // La liste ne sert qu'au sélecteur : inutile de l'exposer hors mode dev.
    let operateurs = []
    if (selectionPossible) {
      const { rows } = await requete(
        `SELECT id, identifiant, profil,
                coalesce(titre || ' ', '') || prenom || ' ' || nom AS nom,
                fonction
           FROM mti.utilisateur
          WHERE actif
          ORDER BY nom, prenom`)
      operateurs = rows
    }

    return {
      mode,
      selectionPossible,
      enTete: EN_TETE_OPERATEUR,
      operateur: request.utilisateur,
      operateurs
      /* Le bandeau « mode démonstration » a été retiré de l'interface à la
         demande. `mode` et `selectionPossible` disent toujours la même chose à
         qui interroge /api/session : ce qui disparaît, c'est la phrase
         affichée en permanence, pas l'information.

         Ce que cet avertissement portait reste vrai et doit être dit
         ailleurs qu'à l'écran : en AUTH_MODE=dev l'opérateur est choisi dans
         l'interface, sans authentification, et la double validation comme la
         signature électronique n'ont donc pas de valeur probante. C'est
         consigné dans docs/architecture.md et rappelé par /api/sante. */
    }
  })
}
