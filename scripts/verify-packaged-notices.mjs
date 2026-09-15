import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = process.argv[2]
assert.ok(resources, 'Usage: node scripts/verify-packaged-notices.mjs <resources-directory>')
const root = fileURLToPath(new URL('../', import.meta.url))

// Every section THIRD-PARTY-NOTICES.md must carry, and the npm packages each
// one attributes. The IBM Plex fonts and the Electron runtime reach the
// installers without being bundled modules, so they name no package.
//
// This list is maintained by hand from the bundle inventory described in
// docs/release.md, "Packaging" — the build's own source maps. The dependency
// cross-check below catches a new RUNTIME dependency shipped without a notice;
// a transitive package or a generated asset still has to be added here, which
// is why the inventory is re-run when dependencies change.
const NOTICES = [
  { heading: 'IBM Plex', packages: [] },
  { heading: 'Electron', packages: [] },
  { heading: 'React', packages: ['react'] },
  { heading: 'React DOM', packages: ['react-dom'] },
  { heading: 'Scheduler', packages: ['scheduler'] },
  { heading: 'Tailwind CSS', packages: ['tailwindcss'] }
]

// The notice set is read from the PACKAGED copy, because that is the document
// a user receives — reading the repository's own would pass a build that
// shipped an empty file. Read before the byte comparison below, so a section
// deleted from the shipped document is reported by name rather than as a
// difference somewhere in the file.
const shipped = await readFile(resolve(resources, 'THIRD-PARTY-NOTICES.md'), 'utf8')
const sections = new Set(
  shipped
    .split(/\r?\n/)
    .filter((line) => line.startsWith('## '))
    .map((line) => line.slice(3).trim())
)
for (const { heading } of NOTICES) {
  assert.ok(sections.has(heading), `Packaged THIRD-PARTY-NOTICES.md carries no ${heading} notice`)
}

const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const attributed = new Set(NOTICES.flatMap(({ packages }) => packages))
for (const name of Object.keys(manifest.dependencies ?? {})) {
  assert.ok(attributed.has(name), `Dependency ${name} has no notice in THIRD-PARTY-NOTICES.md`)
}

for (const [source, destination] of [
  ['src/assets/fonts/OFL.txt', 'licenses/IBM-Plex/OFL.txt'],
  ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md']
]) {
  const original = await readFile(resolve(root, source))
  const packaged = await readFile(resolve(resources, destination))
  assert.ok(original.equals(packaged), `Packaged ${destination} differs from ${source}`)
  console.log(`Verified ${destination}: ${packaged.length} identical bytes`)
}

console.log(`Verified ${NOTICES.length} notices: ${NOTICES.map(({ heading }) => heading).join(', ')}`)
