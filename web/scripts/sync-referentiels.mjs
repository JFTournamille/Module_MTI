/**
 * Recopie les référentiels de `shared/` vers `web/src/data/`.
 *
 * `shared/` est la source unique de vérité : ces JSON alimentent à la fois le
 * seed de la base et le repli hors-ligne du front. Le front en a besoin dans
 * son arborescence pour que Vite les intègre au bundle.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const racine = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const source = join(racine, 'shared')
const cible = join(racine, 'web', 'src', 'data')

await mkdir(cible, { recursive: true })
const fichiers = (await readdir(source)).filter((f) => f.endsWith('.json'))
for (const f of fichiers) {
  await copyFile(join(source, f), join(cible, f))
  console.log(`référentiel synchronisé : ${f}`)
}
