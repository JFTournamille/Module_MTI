/**
 * Onglet Configuration : publier une version du modèle de parcours.
 *
 * Prérequis : base migrée et seedée, serveur démarré, jeu de démonstration en
 * place (il fournit les dossiers ouverts dont on vérifie le figement).
 *
 * Ce qui est éprouvé n'est pas « la route répond 201 » mais l'invariant qui
 * justifie qu'il n'y ait PAS de route de modification : publier une version ne
 * doit rien changer à un dossier déjà ouvert. `dossier_processus.definition`
 * porte une copie figée à la création du dossier — c'est ce qui permet de
 * relire un contrôle tel qu'il a été prescrit au moment où il a été fait.
 *
 * Le test remet le modèle d'origine en service à la fin, en le republiant. Les
 * numéros de version montent donc de deux à chaque passage : c'est le
 * comportement voulu, une version publiée ne s'efface pas.
 */
import pg from 'pg'

const base = process.env.API_URL ?? 'http://localhost:3000'
const CODE = 'PARCOURS_CART_AUTOLOGUE'

/* Accès direct à la base pour la seule remise en état : il n'existe pas de
   route de suppression d'un parcours, et il ne doit pas en exister — effacer
   un modèle rendrait illisibles les dossiers qui le référencent. Le test
   nettoie donc ce qu'il a créé lui-même, sans ouvrir cette porte à
   l'application. */
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
let echec = false
const ok = (m) => console.log('  ✓', m)
const ko = (m) => { console.log('  ✗', m); echec = true }

const j = async (m, url, corps) => {
  const r = await fetch(base + url, {
    method: m,
    headers: corps ? { 'content-type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined
  })
  return { statut: r.status, corps: await r.json().catch(() => null) }
}
const copie = (x) => JSON.parse(JSON.stringify(x))

console.log('\n1. État de départ')
let r = await j('GET', `/api/modeles/${CODE}`)
if (r.statut !== 200) { ko(`modèle actif illisible (${r.statut})`); process.exit(1) }
const origine = copie(r.corps)
const versionDepart = origine.version
ok(`version ${versionDepart} active, ${origine.processus.length} processus`)

r = await j('GET', `/api/modeles/${CODE}/versions`)
const actives = r.corps.filter((v) => v.actif)
actives.length === 1 && actives[0].version === versionDepart
  ? ok('une seule version active, et c\'est bien celle-là')
  : ko(`versions actives : ${JSON.stringify(actives.map((v) => v.version))}`)
/* Le témoin est CRÉÉ ici, sur la version en service, au lieu d'espérer qu'un
   dossier de démonstration s'y trouve déjà. Il ne s'y trouvait plus dès que la
   suite tournait deux fois ou après une autre qui publie : le jeu restait sur
   une version antérieure, et le test échouait pour une raison qui n'avait rien
   à voir avec ce qu'il éprouve — le figement d'un dossier ouvert. */
r = await j('POST', '/api/dossiers', { codeModele: CODE })
const cible = { id: r.corps?.id, reference: r.corps?.reference }
if (!cible.id) { ko(`dossier témoin non créé (${r.statut})`); process.exit(1) }

r = await j('GET', `/api/modeles/${CODE}/versions`)
const dossiersSousDepart = r.corps.find((v) => v.version === versionDepart)?.nbDossiers ?? 0
dossiersSousDepart > 0
  ? ok(`${dossiersSousDepart} dossier(s) ouvert(s) sous la version ${versionDepart}`)
  : ko('aucun dossier ouvert : le figement ne serait pas éprouvable')

// Photographie du dossier témoin, AVANT toute publication.
r = await j('GET', `/api/dossiers/${cible.id}`)
const avant = {
  nb: r.corps.processus.length,
  codes: r.corps.processus.map((p) => p.code).join(','),
  premierLibelle: r.corps.processus
    .find((p) => (p.definition?.sections ?? []).length)
    ?.definition.sections[0].points[0].libelle
}
ok(`dossier témoin ${cible.reference} : ${avant.nb} processus figés`)

console.log('\n2. Formes refusées')
for (const [libelle, definition] of [
  ['définition absente', {}],
  ['aucun processus', { definition: { processus: [] } }],
  ['processus sans nom', { definition: { processus: [{ code: 'A', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'texte' }] }] }] } }],
  ['section sans point', { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', points: [] }] }] } }],
  ['type de point inconnu', { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'couleur' }] }] }] } }],
  ['seuil hors point « valeur »', { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'ouinon', seuil: -150 }] }] }] } }],
  ['n° de série sans exemplaires', { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'texte', numeroSerie: true }] }] }] } }],
  ['kit inexistant', { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', kits: [], points: [{ libelle: 'P', type: 'texte', kit: 'FANTOME' }] }] }] } }],
  ['gabarit inconnu', { definition: { processus: [{ code: 'A', nom: 'A', gabarit: 'exotique', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'texte' }] }] }] } }]
]) {
  const rep = await j('POST', `/api/modeles/${CODE}/versions`, definition)
  rep.statut === 400 ? ok(`${libelle} → 400`) : ko(`${libelle} → ${rep.statut}`)
}
const inconnu = await j('POST', '/api/modeles/CODE_QUI_N_EXISTE_PAS/versions',
  { definition: { processus: [{ code: 'A', nom: 'A', sections: [{ titre: 'S', points: [{ libelle: 'P', type: 'texte' }] }] }] } })
inconnu.statut === 404 ? ok('code de modèle inconnu → 404') : ko(`statut ${inconnu.statut}`)

// Aucun de ces refus ne doit avoir publié quoi que ce soit.
r = await j('GET', `/api/modeles/${CODE}`)
r.corps.version === versionDepart
  ? ok(`après ${10} refus, la version active est toujours ${versionDepart}`)
  : ko(`la version a bougé : ${r.corps.version}`)

console.log('\n3. Publication')
const modifie = copie(origine)
modifie.processus[0].sections[0].points[0].libelle = 'LIBELLÉ POSÉ PAR LE TEST'
const retire = modifie.processus[modifie.processus.length - 1].code
modifie.processus = modifie.processus.filter((p) => p.code !== retire)
delete modifie.version
delete modifie.actif

r = await j('POST', `/api/modeles/${CODE}/versions`, { definition: modifie })
r.statut === 201 && r.corps.version === versionDepart + 1
  ? ok(`version ${r.corps.version} publiée (${r.corps.nbProcessus} processus)`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('GET', `/api/modeles/${CODE}`)
r.corps.version === versionDepart + 1 &&
r.corps.processus[0].sections[0].points[0].libelle === 'LIBELLÉ POSÉ PAR LE TEST' &&
!r.corps.processus.some((p) => p.code === retire)
  ? ok(`le modèle actif porte la modification et n'a plus « ${retire} »`)
  : ko(`modèle actif : v${r.corps.version}, ${r.corps.processus.length} processus`)

/* L'index d'identification patient est un RANG : il doit avoir suivi le retrait
   du processus, sinon il désignerait le voisin. */
const iFab = r.corps.processus.findIndex((p) => p.code === 'MISE_EN_FABRICATION')
r.corps.indexIdentificationPatient === iFab
  ? ok(`indexIdentificationPatient recalculé → ${iFab} (${r.corps.processus[iFab].code})`)
  : ko(`index ${r.corps.indexIdentificationPatient} au lieu de ${iFab}`)

console.log('\n4. Le dossier ouvert n\'a pas bougé — l\'invariant qui compte')
r = await j('GET', `/api/dossiers/${cible.id}`)
const apres = {
  nb: r.corps.processus.length,
  codes: r.corps.processus.map((p) => p.code).join(','),
  premierLibelle: r.corps.processus
    .find((p) => (p.definition?.sections ?? []).length)
    ?.definition.sections[0].points[0].libelle
}
apres.nb === avant.nb ? ok(`toujours ${apres.nb} processus`) : ko(`${apres.nb} au lieu de ${avant.nb}`)
apres.codes === avant.codes
  ? ok(`« ${retire} » est toujours dans le dossier, retiré du modèle seulement`)
  : ko('la liste des processus du dossier a changé')
apres.premierLibelle === avant.premierLibelle
  ? ok('le libellé figé du dossier est intact')
  : ko(`libellé : « ${apres.premierLibelle} »`)

// Une seule version active, toujours.
r = await j('GET', `/api/modeles/${CODE}/versions`)
r.corps.filter((v) => v.actif).length === 1
  ? ok('une seule version active après publication')
  : ko(`${r.corps.filter((v) => v.actif).length} versions actives`)
// L'ancienne version reste consultable : c'est ce qui rend un dossier relisible.
const ancienne = await j('GET', `/api/modeles/${CODE}/versions/${versionDepart}`)
ancienne.statut === 200 && ancienne.corps.processus.length === origine.processus.length
  ? ok(`version ${versionDepart} toujours consultable (${ancienne.corps.processus.length} processus)`)
  : ko(`relecture de la v${versionDepart} : statut ${ancienne.statut}`)
const inexistante = await j('GET', `/api/modeles/${CODE}/versions/999`)
inexistante.statut === 404 ? ok('version inexistante → 404') : ko(`statut ${inexistante.statut}`)

console.log('\n5. Remise en service du modèle d\'origine')
const retour = copie(origine)
delete retour.version
delete retour.actif
r = await j('POST', `/api/modeles/${CODE}/versions`, { definition: retour })
r.statut === 201 ? ok(`version ${r.corps.version} publiée, identique à l'origine`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
r = await j('GET', `/api/modeles/${CODE}`)
r.corps.processus.length === origine.processus.length &&
r.corps.processus.map((p) => p.code).join(',') === origine.processus.map((p) => p.code).join(',')
  ? ok(`modèle actif de nouveau conforme à l'origine (${r.corps.processus.length} processus)`)
  : ko(`modèle actif : ${r.corps.processus.length} processus`)

// ── 6. Créer un parcours ──
//
// Créer un PARCOURS n'est pas publier une VERSION : le premier ouvre un code
// nouveau, le second fait évoluer un code existant. Confondre les deux ferait
// entrer un parcours neuf dans l'historique d'un autre, et le rendrait actif à
// sa place.
console.log('\n6. Créer un parcours')
const CODE_NEUF = `PARCOURS_TEST_${Date.now()}`.slice(0, 60)

/* État de la source relevé JUSTE AVANT la création : les groupes précédents
   ont publié deux versions, et se comparer à l'état du début de la suite
   ferait échouer ce contrôle pour une raison étrangère à ce qu'il éprouve. */
r = await j('GET', `/api/modeles/${CODE}`)
const sourceAvant = { version: r.corps.version, nb: r.corps.processus.length }

r = await j('POST', '/api/modeles', {
  code: CODE_NEUF, libelle: 'Parcours de test — reprise partielle',
  sourceCode: CODE, processusCodes: ['ADMINISTRATION', 'RECEPTION', 'ACCES_TRAITEMENT']
})
r.statut === 201 && r.corps.version === 1 && r.corps.nbProcessus === 3
  ? ok(`parcours ${r.corps.code} créé en v1, 3 processus repris`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 160)}`)

/* L'ORDRE demandé fait foi : reprendre un parcours, c'est aussi réordonner ses
   étapes. S'en remettre à l'ordre de la source rendrait la reprise inutile
   pour un parcours dont la chronologie diffère. */
r = await j('GET', `/api/modeles/${CODE_NEUF}`)
r.corps.processus.map((p) => p.code).join(',') === 'ADMINISTRATION,RECEPTION,ACCES_TRAITEMENT'
  ? ok('les processus sont repris dans l\'ordre demandé, pas celui de la source')
  : ko(`ordre obtenu : ${r.corps.processus.map((p) => p.code).join(',')}`)

/* Le parcours source ne doit pas avoir bougé d'un pouce : une reprise qui
   modifie son modèle d'origine ferait perdre le parcours de référence. */
r = await j('GET', `/api/modeles/${CODE}`)
r.corps.version === sourceAvant.version && r.corps.processus.length === sourceAvant.nb
  ? ok(`le parcours source est intact (v${r.corps.version}, ${r.corps.processus.length} processus)`)
  : ko(`la source a bougé : v${sourceAvant.version}→${r.corps.version}, ` +
       `${sourceAvant.nb}→${r.corps.processus.length} processus`)

// Les deux parcours coexistent, chacun actif dans sa propre série de versions.
r = await j('GET', '/api/modeles')
const lesDeux = r.corps.filter((m) => m.code === CODE || m.code === CODE_NEUF)
lesDeux.length === 2 ? ok('les deux parcours coexistent au sélecteur')
  : ko(`${lesDeux.length} parcours trouvé(s) sur les 2 attendus`)

// Un parcours neuf s'édite comme un autre : publier lui donne sa v2.
r = await j('GET', `/api/modeles/${CODE_NEUF}`)
const defNeuve = copie(r.corps)
defNeuve.processus[0].nom = 'Étape renommée'
r = await j('POST', `/api/modeles/${CODE_NEUF}/versions`, { definition: defNeuve })
r.statut === 201 && r.corps.version === 2
  ? ok('le parcours créé se versionne comme les autres (v2)')
  : ko(`publication sur le parcours neuf : ${r.statut}`)

console.log('\n7. Créations refusées')
for (const [libelle, corps, attendu] of [
  ['code déjà pris', { code: CODE, libelle: 'x', sourceCode: CODE }, 409],
  ['code avec espaces', { code: 'mon parcours', libelle: 'x', sourceCode: CODE }, 400],
  ['code accentué', { code: 'PARCOURS_DÉCONGÉLATION', libelle: 'x', sourceCode: CODE }, 400],
  ['code trop court', { code: 'AB', libelle: 'x', sourceCode: CODE }, 400],
  ['libellé absent', { code: 'PARCOURS_SANS_LIBELLE', sourceCode: CODE }, 400],
  ['source inconnue', { code: 'PARCOURS_SOURCE_X', libelle: 'x', sourceCode: 'FANTOME' }, 404],
  ['processus absent de la source',
    { code: 'PARCOURS_PROC_X', libelle: 'x', sourceCode: CODE, processusCodes: ['FANTOME'] }, 400],
  ['ni définition ni source', { code: 'PARCOURS_VIDE_X', libelle: 'x' }, 400],
  ['définition sans processus',
    { code: 'PARCOURS_VIDE_Y', libelle: 'x', definition: { processus: [] } }, 400]
]) {
  const rep = await j('POST', '/api/modeles', corps)
  rep.statut === attendu ? ok(`${libelle} → ${attendu}`)
    : ko(`${libelle} → ${rep.statut} au lieu de ${attendu} (${JSON.stringify(rep.corps).slice(0, 90)})`)
}

/* Aucun de ces refus ne doit avoir laissé de trace : un parcours à moitié créé
   apparaîtrait au sélecteur sans être publiable. */
r = await j('GET', '/api/modeles')
const fantomes = r.corps.filter((m) => /^PARCOURS_(SANS_LIBELLE|SOURCE_X|PROC_X|VIDE_[XY])$/.test(m.code))
fantomes.length === 0 ? ok('aucun parcours fantôme après les refus')
  : ko(`parcours créés à tort : ${fantomes.map((m) => m.code).join(', ')}`)

/* Remise en état : le parcours de test est retiré, sinon chaque passage en
   laisserait un de plus au sélecteur. */
await pool.query('DELETE FROM mti.modele_parcours WHERE code = $1', [CODE_NEUF])
r = await j('GET', '/api/modeles')
r.corps.some((m) => m.code === CODE_NEUF)
  ? ko('le parcours de test subsiste : la suite encombrerait le sélecteur')
  : ok('parcours de test retiré — la suite reste rejouable')

await pool.end()
console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
