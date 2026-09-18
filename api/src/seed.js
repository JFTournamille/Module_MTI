/**
 * Charge les référentiels de `shared/` dans la base et crée l'utilisateur de
 * développement. Idempotent : rejouable sans effet de bord.
 */
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const lire = async (f) => JSON.parse(await readFile(join(racine, 'shared', f), 'utf8'))

/**
 * Tous les parcours de `shared/`, pas seulement le dernier connu du code.
 *
 * Les modèles sont versionnés et une seule version est active par code : une
 * version retirée du service doit rester EN BASE, sinon les dossiers qui la
 * référencent deviendraient illisibles — ce qui viderait de son sens le
 * figement de la définition dans le dossier.
 *
 * La version la plus haute de chaque code devient l'active. Les autres sont
 * chargées ou rafraîchies, puis désactivées.
 */
/* `--adopter` : remettre en service la version du dépôt, même si l'application
   en a publié une plus récente. À n'employer qu'en connaissance de cause — la
   configuration faite à l'écran passe alors hors service. */
const adopter = process.argv.includes('--adopter')

/**
 * Adoption demandée par une MIGRATION, et non par la ligne de commande.
 *
 * Une migration ne peut pas adopter une version elle-même : au moment où elle
 * s'applique, le seed n'a pas encore chargé les parcours de `shared/`, et
 * l'UPDATE ne trouverait rien. Elle enregistre donc l'intention dans
 * `mti.parametre`, et c'est ici qu'elle s'exécute — une seule fois, la demande
 * étant effacée après coup.
 *
 * C'est l'exception explicite à « le fichier amorce, l'application fait
 * autorité ensuite » : datée, limitée à une version, et non rejouable.
 *
 * Retourne `{ code, version }` ou `null`.
 */
async function adoptionDemandee (client) {
  const { rows } = await client.query(
    "SELECT valeur FROM mti.parametre WHERE cle = 'parcours.adoption_demandee'")
  const brut = String(rows[0]?.valeur ?? '').trim()
  if (!brut) return null
  const [code, version] = brut.split(':')
  const n = Number(version)
  if (!code || !Number.isInteger(n) || n < 1) {
    console.log(`· demande d'adoption illisible (« ${brut} ») — ignorée.`)
    return null
  }
  return { code, version: n }
}

const fichiersParcours = (await readdir(join(racine, 'shared')))
  .filter((f) => /^parcours-.*\.json$/.test(f))
  .sort()
const parcours = await Promise.all(fichiersParcours.map(lire))
const versionActive = new Map()
for (const p of parcours) {
  const courant = versionActive.get(p.code)
  if (!courant || p.version > courant.version) versionActive.set(p.code, p)
}

const catalogue = await lire('catalogue-processus-v1.json')

const client = await pool.connect()
try {
  await client.query('BEGIN')

  // ── Modèles de parcours ──
  // Insertion en INACTIF d'abord : la base n'admet qu'une version active par
  // code, activer avant d'avoir désactivé l'ancienne violerait la contrainte.
  for (const p of parcours) {
    await client.query(
      `INSERT INTO mti.modele_parcours (code, version, libelle, definition, actif, publie_le)
       VALUES ($1, $2, $3, $4, false, now())
       ON CONFLICT (code, version) DO UPDATE
         SET definition = EXCLUDED.definition, libelle = EXCLUDED.libelle`,
      [p.code, p.version, p.libelle, JSON.stringify(p)]
    )
  }
  /* La demande est lue AVANT la boucle : elle peut désigner une version qui
     n'est pas la plus haute du dépôt, et c'est alors elle qui l'emporte. */
  const demande = await adoptionDemandee(client)

  for (const [code, active] of versionActive) {
    /* Une version publiée DEPUIS L'APPLICATION ne se fait pas démonter par un
       fichier.

       Le seed activait aveuglément la version la plus haute de `shared/`. Or
       l'onglet Configuration publie des versions qui montent librement : un
       établissement qui en était à la v22 se retrouvait ramené à la v5 au
       redéploiement suivant, sans un mot — sa configuration passait hors
       service et le parcours en usage changeait sous lui. C'est une perte de
       travail silencieuse, le pire genre.

       Règle : le fichier amorce, l'application fait autorité ensuite. La
       version du fichier est toujours chargée — elle reste disponible — mais
       elle ne prend le service que si rien de plus récent n'a été publié.
       `--adopter` force la reprise, pour l'adopter délibérément. */
    /* La comparaison porte sur la version EN SERVICE, pas sur la plus haute
       en base : après une adoption, les versions publiées plus tard restent
       stockées sans être en service, et se fier au maximum ferait annoncer
       « hors service » une version qui est précisément en service. */
    const { rows: [etat] } = await client.query(
      `SELECT version FROM mti.modele_parcours WHERE code = $1 AND actif`, [code])
    const enService = etat ? Number(etat.version) : null
    const publieeApres = enService !== null && enService > active.version

    /* Une demande portée par une migration vaut `--adopter`, mais pour CE code
       seulement : elle ne doit pas emporter au passage les autres parcours,
       dont personne n'a demandé l'adoption. */
    const demandePourCeCode = demande?.code === code && demande.version === active.version
    if (publieeApres && !adopter && !demandePourCeCode) {
      console.log(
        `· modèle ${code} : v${active.version} chargée HORS SERVICE — ` +
        `v${enService} publiée depuis l'application reste en service.`)
      console.log('  Pour adopter la version du dépôt : node src/seed.js --adopter')
      continue
    }

    await client.query(
      'UPDATE mti.modele_parcours SET actif = false WHERE code = $1 AND version <> $2',
      [code, active.version])
    await client.query(
      'UPDATE mti.modele_parcours SET actif = true WHERE code = $1 AND version = $2',
      [code, active.version])
    const retirees = parcours.filter((p) => p.code === code && p.version !== active.version)
    console.log(
      `✓ modèle ${code} v${active.version} actif — ${active.processus.length} processus` +
      (publieeApres
        ? ` (adoptée${demandePourCeCode && !adopter ? ' sur demande de migration' : ''} :` +
          ` v${enService} retirée du service)`
        : '') +
      (retirees.length
        ? ` (v${retirees.map((p) => p.version).join(', v')} conservée(s) hors service)`
        : ''))
  }

  /* La demande peut désigner une version qui n'est PLUS la plus haute du
     dépôt — si le code a livré une v9 avant que la demande n'ait jamais été
     honorée. La boucle ne l'a alors pas vue passer, et sans ce rattrapage elle
     resterait en base indéfiniment, à ne rien faire. On adopte ici exactement
     ce qui a été demandé, si cette version existe. */
  if (demande) {
    const { rows: [cible] } = await client.query(
      'SELECT version FROM mti.modele_parcours WHERE code = $1 AND version = $2',
      [demande.code, demande.version])
    const { rows: [enService] } = await client.query(
      'SELECT version FROM mti.modele_parcours WHERE code = $1 AND actif', [demande.code])

    if (!cible) {
      /* La version demandée n'est pas en base : elle a été retirée de
         `shared/`. On le DIT et on garde la demande — l'effacer sans rien
         faire donnerait un déploiement qui prétend avoir adopté. */
      console.log(
        `· adoption demandée de ${demande.code} v${demande.version} : ` +
        'cette version n\'est pas en base, demande CONSERVÉE.')
    } else {
      if (Number(enService?.version) !== demande.version) {
        await client.query(
          'UPDATE mti.modele_parcours SET actif = false WHERE code = $1 AND version <> $2',
          [demande.code, demande.version])
        await client.query(
          'UPDATE mti.modele_parcours SET actif = true WHERE code = $1 AND version = $2',
          [demande.code, demande.version])
        console.log(
          `✓ adoption demandée par migration : ${demande.code} v${demande.version} ` +
          `mise en service (v${enService?.version ?? '—'} retirée).`)
      }
      /* La demande est un geste UNIQUE, pas un réglage permanent : une fois
         honorée, elle disparaît. La laisser ramènerait le parcours à cette
         version à chaque déploiement, et rendrait toute publication faite à
         l'écran éphémère sans que personne ne comprenne pourquoi. */
      await client.query(
        "DELETE FROM mti.parametre WHERE cle = 'parcours.adoption_demandee'")
      console.log('  Demande d\'adoption effacée : elle ne se rejouera pas.')
    }
  }

  // ── Catalogue ──
  await client.query(
    `INSERT INTO mti.catalogue_processus (code, version, definition, actif)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (code, version) DO UPDATE SET definition = EXCLUDED.definition`,
    [catalogue.code, catalogue.version, JSON.stringify(catalogue)]
  )
  const nbItems = catalogue.groupes.reduce((a, g) => a + g.items.length, 0)
  console.log(`✓ catalogue v${catalogue.version} — ${nbItems} processus disponibles`)

  // ── Produits de référence ──
  const produits = [
    ['KYMRIAH®', 'tisagenlecleucel', 'Novartis', -150],
    ['YESCARTA®', 'axicabtagene ciloleucel', 'Kite/Gilead', -150],
    ['TECARTUS®', 'brexucabtagene autoleucel', 'Kite/Gilead', -150],
    ['CARVYKTI®', 'ciltacabtagene autoleucel', 'Janssen', -150]
  ]
  for (const [denomination, dci, labo, seuil] of produits) {
    await client.query(
      `INSERT INTO mti.produit (denomination, dci, laboratoire, seuil_temp_c)
       VALUES ($1, $2, $3, $4) ON CONFLICT (denomination) DO NOTHING`,
      [denomination, dci, labo, seuil])
  }
  console.log(`✓ ${produits.length} produits de référence`)

  /* ── Services (unités fonctionnelles) ──
     Données PLAUSIBLES mais fictives, comme les produits de référence : elles
     permettent de montrer l'écran et d'éprouver les rattachements avant que
     l'établissement n'importe les siennes. L'UF identifie, le libellé décrit —
     c'est l'UF que porte le SIH et qui sert au rapprochement. */
  const services = [
    ['1301', 'Hématologie clinique — secteur protégé', 'Pôle Cancérologie'],
    ['1302', 'Hématologie clinique — hôpital de jour', 'Pôle Cancérologie'],
    ['1305', 'Hématologie — consultations', 'Pôle Cancérologie'],
    ['1310', 'Oncologie médicale', 'Pôle Cancérologie'],
    ['1420', 'Unité de thérapie cellulaire', 'Pôle Biologie'],
    ['1425', 'Laboratoire de contrôle qualité', 'Pôle Biologie'],
    ['2100', 'Pharmacie à usage intérieur', 'Pôle Pharmacie'],
    ['2110', 'Unité de préparation des chimiothérapies (UPC)', 'Pôle Pharmacie'],
    ['2115', 'Stérilisation centrale', 'Pôle Pharmacie'],
    ['3200', 'Réanimation médicale', 'Pôle Urgences-Réanimation'],
    ['3210', 'Surveillance continue', 'Pôle Urgences-Réanimation'],
    ['4100', 'Pédiatrie — onco-hématologie', 'Pôle Femme-Enfant']
  ]
  for (const [uf, libelle, pole] of services) {
    await client.query(
      `INSERT INTO mti.service (uf, libelle, pole)
       VALUES ($1, $2, $3)
       ON CONFLICT (uf) DO UPDATE SET libelle = EXCLUDED.libelle, pole = EXCLUDED.pole`,
      [uf, libelle, pole])
  }
  console.log(`✓ ${services.length} services (unités fonctionnelles)`)

  /* ── Contenants de stockage ──
     Des EXEMPLES, au même titre que les produits et les services : sans un
     contenant au moins, un point de contrôle « emplacement » n'a rien à
     proposer et l'écran paraît cassé alors qu'il est seulement vide. Ce sont
     des données plausibles et fictives, que l'établissement remplacera par les
     siennes — elles se désactivent depuis Codifications, elles ne se
     suppriment pas, comme tout ce qu'un dossier peut citer.

     `ON CONFLICT DO NOTHING` sur le code : un contenant déjà là n'est pas
     réécrit, et surtout ses places ne sont pas régénérées — ce serait effacer
     une mise hors service décidée par l'établissement. */
  const contenants = [
    ['CUVE-1', 'Cuve d\'azote n°1 — PUI', 'cuve', 'A-J', 20],
    ['CUVE-2', 'Cuve d\'azote n°2 — PUI (secours)', 'cuve', 'A-E', 20],
    ['CONG-80', 'Congélateur −80 °C — UPC', 'congelateur', '1-4', 12]
  ]
  let contenantsCrees = 0
  for (const [code, libelle, genre, etages, parEtage] of contenants) {
    const { rows } = await client.query(
      `INSERT INTO mti.contenant (code, libelle, genre)
       VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING RETURNING id`,
      [code, libelle, genre])
    if (!rows.length) continue
    /* « A-J » ou « 1-4 » : une plage se déplie ici, le référentiel ne portant
       que des étiquettes. Un étage peut s'appeler « haut » ou « 1 bis », d'où
       du texte et non un rang. */
    const [debut, fin] = etages.split('-')
    const etiquettes = []
    if (/^[0-9]+$/.test(debut)) {
      for (let i = Number(debut); i <= Number(fin); i++) etiquettes.push(String(i))
    } else {
      for (let c = debut.charCodeAt(0); c <= fin.charCodeAt(0); c++) {
        etiquettes.push(String.fromCharCode(c))
      }
    }
    await client.query('SELECT mti.creer_emplacements($1, $2::text[], $3)',
      [rows[0].id, etiquettes, parEtage])
    contenantsCrees++
  }
  console.log(
    `✓ ${contenants.length} contenant(s) de stockage` +
    (contenantsCrees ? ` — ${contenantsCrees} créé(s) avec leurs places` : ' (déjà présents)'))

  // ── Utilisateur de développement ──
  if ((process.env.AUTH_MODE ?? 'dev') === 'dev' && process.env.NODE_ENV !== 'production') {
    const { rows } = await client.query(
      `INSERT INTO mti.utilisateur (identifiant, nom, prenom, titre, fonction)
       VALUES ('mdurand', 'DURAND', 'Martin', 'M.', 'préparateur')
       ON CONFLICT (identifiant) DO UPDATE SET actif = true
       RETURNING id`)
    console.log(`✓ utilisateur de développement — DEV_UTILISATEUR_ID=${rows[0].id}`)
  }

  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  console.error(`✗ seed : ${e.message}`)
  process.exit(1)
} finally {
  client.release()
  await pool.end()
}
