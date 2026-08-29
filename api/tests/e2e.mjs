/**
 * Test de bout en bout de l'API MTI.
 *
 * Prérequis : une base migrée et seedée, et le serveur démarré.
 *   export DATABASE_URL=... DEV_UTILISATEUR_IDENTIFIANT=mdurand
 *   node src/migrer.js && node src/seed.js
 *   node src/server.js &
 *   node tests/e2e.mjs
 *
 * Vérifie ce qui compte réglementairement : anonymat par défaut, figement de
 * la définition du parcours, alarme de seuil calculée côté serveur, double
 * contrôle, blocage de la validation incomplète, lecture seule après
 * validation, et reconstitution de la piste d'audit.
 */
const base = process.env.API_URL ?? 'http://localhost:3000'
let echec = false
const ok = (m) => console.log('  ✓', m)
const ko = (m) => { console.log('  ✗', m); echec = true }
const j = async (m, url, body, entetes) => {
  const r = await fetch(base + url, {
    method: m,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(entetes ?? {}) },
    body: body ? JSON.stringify(body) : undefined
  })
  return { statut: r.status, corps: await r.json().catch(() => null) }
}

const modeles = (await j('GET', '/api/modeles')).corps
const modeleActif = modeles.find((m) => m.code === 'PARCOURS_CART_AUTOLOGUE')
const NB_PROCESSUS = modeleActif?.nbProcessus
console.log(`\n0. Modèle actif : ${modeleActif?.code} v${modeleActif?.version}`)
NB_PROCESSUS >= 12
  ? ok(`${NB_PROCESSUS} processus au parcours actif`)
  : ko(`modèle actif introuvable ou incomplet : ${JSON.stringify(modeles)}`)

console.log('\n1. Création d\'un dossier')
const ref = `DOS-E2E-${Date.now()}`
let r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: ref })
r.statut === 201 && r.corps.nbProcessus === NB_PROCESSUS
  ? ok(`dossier ${ref} créé avec ${NB_PROCESSUS} processus figés`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
const dossierId = r.corps.id

/* Sans référence, la base numérote : MTI-000001, MTI-000002, … Deux créations
   de suite éprouvent l'incrémentation, pas seulement la forme — c'est la
   collision entre deux dossiers créés dans la même minute que la séquence
   remplace. */
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE' })
const refAuto1 = r.corps?.reference
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE' })
const refAuto2 = r.corps?.reference
if (/^MTI-\d{6}$/.test(refAuto1 ?? '') && /^MTI-\d{6}$/.test(refAuto2 ?? '')) {
  ok(`n° attribués automatiquement : ${refAuto1} puis ${refAuto2}`)
} else {
  ko(`n° automatiques inattendus : ${refAuto1} / ${refAuto2}`)
}
Number(String(refAuto2).slice(4)) === Number(String(refAuto1).slice(4)) + 1
  ? ok('la séquence avance d\'une unité, sans rejouer un n°')
  : ko(`séquence : ${refAuto1} puis ${refAuto2}`)

r = await j('POST', '/api/dossiers', { reference: `DOS-E2E-B-${Date.now()}` })
r.statut === 400 ? ok('création sans modèle refusée (400)') : ko(`statut ${r.statut}`)

console.log('\n2. Le dossier est anonyme à la création')
r = await j('GET', `/api/dossiers/${dossierId}`)
r.corps.dossier.patient_id === null && r.corps.dossier.preallocation === false
  ? ok('patient_id NULL, préallocation inactive') : ko(JSON.stringify(r.corps.dossier))
const premier = r.corps.processus.find((p) => p.ordre === 1)
premier?.etat === 'en_cours'
  ? ok(`processus 1 « ${premier.nom} » en cours`)
  : ko(`premier processus : ${JSON.stringify(premier)}`)
const reception = r.corps.processus.find((p) => p.gabarit === 'reception')
reception
  ? ok(`réception trouvée au rang ${reception.ordre}, état « ${reception.etat} »`)
  : ko('processus de réception introuvable')
/* Le nombre de sections vient du modèle actif : ce qui compte n'est pas qu'il
   y en ait six, c'est que le dossier porte une COPIE fidèle de la définition —
   c'est elle qui le rend relisible après évolution du référentiel. */
const sectionsModele = (await j('GET', '/api/modeles/PARCOURS_CART_AUTOLOGUE')).corps
  .processus.find((p) => p.gabarit === 'reception').sections
reception.definition.sections.length === sectionsModele.length
  ? ok(`définition figée dans le dossier (${sectionsModele.length} sections, copie du modèle)`)
  : ko(`${reception.definition.sections?.length} sections au lieu de ${sectionsModele.length}`)
JSON.stringify(reception.definition.sections) === JSON.stringify(sectionsModele)
  ? ok('la copie est fidèle, point par point')
  : ko('la définition figée diffère du modèle dont elle est issue')

console.log('\n3. Validation de type sur les saisies')
r = await j('PUT', `/api/processus/${reception.id}/saisies`,
  { saisies: [{ sectionIndex: 0, pointIndex: 0, pointType: 'inconnu' }] })
r.statut === 400 ? ok('pointType invalide refusé (400)') : ko(`statut ${r.statut}`)
r = await j('PUT', `/api/processus/${reception.id}/saisies`,
  { saisies: [{ sectionIndex: 'zéro', pointIndex: 0, pointType: 'ouinon' }] })
r.statut === 400 ? ok('index non entier refusé (400)') : ko(`statut ${r.statut}`)

console.log('\n4. Enregistrement des saisies')
r = await j('PUT', `/api/processus/${reception.id}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 0, pointNum: '1.1', pointType: 'ouinon', obligatoire: true, reponse: 'oui' },
  { sectionIndex: 0, pointIndex: 1, pointNum: '1.2', pointType: 'ouinon', obligatoire: true, reponse: 'oui' },
  // Op.2 sur le même point : double contrôle
  { sectionIndex: 0, pointIndex: 0, pointNum: '1.1', pointType: 'ouinon', operateurRole: 'op2', reponse: 'oui' },
  // Températures : une conforme, une hors seuil
  { sectionIndex: 0, pointIndex: 2, pointNum: '1.3', pointType: 'valeur', obligatoire: true, valeurNum: -168.2, seuil: -150 },
  { sectionIndex: 1, pointIndex: 1, pointNum: '2.2', pointType: 'valeur', obligatoire: true, exemplaire: 1, valeurNum: -165, seuil: -160 },
  { sectionIndex: 1, pointIndex: 1, pointNum: '2.2', pointType: 'valeur', obligatoire: true, exemplaire: 2, valeurNum: -152.7, seuil: -160 }
] })
r.statut === 200 && r.corps.enregistrees === 6
  ? ok('6 saisies enregistrées') : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

console.log('\n5. L\'alarme de seuil est figée côté serveur')
r = await j('GET', `/api/dossiers/${dossierId}`)
const alarmes = r.corps.saisies.filter((s) => s.hors_seuil === true)
alarmes.length === 1 && Number(alarmes[0].valeur_num) === -152.7
  ? ok(`1 alarme : cuve ${alarmes[0].exemplaire} à ${alarmes[0].valeur_num} °C (seuil ${alarmes[0].seuil_applique})`)
  : ko(`${alarmes.length} alarme(s) : ${JSON.stringify(alarmes.map(a => a.valeur_num))}`)
const conformes = r.corps.saisies.filter((s) => s.hors_seuil === false)
conformes.length === 2 ? ok('2 relevés marqués conformes') : ko(`${conformes.length} relevés conformes`)
const doubles = r.corps.saisies.filter((s) => s.point_num === '1.1')
doubles.length === 2 && new Set(doubles.map(s => s.operateur_role)).size === 2
  ? ok('point 1.1 porte bien deux rôles distincts (op1 + op2)')
  : ko(`${doubles.length} saisie(s) sur 1.1`)

console.log('\n6. Idempotence : réenregistrer met à jour sans dupliquer')
const avant = r.corps.saisies.length
r = await j('PUT', `/api/processus/${reception.id}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 2, pointNum: '1.3', pointType: 'valeur', obligatoire: true, valeurNum: -170, seuil: -150 }
] })
r = await j('GET', `/api/dossiers/${dossierId}`)
r.corps.saisies.length === avant
  ? ok(`toujours ${avant} saisies (mise à jour, pas de doublon)`)
  : ko(`${r.corps.saisies.length} saisies au lieu de ${avant}`)

console.log('\n7. La validation refuse les points obligatoires vides')
r = await j('PUT', `/api/processus/${reception.id}/saisies`, { saisies: [
  { sectionIndex: 2, pointIndex: 0, pointNum: '3.1', pointType: 'timer', obligatoire: true }
] })
r = await j('POST', `/api/dossiers/${dossierId}/valider`, { conformite: 'conforme' })
r.statut === 422 && r.corps.details?.length === 1
  ? ok(`422 — ${r.corps.erreur} (${r.corps.details[0].point_num})`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('POST', `/api/dossiers/${dossierId}/valider`, { conformite: 'peut-être' })
r.statut === 400 ? ok('conformité invalide refusée (400)') : ko(`statut ${r.statut}`)

console.log('\n8. Validation effective')
r = await j('PUT', `/api/processus/${reception.id}/saisies`, { saisies: [
  { sectionIndex: 2, pointIndex: 0, pointNum: '3.1', pointType: 'timer', obligatoire: true,
    timerDebut: new Date(Date.now() - 90_000).toISOString(), timerFin: new Date().toISOString() }
] })
r = await j('POST', `/api/dossiers/${dossierId}/valider`,
  { conformite: 'conforme', commentaire: 'Réception conforme, cuve 2 à recontrôler.' })
r.statut === 200 && r.corps.statut === 'valide'
  ? ok(`dossier validé le ${r.corps.valide_le}`) : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

console.log('\n9. Lecture seule après validation')
r = await j('PUT', `/api/processus/${reception.id}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 0, pointNum: '1.1', pointType: 'ouinon', reponse: 'non' }
] })
r.statut === 409 ? ok(`409 — ${r.corps.erreur.split('.')[0]}.`) : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('POST', `/api/dossiers/${dossierId}/valider`, { conformite: 'non_conforme' })
r.statut === 409 ? ok('revalidation refusée (409)') : ko(`statut ${r.statut}`)

console.log('\n10. Piste d\'audit reconstituable')
r = await j('GET', `/api/dossiers/${dossierId}/audit`)
const audit = r.corps
audit.length > 0 ? ok(`${audit.length} événements tracés`) : ko('audit vide')
const sansAuteur = audit.filter((e) => !e.nom)
sansAuteur.length === 0 ? ok('tous les événements ont un auteur identifié')
  : ko(`${sansAuteur.length} événement(s) sans auteur`)
const maj = audit.find((e) => e.operation === 'UPDATE' && e.table_cible === 'saisie')
maj && Number(maj.ancien.valeur_num) === -168.2 && Number(maj.nouveau.valeur_num) === -170
  ? ok(`correction retrouvée : ${maj.ancien.valeur_num} °C → ${maj.nouveau.valeur_num} °C par ${maj.titre} ${maj.nom}`)
  : ko('la correction du point 1.3 n\'est pas reconstituable')

console.log('\n11. Gestion des comptes utilisateurs')
const login = `etest${Date.now()}`
r = await j('POST', '/api/utilisateurs',
  { identifiant: login.toUpperCase(), nom: 'ESSAI', prenom: 'Camille', titre: 'Dr',
    fonction: 'pharmacien praticien', profil: 'pharmacien' })
r.statut === 201 && r.corps.identifiant === login && r.corps.libelle === 'Dr Camille ESSAI'
  ? ok(`compte ${login} créé, identifiant normalisé, libellé « ${r.corps.libelle} »`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
const compteId = r.corps.id

r = await j('POST', '/api/utilisateurs', { identifiant: login, nom: 'X', prenom: 'Y' })
r.statut === 409 ? ok('identifiant déjà pris refusé (409)') : ko(`statut ${r.statut}`)

r = await j('POST', '/api/utilisateurs', { identifiant: 'a b', nom: 'X', prenom: 'Y' })
r.statut === 400 ? ok('identifiant hors format refusé (400)') : ko(`statut ${r.statut}`)

r = await j('POST', '/api/utilisateurs', { identifiant: `${login}b`, nom: 'X', prenom: 'Y', profil: 'chef' })
r.statut === 400 ? ok('profil inconnu refusé (400)') : ko(`statut ${r.statut}`)

r = await j('POST', '/api/utilisateurs', { identifiant: `${login}c`, prenom: 'Y' })
r.statut === 400 ? ok('nom manquant refusé (400)') : ko(`statut ${r.statut}`)

// L'identifiant lie le compte à ses saisies : le changer les réaffecterait.
r = await j('PATCH', `/api/utilisateurs/${compteId}`, { identifiant: 'autrechose' })
r.statut === 400 ? ok('identifiant non modifiable (400)') : ko(`statut ${r.statut}`)

r = await j('PATCH', `/api/utilisateurs/${compteId}`, { actif: false })
r.statut === 400 ? ok('activation refusée hors de sa route dédiée (400)') : ko(`statut ${r.statut}`)

r = await j('PATCH', `/api/utilisateurs/${compteId}`, { profil: 'qualite', titre: null })
r.statut === 200 && r.corps.profil === 'qualite' && r.corps.titre === null
  ? ok('profil et titre modifiés') : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('PATCH', '/api/utilisateurs/00000000-0000-0000-0000-000000000000', { profil: 'ide' })
r.statut === 404 ? ok('compte inconnu → 404') : ko(`statut ${r.statut}`)

r = await j('POST', `/api/utilisateurs/${compteId}/actif`, { actif: false })
r.statut === 200 && r.corps.actif === false ? ok('compte désactivé') : ko(`statut ${r.statut}`)

r = await j('GET', '/api/utilisateurs')
!r.corps.some((u) => u.id === compteId)
  ? ok('un compte désactivé sort de la liste par défaut') : ko('compte désactivé encore listé')
r = await j('GET', '/api/utilisateurs?inactifs=oui')
r.corps.some((u) => u.id === compteId)
  ? ok('et reste consultable avec inactifs=oui') : ko('compte désactivé introuvable')

r = await j('GET', `/api/utilisateurs?q=${login}`)
r.corps.length === 0 ? ok('la recherche respecte le filtre d\'activité') : ko(`${r.corps.length} résultat(s)`)

r = await j('POST', `/api/utilisateurs/${compteId}/actif`, { actif: true })
r.statut === 200 && r.corps.actif === true ? ok('compte réactivé') : ko(`statut ${r.statut}`)

// Se désactiver soi-même fermerait la porte de l'intérieur : plus aucun
// opérateur pour tracer une écriture, donc plus aucune écriture possible.
r = await j('GET', '/api/dossiers/' + dossierId)
const moi = r.corps.dossier.cree_par
r = await j('POST', `/api/utilisateurs/${moi}/actif`, { actif: false })
r.statut === 409 ? ok('auto-désactivation refusée (409)') : ko(`statut ${r.statut}`)

r = await j('GET', '/api/profils')
Array.isArray(r.corps) && r.corps.includes('pharmacien')
  ? ok(`${r.corps.length} profils exposés : ${r.corps.join(', ')}`) : ko('vocabulaire des profils absent')

console.log('\n12. Opérateur de la session, choisi en mode démonstration')
r = await j('GET', '/api/session')
r.statut === 200 && r.corps.mode === 'dev' && r.corps.selectionPossible === true
  ? ok(`mode ${r.corps.mode}, sélection de l'opérateur permise`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
r.corps.avertissement && /valeur probante/.test(r.corps.avertissement)
  ? ok('un avertissement signale que la démonstration n\'a pas valeur probante')
  : ko('aucun avertissement de mode démonstration')
r.corps.operateurs.some((o) => o.id === compteId)
  ? ok(`${r.corps.operateurs.length} opérateur(s) proposé(s) au choix`)
  : ko('le compte de test ne figure pas parmi les opérateurs proposés')
const enTete = r.corps.enTete

// L'opérateur désigné doit être celui retenu, et surtout celui que l'audit
// enregistre comme auteur : sinon la sélection serait cosmétique.
r = await j('GET', '/api/session', null, { [enTete]: compteId })
r.corps.operateur?.id === compteId
  ? ok(`opérateur désigné retenu : ${r.corps.operateur.nom}`)
  : ko(`opérateur retenu : ${JSON.stringify(r.corps.operateur)}`)

const refOp = `DOS-OP-${Date.now()}`
r = await j('POST', '/api/dossiers',
  { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refOp }, { [enTete]: compteId })
const dossierOp = r.corps?.id
r.statut === 201 ? ok(`dossier ${refOp} créé sous l'opérateur désigné`) : ko(`statut ${r.statut}`)

r = await j('GET', `/api/dossiers/${dossierOp}/audit`)
r.corps.some((e) => e.nom === 'ESSAI')
  ? ok('l\'audit attribue la création à l\'opérateur désigné, pas au défaut')
  : ko(`auteurs tracés : ${JSON.stringify(r.corps.map((e) => e.nom))}`)

// Un opérateur inconnu ou désactivé doit être refusé explicitement, avec un
// code que le front sait reconnaître pour remettre sa sélection à zéro.
r = await j('GET', '/api/session', null, { [enTete]: '00000000-0000-0000-0000-000000000000' })
r.statut === 409 && r.corps.code === 'operateur_inconnu'
  ? ok('opérateur inconnu refusé (409, code operateur_inconnu)')
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
r = await j('GET', '/api/session', null, { [enTete]: 'pas-un-uuid' })
r.statut === 409 ? ok('en-tête malformé refusé (409)') : ko(`statut ${r.statut}`)

// Le compte de test est laissé désactivé : un compte actif figure dans le
// sélecteur d'opérateur de la démonstration, et une suite de tests n'a pas à
// peupler ce sélecteur. Il n'est pas supprimé — un compte ne s'efface pas.
r = await j('POST', `/api/utilisateurs/${compteId}/actif`, { actif: false })
r.statut === 200 && r.corps.actif === false
  ? ok('compte de test laissé désactivé, sans polluer le sélecteur d\'opérateur')
  : ko(`statut ${r.statut}`)

r = await j('GET', '/api/session', null, { [enTete]: compteId })
r.statut === 409
  ? ok('un compte désactivé cesse aussitôt d\'être désignable, sans redémarrage')
  : ko(`statut ${r.statut} — un compte désactivé reste utilisable`)

console.log('\n13. Liste des dossiers (tableau de bord)')
r = await j('GET', '/api/dossiers')
const liste = r.corps
Array.isArray(liste) && liste.length >= 1
  ? ok(`${liste.length} dossier(s) listés`) : ko(`réponse : ${JSON.stringify(r.corps)}`)

const ligne = liste.find((x) => x.id === dossierId)
ligne ? ok(`le dossier ${ref} figure dans la liste`) : ko('dossier créé absent de la liste')
ligne?.statutAffiche === 'termine' && ligne?.etape === 'Parcours clos'
  ? ok('un dossier validé est affiché « Parcours clos »')
  : ko(`statut ${ligne?.statutAffiche}, étape « ${ligne?.etape} »`)
ligne?.nbAlarmes === 1
  ? ok(`${ligne.nbAlarmes} alarme de seuil comptée sur le dossier`)
  : ko(`${ligne?.nbAlarmes} alarme(s) au lieu de 1`)
typeof ligne?.avancement === 'number' && ligne.nbProcessus === NB_PROCESSUS
  ? ok(`avancement ${ligne.avancement} % sur ${ligne.nbProcessus} processus`)
  : ko(`avancement/processus : ${JSON.stringify([ligne?.avancement, ligne?.nbProcessus])}`)

// L'anonymat vaut aussi dans une liste — c'est justement là qu'une identité
// fuit sans qu'on y pense.
ligne?.patient === null
  ? ok('aucune donnée identifiante sur un dossier sans patient')
  : ko(`patient renvoyé sur un dossier anonyme : ${JSON.stringify(ligne?.patient)}`)

r = await j('GET', '/api/dossiers?statut=attente')
r.corps.every((x) => x.patient === null && x.statut !== 'valide')
  ? ok(`${r.corps.length} dossier(s) en attente d'allocation, tous sans patient`)
  : ko('le filtre « attente » laisse passer des dossiers alloués ou clos')

r = await j('GET', '/api/dossiers?statut=valide')
r.corps.every((x) => x.statut === 'valide')
  ? ok(`${r.corps.length} dossier(s) terminés, restant consultables`)
  : ko('le filtre « valide » laisse passer des dossiers ouverts')

r = await j('GET', `/api/dossiers?q=${ref}`)
r.corps.length === 1 && r.corps[0].id === dossierId
  ? ok('recherche par référence exacte') : ko(`${r.corps.length} résultat(s)`)

r = await j('GET', '/api/dossiers?q=zzz-aucune-chance-zzz')
r.corps.length === 0 ? ok('une recherche sans résultat renvoie une liste vide')
  : ko(`${r.corps.length} résultat(s) inattendus`)

console.log('\n14. En-tête du dossier et ajout de processus')
const refH = `DOS-ENT-${Date.now()}`
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refH })
const dossierH = r.corps.id
r.statut === 201 ? ok(`dossier ${refH} créé`) : ko(`statut ${r.statut}`)

r = await j('PATCH', `/api/dossiers/${dossierH}`, {
  designationProduit: 'Kymriah® (tisagenlecleucel)',
  numeroLot: 'LOT-KY-2608-A',
  datePeremption: '2026-12-31',
  nbExemplaires: 3
})
r.statut === 200 ? ok('en-tête enregistré') : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('GET', `/api/dossiers/${dossierH}`)
r.corps.dossier.numero_lot === 'LOT-KY-2608-A' && r.corps.dossier.nb_exemplaires === 3
  ? ok('en-tête relu depuis la base')
  : ko(`relu : ${JSON.stringify([r.corps.dossier.numero_lot, r.corps.dossier.nb_exemplaires])}`)

// Liste blanche : le statut ne se change pas par cette route, la validation a
// la sienne, qui vérifie les points obligatoires.
r = await j('PATCH', `/api/dossiers/${dossierH}`, { statut: 'valide' })
r.statut === 400 ? ok('champ hors liste blanche refusé (400)') : ko(`statut ${r.statut}`)
r = await j('PATCH', `/api/dossiers/${dossierH}`, { nbExemplaires: 99 })
r.statut === 400 ? ok('nbExemplaires hors bornes refusé (400)') : ko(`statut ${r.statut}`)
r = await j('PATCH', '/api/dossiers/00000000-0000-0000-0000-000000000000', { numeroLot: 'X' })
r.statut === 404 ? ok('dossier inconnu → 404') : ko(`statut ${r.statut}`)

// Un processus ajouté en cours de parcours doit exister côté serveur, sinon
// ses saisies n'auraient aucun dossier_processus où atterrir.
r = await j('POST', `/api/dossiers/${dossierH}/processus`, {
  code: 'CQ_INTERMEDIAIRE', nom: 'Contrôle qualité intermédiaire',
  sections: [{ titre: 'Contrôle qualité', points: [{ num: 'CQ.1', libelle: 'Aspect conforme', type: 'ouinon', obligatoire: true }] }]
})
const procAjoute = r.corps?.id
r.statut === 201 && r.corps.ajoute_du_catalogue === true &&
  r.corps.ordre === NB_PROCESSUS + 1
  ? ok(`processus ajouté au rang ${r.corps.ordre}, marqué « du catalogue »`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('PUT', `/api/processus/${procAjoute}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 0, pointNum: 'CQ.1', pointType: 'ouinon',
    obligatoire: true, reponse: 'oui' }
] })
r.statut === 200 ? ok('les saisies du processus ajouté sont enregistrées')
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

r = await j('POST', `/api/dossiers/${dossierH}/processus`, { nom: 'sans code' })
r.statut === 400 ? ok('ajout sans code refusé (400)') : ko(`statut ${r.statut}`)

// Un dossier validé est figé : ni en-tête, ni nouveau processus.
r = await j('POST', `/api/dossiers/${dossierH}/valider`, { conformite: 'conforme' })
r.statut === 200 ? ok('dossier validé') : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
r = await j('PATCH', `/api/dossiers/${dossierH}`, { numeroLot: 'APRES-VALIDATION' })
r.statut === 409 ? ok('en-tête en lecture seule après validation (409)') : ko(`statut ${r.statut}`)
r = await j('POST', `/api/dossiers/${dossierH}/processus`, { code: 'X', nom: 'X' })
r.statut === 409 ? ok('plus d\'ajout de processus après validation (409)') : ko(`statut ${r.statut}`)

console.log('\n15. Référentiels du tableau de bord')
r = await j('GET', '/api/produits')
Array.isArray(r.corps) && r.corps.length >= 1
  ? ok(`${r.corps.length} produit(s) de référence`) : ko(`réponse : ${JSON.stringify(r.corps)}`)
r.corps.every((p) => p.id && p.denomination)
  ? ok('chaque produit porte un identifiant et une dénomination')
  : ko('produit incomplet dans la liste')
const kymriah = r.corps.find((p) => /KYMRIAH/i.test(p.denomination))
kymriah?.seuilTempC === -150
  ? ok(`seuil de conservation exposé : ${kymriah.seuilTempC} °C`)
  : ko(`seuil : ${JSON.stringify(kymriah?.seuilTempC)}`)

r = await j('GET', '/api/modeles')
r.corps.some((m) => m.code === 'PARCOURS_CART_AUTOLOGUE' && m.nbProcessus === NB_PROCESSUS)
  ? ok(`le modèle de parcours actif est listé avec ses ${NB_PROCESSUS} processus`)
  : ko(`modèles : ${JSON.stringify(r.corps)}`)

// Création en un seul appel : un dossier créé sans son produit, parce qu'un
// second appel a échoué, serait une incohérence gratuite.
const refP = `DOS-PROD-${Date.now()}`
r = await j('POST', '/api/dossiers', {
  codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refP,
  produitId: kymriah.id, numeroLot: 'LOT-PROD-1'
})
r.statut === 201 ? ok('dossier créé avec produit et lot en un seul appel') : ko(`statut ${r.statut}`)

r = await j('GET', `/api/dossiers?q=${refP}`)
r.corps[0]?.numeroLot === 'LOT-PROD-1' && /KYMRIAH/i.test(r.corps[0]?.produit ?? '')
  ? ok(`relu dans la liste : ${r.corps[0].produit} / ${r.corps[0].numeroLot}`)
  : ko(`ligne : ${JSON.stringify(r.corps[0])}`)

r = await j('GET', `/api/dossiers?produit=${kymriah.id}`)
r.corps.length >= 1 && r.corps.every((d) => /KYMRIAH/i.test(d.produit ?? ''))
  ? ok(`filtre par produit : ${r.corps.length} dossier(s), tous du bon produit`)
  : ko('le filtre par produit laisse passer autre chose')

console.log('\n16. Jalon de prescription')
const refJ = `DOS-PRESC-${Date.now()}`
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refJ })
const dossierJ = r.corps.id
r = await j('GET', `/api/dossiers/${dossierJ}`)
r.corps.dossier.prescription_faite === false
  ? ok('un dossier neuf porte « prescription non réalisée »')
  : ko(`prescription_faite = ${r.corps.dossier.prescription_faite}`)

r = await j('PATCH', `/api/dossiers/${dossierJ}`, { prescriptionFaite: true })
r.statut === 200 ? ok('jalon posé') : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
r = await j('GET', `/api/dossiers?q=${refJ}`)
r.corps[0]?.prescriptionFaite === true
  ? ok('jalon repris dans la liste du tableau de bord')
  : ko(`liste : ${JSON.stringify(r.corps[0]?.prescriptionFaite)}`)

r = await j('PATCH', `/api/dossiers/${dossierJ}`, { prescriptionFaite: 'oui' })
r.statut === 400 ? ok('valeur non booléenne refusée (400)') : ko(`statut ${r.statut}`)

r = await j('PATCH', `/api/dossiers/${dossierJ}`, { prescriptionFaite: false })
r.statut === 200 ? ok('jalon retiré — le parcours peut revenir en arrière avant validation')
  : ko(`statut ${r.statut}`)

// Le jalon est un état du dossier : son changement doit être tracé, comme le
// reste. C'est ce qui distingue un jalon d'un simple affichage.
r = await j('GET', `/api/dossiers/${dossierJ}/audit`)
const majJalon = r.corps.filter((e) => e.table_cible === 'dossier' && e.operation === 'UPDATE')
majJalon.length >= 2 && majJalon.every((e) => e.nom)
  ? ok(`${majJalon.length} changement(s) de jalon tracés, tous avec leur auteur`)
  : ko(`traces : ${JSON.stringify(majJalon.map((e) => e.nom))}`)

console.log('\n17. Processus amont et jalons calendaires')
r = await j('GET', '/api/modeles/PARCOURS_CART_AUTOLOGUE')
const noms = r.corps.processus.map((p) => p.nom)
const iCommande = noms.findIndex((n) => /Commande MTI/.test(n))
const iReception = noms.findIndex((n) => /^Réception \(/.test(n))
iCommande >= 0 && iReception >= 0 && iCommande < iReception
  ? ok(`la commande MTI (rang ${iCommande + 1}) précède la réception (rang ${iReception + 1})`)
  : ko(`ordre : commande ${iCommande}, réception ${iReception}`)
/* L'aphérèse ne figure plus dans cette liste : ramenée à une date facultative,
   elle vit en jalon d'en-tête (dossier.apherese_faite / date_apherese) et non
   comme processus du parcours. Éprouvée plus bas avec les autres jalons. */
;['Demande d\'accès au traitement',
  'Rattachement patient / prescription'].every((n) => noms.includes(n))
  ? ok('les autres processus amont sont présents')
  : ko(`processus : ${JSON.stringify(noms.slice(0, 5))}`)
noms.some((n) => /Aphérèse/i.test(n))
  ? ko(`l'aphérèse est encore un processus du parcours : ${noms.filter((n) => /Aphérèse/i.test(n))}`)
  : ok("l'aphérèse ne figure plus comme processus — c'est un jalon d'en-tête")

// L'identité patient reste imposée par la mise en fabrication : son index a
// bougé avec l'insertion des processus amont, il doit avoir suivi.
const iFab = noms.findIndex((n) => /Mise en fabrication/.test(n))
r.corps.indexIdentificationPatient === iFab
  ? ok(`identité patient exigée à partir du rang ${iFab + 1} (${noms[iFab]})`)
  : ko(`index ${r.corps.indexIdentificationPatient} au lieu de ${iFab}`)

// Les jalons calendaires ne doivent pas être du texte libre : sans type, ils
// seraient intriables et incomparables.
const pointsCommande = r.corps.processus[iCommande].sections.flatMap((sc) => sc.points)
const jalons = pointsCommande.filter((pt) => pt.type === 'date').map((pt) => pt.libelle)
/* Deux jalons, plus trois : la date d'aphérèse a quitté la commande en v4. Elle
   vit en en-tête du dossier, et la laisser ici en aurait fait un doublon dont
   rien ne dit lequel fait foi. */
jalons.length === 2 ? ok(`2 jalons de type « date » : ${jalons.join(' · ')}`)
  : ko(`jalons date : ${JSON.stringify(jalons)}`)
jalons.some((l) => /phérèse/i.test(l))
  ? ko(`la date d'aphérèse est encore un point de la commande : ${jalons}`)
  : ok("la date d'aphérèse ne figure plus dans la commande")

// Le type doit être accepté à l'écriture ET compté à la validation, sinon un
// jalon obligatoire vide passerait — plus grave que de le refuser.
const refD = `DOS-DATE-${Date.now()}`
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refD })
const dossierD = r.corps.id
r = await j('GET', `/api/dossiers/${dossierD}`)
const procCommande = r.corps.processus.find((p) => /Commande MTI/.test(p.nom))
r = await j('PUT', `/api/processus/${procCommande.id}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 2, pointType: 'date', obligatoire: true, valeurTexte: '' }
] })
r.statut === 200 ? ok('une saisie de type date est acceptée') : ko(`statut ${r.statut}`)

r = await j('POST', `/api/dossiers/${dossierD}/valider`, { conformite: 'conforme' })
r.statut === 422 && r.corps.details?.some((d) => d.point_type === 'date')
  ? ok('un jalon date obligatoire et vide bloque la validation (422)')
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 160)}`)

r = await j('PUT', `/api/processus/${procCommande.id}/saisies`, { saisies: [
  { sectionIndex: 0, pointIndex: 2, pointType: 'date', obligatoire: true,
    valeurTexte: '2026-09-15' }
] })
r = await j('GET', `/api/dossiers/${dossierD}`)
r.corps.saisies.some((sa) => sa.point_type === 'date' && sa.valeur_texte === '2026-09-15')
  ? ok('le jalon est relu au format ISO depuis la base')
  : ko('jalon date introuvable en base')

// Les dossiers ouverts sur une version antérieure gardent leur définition
// figée : c'est tout l'intérêt de la recopie à la création.
r = await j('GET', '/api/dossiers')
const versions = [...new Set(r.corps.map((d) => d.versionModele))].sort()
versions.length >= 1
  ? ok(`versions de modèle en service dans les dossiers : v${versions.join(', v')}`)
  : ko('aucune version de modèle rapportée')

console.log('\n18. Commentaire, n° de série, kits et contresignature')
const refK = `DOS-KIT-${Date.now()}`
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refK })
const dossierK = r.corps.id
r = await j('GET', `/api/dossiers/${dossierK}`)
const procK = r.corps.processus.find((p) => p.gabarit === 'reception')

// Le kit vient du modèle : composition et compte propre à chaque composant.
const secKit = procK.definition.sections.find((sc) => (sc.kits ?? []).length)
secKit ? ok(`section « ${secKit.titre} » porte ${secKit.kits.length} kit(s)`)
  : ko('aucune section ne déclare de kit')
const compo = secKit?.kits?.[0]?.composition ?? ''
if (/CD4/.test(compo) && /CD8/.test(compo)) ok(`composition : ${compo}`)
else ko(`composition : ${JSON.stringify(secKit?.kits?.[0])}`)
const tubes = secKit.points.filter((pt) => pt.kit === secKit.kits[0].id && pt.exemplaires)
tubes.length === 2 && tubes[0].exemplaires === 3 && tubes[1].exemplaires === 2
  ? ok(`exemplaires propres au point : ${tubes.map((t) => t.exemplaires).join(' et ')}`)
  : ko(`exemplaires : ${JSON.stringify(tubes.map((t) => t.exemplaires))}`)

const iKit = procK.definition.sections.indexOf(secKit)
r = await j('PUT', `/api/processus/${procK.id}/saisies`, { saisies: [
  { sectionIndex: iKit, pointIndex: 0, pointNum: '7.1', pointType: 'ouinon', exemplaire: 1,
    obligatoire: true, reponse: 'oui', numeroSerie: 'CD4-000117',
    commentaire: 'Étiquette décollée, tube intègre.' },
  { sectionIndex: iKit, pointIndex: 0, pointNum: '7.1', pointType: 'ouinon', exemplaire: 2,
    obligatoire: true, reponse: 'oui', numeroSerie: 'CD4-000118' },
  { sectionIndex: iKit, pointIndex: 1, pointNum: '7.2', pointType: 'ouinon', exemplaire: 1,
    obligatoire: true, reponse: 'oui', numeroSerie: '   ' }
] })
r.statut === 200 ? ok('saisies avec n° de série et commentaire enregistrées') : ko(`statut ${r.statut}`)

r = await j('GET', `/api/dossiers/${dossierK}`)
const parEx = (ex) => r.corps.saisies.find(
  (sa) => sa.point_num === '7.1' && sa.exemplaire === ex)
parEx(1)?.numero_serie === 'CD4-000117' && parEx(2)?.numero_serie === 'CD4-000118'
  ? ok('un n° de série par exemplaire, distincts')
  : ko(`séries : ${JSON.stringify([parEx(1)?.numero_serie, parEx(2)?.numero_serie])}`)
if (/Étiquette décollée/.test(parEx(1)?.commentaire ?? '')) {
  ok('commentaire relu sur la bonne ligne')
} else {
  ko(`commentaire : ${parEx(1)?.commentaire}`)
}
parEx(2)?.commentaire === null
  ? ok('pas de commentaire là où rien n\'a été saisi') : ko(`commentaire parasite : ${parEx(2)?.commentaire}`)
// Une chaîne d'espaces n'est pas un n° de série : elle ne doit pas être stockée.
r.corps.saisies.find((sa) => sa.point_num === '7.2')?.numero_serie === null
  ? ok('un n° de série vide de sens est ramené à NULL')
  : ko('une chaîne d\'espaces a été stockée comme n° de série')

// Contresignature : elle vaut pour le processus entier, avec rappel des points.
r = await j('GET', '/api/session')
const moiSession = r.corps.operateur.id
let autre = r.corps.operateurs.find((o) => o.id !== moiSession)
/* Une base fraîche ne porte qu'un compte : la suite s'en crée un second plutôt
   que d'échouer sur une absence qui n'est pas un défaut de l'application. */
if (!autre) {
  const second = `e2e.contre.${Date.now()}`
  const c = await j('POST', '/api/utilisateurs',
    { identifiant: second, nom: 'CONTRESIGNE', prenom: 'Test', titre: 'Dr', profil: 'pharmacien' })
  if (c.statut === 201) {
    autre = { id: c.corps.id, libelle: `Dr Test CONTRESIGNE` }
    ok(`second opérateur créé pour la contresignature (${second})`)
  }
}
if (!autre) {
  ko('aucun second opérateur actif et création impossible : contresignature non éprouvable')
} else {
  r = await j('POST', `/api/processus/${procK.id}/contresigner`, { utilisateurId: moiSession })
  r.statut === 409 ? ok('contresignature par soi-même refusée (409)') : ko(`statut ${r.statut}`)

  r = await j('POST', `/api/processus/${procK.id}/contresigner`, { utilisateurId: autre.id })
  r.statut === 200 && r.corps.points.length >= 4
    ? ok(`contresigné par ${r.corps.contresignataire.libelle} — ${r.corps.points.length} points rappelés`)
    : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 140)}`)
  const empreinte = r.corps.empreinte
  if (/^[0-9a-f]{64}$/.test(empreinte ?? '')) {
    ok(`empreinte SHA-256 du contenu signé : ${empreinte.slice(0, 16)}…`)
  } else {
    ko(`empreinte : ${empreinte}`)
  }

  r = await j('POST', `/api/processus/${procK.id}/contresigner`, { utilisateurId: autre.id })
  r.corps?.deja === true ? ok('une seconde contresignature du même vérificateur ne double pas')
    : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 120)}`)

  r = await j('GET', `/api/dossiers/${dossierK}/signatures`)
  r.corps.length === 1 && r.corps[0].role === 'verificateur'
    ? ok(`1 contresignature relue, rôle « ${r.corps[0].role} »`)
    : ko(`signatures : ${JSON.stringify(r.corps.map((x) => x.role))}`)

  r = await j('POST', '/api/processus/00000000-0000-0000-0000-000000000000/contresigner',
    { utilisateurId: autre.id })
  r.statut === 404 ? ok('processus inconnu → 404') : ko(`statut ${r.statut}`)

  // Un processus sans point en double validation n'a rien à contresigner.
  r = await j('GET', `/api/dossiers/${dossierK}`)
  const sansDbl = r.corps.processus.find((p) => !(p.definition?.sections ?? [])
    .flatMap((sc) => sc.points ?? []).some((pt) => pt.doubleValidation))
  r = await j('POST', `/api/processus/${sansDbl.id}/contresigner`, { utilisateurId: autre.id })
  r.statut === 409 ? ok(`« ${sansDbl.nom} » : rien à contresigner, refusé (409)`)
    : ko(`statut ${r.statut}`)
}

/* Un patient retiré de l'annuaire entre l'ouverture de l'écran et
   l'enregistrement : c'est une erreur d'appelant, pas une panne. Le 500 qui en
   sortait ne disait rien d'exploitable — ni au front, qui ne pouvait pas
   distinguer ce cas d'une base en vrac, ni à qui lit les journaux. */
/* Sur un dossier NEUF : celui du groupe 1 a été validé depuis, et le refus de
   lecture seule masquerait le cas qu'on éprouve ici. */
r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE' })
r = await j('PATCH', `/api/dossiers/${r.corps.id}`,
  { preallocation: true, patientId: '00000000-0000-0000-0000-000000000000' })
r.statut === 409 && r.corps?.code === 'patient_inconnu'
  ? ok('un patient qui n\'existe plus → 409 « patient_inconnu », pas 500')
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 140)}`)

// ── 19. Photos : dépôt, lecture, retrait ──
//
// La cellule photo ne cochait qu'un pictogramme : ✅ s'affichait sans qu'aucune
// image existe. Ce groupe éprouve la chaîne complète, y compris ce qu'elle doit
// REFUSER — un format qui n'est pas une image, un contenu illisible, un dossier
// figé. Une pièce jointe acceptée à tort vaut une preuve fabriquée.
console.log('\n19. Photos')
{
  const refPh = `DOS-PHOTO-${Date.now()}`
  r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: refPh })
  const dossierPh = r.corps.id
  r = await j('GET', `/api/dossiers/${dossierPh}`)
  const procPh = r.corps.processus.find((p) => p.gabarit === 'reception')

  /* Un PNG minuscule fabriqué ici : le test ne doit dépendre d'aucun fichier
     du dépôt, sinon il échoue pour une raison qui n'a rien à voir. */
  const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const poser = (corps) => j('POST', `/api/dossiers/${dossierPh}/processus/${procPh.id}/photos`,
    { sectionIndex: 0, pointIndex: 4, exemplaire: 1, operateurRole: 'op1', ...corps })

  r = await poser({ mime: 'image/png', nomFichier: 'essai.png', libelle: 'Avant', contenu: PNG_1x1 })
  const photoId = r.corps?.id
  r.statut === 201 && photoId
    ? ok(`photo déposée : ${r.corps.taille} octets, sha ${String(r.corps.sha256).slice(0, 12)}…`)
    : ko(`statut ${r.statut} — ${JSON.stringify(r.corps).slice(0, 160)}`)

  /* Le dépôt crée la saisie porteuse : sans cela il faudrait enregistrer le
     processus d'abord, et une photo prise avant tout autre geste serait
     perdue. */
  r = await j('GET', `/api/dossiers/${dossierPh}`)
  const saisiePh = r.corps.saisies.find((x) => x.point_type === 'photo')
  saisiePh ? ok('la saisie porteuse est créée par le dépôt lui-même')
    : ko('aucune saisie photo après le dépôt')
  r.corps.photos?.length === 1 && r.corps.photos[0].id === photoId
    ? ok('la photo remonte avec le dossier, sans son contenu')
    : ko(`photos du dossier : ${JSON.stringify(r.corps.photos)}`)
  r.corps.photos?.[0]?.contenu === undefined
    ? ok('le contenu ne voyage pas dans la réponse du dossier')
    : ko('le contenu est embarqué dans la réponse : ouverture alourdie pour rien')

  const brut = await fetch(`${base}/api/photos/${photoId}`)
  const octets = Buffer.from(await brut.arrayBuffer())
  brut.status === 200 && brut.headers.get('content-type') === 'image/png' &&
    octets.length === Buffer.from(PNG_1x1, 'base64').length
    ? ok(`contenu relu à l'identique (${octets.length} octets, image/png)`)
    : ko(`lecture : ${brut.status} ${brut.headers.get('content-type')} ${octets.length} octets`)

  r = await poser({ mime: 'application/pdf', nomFichier: 'x.pdf', contenu: PNG_1x1 })
  r.statut === 415 ? ok('format non image refusé (415)') : ko(`statut ${r.statut}`)

  /* Buffer.from ne signale pas une base64 invalide, il tronque en silence :
     sans contrôle explicite, une pièce vide passerait pour un dépôt réussi. */
  r = await poser({ mime: 'image/png', nomFichier: 'x.png', contenu: '!!!!' })
  r.statut === 400 ? ok('base64 illisible refusée (400), pas de pièce vide')
    : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)

  r = await j('DELETE', `/api/photos/${photoId}`)
  const apresRetrait = await fetch(`${base}/api/photos/${photoId}`)
  r.statut === 204 && apresRetrait.status === 404
    ? ok('retrait effectif : la pièce n\'est plus servie')
    : ko(`retrait ${r.statut}, lecture ${apresRetrait.status}`)

  /* Un dossier validé est en lecture seule : y ajouter une photo reviendrait à
     compléter après coup un dossier figé. */
  r = await poser({ mime: 'image/png', nomFichier: 'apres.png', contenu: PNG_1x1 })
  const photoAvantCloture = r.corps?.id
  await j('POST', `/api/dossiers/${dossierPh}/valider`,
    { conformite: 'conforme', commentaire: 'clôture pour éprouver la lecture seule' })
  r = await j('GET', `/api/dossiers/${dossierPh}`)
  if (r.corps.dossier.statut === 'valide') {
    r = await poser({ mime: 'image/png', nomFichier: 'trop-tard.png', contenu: PNG_1x1 })
    r.statut === 409 ? ok('dossier validé : dépôt refusé (409)') : ko(`statut ${r.statut}`)
    r = await j('DELETE', `/api/photos/${photoAvantCloture}`)
    r.statut === 409 ? ok('dossier validé : retrait refusé (409)') : ko(`statut ${r.statut}`)
  } else {
    console.log(`  · dossier non validé (${r.corps.dossier.statut}) — lecture seule non éprouvée`)
  }
}

console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
