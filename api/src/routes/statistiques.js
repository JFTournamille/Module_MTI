import { requete } from '../db.js'

/**
 * Statistiques d'ACTIVITÉ — quantitatives, décision du 18 septembre.
 *
 * Combien de dossiers ouverts, validés, clos ; par mois, par parcours, par
 * produit.
 *
 * CE QUE CE CHOIX ÉCARTE, et c'est délibéré : le taux de non-conformité. Il
 * était piégé — la conformité automatique ne prononce jamais une
 * non-conformité, elle constate le vert ou refuse de conclure. Un « taux de
 * NC » aurait donc compté des jugements pharmaceutiques en les présentant
 * comme des constats de la machine. Mieux vaut ne pas le tracer que le tracer
 * mal.
 *
 * L'AGRÉGATION EST FAITE ICI, jamais dans le navigateur. La liste des dossiers
 * du tableau de bord est plafonnée à 200 lignes : compter à partir d'elle
 * donnerait des totaux faux sans le dire, et un total faux est pire qu'un
 * total absent.
 */
export default async function statistiques (app) {
  app.get('/api/statistiques', async (request) => {
    const depuis = String(request.query.depuis ?? '').trim() || null
    const jusqua = String(request.query.jusqua ?? '').trim() || null

    const { rows } = await requete(
      'SELECT * FROM mti.statistiques_activite($1::date, $2::date)', [depuis, jusqua])

    /* Le mois est normalisé en TEXTE avant d'entrer dans l'index : `pg` rend
       un objet `Date`, et une Map clée par objet ne regroupe rien — chaque
       ligne devenait son propre mois, et les séries sortaient en doublons. */
    const cle = (r, dimension) => (dimension === 'mois'
      ? (r.mois instanceof Date ? r.mois.toISOString().slice(0, 7) : String(r.mois).slice(0, 7))
      : r[dimension])

    const cumuler = (dimension) => {
      const index = new Map()
      for (const r of rows) {
        const k = cle(r, dimension)
        const a = index.get(k) ?? { cle: k, enCours: 0, valides: 0, clos: 0, total: 0 }
        a.enCours += Number(r.en_cours)
        a.valides += Number(r.valides)
        a.clos += Number(r.clos)
        a.total += Number(r.total)
        index.set(k, a)
      }
      return [...index.values()]
    }

    const parMois = cumuler('mois').sort((a, b) => a.cle.localeCompare(b.cle))
    const total = parMois.reduce((a, m) => ({
      enCours: a.enCours + m.enCours,
      valides: a.valides + m.valides,
      clos: a.clos + m.clos,
      total: a.total + m.total
    }), { enCours: 0, valides: 0, clos: 0, total: 0 })

    const parTotal = (a, b) => b.total - a.total
    return {
      total,
      parMois,
      parParcours: cumuler('parcours').sort(parTotal),
      parProduit: cumuler('produit').sort(parTotal),
      /* DIT, plutôt que rendu par une colonne vide. Le dossier ne porte aucun
         service aujourd'hui : produire cette ventilation obligerait à la
         deviner, et une statistique devinée est pire qu'une absente. */
      parService: null,
      serviceIndisponible: 'Le dossier ne porte pas de service. Cette ventilation ' +
        'demande d\'abord de décider quel service compte : celui qui prescrit, ' +
        'ou celui qui administre.'
    }
  })
}
