import { createHash } from 'node:crypto'
import { requete, transaction } from '../db.js'
import { pdfDuDossier, tableurDuDossier } from '../export-dossier.js'

/**
 * Exports du dossier de traçabilité.
 *
 * TOLÉRANTS AUX INFORMATIONS PARTIELLES — c'est la contrainte structurante :
 * un export n'est pas une validation. Aucune de ces routes ne vérifie que le
 * dossier est complet, et aucune ne refuse. Elles produisent un document qui
 * DIT ce qui manque.
 *
 * LE FILIGRANE EST POSÉ ICI, côté serveur, jamais demandé par le client. C'est
 * le même raisonnement que pour la conformité automatique : une page périmée
 * pourrait demander un document sans filigrane sur un dossier qui n'est plus
 * validé, et ce document ferait foi à tort.
 */
export default async function exports (app) {
  /**
   * Rassemble tout ce dont le document a besoin.
   *
   * Une seule lecture pour les deux formats : un PDF et un tableur du même
   * dossier doivent dire exactement la même chose, et deux collectes séparées
   * finiraient par diverger.
   */
  async function rassembler (dossierId) {
    const { rows } = await requete(
      `SELECT d.*,
              btrim(concat_ws(' ', uv.titre, uv.prenom, uv.nom)) AS valide_par_libelle,
              btrim(concat_ws(' ', uc.titre, uc.prenom, uc.nom)) AS clos_par_libelle,
              m.code AS code_modele, m.version AS version_modele
         FROM mti.dossier d
         JOIN mti.modele_parcours m ON m.id = d.modele_parcours_id
         LEFT JOIN mti.utilisateur uv ON uv.id = d.valide_par
         LEFT JOIN mti.utilisateur uc ON uc.id = d.clos_par
        WHERE d.id = $1`,
      [dossierId])
    if (!rows.length) return null
    const dossier = rows[0]

    const { rows: processus } = await requete(
      `SELECT id, ordre, code, nom, gabarit, externe, definition, etat,
              conformite, conformite_automatique, nb_exemplaires, nb_secours
         FROM mti.dossier_processus WHERE dossier_id = $1 ORDER BY ordre`,
      [dossierId])

    /* L'emplacement est résolu EN SQL : sans la jointure, le document
       imprimerait un identifiant technique, qui n'apprend rien à un lecteur
       tout en donnant l'illusion d'une information. */
    const { rows: saisies } = processus.length
      ? await requete(
        `SELECT s.*, t.secondes,
                btrim(concat_ws(' ', u.titre, u.prenom, u.nom)) AS operateur_libelle,
                CASE WHEN s.point_type = 'emplacement' THEN
                  (SELECT format('%s-%s-%s', c.code, e.etage, lpad(e.numero::text, 2, '0'))
                     FROM mti.emplacement e
                     JOIN mti.contenant c ON c.id = e.contenant_id
                    WHERE e.id::text = s.valeur_texte)
                END AS emplacement_libelle
           FROM mti.saisie s
           LEFT JOIN mti.saisie_timer t ON t.id = s.id
           LEFT JOIN mti.utilisateur u ON u.id = s.operateur_id
          WHERE s.dossier_processus_id = ANY($1::uuid[])
          ORDER BY s.section_index, s.point_index, s.secours, s.exemplaire`,
        [processus.map((p) => p.id)])
      : { rows: [] }

    /* Les pièces remontent sans leur contenu : le document en cite le nom et le
       nombre. Un PDF qui embarquerait les photos pèserait des dizaines de
       méga-octets, et ce n'est pas ce qu'on lui demande. */
    const { rows: pieces } = saisies.length
      ? await requete(
        `SELECT id, saisie_id, libelle, nom_fichier, mime, taille
           FROM mti.piece_jointe WHERE saisie_id = ANY($1::uuid[]) ORDER BY ajoute_le`,
        [saisies.map((s) => s.id)])
      : { rows: [] }

    let patient = null
    if (dossier.patient_id) {
      const { rows: p } = await requete(
        `SELECT pat.reference, i.nom, i.prenom, i.ipp, i.date_naissance
           FROM mti.patient pat
           LEFT JOIN mti.patient_identite i ON i.patient_id = pat.id
          WHERE pat.id = $1`, [dossier.patient_id])
      if (p.length) {
        patient = {
          reference: p[0].reference,
          nom: [p[0].nom, p[0].prenom].filter(Boolean).join(' ') || null,
          ipp: p[0].ipp ?? null
        }
      }
    }

    const { rows: alertes } = await requete(
      'SELECT regle, libelle, message FROM mti.incoherences_dates($1)', [dossierId])

    const { rows: [etab] } = await requete(
      "SELECT valeur FROM mti.parametre WHERE cle = 'etablissement.nom'")

    return {
      dossier,
      patient,
      processus,
      saisies,
      pieces,
      alertes,
      etablissement: etab?.valeur ?? 'Établissement — à renseigner'
    }
  }

  /** Nom de fichier : lisible, daté, et sans caractère qui gêne un système. */
  function nomFichier (dossier, extension, quand) {
    const p = (n) => String(n).padStart(2, '0')
    const date = `${quand.getFullYear()}${p(quand.getMonth() + 1)}${p(quand.getDate())}` +
      `-${p(quand.getHours())}${p(quand.getMinutes())}`
    const reference = String(dossier.reference).replace(/[^A-Za-z0-9-]/g, '')
    return `${reference}-${date}.${extension}`
  }

  async function produire (request, reply, format) {
    const contexte = await rassembler(request.params.id)
    if (!contexte) return reply.code(404).send({ erreur: 'Dossier introuvable.' })

    const genereLe = new Date()
    const generePar = [request.utilisateur.titre, request.utilisateur.prenom,
      request.utilisateur.nom].filter(Boolean).join(' ') ||
      request.utilisateur.identifiant || 'opérateur non résolu'

    const complet = { ...contexte, genereLe, generePar }
    const fichier = format === 'pdf' ? pdfDuDossier(complet) : tableurDuDossier(complet)
    const sha = createHash('sha256').update(fichier).digest('hex')

    /* LA TRACE EST POSÉE AVANT L'ENVOI. Si l'écriture échoue, le document ne
       part pas : un export nominatif non tracé est précisément ce qu'on veut
       éviter, et il vaut mieux refuser une édition que la laisser sortir sans
       trace. */
    await transaction(request.utilisateur.id, request.ip, (client) =>
      client.query(
        `INSERT INTO mti.export_dossier
           (dossier_id, format, statut, conformite, nominatif, taille, sha256, genere_par)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [request.params.id, format, contexte.dossier.statut,
          contexte.dossier.conformite ?? null, contexte.patient !== null,
          fichier.length, sha, request.utilisateur.id]))

    const nom = nomFichier(contexte.dossier, format, genereLe)
    return reply
      .header('content-type', format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.ms-excel')
      /* En pièce jointe, et `nosniff` : le contenu est servi depuis l'origine
         de l'application, et un document ne doit pas s'ouvrir dans la page. */
      .header('content-disposition', `attachment; filename="${nom}"`)
      .header('x-content-type-options', 'nosniff')
      /* Un document nominatif ne se met pas en cache : il pourrait rester
         lisible dans un navigateur partagé longtemps après la consultation. */
      .header('cache-control', 'no-store')
      .send(fichier)
  }

  app.get('/api/dossiers/:id/export.pdf', (request, reply) =>
    produire(request, reply, 'pdf'))

  app.get('/api/dossiers/:id/export.xls', (request, reply) =>
    produire(request, reply, 'xls'))

  /** Historique des éditions : qui a sorti quoi, et quand. */
  app.get('/api/dossiers/:id/exports', async (request) => {
    const { rows } = await requete(
      `SELECT e.id, e.format, e.statut, e.conformite, e.nominatif, e.taille,
              e.sha256, e.genere_le,
              btrim(concat_ws(' ', u.titre, u.prenom, u.nom)) AS genere_par
         FROM mti.export_dossier e
         LEFT JOIN mti.utilisateur u ON u.id = e.genere_par
        WHERE e.dossier_id = $1
        ORDER BY e.genere_le DESC`,
      [request.params.id])
    return rows
  })
}
