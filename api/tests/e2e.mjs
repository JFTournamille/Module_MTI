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
/* Pas de seuil en dur sur le nombre de processus : il a valu 12, puis 15, puis
   11 quand le suivi fabricant a été replié dans la commande. Ce qui doit être
   vrai, c'est qu'un modèle actif existe et porte des processus. */
NB_PROCESSUS >= 1
  ? ok(`${NB_PROCESSUS} processus au parcours actif`)
  : ko(`modèle actif introuvable ou vide : ${JSON.stringify(modeles.map((m) => m.code))}`)

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
/* Le champ `avertissement` a été retiré avec le bandeau qu'il alimentait :
   `mode` et `selectionPossible` ci-dessus portent la même information à qui
   interroge la session. */
r.corps.avertissement === undefined
  ? ok('plus de champ « avertissement » : le bandeau a été retiré')
  : ko('le champ « avertissement » subsiste sans rien pour l\'afficher')
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
/* « Parcours clos » désignait le dossier VALIDÉ, et c'était le mot le plus
   trompeur du tableau de bord : depuis qu'un parcours peut réellement être
   clos sur un avortement, les deux états auraient porté le même libellé en
   disant l'inverse l'un de l'autre. Validé = allé au bout ; clos = arrêté en
   chemin. */
ligne?.statutAffiche === 'termine' && ligne?.etape === 'Parcours validé'
  ? ok('un dossier validé est affiché « Parcours validé », plus « Parcours clos »')
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

/* Bascule d'anonymat : c'est un RANG, mais il se déduit d'un CODE. Le parcours
   désigne son processus pivot par `codeIdentificationPatient` — « mise en
   fabrication » le portait jusqu'en v4, le rattachement patient depuis. Ce
   qu'on éprouve n'est donc pas un rang en dur, mais que le rang publié
   corresponde bien au code déclaré : c'est exactement le décalage qu'a produit
   le retrait de l'aphérèse en v3. */
const codePivot = r.corps.codeIdentificationPatient
const iPivot = r.corps.processus.findIndex((p) => p.code === codePivot)
if (!codePivot) {
  console.log('  · le parcours ne déclare pas de pivot d\'identification — nominatif d\'emblée')
} else if (iPivot < 0) {
  ko(`codeIdentificationPatient « ${codePivot} » absent du parcours`)
} else if (r.corps.indexIdentificationPatient === iPivot) {
  ok(`identité patient exigée à partir du rang ${iPivot + 1} (${noms[iPivot]}), ` +
     `déduit du code « ${codePivot} »`)
} else {
  ko(`index ${r.corps.indexIdentificationPatient} au lieu de ${iPivot} pour « ${codePivot} »`)
}

// Les jalons calendaires ne doivent pas être du texte libre : sans type, ils
// seraient intriables et incomparables.
const pointsCommande = r.corps.processus[iCommande].sections.flatMap((sc) => sc.points)
const jalons = pointsCommande.filter((pt) => pt.type === 'date').map((pt) => pt.libelle)
/* Pas de compte en dur — il a changé à chaque version de la commande. Ce qui
   doit rester vrai, c'est qu'un jalon calendaire soit TYPÉ « date » : en texte
   libre, il serait intriable et incomparable. On cherche donc les points qui
   annoncent une date dans leur libellé et n'en portent pas le type. */
const fausseDate = pointsCommande.filter(
  (pt) => /^date\b/i.test(pt.libelle) && pt.type !== 'date')
jalons.length >= 1 && !fausseDate.length
  ? ok(`${jalons.length} jalon(s) de type « date », aucun en texte libre : ${jalons.join(' · ')}`)
  : ko(`jalons date : ${JSON.stringify(jalons)} ; ` +
       `mal typés : ${JSON.stringify(fausseDate.map((pt) => pt.libelle))}`)

/* La date d'aphérèse a quitté la commande en v4 : elle vit en en-tête du
   dossier, et la laisser ici en ferait un doublon dont rien ne dit lequel fait
   foi. */
pointsCommande.some((pt) => /aphérèse|apherese/i.test(pt.libelle))
  ? ko('la commande porte encore un point d\'aphérèse')
  : ok("la commande ne porte plus de point d'aphérèse")
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

  const poser = (corps) => j('POST', `/api/dossiers/${dossierPh}/processus/${procPh.id}/pieces`,
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
  r.corps.pieces?.length === 1 && r.corps.pieces[0].id === photoId
    ? ok('la photo remonte avec le dossier, sans son contenu')
    : ko(`pièces du dossier : ${JSON.stringify(r.corps.pieces)}`)
  r.corps.pieces?.[0]?.contenu === undefined
    ? ok('le contenu ne voyage pas dans la réponse du dossier')
    : ko('le contenu est embarqué dans la réponse : ouverture alourdie pour rien')

  const brut = await fetch(`${base}/api/pieces/${photoId}`)
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

  r = await j('DELETE', `/api/pieces/${photoId}`)
  const apresRetrait = await fetch(`${base}/api/pieces/${photoId}`)
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
    r = await j('DELETE', `/api/pieces/${photoAvantCloture}`)
    r.statut === 409 ? ok('dossier validé : retrait refusé (409)') : ko(`statut ${r.statut}`)
  } else {
    console.log(`  · dossier non validé (${r.corps.dossier.statut}) — lecture seule non éprouvée`)
  }
}

// ── 20. Clôture d'un parcours avorté ──
console.log('\n20. Clôture d\'un parcours avorté')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E clôture' })
  const dos = r.corps?.id

  // Le motif est obligatoire, et pas seulement non vide.
  r = await j('POST', `/api/dossiers/${dos}/clore`, { motif: 'x' })
  r.statut === 400 ? ok('motif trop court refusé (400)') : ko(`statut ${r.statut}`)
  r = await j('POST', `/api/dossiers/${dos}/clore`, {})
  r.statut === 400 ? ok('clôture sans motif refusée (400)') : ko(`statut ${r.statut}`)

  r = await j('POST', `/api/dossiers/${dos}/clore`,
    { motif: 'Aphérèse non exploitable — viabilité insuffisante' })
  r.statut === 200 && r.corps?.statut === 'annule'
    ? ok(`clos : ${r.corps.motif_cloture.slice(0, 34)}…`)
    : ko(`statut ${r.statut} / ${JSON.stringify(r.corps)}`)

  /* Le gel est le cœur du sujet : sans lui la clôture ne serait qu'un libellé,
     et on continuerait de saisir dans un parcours abandonné. */
  r = await j('PATCH', `/api/dossiers/${dos}`, { numeroLot: 'APRES-CLOTURE' })
  r.statut === 409 && /clos/i.test(r.corps?.erreur ?? '')
    ? ok('en-tête figé, et le message dit « clos », pas « validé »')
    : ko(`statut ${r.statut} : ${r.corps?.erreur}`)

  r = await j('POST', `/api/dossiers/${dos}/processus`,
    { code: 'CONCILIATION', nom: 'Conciliation médicamenteuse' })
  r.statut === 409 ? ok('ajout de processus refusé (409)') : ko(`statut ${r.statut}`)

  r = await j('POST', `/api/dossiers/${dos}/valider`, { conformite: 'conforme' })
  r.statut === 409 ? ok('validation d\'un dossier clos refusée (409)') : ko(`statut ${r.statut}`)

  // Pas de déclôture, et pas de seconde clôture non plus.
  r = await j('POST', `/api/dossiers/${dos}/clore`, { motif: 'Deuxième tentative' })
  r.statut === 409 ? ok('re-clôture refusée (409)') : ko(`statut ${r.statut}`)

  // Les processus non validés cessent d'attendre.
  r = await j('GET', `/api/dossiers/${dos}`)
  const restants = r.corps.processus.filter((p) => p.etat !== 'annule' && p.etat !== 'valide')
  restants.length === 0
    ? ok('aucun processus ne reste en attente')
    : ko(`${restants.length} processus encore en attente`)

  // Le tableau de bord : clos n'est ni terminé ni en cours.
  r = await j('GET', '/api/dossiers?statut=clos')
  const ligne = r.corps.find((d) => d.id === dos)
  ligne?.statutAffiche === 'clos' && ligne?.etape === 'Parcours clos' && ligne?.cloture?.motif
    ? ok(`ligne close, motif et auteur remontés (${ligne.cloture.par ?? '—'})`)
    : ko(`ligne ${JSON.stringify(ligne && { s: ligne.statutAffiche, e: ligne.etape })}`)

  r = await j('GET', '/api/dossiers?statut=en_cours')
  r.corps.every((d) => d.id !== dos)
    ? ok('absent des dossiers en cours')
    : ko('un dossier clos apparaît encore comme en cours')

  /* Un dossier VALIDÉ n'est pas un parcours avorté : il est allé au bout, et
     le clore effacerait la conclusion du pharmacien. */
  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E validé' })
  const dosV = r.corps?.id
  await j('POST', `/api/dossiers/${dosV}/valider`, { conformite: 'conforme' })
  r = await j('POST', `/api/dossiers/${dosV}/clore`, { motif: 'Tentative sur un validé' })
  r.statut === 409 && /allé au bout/.test(r.corps?.erreur ?? '')
    ? ok('clôture d\'un dossier validé refusée, avec la raison')
    : ko(`statut ${r.statut} : ${r.corps?.erreur}`)

  // L'ordonnancier reste en saisie manuelle : c'est CHIMIO qui le fournit.
  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E ordonnancier' })
  const dosO = r.corps?.id
  await j('PATCH', `/api/dossiers/${dosO}`, { numeroOrdonnancier: 'ORD-2026-4417' })
  r = await j('GET', '/api/dossiers?reference=' + r.corps.reference)
  r.corps[0]?.numeroOrdonnancier === 'ORD-2026-4417'
    ? ok('n° d\'ordonnancier saisi à la main, remonté au tableau de bord')
    : ko(`ordonnancier ${JSON.stringify(r.corps[0]?.numeroOrdonnancier)}`)
}

// ── 21. Conformité automatique : seulement si toutes les coches sont vertes ──
console.log('\n21. Conformité automatique')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E conformité auto' })
  const dos = r.corps?.id

  /* LE POINT QUI COMPTE : un dossier vierge ne doit PAS être « tout vert ».
     La première version de la fonction ne regardait que les saisies
     existantes — sans saisie, rien de rouge, donc conformité automatique sur
     un parcours que personne n'a parcouru. */
  r = await j('GET', `/api/dossiers/${dos}/conformite`)
  r.corps?.toutVert === false && r.corps?.nonVertes?.length > 0
    ? ok(`dossier vierge : ${r.corps.nonVertes.length} coche(s) attendues, aucune verte`)
    : ko(`dossier vierge déclaré « tout vert » — ${JSON.stringify(r.corps?.toutVert)}`)

  r = await j('POST', `/api/dossiers/${dos}/valider`, { conformite: 'auto' })
  r.statut === 422 ? ok('conformité automatique refusée sur un dossier vierge (422)')
    : ko(`statut ${r.statut}`)

  // Remplir tous les points obligatoires du parcours, en vert.
  r = await j('GET', `/api/dossiers/${dos}`)
  const procs = r.corps.processus
  /* Un point « emplacement » ne se remplit pas avec du texte : il attend
     l'identifiant d'une place réelle, et la réservation qui va avec. Une
     réserve de places est donc constituée ici, et piochée au fur et à
     mesure — sans elle, le lot entier partait en erreur et TOUS les points du
     processus restaient « jamais saisis », ce qui masquait ce que ce groupe
     éprouve vraiment. */
  const cuveConf = await j('POST', '/api/contenants', {
    code: `E2E-CONF-${Date.now().toString(36).toUpperCase()}`,
    libelle: 'Cuve pour la conformité', etages: ['A'], emplacementsParEtage: 12
  })
  const placesConf = cuveConf.statut === 200
    ? (await j('GET', `/api/contenants/${cuveConf.corps.id}/emplacements?libres=oui`)).corps
    : []
  let placeSuivante = 0
  let poses = 0
  for (const p of procs) {
    if (p.externe) continue
    const lot = []
    for (const [iS, sec] of (p.definition?.sections ?? []).entries()) {
      for (const [iP, pt] of (sec.points ?? []).entries()) {
        if (pt.obligatoire !== true) continue
        const base = { sectionIndex: iS, pointIndex: iP, pointNum: pt.num ?? null,
          pointType: pt.type, exemplaire: 1, operateurRole: 'op1', obligatoire: true }
        /* Une valeur DANS le seuil : `hors_seuil` est figé côté serveur, et
           une valeur au-dessus rendrait la coche rouge — ce qui est
           exactement ce que la vérification suivante éprouve. */
        if (pt.type === 'ouinon') lot.push({ ...base, reponse: 'oui' })
        else if (pt.type === 'valeur') {
          lot.push({ ...base, valeurNum: pt.seuil !== undefined ? pt.seuil - 10 : 1 })
        } else if (pt.type === 'timer') lot.push({ ...base, timerDebut: new Date().toISOString() })
        else if (pt.type === 'photo' || pt.type === 'fichier') {
          /* Un point pièce ne se « renseigne » pas par une saisie : il attend
             un document. Le laisser obligatoire rendrait le dossier
             éternellement rouge dans ce groupe, qui éprouve autre chose. */
          lot.push({ ...base, obligatoire: false })
        }
        else if (pt.type === 'liste') lot.push({ ...base, valeurTexte: (pt.options ?? ['x'])[0] })
        else if (pt.type === 'emplacement') {
          const place = placesConf[placeSuivante++]
          /* Faute de place disponible, le point est rendu facultatif plutôt
             que renseigné avec une valeur fausse : un identifiant inventé
             ferait échouer la réservation, donc tout le lot. */
          lot.push(place ? { ...base, valeurTexte: place.id } : { ...base, obligatoire: false })
        }
        else lot.push({ ...base, valeurTexte: 'renseigné en recette' })
        poses++
      }
    }
    if (lot.length) await j('PUT', `/api/processus/${p.id}/saisies`, { saisies: lot })
  }
  poses > 0 ? ok(`${poses} point(s) obligatoire(s) renseignés en vert`) : ko('aucun point à renseigner')

  /* Et surtout : les points NON obligatoires sont restés vides. « Toutes les
     coches vertes » ne doit pas vouloir dire « tout est rempli » — un point
     facultatif laissé blanc n'empêche pas de conclure la conformité. */
  let facultatifs = 0
  for (const p of procs) {
    for (const sec of (p.definition?.sections ?? [])) {
      for (const pt of (sec.points ?? [])) if (pt.obligatoire !== true) facultatifs++
    }
  }
  facultatifs > 0
    ? ok(`${facultatifs} point(s) facultatif(s) laissés vides — ils ne doivent rien bloquer`)
    : console.log('  · aucun point facultatif au parcours — cas non éprouvé')

  r = await j('GET', `/api/dossiers/${dos}/conformite`)
  r.corps?.toutVert === true
    ? ok('tout vert MALGRÉ les points facultatifs vides')
    : ko(`reste ${r.corps?.nonVertes?.length} rouge(s) : ` +
         JSON.stringify(r.corps?.nonVertes?.slice(0, 3)))

  /* Le constat vient du SERVEUR : le client demande « auto », il n'affirme
     pas « tout est vert ». */
  r = await j('POST', `/api/dossiers/${dos}/valider`, { conformite: 'auto' })
  r.statut === 200 && r.corps?.conformite === 'conforme' &&
  r.corps?.conformite_automatique === true
    ? ok('conformité constatée automatiquement, et marquée comme telle')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  // Une conformité posée à la main n'est PAS marquée automatique.
  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E conformité main' })
  const dosM = r.corps?.id
  r = await j('POST', `/api/dossiers/${dosM}/valider`, { conformite: 'non_conforme' })
  r.statut === 200 && r.corps?.conformite_automatique === false
    ? ok('conclusion manuelle : non marquée automatique')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  /* L'asymétrie, éprouvée en base : la machine constate le vert, elle ne
     prononce jamais une non-conformité. */
  r = await j('POST', `/api/dossiers/${dos}/valider`, { conformite: 'auto' })
  r.statut === 409 ? ok('un dossier déjà validé ne se revalide pas')
    : ko(`statut ${r.statut}`)

  r = await j('POST', `/api/dossiers/${dosM}/valider`, { conformite: 'nimporte_quoi' })
  r.statut === 400 ? ok('conformité inconnue refusée (400)') : ko(`statut ${r.statut}`)
}

// ── 22. Réouverture d'un parcours clos ──
console.log('\n22. Réouverture d\'un parcours clos')
{
  const enTete = (id) => ({ 'x-mti-operateur': id })
  let r = await j('GET', '/api/session')
  const comptes = r.corps.operateurs ?? []
  const pharmacien = comptes.find((o) => o.profil === 'pharmacien')
  const preparateur = comptes.find((o) => o.profil === 'preparateur')

  if (!pharmacien || !preparateur) {
    console.log('  · pas de compte pharmacien ET préparateur — groupe sans objet')
  } else {
    r = await j('POST', '/api/dossiers',
      { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E réouverture' })
    const dos = r.corps?.id
    await j('POST', `/api/dossiers/${dos}/clore`, { motif: 'Aphérèse non exploitable' })

    /* Le droit est tenu par le SERVEUR : un client qui appelle la route sans
       le profil doit être refusé, que l'écran lui ait montré un bouton ou non. */
    r = await j('POST', `/api/dossiers/${dos}/declore`,
      { motif: 'Je tente quand même' }, enTete(preparateur.id))
    r.statut === 403 && r.corps?.code === 'profil_insuffisant'
      ? ok('préparateur : réouverture refusée (403), le profil est dit')
      : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

    // Et le dossier est resté clos.
    r = await j('GET', `/api/dossiers/${dos}`)
    r.corps.dossier.statut === 'annule'
      ? ok('le refus n\'a rien changé au dossier')
      : ko(`statut ${r.corps.dossier.statut} après un refus`)

    // Motif obligatoire, même pour un profil autorisé.
    r = await j('POST', `/api/dossiers/${dos}/declore`, { motif: 'x' }, enTete(pharmacien.id))
    r.statut === 400 ? ok('motif de réouverture trop court refusé (400)')
      : ko(`statut ${r.statut}`)

    r = await j('POST', `/api/dossiers/${dos}/declore`,
      { motif: 'Clôture par erreur, le lot est exploitable' }, enTete(pharmacien.id))
    r.statut === 200 && r.corps?.statut === 'en_cours'
      ? ok('pharmacien : parcours rouvert')
      : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

    /* LE POINT QUI COMPTE : rouvrir n'efface pas la clôture. Les colonnes de
       `dossier` sont vidées — la contrainte l'impose — mais l'épisode reste. */
    r = await j('GET', `/api/dossiers/${dos}/clotures`)
    const ep = r.corps?.[0]
    ep?.motif === 'Aphérèse non exploitable' && ep?.clos_par && ep?.reouvert_par &&
    ep?.motif_reouverture
      ? ok(`l'épisode garde tout : clos par ${ep.clos_par}, rouvert par ${ep.reouvert_par}`)
      : ko(`épisode incomplet : ${JSON.stringify(ep)}`)

    // Le dossier redevient modifiable, et réapparaît dans les dossiers en cours.
    r = await j('PATCH', `/api/dossiers/${dos}`, { numeroLot: 'REPRIS-E2E' })
    r.statut === 200 ? ok('le dossier rouvert est de nouveau modifiable')
      : ko(`PATCH ${r.statut} : ${r.corps?.erreur}`)

    r = await j('GET', `/api/dossiers/${dos}`)
    const enAttente = r.corps.processus.filter((p) => p.etat === 'annule').length
    const ouverts = r.corps.processus.filter((p) => p.etat === 'en_cours').length
    enAttente === 0 && ouverts === 1
      ? ok('les processus ont repris, un seul est ouvert')
      : ko(`${enAttente} encore annulé(s), ${ouverts} ouvert(s)`)

    // Re-clore puis rouvrir : deux épisodes, pas un écrasé.
    await j('POST', `/api/dossiers/${dos}/clore`, { motif: 'Second arrêt du parcours' })
    await j('POST', `/api/dossiers/${dos}/declore`,
      { motif: 'Seconde reprise décidée en RCP' }, enTete(pharmacien.id))
    r = await j('GET', `/api/dossiers/${dos}/clotures`)
    r.corps?.length === 2
      ? ok('deux arrêts, deux épisodes : rien n\'est écrasé')
      : ko(`${r.corps?.length} épisode(s) après deux clôtures`)

    /* Un dossier VALIDÉ n'est pas clos : le rouvrir défairait la conclusion
       signée du pharmacien. */
    r = await j('POST', '/api/dossiers',
      { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E réouv validé' })
    const dosV = r.corps?.id
    await j('POST', `/api/dossiers/${dosV}/valider`, { conformite: 'conforme' })
    r = await j('POST', `/api/dossiers/${dosV}/declore`,
      { motif: 'Tentative sur un dossier validé' }, enTete(pharmacien.id))
    r.statut === 409 && /allé au bout/.test(r.corps?.erreur ?? '')
      ? ok('réouverture d\'un dossier validé refusée, avec la raison')
      : ko(`statut ${r.statut} : ${r.corps?.erreur}`)
  }
}

// ── 23. Fichiers joints : dissociés des photos, PDF accepté ──
console.log('\n23. Fichiers joints — dissociés des photos')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E fichier' })
  const dos = r.corps?.id
  r = await j('GET', `/api/dossiers/${dos}`)

  // Le parcours doit porter des points « fichier » distincts des points photo.
  let cible = null
  let nbFichier = 0
  let nbPhoto = 0
  for (const p of r.corps.processus) {
    for (const [iS, sec] of (p.definition?.sections ?? []).entries()) {
      for (const [iP, pt] of (sec.points ?? []).entries()) {
        if (pt.type === 'fichier') { nbFichier++; cible ??= { pid: p.id, iS, iP, pt } }
        if (pt.type === 'photo') nbPhoto++
      }
    }
  }
  nbFichier > 0 && nbPhoto > 0
    ? ok(`${nbFichier} point(s) « fichier » et ${nbPhoto} point(s) « photo » — les deux coexistent`)
    : ko(`fichier: ${nbFichier}, photo: ${nbPhoto}`)

  if (!cible) {
    ko('aucun point « fichier » au parcours : le reste du groupe est sans objet')
  } else {
    const { pid, iS, iP, pt } = cible
    const socle = { sectionIndex: iS, pointIndex: iP, pointNum: pt.num ?? null,
      exemplaire: 1, operateurRole: 'op1', obligatoire: true }
    /* Un vrai PDF, pas des octets quelconques : ce qui est éprouvé est que le
       contenu revient IDENTIQUE — un certificat recompressé ne vaut rien. */
    const pdf = Buffer.from(
      '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
    const b64 = pdf.toString('base64')

    r = await j('POST', `/api/dossiers/${dos}/processus/${pid}/pieces`,
      { ...socle, pointType: 'fichier', mime: 'application/pdf',
        nomFichier: 'coa-lot-4471.pdf', libelle: 'CoA lot 4471', contenu: b64 })
    const pieceId = r.corps?.id
    r.statut === 201 && pieceId
      ? ok(`PDF accepté sur un point « fichier » (${r.corps.taille} octets)`)
      : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

    /* LA DISSOCIATION : le même PDF sur un point PHOTO doit être refusé. Sans
       ce refus, « dissocier » ne serait qu'un libellé. */
    r = await j('POST', `/api/dossiers/${dos}/processus/${pid}/pieces`,
      { ...socle, pointType: 'photo', mime: 'application/pdf',
        nomFichier: 'x.pdf', contenu: b64 })
    r.statut === 415 && /photo/.test(r.corps?.erreur ?? '')
      ? ok('le même PDF est refusé sur un point « photo » (415)')
      : ko(`statut ${r.statut} : ${r.corps?.erreur}`)

    /* SVG et HTML portent du script, et le contenu est servi depuis l'origine
       de l'application. Leur refus n'est pas une commodité. */
    for (const [mime, nom] of [['image/svg+xml', 'x.svg'], ['text/html', 'x.html']]) {
      r = await j('POST', `/api/dossiers/${dos}/processus/${pid}/pieces`,
        { ...socle, pointType: 'fichier', mime, nomFichier: nom, contenu: b64 })
      r.statut === 415
        ? ok(`${mime} refusé — format scriptable`)
        : ko(`${mime} accepté (${r.statut}) : il s'exécuterait dans la page`)
    }

    // Le contenu revient octet pour octet, et se TÉLÉCHARGE au lieu de s'ouvrir.
    const brut = await fetch(`${base}/api/pieces/${pieceId}`)
    const recu = Buffer.from(await brut.arrayBuffer())
    recu.equals(pdf)
      ? ok('le PDF est relu à l\'identique, sans recompression')
      : ko(`${recu.length} octets relus contre ${pdf.length} déposés`)
    const disposition = brut.headers.get('content-disposition') ?? ''
    disposition.includes('attachment')
      ? ok('servi en pièce à télécharger, pas ouvert dans la page')
      : ko(`content-disposition : ${disposition}`)
    brut.headers.get('x-content-type-options') === 'nosniff'
      ? ok('nosniff : le navigateur ne devine pas un type plus permissif')
      : ko('en-tête nosniff absent')

    // Une image reste servie en ligne : elle s'affiche à sa place.
    r = await j('GET', `/api/dossiers/${dos}`)
    const piece = r.corps.pieces?.find((x) => x.id === pieceId)
    piece && piece.mime === 'application/pdf' && piece.contenu === undefined
      ? ok('la pièce remonte avec le dossier, sans son contenu')
      : ko(`pièce : ${JSON.stringify(piece)}`)

    /* Un point « fichier » obligatoire sans document n'est pas une coche
       verte : c'est ce que la migration 019 a ajouté. */
    r = await j('DELETE', `/api/pieces/${pieceId}`)
    r.statut === 204 ? ok('retrait du document') : ko(`retrait ${r.statut}`)
    r = await j('GET', `/api/dossiers/${dos}/conformite?processus=${pid}`)
    const rouge = r.corps?.nonVertes?.some((c) => /obligatoire/.test(c.raison))
    rouge
      ? ok('un point « fichier » obligatoire sans document reste rouge')
      : ko(`aucune coche rouge après retrait : ${JSON.stringify(r.corps?.nonVertes)}`)
  }
}

// ── 24. Le nombre d'exemplaires appartient au processus ──
console.log('\n24. Exemplaires par processus')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E exemplaires' })
  const dos = r.corps?.id
  r = await j('GET', `/api/dossiers/${dos}`)
  const recep = r.corps.processus.find((p) => p.code === 'RECEPTION')
  const autre = r.corps.processus.find((p) => p.code !== 'RECEPTION' && !p.externe)

  recep?.nb_exemplaires === 1 && autre?.nb_exemplaires === 1
    ? ok('chaque processus démarre à 1 exemplaire')
    : ko(`réception ${recep?.nb_exemplaires}, autre ${autre?.nb_exemplaires}`)

  r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`, { nbExemplaires: 3 })
  r.statut === 200 && r.corps?.nb_exemplaires === 3
    ? ok('réception portée à 3 exemplaires')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  /* LE POINT QUI COMPTE : le compte est PROPRE au processus. Un compte unique
     porté par le dossier obligeait à prendre le maximum et à cocher « sans
     objet » ailleurs. */
  r = await j('GET', `/api/dossiers/${dos}`)
  const apres = r.corps.processus
  apres.find((p) => p.code === 'RECEPTION').nb_exemplaires === 3 &&
  apres.find((p) => p.id === autre.id).nb_exemplaires === 1
    ? ok('les autres processus gardent leur propre compte')
    : ko('le changement a débordé sur les autres processus')

  for (const n of [0, 21, 'trois']) {
    r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`, { nbExemplaires: n })
    r.statut === 400 ? ok(`nbExemplaires = ${JSON.stringify(n)} refusé (400)`)
      : ko(`${JSON.stringify(n)} accepté (${r.statut})`)
  }

  /* RÉDUIRE le compte efface les saisies des exemplaires retirés : les garder
     laisserait en base des relevés que plus personne ne peut relire, et un
     dossier validé en porterait la trace sans les montrer. */
  const pt = recep.definition.sections
    .flatMap((sec, iS) => (sec.points ?? []).map((p, iP) => ({ p, iS, iP })))
    .find((x) => x.p.multi)
  if (!pt) {
    console.log('  · aucun point « multi » à la réception — effacement non éprouvé')
  } else {
    await j('PUT', `/api/processus/${recep.id}/saisies`, { saisies: [3, 2, 1].map((ex) => ({
      sectionIndex: pt.iS, pointIndex: pt.iP, pointNum: pt.p.num ?? null,
      pointType: pt.p.type, exemplaire: ex, operateurRole: 'op1',
      obligatoire: false, valeurNum: pt.p.type === 'valeur' ? -170 : null,
      reponse: pt.p.type === 'ouinon' ? 'oui' : null,
      valeurTexte: ['texte', 'date', 'liste'].includes(pt.p.type) ? 'x' : null
    })) })
    r = await j('GET', `/api/dossiers/${dos}`)
    const avant = r.corps.saisies.filter((x) => x.dossier_processus_id === recep.id).length
    r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`, { nbExemplaires: 1 })
    r.corps?.saisiesEffacees >= 1
      ? ok(`réduction à 1 : ${r.corps.saisiesEffacees} saisie(s) d'exemplaires retirés effacée(s)`)
      : ko(`aucune saisie effacée alors que ${avant} existaient`)
    r = await j('GET', `/api/dossiers/${dos}`)
    const restantes = r.corps.saisies
      .filter((x) => x.dossier_processus_id === recep.id && x.exemplaire > 1).length
    restantes === 0
      ? ok('aucune saisie ne subsiste au-delà du compte')
      : ko(`${restantes} saisie(s) fantômes au-delà de l'exemplaire 1`)
  }
}

// ── 25. Quarantaine ──
console.log('\n25. Quarantaine')
{
  const enTete = (id) => ({ 'x-mti-operateur': id })
  let r = await j('GET', '/api/session')
  const pharmacien = (r.corps.operateurs ?? []).find((o) => o.profil === 'pharmacien')

  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E quarantaine' })
  const dos = r.corps?.id

  r = await j('POST', `/api/dossiers/${dos}/quarantaine`, { motif: 'x' })
  r.statut === 400 ? ok('motif de quarantaine trop court refusé (400)') : ko(`statut ${r.statut}`)

  /* POSER est ouvert à tous, délibérément : quiconque constate un doute doit
     pouvoir le signaler dans la seconde. Exiger une autorisation serait le
     mauvais réflexe. */
  r = await j('POST', `/api/dossiers/${dos}/quarantaine`,
    { motif: 'Aspect trouble de la poche au déchargement' })
  r.statut === 200 && r.corps?.quarantaine === true
    ? ok('mise en quarantaine, sans exiger de profil')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  r = await j('POST', `/api/dossiers/${dos}/quarantaine`, { motif: 'Encore un doute' })
  r.statut === 409 ? ok('seconde mise en quarantaine refusée (409)') : ko(`statut ${r.statut}`)

  /* LA QUARANTAINE SIGNALE, elle n'interdit rien à ce stade. C'est le
     périmètre voulu : la saisie et la validation restent possibles, et le
     blocage de l'administration reste à écrire. Si un jour ce test échoue,
     c'est que le périmètre a changé — vérifier que c'était voulu. */
  r = await j('PATCH', `/api/dossiers/${dos}`, { numeroLot: 'EN-QUARANTAINE' })
  r.statut === 200
    ? ok('la saisie reste possible : la quarantaine signale, elle n\'interdit pas')
    : ko(`la quarantaine bloque la saisie (${r.statut}) — périmètre non voulu`)

  // Le tableau de bord doit le dire : c'est là qu'on voit dix dossiers d'un coup.
  r = await j('GET', '/api/dossiers?statut=en_cours')
  const ligne = r.corps.find((d) => d.id === dos)
  ligne?.quarantaine?.motif && ligne?.statutAffiche !== 'clos'
    ? ok('signalée au tableau de bord, sans changer le statut du dossier')
    : ko(`ligne : ${JSON.stringify(ligne && { q: ligne.quarantaine, s: ligne.statutAffiche })}`)

  /* LEVER est réservé : c'est déclarer que le doute est levé. */
  r = await j('DELETE', `/api/dossiers/${dos}/quarantaine`, { motif: 'Je tente la levée' })
  r.statut === 403 && r.corps?.code === 'profil_insuffisant'
    ? ok('levée refusée sans profil (403)')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  if (!pharmacien) {
    console.log('  · aucun compte pharmacien — levée non éprouvée')
  } else {
    r = await j('DELETE', `/api/dossiers/${dos}/quarantaine`,
      { motif: 'Contrôle refait, aspect conforme' }, enTete(pharmacien.id))
    r.statut === 200 && r.corps?.quarantaine === false
      ? ok('levée par un pharmacien')
      : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

    /* L'épisode reste lisible : un traitement qui a été en quarantaine doit
       pouvoir le dire après coup, avec les deux motifs et les deux auteurs. */
    r = await j('GET', `/api/dossiers/${dos}/quarantaines`)
    const ep = r.corps?.[0]
    ep?.motif && ep?.motif_levee && ep?.pose_par && ep?.leve_par
      ? ok(`l'épisode garde tout : posé par ${ep.pose_par}, levé par ${ep.leve_par}`)
      : ko(`épisode incomplet : ${JSON.stringify(ep)}`)

    r = await j('DELETE', `/api/dossiers/${dos}/quarantaine`,
      { motif: 'Seconde tentative de levée' }, enTete(pharmacien.id))
    r.statut === 409 ? ok('levée d\'un dossier qui n\'y est pas refusée (409)')
      : ko(`statut ${r.statut}`)

    // Deux épisodes, pas un écrasé.
    await j('POST', `/api/dossiers/${dos}/quarantaine`, { motif: 'Second doute, autre cause' })
    await j('DELETE', `/api/dossiers/${dos}/quarantaine`,
      { motif: 'Second doute levé' }, enTete(pharmacien.id))
    r = await j('GET', `/api/dossiers/${dos}/quarantaines`)
    r.corps?.length === 2
      ? ok('deux mises en quarantaine, deux épisodes : rien n\'est écrasé')
      : ko(`${r.corps?.length} épisode(s)`)
  }
}

// ── 26. Unités de secours : une seconde série, avec sa propre numérotation ──
console.log('\n26. Unités de secours')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E secours' })
  const dos = r.corps?.id
  r = await j('GET', `/api/dossiers/${dos}`)
  const recep = r.corps.processus.find((p) => p.code === 'RECEPTION')

  recep?.nb_secours === 0
    ? ok('aucune unité de secours par défaut')
    : ko(`nb_secours = ${recep?.nb_secours}`)

  r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`,
    { nbExemplaires: 3, nbSecours: 2 })
  r.statut === 200 && r.corps?.nb_exemplaires === 3 && r.corps?.nb_secours === 2
    ? ok('3 exemplaires et 2 unités de secours')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  for (const n of [-1, 21, 'deux']) {
    r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`,
      { nbExemplaires: 3, nbSecours: n })
    r.statut === 400 ? ok(`nbSecours = ${JSON.stringify(n)} refusé (400)`)
      : ko(`${JSON.stringify(n)} accepté (${r.statut})`)
  }

  const pt = recep.definition.sections
    .flatMap((sec, iS) => (sec.points ?? []).map((p, iP) => ({ p, iS, iP })))
    .find((x) => x.p.multi)
  if (!pt) {
    console.log('  · aucun point « multi » à la réception — séries non éprouvées')
  } else {
    const releve = (exemplaire, secours) => ({
      sectionIndex: pt.iS, pointIndex: pt.iP, pointNum: pt.p.num ?? null,
      pointType: pt.p.type, exemplaire, secours, operateurRole: 'op1',
      obligatoire: false, valeurNum: pt.p.type === 'valeur' ? -170 : null,
      reponse: pt.p.type === 'ouinon' ? 'oui' : null,
      valeurTexte: ['texte', 'date', 'liste'].includes(pt.p.type) ? 'x' : null
    })
    await j('PUT', `/api/processus/${recep.id}/saisies`, {
      saisies: [releve(1, false), releve(2, false), releve(3, false),
        releve(1, true), releve(2, true)]
    })
    r = await j('GET', `/api/dossiers/${dos}`)
    const lignes = r.corps.saisies.filter((x) => x.dossier_processus_id === recep.id)

    /* LE POINT QUI COMPTE : l'exemplaire n°1 et le secours n°1 sont DEUX
       relevés distincts. Sans la colonne `secours` dans la clé d'unicité, le
       second aurait écrasé le premier. */
    lignes.length === 5
      ? ok('cinq relevés : les deux séries cohabitent sur le même point')
      : ko(`${lignes.length} relevé(s) au lieu de 5 — les séries se marchent dessus`)

    /* Et SURTOUT : réduire une série ne touche pas l'autre. Passer de 3 à 2
       exemplaires ne doit pas faire du « secours n°1 » un « exemplaire n°3 » :
       sur une fiche de traçabilité, une ligne qui change de sens après coup
       n'est pas un défaut d'affichage, c'est une preuve falsifiée. */
    r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`,
      { nbExemplaires: 2, nbSecours: 2 })
    r.corps?.saisiesEffacees === 1
      ? ok('réduire les exemplaires n\'efface que l\'exemplaire retiré')
      : ko(`${r.corps?.saisiesEffacees} saisie(s) effacée(s) au lieu d'une`)

    r = await j('GET', `/api/dossiers/${dos}`)
    const apres = r.corps.saisies.filter((x) => x.dossier_processus_id === recep.id)
    apres.filter((x) => x.secours).length === 2
      ? ok('les deux unités de secours gardent leurs relevés')
      : ko(`${apres.filter((x) => x.secours).length} relevé(s) de secours subsistent`)

    r = await j('PATCH', `/api/processus/${recep.id}/exemplaires`,
      { nbExemplaires: 2, nbSecours: 1 })
    r.corps?.saisiesEffacees === 1
      ? ok('réduire les secours n\'efface que le secours retiré')
      : ko(`${r.corps?.saisiesEffacees} saisie(s) effacée(s) au lieu d'une`)

    r = await j('GET', `/api/dossiers/${dos}`)
    const fin = r.corps.saisies.filter((x) => x.dossier_processus_id === recep.id)
    fin.filter((x) => !x.secours).length === 2 && fin.filter((x) => x.secours).length === 1
      ? ok('deux exemplaires et un secours : chaque série a sa numérotation')
      : ko(`${JSON.stringify(fin.map((x) => `${x.exemplaire}/${x.secours}`))}`)
  }
}

// ── 27. Règles de cohérence entre deux dates ──
console.log('\n27. Cohérence de dates')
{
  let r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E dates' })
  const dos = r.corps?.id
  r = await j('GET', `/api/dossiers/${dos}`)
  const parcours = r.corps.processus

  /* Les points sont retrouvés par leur CODE, comme les règles les désignent —
     si le test les cherchait par leur rang, il passerait au vert sur un
     parcours où les règles, elles, seraient devenues inertes. */
  const situer = (code) => {
    for (const p of parcours) {
      const sections = p.definition?.sections ?? []
      for (let iS = 0; iS < sections.length; iS++) {
        const points = sections[iS].points ?? []
        for (let iP = 0; iP < points.length; iP++) {
          if (points[iP].code === code) return { pid: p.id, iS, iP }
        }
      }
    }
    return null
  }
  const expedition = situer('date-expedition-annoncee')
  const reception = situer('date-reception-prevue')
  const rcp = situer('date-rcp')

  if (!expedition || !reception || !rcp) {
    ko(`parcours sans points codés : ${JSON.stringify({ expedition, reception, rcp })}`)
  } else {
    ok('les trois points datés portent un code, comme les règles les désignent')

    const poser = (ou, valeur) => j('PUT', `/api/processus/${ou.pid}/saisies`, {
      saisies: [{
        sectionIndex: ou.iS, pointIndex: ou.iP, pointType: 'date',
        operateurRole: 'op1', obligatoire: true, valeurTexte: valeur
      }]
    })
    const alertes = async () => {
      const x = await j('GET', `/api/dossiers/${dos}`)
      return x.corps?.alertes ?? []
    }

    // Une seule date : la règle ne se prononce pas.
    await poser(reception, '2026-10-10')
    const seule = await alertes()
    seule.length === 0
      ? ok('une seule date renseignée : aucune règle ne se prononce')
      : ko('règle déclenchée sur une date isolée')

    // Expédition APRÈS la réception prévue : on ne reçoit pas avant d'expédier.
    await poser(expedition, '2026-10-25')
    let a = await alertes()
    a.some((x) => x.regle === 'EXPEDITION_AVANT_RECEPTION')
      ? ok('expédition postérieure à la réception : signalée')
      : ko(`non signalée : ${JSON.stringify(a.map((x) => x.regle))}`)

    /* Les DEUX extrémités sont rendues, pas seulement la fautive : l'écran
       doit pouvoir marquer les deux cellules, l'opérateur ne sachant pas
       encore laquelle des deux dates est fausse. */
    const inc = a.find((x) => x.regle === 'EXPEDITION_AVANT_RECEPTION')
    inc?.point_avant && inc?.point_apres && inc?.date_avant && inc?.date_apres &&
    inc?.processus_avant_id && inc?.processus_apres_id
      ? ok('l\'alerte porte ses deux extrémités, avec leurs dates et leurs processus')
      : ko(`alerte incomplète : ${JSON.stringify(inc)}`)

    /* UNE RÈGLE PEUT ENJAMBER DEUX PROCESSUS. C'est pour cela qu'elle vit au
       niveau du parcours et non d'un processus : la RCP est décidée dans un
       processus, la réception prévue est saisie dans un autre. */
    await poser(rcp, '2026-11-15')
    a = await alertes()
    const croisee = a.find((x) => x.regle === 'RCP_AVANT_RECEPTION')
    croisee && croisee.processus_avant_id !== croisee.processus_apres_id
      ? ok('une règle enjambe deux processus et le dit')
      : ko(`règle croisée absente ou repliée sur un processus : ${JSON.stringify(croisee)}`)

    /* ELLE ALERTE, ELLE N'INTERDIT PAS — décision du 18 septembre. La saisie
       passe, et le verdict de conformité ignore les incohérences : c'est un
       jugement pharmaceutique, pas un constat machine. Si ce test échoue, le
       périmètre a changé. */
    const c = await j('GET', `/api/dossiers/${dos}/conformite`)
    c.corps?.incoherences?.length >= 2 &&
    !c.corps.nonVertes.some((x) => String(x.raison ?? '').includes('date'))
      ? ok('les incohérences sont rendues À CÔTÉ du verdict, jamais dedans')
      : ko(`incohérences mêlées au verdict : ${JSON.stringify(c.corps?.nonVertes?.slice(0, 2))}`)

    r = await j('PATCH', `/api/dossiers/${dos}`, { numeroLot: 'DATES-INCOHERENTES' })
    r.statut === 200
      ? ok('la saisie reste possible : la règle signale, elle n\'interdit pas')
      : ko(`la règle bloque la saisie (${r.statut}) — périmètre non voulu`)

    // Le tableau de bord le dit, sans confondre avec une alarme hors seuil.
    r = await j('GET', '/api/dossiers?statut=en_cours')
    const ligne = r.corps.find((x) => x.id === dos)
    ligne?.nbIncoherences === 2 && ligne?.nbAlarmes === 0
      ? ok('signalées au tableau de bord, distinctes des alarmes hors seuil')
      : ko(`ligne : ${JSON.stringify({ i: ligne?.nbIncoherences, a: ligne?.nbAlarmes })}`)

    // Corriger les deux dates éteint les deux alertes.
    await poser(expedition, '2026-10-01')
    await poser(rcp, '2026-09-01')
    const apres = await alertes()
    apres.length === 0
      ? ok('dates corrigées : plus aucune alerte')
      : ko(`alertes résiduelles : ${JSON.stringify(apres.map((x) => x.regle))}`)
  }

  /* Une règle refusée à la PUBLICATION plutôt qu'au moment de la saisie : une
     alerte qui ne viendrait jamais est plus grave qu'un refus, parce que
     personne ne la cherche. */
  r = await j('GET', '/api/modeles/PARCOURS_CART_AUTOLOGUE')
  const base = r.corps
  const avec = (regles) => ({ definition: { ...base, regles } })
  const casDeRefus = [
    [[{ code: 'X', type: 'ordre_dates', avant: { processus: 'COMMANDE_MTI', point: 'fantome' }, apres: { processus: 'COMMANDE_MTI', point: 'date-reception-prevue' } }],
      'point inexistant'],
    [[{ code: 'X', type: 'ordre_dates', avant: { processus: 'ACCES_TRAITEMENT', point: 'date-reception-prevue' }, apres: { processus: 'COMMANDE_MTI', point: 'date-rcp' } }],
      'point rattaché au mauvais processus'],
    [[{ code: 'X', type: 'grigri', avant: {}, apres: {} }], 'type de règle inconnu'],
    [[{ code: 'X', type: 'ordre_dates', avant: { processus: 'COMMANDE_MTI', point: 'date-rcp' }, apres: { processus: 'COMMANDE_MTI', point: 'date-rcp' } }],
      'les deux bornes sur le même point']
  ]
  for (const [regles, quoi] of casDeRefus) {
    r = await j('POST', '/api/modeles/PARCOURS_CART_AUTOLOGUE/versions', avec(regles))
    r.statut === 400
      ? ok(`publication refusée : ${quoi}`)
      : ko(`${quoi} accepté (${r.statut})`)
  }
}

// ── 28. Emplacements de stockage : le référentiel, et la réservation ──
console.log('\n28. Emplacements de stockage')
{
  const code = `E2E-CUVE-${Date.now().toString(36).toUpperCase()}`
  let r = await j('POST', '/api/contenants', {
    code, libelle: 'Cuve de recette', genre: 'cuve',
    etages: ['A', 'B'], emplacementsParEtage: 5
  })
  const cuve = r.corps
  r.statut === 200 && cuve?.nbPlaces === 10
    ? ok('cuve créée : 2 étages × 5 places = 10 emplacements énumérés')
    : ko(`statut ${r.statut} : ${JSON.stringify(cuve)}`)

  for (const [corps, quoi] of [
    [{ code, libelle: 'Doublon', etages: ['A'], emplacementsParEtage: 1 }, 'code déjà pris'],
    [{ code: `${code}-X`, libelle: 'Sans étage', etages: [], emplacementsParEtage: 5 }, 'aucun étage'],
    [{ code: `${code}-Y`, libelle: 'Étages en double', etages: ['A', 'A'], emplacementsParEtage: 5 }, 'deux étages identiques'],
    [{ code: `${code}-Z`, libelle: 'Trop', etages: ['A'], emplacementsParEtage: 9999 }, 'places par étage hors bornes']
  ]) {
    r = await j('POST', '/api/contenants', corps)
    r.statut === 400 || r.statut === 409
      ? ok(`création refusée : ${quoi}`)
      : ko(`${quoi} accepté (${r.statut})`)
  }

  r = await j('GET', `/api/contenants/${cuve.id}/emplacements?libres=oui`)
  const places = r.corps
  places.length === 10 && places[0].libelle === `${code}-A-01`
    ? ok(`dix places libres, nommées « ${places[0].libelle} »`)
    : ko(`${places.length} place(s), première « ${places[0]?.libelle} »`)

  // Deux dossiers, une seule place.
  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E stockage A' })
  const dosA = r.corps?.id
  r = await j('POST', '/api/dossiers',
    { codeModele: 'PARCOURS_CART_AUTOLOGUE', designationProduit: 'E2E stockage B' })
  const dosB = r.corps?.id

  r = await j('POST', `/api/emplacements/${places[0].id}/reserver`, { dossierId: dosA })
  r.statut === 200 ? ok('place prise par le premier dossier') : ko(`statut ${r.statut}`)

  /* ═══ LE POINT QUI COMPTE ═══
     Le refus vient de la base, et il se dit comme il doit l'être : « déjà
     prise », avec un code que le front reconnaît — la réaction attendue est
     d'en choisir une autre, pas d'appeler l'informatique. */
  r = await j('POST', `/api/emplacements/${places[0].id}/reserver`, { dossierId: dosB })
  r.statut === 409 && r.corps?.code === 'emplacement_pris'
    ? ok('la seconde réservation est refusée, et dit qu\'il faut en choisir une autre')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  // Reprendre SA propre place ne la relâche pas au passage.
  r = await j('POST', `/api/emplacements/${places[0].id}/reserver`, { dossierId: dosA })
  r.statut === 200 && r.corps?.inchange === true
    ? ok('ré-enregistrer sa propre place ne rouvre pas de fenêtre de reprise')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)

  // Déplacement : l'ancienne est libérée, et le motif dit que c'en est un.
  r = await j('POST', `/api/emplacements/${places[3].id}/reserver`, { dossierId: dosA })
  r = await j('GET', `/api/dossiers/${dosA}/emplacements`)
  const liberee = r.corps.find((o) => o.libere_le)
  liberee?.motif_liberation?.includes('Déplacement')
    ? ok('changer de place libère l\'ancienne, en disant que c\'est un déplacement')
    : ko(`historique : ${JSON.stringify(r.corps.map((o) => [o.libelle, o.motif_liberation]))}`)

  /* La réservation se fait DANS LA TRANSACTION DE LA SAISIE : c'est ce qui
     empêche un relevé de désigner une cassette prise entre-temps. */
  r = await j('GET', `/api/dossiers/${dosB}`)
  const cible = (() => {
    for (const p of r.corps.processus) {
      const sections = p.definition?.sections ?? []
      for (let iS = 0; iS < sections.length; iS++) {
        const points = sections[iS].points ?? []
        for (let iP = 0; iP < points.length; iP++) {
          if (points[iP].type === 'emplacement') return { pid: p.id, iS, iP }
        }
      }
    }
    return null
  })()

  if (!cible) {
    console.log('  · aucun point « emplacement » au parcours — saisie non éprouvée')
  } else {
    /* Le témoin porte une valeur DIFFÉRENTE à chaque lot : avec la même, on
       ne saurait pas si la ligne retrouvée vient du lot accepté ou du lot
       refusé — et le test passerait au vert en ne vérifiant rien. */
    const saisir = (place, temoin) => j('PUT', `/api/processus/${cible.pid}/saisies`, {
      saisies: [
        { sectionIndex: cible.iS, pointIndex: cible.iP, pointType: 'emplacement',
          operateurRole: 'op1', obligatoire: true, valeurTexte: place },
        /* Une seconde saisie dans le même lot : c'est elle qui montre que le
           refus annule TOUT, et ne laisse pas une fiche à moitié écrite. */
        { sectionIndex: 0, pointIndex: 0, pointType: 'texte',
          operateurRole: 'op1', obligatoire: false, valeurTexte: temoin }
      ]
    })

    r = await saisir(places[1].id, 'témoin-accepté')
    r.statut === 200 ? ok('la saisie du point réserve la place') : ko(`statut ${r.statut}`)
    r = await j('GET', `/api/dossiers/${dosB}/emplacements`)
    r.corps.some((o) => !o.libere_le && o.libelle === `${code}-A-02`)
      ? ok('la place est tenue par le dossier, sans appel séparé')
      : ko(`occupations : ${JSON.stringify(r.corps.map((o) => o.libelle))}`)

    // La place de l'autre dossier : refusée, et RIEN n'est enregistré.
    r = await saisir(places[3].id, 'témoin-refusé')
    r.statut === 409 && r.corps?.code === 'emplacement_pris'
      ? ok('saisie d\'une place déjà prise : refusée')
      : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)
    r = await j('GET', `/api/dossiers/${dosB}`)
    const temoins = r.corps.saisies.map((x) => x.valeur_texte)
    temoins.includes('témoin-accepté') && !temoins.includes('témoin-refusé')
      ? ok('le lot refusé est annulé EN ENTIER, et le lot accepté reste intact')
      : ko(`témoins en base : ${JSON.stringify(temoins.filter((t) => t?.startsWith('témoin')))}`)
  }

  // Une place occupée ne se met pas hors service en douce.
  r = await j('PATCH', `/api/emplacements/${places[1].id}`,
    { actif: false, motif: 'Rack tordu' })
  r.statut === 409
    ? ok('mettre hors service une place occupée est refusé')
    : ko(`statut ${r.statut} — un MTI disparaîtrait de l'inventaire`)

  r = await j('PATCH', `/api/emplacements/${places[8].id}`, { actif: false })
  r.statut === 400
    ? ok('une place hors service dit pourquoi')
    : ko(`mise hors service sans motif acceptée (${r.statut})`)

  r = await j('PATCH', `/api/emplacements/${places[8].id}`,
    { actif: false, motif: 'Rack tordu' })
  r.statut === 200 ? ok('place mise hors service, avec son motif') : ko(`statut ${r.statut}`)
  r = await j('GET', `/api/contenants/${cuve.id}/emplacements?libres=oui`)
  r.corps.every((e) => e.id !== places[8].id)
    ? ok('une place hors service n\'est plus proposée')
    : ko('une place hors service reste proposée')

  // Le délai d'expiration vit dans le référentiel, et il est borné.
  r = await j('PATCH', '/api/parametres/emplacement.expiration_heures', { valeur: '0' })
  r.statut === 400
    ? ok('délai d\'expiration nul refusé : la cuve paraîtrait vide en permanence')
    : ko(`0 h accepté (${r.statut})`)
  r = await j('PATCH', '/api/parametres/emplacement.expiration_heures', { valeur: '48' })
  r.statut === 200 && r.corps?.valeur === '48'
    ? ok('le délai se règle sans redéploiement')
    : ko(`statut ${r.statut} : ${JSON.stringify(r.corps)}`)
  await j('PATCH', '/api/parametres/emplacement.expiration_heures', { valeur: '24' })

  // Un contenant ne se supprime pas : il se désactive.
  r = await j('PATCH', `/api/contenants/${cuve.id}`, { actif: false })
  r.statut === 200 && r.corps?.actif === false
    ? ok('un contenant se désactive — les occupations passées restent lisibles')
    : ko(`statut ${r.statut}`)
}

console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
