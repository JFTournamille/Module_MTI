import { requete, transaction } from '../db.js'

/**
 * Gestion des comptes utilisateurs.
 *
 * Deux règles de fond, qui expliquent l'absence de DELETE :
 *
 *  1. Un utilisateur est l'AUTEUR de saisies, de signatures et d'événements
 *     d'audit. Le supprimer priverait la traçabilité de son auteur, ce qui la
 *     rendrait inexploitable en inspection. Un compte se désactive, il ne
 *     s'efface pas.
 *  2. Le nom porté par une saisie validée ne doit plus bouger. On autorise donc
 *     la correction d'une coquille, mais l'identifiant — la clé du compte, celle
 *     qui viendra du SSO — n'est pas modifiable après création.
 *
 * L'identité affichée dans l'application vient d'ici ; l'authentification, elle,
 * viendra du SSO de l'établissement (AUTH_MODE=oidc). Ce module gère les
 * comptes, pas les mots de passe : il n'y en a aucun en base.
 */

const PROFILS = ['pharmacien', 'preparateur', 'ide', 'qualite', 'administrateur']

/** Colonnes exposées. `profil` peut être NULL — « non attribué ». */
const CHAMPS = `id, identifiant, nom, prenom, titre, fonction, profil, actif, cree_le`

const enSortie = (r) => ({
  id: r.id,
  identifiant: r.identifiant,
  nom: r.nom,
  prenom: r.prenom,
  titre: r.titre,
  fonction: r.fonction,
  profil: r.profil,
  actif: r.actif,
  creeLe: r.cree_le,
  /** Libellé prêt à afficher, construit une seule fois côté serveur. */
  libelle: `${r.titre ? r.titre + ' ' : ''}${r.prenom} ${r.nom}`.trim()
})

/**
 * Valide et normalise une charge utile. Retourne `{ valeurs }` ou `{ erreur }`.
 * `creation` distingue les champs obligatoires de ceux qu'on peut omettre en
 * modification partielle.
 */
function verifier (corps, creation) {
  const texte = (v) => (typeof v === 'string' ? v.trim() : v == null ? null : undefined)
  const valeurs = {}

  if (creation || 'identifiant' in corps) {
    const identifiant = texte(corps.identifiant)
    if (!identifiant) return { erreur: "L'identifiant est obligatoire." }
    if (identifiant === undefined) return { erreur: "L'identifiant doit être une chaîne." }
    // Le login vient du SSO : on refuse ce qui ne pourrait pas en venir.
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(identifiant)) {
      return {
        erreur: "Identifiant invalide : 2 à 63 caractères, lettres, chiffres, " +
                "point, tiret ou tiret bas, commençant par une lettre ou un chiffre."
      }
    }
    valeurs.identifiant = identifiant.toLowerCase()
  }

  for (const champ of ['nom', 'prenom']) {
    if (creation || champ in corps) {
      const v = texte(corps[champ])
      if (v === undefined) return { erreur: `${champ} doit être une chaîne.` }
      if (!v) return { erreur: `Le ${champ} est obligatoire.` }
      valeurs[champ] = v
    }
  }

  for (const champ of ['titre', 'fonction']) {
    if (champ in corps) {
      const v = texte(corps[champ])
      if (v === undefined) return { erreur: `${champ} doit être une chaîne ou null.` }
      valeurs[champ] = v || null
    }
  }

  if ('profil' in corps) {
    const p = texte(corps.profil)
    if (p === undefined) return { erreur: 'profil doit être une chaîne ou null.' }
    if (p && !PROFILS.includes(p)) {
      return { erreur: `Profil inconnu : ${p} (attendu : ${PROFILS.join(' | ')} ou null).` }
    }
    valeurs.profil = p || null
  }

  return { valeurs }
}

/** Violation de contrainte d'unicité Postgres. */
const identifiantDejaPris = (e) => e.code === '23505'

export default async function utilisateurs (app) {
  /** Vocabulaire des profils, pour que le front n'ait pas à le dupliquer. */
  app.get('/api/profils', async () => PROFILS)

  app.get('/api/utilisateurs', async (request) => {
    const q = String(request.query.q ?? '').trim()
    const avecInactifs = String(request.query.inactifs ?? '') === 'oui'

    const conditions = []
    const params = []
    if (!avecInactifs) conditions.push('actif')
    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(identifiant ILIKE $${params.length} OR nom ILIKE $${params.length}
                        OR prenom ILIKE $${params.length} OR fonction ILIKE $${params.length})`)
    }

    const { rows } = await requete(
      `SELECT ${CHAMPS} FROM mti.utilisateur
        ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
        ORDER BY actif DESC, nom, prenom
        LIMIT 200`,
      params)
    return rows.map(enSortie)
  })

  app.post('/api/utilisateurs', async (request, reply) => {
    const { valeurs, erreur } = verifier(request.body ?? {}, true)
    if (erreur) return reply.code(400).send({ erreur })

    try {
      const cree = await transaction(
        request.utilisateur.id, 'création utilisateur',
        async (client) => {
          const { rows } = await client.query(
            `INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction, profil)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING ${CHAMPS}`,
            [valeurs.identifiant, valeurs.nom, valeurs.prenom,
              valeurs.titre ?? null, valeurs.fonction ?? null, valeurs.profil ?? null])
          return rows[0]
        })
      return reply.code(201).send(enSortie(cree))
    } catch (e) {
      if (identifiantDejaPris(e)) {
        return reply.code(409).send({
          erreur: `L'identifiant « ${valeurs.identifiant} » est déjà utilisé. ` +
                  'Un compte désactivé conserve son identifiant : le réactiver plutôt ' +
                  'que d\'en créer un second.'
        })
      }
      throw e
    }
  })

  app.patch('/api/utilisateurs/:id', async (request, reply) => {
    const corps = { ...(request.body ?? {}) }

    // L'identifiant est la clé du compte, et le lien avec le SSO : le changer
    // reviendrait à réaffecter à quelqu'un d'autre des saisies déjà signées.
    if ('identifiant' in corps) {
      return reply.code(400).send({
        erreur: "L'identifiant n'est pas modifiable : il lie le compte à ses saisies " +
                'et au fournisseur d\'identité. Créer un autre compte si besoin.'
      })
    }
    if ('actif' in corps) {
      return reply.code(400).send({
        erreur: "L'activation passe par /api/utilisateurs/:id/actif, pour que la " +
                'raison du changement soit tracée.'
      })
    }

    const { valeurs, erreur } = verifier(corps, false)
    if (erreur) return reply.code(400).send({ erreur })
    const champs = Object.keys(valeurs)
    if (!champs.length) return reply.code(400).send({ erreur: 'Aucun champ à modifier.' })

    const majs = champs.map((c, i) => `${c} = $${i + 2}`)
    const modifie = await transaction(
      request.utilisateur.id, 'modification utilisateur',
      async (client) => {
        const { rows } = await client.query(
          `UPDATE mti.utilisateur SET ${majs.join(', ')} WHERE id = $1 RETURNING ${CHAMPS}`,
          [request.params.id, ...champs.map((c) => valeurs[c])])
        return rows[0]
      })

    if (!modifie) return reply.code(404).send({ erreur: 'Utilisateur introuvable.' })
    return enSortie(modifie)
  })

  /**
   * Activation / désactivation. Un compte désactivé ne peut plus être opérateur,
   * mais reste l'auteur de tout ce qu'il a déjà saisi.
   */
  app.post('/api/utilisateurs/:id/actif', async (request, reply) => {
    const actif = (request.body ?? {}).actif
    if (typeof actif !== 'boolean') {
      return reply.code(400).send({ erreur: 'actif doit valoir true ou false.' })
    }

    // Se désactiver soi-même fermerait la porte de l'intérieur : plus d'opérateur
    // pour rouvrir, et une base qui refuse toute écriture tracée.
    if (!actif && request.params.id === request.utilisateur.id) {
      return reply.code(409).send({
        erreur: 'Vous ne pouvez pas désactiver le compte avec lequel vous travaillez. ' +
                'Demandez-le à un autre utilisateur.'
      })
    }

    const modifie = await transaction(
      request.utilisateur.id, actif ? 'réactivation utilisateur' : 'désactivation utilisateur',
      async (client) => {
        // Le dernier compte actif ne peut pas partir : sans lui, plus aucune
        // écriture ne peut être tracée, donc plus aucune écriture du tout.
        if (!actif) {
          const { rows: [{ n }] } = await client.query(
            'SELECT count(*)::int AS n FROM mti.utilisateur WHERE actif AND id <> $1',
            [request.params.id])
          if (n === 0) return { refus: 'dernier' }
        }
        const { rows } = await client.query(
          `UPDATE mti.utilisateur SET actif = $2 WHERE id = $1 RETURNING ${CHAMPS}`,
          [request.params.id, actif])
        return rows[0] ?? null
      })

    if (modifie?.refus === 'dernier') {
      return reply.code(409).send({
        erreur: 'C\'est le dernier compte actif : le désactiver rendrait toute ' +
                'écriture tracée impossible. Créez d\'abord un autre compte.'
      })
    }
    if (!modifie) return reply.code(404).send({ erreur: 'Utilisateur introuvable.' })
    return enSortie(modifie)
  })
}
