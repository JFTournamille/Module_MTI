/**
 * Test du jeu de démonstration : insertion, idempotence, purge.
 *
 * Prérequis : une base migrée et seedée (référentiels), et le serveur démarré.
 *   export DATABASE_URL=... SEED_DEMO=oui
 *   node tests/jeu-demo.mjs
 *
 * ATTENTION : ce test purge puis réinsère le jeu de démonstration. Il ne touche
 * à rien d'autre — mais il ne doit pas tourner sur une base portant des
 * dossiers réels.
 *
 * Ce qui est vérifié n'est pas « il y a dix dossiers » mais ce qui rend le jeu
 * utilisable et sans danger : la chronologie tient, la non-conformité remonte
 * jusqu'au tableau de bord, un dossier clos est bien figé, la purge n'oublie
 * rien — et surtout, elle ne laisse pas le journal d'audit avec des auteurs
 * que rien ne résout.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const ici = dirname(fileURLToPath(import.meta.url))
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

/** Lance le seed et rend sa sortie ; échoue bruyamment plutôt qu'en silence. */
function seed (...args) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(ici, '..', 'src', 'seed-demo.js'), ...args], {
      env: { ...process.env, SEED_DEMO: 'oui' }
    })
    let sortie = ''
    p.stdout.on('data', (d) => { sortie += d })
    p.stderr.on('data', (d) => { sortie += d })
    p.on('close', (code) => code === 0
      ? resolve(sortie)
      : reject(new Error(`seed-demo ${args.join(' ')} → code ${code}\n${sortie}`)))
  })
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
const un = async (sql, params) => (await pool.query(sql, params)).rows[0]

// ─────────────────────────────────────────────────────────── Table rase ──
console.log('\n0. Table rase')
await seed('--supprimer')
let n = await un(
  `SELECT (SELECT count(*) FROM mti.dossier WHERE reference LIKE 'DEMO-MTI-%')::int AS d,
          (SELECT count(*) FROM mti.patient WHERE source = 'DEMO')::int AS p`)
n.d === 0 && n.p === 0 ? ok('aucun dossier ni patient fictif') : ko(JSON.stringify(n))

let r = await j('GET', '/api/sante')
r.corps.base.dossiersFictifs === 0 && r.corps.base.comptesFictifs === 0 &&
r.corps.base.patientsFictifs === 0
  ? ok('/api/sante ne signale plus de jeu de démonstration')
  : ko(`santé : ${JSON.stringify(r.corps.base)}`)

// ───────────────────────────────────────────────────────────── Insertion ──
console.log('\n1. Insertion')
await seed()
n = await un(
  `SELECT (SELECT count(*) FROM mti.dossier WHERE reference LIKE 'DEMO-MTI-%')::int AS d,
          (SELECT count(*) FROM mti.patient WHERE source = 'DEMO')::int AS p,
          (SELECT count(*) FROM mti.utilisateur
            WHERE identifiant LIKE 'demo.%' AND actif)::int AS u`)
n.d === 10 && n.p === 10 && n.u === 10
  ? ok('10 dossiers, 10 patients, 10 comptes actifs')
  : ko(`compte : ${JSON.stringify(n)}`)

// Les cinq profils doivent être représentés : c'est à ça que sert le jeu de
// comptes — éprouver l'écran de gestion, pas seulement le remplir.
const { rows: profils } = await pool.query(
  `SELECT coalesce(profil::text, '(non attribué)') AS profil, count(*)::int AS n
     FROM mti.utilisateur WHERE identifiant LIKE 'demo.%' GROUP BY 1 ORDER BY 1`)
const attendus = ['administrateur', 'ide', 'pharmacien', 'preparateur', 'qualite']
attendus.every((p) => profils.some((x) => x.profil === p))
  ? ok(`profils couverts : ${profils.map((p) => `${p.profil}×${p.n}`).join(', ')}`)
  : ko(`profils : ${JSON.stringify(profils)}`)

// ─────────────────────────────────────────── Ce que voit le tableau de bord ──
console.log('\n2. Tableau de bord')
r = await j('GET', '/api/dossiers?q=DEMO-MTI-')
const liste = r.corps
liste.length === 10 ? ok('10 dossiers listés') : ko(`${liste.length} dossier(s)`)

const par = (ref) => liste.find((d) => d.reference === `DEMO-MTI-${ref}`)
/* Trois dossiers sans patient, et pas au même endroit du parcours : deux
   avant le rattachement, un arrivé jusqu'à la réception sans allocation. Ce
   troisième cas est le plus intéressant — c'est celui qui montre que
   l'anonymat n'est pas qu'un état transitoire du début de parcours. */
const attente = liste.filter((d) => d.statutAffiche === 'attente')
if (attente.length === 3 && attente.every((d) => d.patient === null)) {
  ok(`3 dossiers en attente d'allocation, sans aucune donnée patient : ${
    attente.map((d) => `${d.reference} (${d.etape})`).join(', ')}`)
} else {
  ko(`attente : ${JSON.stringify(attente.map((d) => [d.reference, d.patient]))}`)
}

const avecAlarme = liste.filter((d) => d.nbAlarmes > 0)
avecAlarme.length === 1 && avecAlarme[0].reference === 'DEMO-MTI-0004'
  ? ok(`1 dossier avec alarme de seuil (${avecAlarme[0].reference})`)
  : ko(`alarmes : ${JSON.stringify(avecAlarme.map((d) => [d.reference, d.nbAlarmes]))}`)

/* Un jeu de démonstration entièrement conforme ou entièrement en alarme
   n'apprend rien : les deux issues doivent être présentes, et distinguables. */
par('0009')?.statutAffiche === 'termine' && par('0009')?.conformite === 'conforme'
  ? ok('dossier clos conforme : statut « termine »')
  : ko(`0009 : ${JSON.stringify([par('0009')?.statutAffiche, par('0009')?.conformite])}`)
par('0010')?.statutAffiche === 'non_conforme' && par('0010')?.conformite === 'non_conforme'
  ? ok('dossier clos non conforme : distingué du conforme au tableau de bord')
  : ko(`0010 : ${JSON.stringify([par('0010')?.statutAffiche, par('0010')?.conformite])}`)

// L'avancement doit s'étaler : dix dossiers tous au même rang ne montrent rien.
const rangs = new Set(liste.map((d) => d.avancement))
rangs.size >= 7
  ? ok(`${rangs.size} niveaux d'avancement distincts : ${[...rangs].sort((a, b) => a - b).join(', ')} %`)
  : ko(`avancements : ${[...rangs].join(', ')}`)

const clos = liste.filter((d) => d.avancement === 100)
clos.length === 2 && clos.every((d) => d.nbValides === d.nbProcessus)
  ? ok('les dossiers clos ont tous leurs processus validés')
  : ko(`clos : ${JSON.stringify(clos.map((d) => [d.reference, d.nbValides, d.nbProcessus]))}`)

// ───────────────────────────────────────────────────────── Chronologie ──
console.log('\n3. Chronologie')
const { rows: fauteurs } = await pool.query(
  `SELECT d.reference,
          d.cree_le, d.valide_le,
          (SELECT min(dp.ouvert_le) FROM mti.dossier_processus dp
            WHERE dp.dossier_id = d.id) AS premier,
          (SELECT max(dp.valide_le) FROM mti.dossier_processus dp
            WHERE dp.dossier_id = d.id) AS dernier,
          (SELECT max(s.saisi_le) FROM mti.saisie s
             JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
            WHERE dp.dossier_id = d.id) AS derniere_saisie
     FROM mti.dossier d WHERE d.reference LIKE 'DEMO-MTI-%'`)
const desordre = fauteurs.filter((f) =>
  (f.premier && f.premier < f.cree_le) ||
  (f.dernier && f.premier && f.dernier < f.premier) ||
  (f.valide_le && f.derniere_saisie && f.derniere_saisie > f.valide_le))
desordre.length === 0
  ? ok('création ≤ ouverture ≤ validation, et rien de saisi après la clôture')
  : ko(`chronologie incohérente : ${desordre.map((f) => f.reference).join(', ')}`)

// ─────────────────────────────────────────── Contresignature et figement ──
console.log('\n4. Contresignature et figement')
const { rows: sg } = await pool.query(
  `SELECT d.reference, count(*)::int AS n FROM mti.signature s
     JOIN mti.dossier d ON d.id = s.dossier_id
    WHERE d.reference LIKE 'DEMO-MTI-%' GROUP BY 1 ORDER BY 1`)
sg.length === 3 && sg.every((x) => x.n === 1)
  ? ok(`3 dossiers contresignés : ${sg.map((x) => x.reference).join(', ')}`)
  : ko(`signatures : ${JSON.stringify(sg)}`)

/* Un dossier clos est en lecture seule : le jeu de démonstration doit le
   montrer, pas seulement le prétendre. */
const dossierClos = par('0009')
r = await j('PATCH', `/api/dossiers/${dossierClos.id}`, { numeroLot: 'LOT-BIDON' })
r.statut === 409 ? ok('un dossier clos refuse toute modification (409)')
  : ko(`PATCH sur dossier clos → ${r.statut}`)

r = await j('GET', `/api/dossiers/${dossierClos.id}/audit`)
Array.isArray(r.corps) && r.corps.length > 0
  ? ok(`piste d'audit reconstituée : ${r.corps.length} trace(s)`)
  : ko(`audit : ${JSON.stringify(r.corps).slice(0, 120)}`)

// ─────────────────────────────────────────────────────────── Idempotence ──
console.log('\n5. Idempotence')
const sortie = await seed()
if (/^\s*✓ 0 dossier/m.test(sortie) && /déjà présent/.test(sortie)) {
  ok('un second passage ne recrée rien')
} else {
  ko(`sortie inattendue :\n${sortie}`)
}
n = await un(
  `SELECT (SELECT count(*) FROM mti.dossier WHERE reference LIKE 'DEMO-MTI-%')::int AS d,
          (SELECT count(*) FROM mti.saisie s
             JOIN mti.dossier_processus dp ON dp.id = s.dossier_processus_id
             JOIN mti.dossier d ON d.id = dp.dossier_id
            WHERE d.reference LIKE 'DEMO-MTI-%')::int AS s`)
n.d === 10 ? ok(`toujours 10 dossiers, ${n.s} saisies`) : ko(`${n.d} dossier(s)`)

// ────────────────────────────────────────────────────────────────── Purge ──
console.log('\n6. Purge')
const purge = await seed('--supprimer')
if (/désactivé\(s\) car auteurs de traçabilité/.test(purge)) {
  ok('les comptes auteurs de traçabilité sont désactivés, pas effacés')
} else {
  ko(`la purge a effacé des comptes auteurs :\n${purge}`)
}

n = await un(
  `SELECT (SELECT count(*) FROM mti.dossier WHERE reference LIKE 'DEMO-MTI-%')::int AS d,
          (SELECT count(*) FROM mti.patient WHERE source = 'DEMO')::int AS p,
          (SELECT count(*) FROM mti.utilisateur
            WHERE identifiant LIKE 'demo.%' AND actif)::int AS actifs`)
n.d === 0 && n.p === 0 && n.actifs === 0
  ? ok('plus un dossier, plus un patient, plus un compte fictif actif')
  : ko(`reste : ${JSON.stringify(n)}`)

/* Le point qui compte le plus : le journal d'audit survit à la purge (il n'est
   pas effaçable, par construction) et ne porte AUCUNE clé étrangère vers
   `utilisateur`. Effacer un compte qui y figure ne casse donc rien à
   l'insertion — mais laisse des traces dont l'auteur n'est plus qu'un UUID.
   C'est exactement ce que le journal est censé empêcher. */
const orphelines = await un(
  `SELECT count(*)::int AS n FROM mti.audit a
    WHERE a.utilisateur_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM mti.utilisateur u WHERE u.id = a.utilisateur_id)`)
orphelines.n === 0
  ? ok("aucune trace d'audit sans auteur résoluble après la purge")
  : ko(`${orphelines.n} trace(s) d'audit dont l'auteur a été effacé`)

r = await j('GET', '/api/sante')
r.corps.statut === 'ok'
  ? ok('/api/sante repasse à « ok »')
  : ko(`santé : ${r.corps.statut} — ${r.corps.diagnostic}`)

// On remet le jeu en place : le test ne doit pas laisser la base plus vide
// qu'il ne l'a trouvée pour les suites qui tournent après lui.
console.log('\n7. Remise en place')
await seed()
n = await un(
  `SELECT count(*)::int AS n FROM mti.dossier WHERE reference LIKE 'DEMO-MTI-%'`)
n.n === 10 ? ok('jeu de démonstration réinséré') : ko(`${n.n} dossier(s)`)

await pool.end()
console.log(echec ? '\n✗ Des vérifications ont échoué.' : '\n✓ Toutes les vérifications passent.')
process.exit(echec ? 1 : 0)
