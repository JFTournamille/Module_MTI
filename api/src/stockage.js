import { requete } from './db.js'

/**
 * Réservation d'un emplacement de stockage.
 *
 * Ce module n'est PAS un plugin de routes, et c'est délibéré : la réservation
 * doit pouvoir se faire dans la même transaction que la saisie du point
 * « emplacement » qui la déclenche. Un plugin Fastify encapsule ses
 * décorations — `routes/dossiers.js` ne verrait pas une fonction posée par
 * `routes/stockage.js`, et on se retrouverait à réserver par un appel HTTP
 * depuis le serveur lui-même, donc dans une autre transaction. Un relevé
 * pourrait alors désigner une place que quelqu'un vient de prendre.
 */

/** Valeur d'amorçage si le paramètre manque ou est illisible. */
const HEURES_DEFAUT = 24

/**
 * Délai d'expiration en vigueur, lu dans le référentiel et jamais en dur.
 *
 * Une place reprise sous les pieds d'un opérateur est plus grave qu'une place
 * gelée une journée : le réglage est donc amorcé haut, et se change sans
 * redéploiement. Un paramètre absent ne doit pas faire tomber la réservation —
 * on ne refuse pas de ranger un MTI parce qu'une ligne de configuration
 * manque.
 */
export async function heuresExpiration (client = null) {
  const lire = client ? (t) => client.query(t) : (t) => requete(t)
  const { rows } = await lire(
    "SELECT valeur FROM mti.parametre WHERE cle = 'emplacement.expiration_heures'")
  const n = Number(rows[0]?.valeur)
  return Number.isFinite(n) && n > 0 ? n : HEURES_DEFAUT
}

/**
 * Réserve une place pour un dossier, dans la transaction fournie.
 *
 * LE CONFLIT EST RENDU PAR LA BASE. L'index partiel `emplacement_occupe_unique`
 * est le seul juge : la liste des places libres affichée à l'écran n'est qu'un
 * instantané, et entre son affichage et le clic une autre réception peut avoir
 * pris la même cassette. Cette fonction traduit le refus en message lisible,
 * elle ne le remplace pas — et le message doit dire « déjà prise » plutôt
 * qu'« erreur », parce que la réaction attendue est d'en choisir une autre.
 *
 * Retourne `{ occupation }`, ou l'un de `{ inconnu }`, `{ horsService }`,
 * `{ prise }`.
 */
export async function reserverEmplacement (client, {
  emplacementId, dossierId, processusId = null, exemplaire = 1,
  secours = false, utilisateurId
}) {
  /* Les expirées sont libérées AVANT toute tentative : une place libérée par
     le temps qui passe doit l'être au moment où quelqu'un cherche à la
     prendre, et l'expiration est un ÉVÉNEMENT enregistré, pas une condition
     implicite — sans quoi on ne saurait pas dire, après coup, qui occupait
     quoi à une date donnée. */
  await client.query('SELECT mti.liberer_occupations_expirees()')

  /* Un identifiant mal formé est traité comme introuvable, jamais comme une
     panne : `WHERE id = 'x'` sur une colonne uuid lève `22P02`, et sans ce
     filet une valeur aberrante — un import, un vieux relevé en texte libre,
     un test — faisait échouer TOUT le lot de saisies avec une erreur 500 que
     personne ne pouvait interpréter. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    .test(String(emplacementId))) {
    return { inconnu: true }
  }

  const { rows: place } = await client.query(
    'SELECT actif FROM mti.emplacement WHERE id = $1', [emplacementId])
  if (!place.length) return { inconnu: true }
  if (!place[0].actif) return { horsService: true }

  /* La place déjà tenue par CE dossier et CET exemplaire est conservée telle
     quelle : ré-enregistrer une fiche ne doit pas relâcher puis reprendre la
     place, ce qui ouvrirait une fenêtre où un autre dossier pourrait s'y
     glisser. */
  const { rows: deja } = await client.query(
    `SELECT id, emplacement_id FROM mti.occupation_emplacement
      WHERE dossier_id = $1 AND exemplaire = $2 AND secours = $3
        AND libere_le IS NULL`,
    [dossierId, exemplaire, secours])
  if (deja.length && deja[0].emplacement_id === emplacementId) {
    return { occupation: deja[0].id, inchange: true }
  }
  /* Changer de place libère l'ancienne, avec un motif qui dit que c'est un
     DÉPLACEMENT et non un déstockage : un inventaire doit pouvoir faire la
     différence entre un MTI sorti de la cuve et un MTI qui a changé de
     cassette. */
  if (deja.length) {
    await client.query(
      `UPDATE mti.occupation_emplacement
          SET libere_le = now(), libere_par = $2,
              motif_liberation = 'Déplacement vers un autre emplacement'
        WHERE id = $1`,
      [deja[0].id, utilisateurId])
  }

  const heures = await heuresExpiration(client)
  try {
    const { rows } = await client.query(
      `INSERT INTO mti.occupation_emplacement
         (emplacement_id, dossier_id, processus_id, exemplaire, secours,
          pose_par, expire_le)
       VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7))
       RETURNING id`,
      [emplacementId, dossierId, processusId, exemplaire, secours,
        utilisateurId, heures])
    return { occupation: rows[0].id }
  } catch (e) {
    if (e.code === '23505') return { prise: true }
    throw e
  }
}

/** Message et code HTTP d'un refus de réservation, pour ne pas les recopier. */
export function refusDeReservation (r) {
  if (r.inconnu) {
    return {
      statut: 404,
      corps: {
        code: 'emplacement_inconnu',
        erreur: 'Emplacement introuvable : choisir une place dans la liste.'
      }
    }
  }
  if (r.horsService) {
    return { statut: 409, corps: { erreur: 'Cet emplacement est hors service.' } }
  }
  if (r.prise) {
    return {
      statut: 409,
      corps: {
        code: 'emplacement_pris',
        erreur: 'Cet emplacement vient d\'être pris par un autre dossier. ' +
          'En choisir un autre.'
      }
    }
  }
  return null
}
