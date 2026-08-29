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
const base = process.env.API_URL ?? 'http://localhost:3000'
const CODE = 'PARCOURS_CART_AUTOLOGUE'
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

console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
