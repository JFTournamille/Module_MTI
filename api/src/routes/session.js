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
      operateurs,
      /* Affiché dans l'interface : une démonstration ne doit pas pouvoir passer
         pour une mise en service. */
      avertissement: selectionPossible
        ? "Mode démonstration : l'opérateur est choisi dans l'interface, sans " +
          'authentification. La double validation et la signature électronique ' +
          "n'ont pas de valeur probante dans cet état."
        : null
    }
  })
}
