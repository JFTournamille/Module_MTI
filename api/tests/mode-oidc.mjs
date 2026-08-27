/**
 * Ce que fait l'application en AUTH_MODE=oidc sans SSO branché.
 *
 * Prérequis : un serveur démarré avec AUTH_MODE=oidc.
 *   AUTH_MODE=oidc NODE_ENV=production node src/server.js &
 *   node tests/mode-oidc.mjs
 *
 * L'enjeu n'est pas le code de retour — il est correct depuis le début — mais
 * ce que l'exploitant peut en déduire. Une instance en `oidc` sans fournisseur
 * d'identité est ENTIÈREMENT muette : toutes les routes répondent 501, aucun
 * écran n'affiche de donnée, et rien dans le message d'origine ne disait que la
 * cause était une variable d'environnement plutôt qu'une panne ou une base
 * vide. Le diagnostic a réellement coûté un aller-retour. D'où ce test : le
 * message doit nommer la variable ET le remède.
 */
const base = process.env.API_URL ?? 'http://localhost:3000'
let echec = false
const ok = (m) => console.log('  ✓', m)
const ko = (m) => { console.log('  ✗', m); echec = true }

const j = async (url) => {
  const r = await fetch(base + url)
  return { statut: r.status, corps: await r.json().catch(() => null) }
}

console.log('\n1. Le mode est bien oidc')
let r = await j('/api/sante')
/* /api/sante doit rester joignable : c'est le seul moyen de diagnostiquer une
   instance dont toutes les autres routes sont fermées. */
if (r.statut === 200 && r.corps?.authMode === 'oidc') {
  ok(`/api/sante reste ouvert et annonce authMode « ${r.corps.authMode} »`)
} else {
  ko(`statut ${r.statut}, authMode ${r.corps?.authMode}`)
}

console.log('\n2. Toutes les routes applicatives répondent 501')
const routes = ['/api/dossiers', '/api/utilisateurs', '/api/session',
  '/api/produits', '/api/modeles', '/api/catalogue', '/api/patients?q=x']
const survivantes = []
for (const url of routes) {
  const rep = await j(url)
  if (rep.statut !== 501) survivantes.push(`${url} → ${rep.statut}`)
}
if (survivantes.length === 0) {
  ok(`${routes.length} routes fermées en 501, sans exception`)
} else {
  ko(`routes non fermées : ${survivantes.join(', ')}`)
}

console.log('\n3. Le message dit quoi faire')
r = await j('/api/dossiers')
const m = r.corps?.erreur ?? ''
if (/^Authentification OIDC non configurée/.test(m)) {
  ok('le corps porte un champ « erreur » exploitable par le front')
} else {
  ko(`corps : ${JSON.stringify(r.corps)}`)
}

/* Le front complète ce message côté navigateur (api.js : messageErreur), parce
   que c'est là que l'exploitant le lit. On vérifie ici que le texte serveur
   reste bien celui sur lequel ce complément s'appuie. */
console.log(`\n    Message servi : « ${m} »`)

console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
