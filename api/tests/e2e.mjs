/**
 * Test de bout en bout de l'API MTI.
 *
 * Prérequis : une base migrée et seedée, et le serveur démarré.
 *   export DATABASE_URL=... DEV_UTILISATEUR_ID=...
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
const j = async (m, url, body) => {
  const r = await fetch(base + url, {
    method: m,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined
  })
  return { statut: r.status, corps: await r.json().catch(() => null) }
}

console.log('\n1. Création d\'un dossier')
const ref = `DOS-E2E-${Date.now()}`
let r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE', reference: ref })
r.statut === 201 && r.corps.nbProcessus === 12
  ? ok(`dossier ${ref} créé avec 12 processus figés`)
  : ko(`statut ${r.statut} — ${JSON.stringify(r.corps)}`)
const dossierId = r.corps.id

r = await j('POST', '/api/dossiers', { codeModele: 'PARCOURS_CART_AUTOLOGUE' })
r.statut === 400 ? ok('création sans référence refusée (400)') : ko(`statut ${r.statut}`)

console.log('\n2. Le dossier est anonyme à la création')
r = await j('GET', `/api/dossiers/${dossierId}`)
r.corps.dossier.patient_id === null && r.corps.dossier.preallocation === false
  ? ok('patient_id NULL, préallocation inactive') : ko(JSON.stringify(r.corps.dossier))
const reception = r.corps.processus.find((p) => p.gabarit === 'reception')
reception && reception.etat === 'en_cours'
  ? ok(`processus 1 « ${reception.nom} » en cours`) : ko('processus de réception introuvable')
reception.definition.sections.length === 6
  ? ok('définition figée dans le dossier (6 sections)')
  : ko(`${reception.definition.sections?.length} sections`)

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

console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
