import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = process.argv[2]
assert.ok(resources, 'Usage: node scripts/verify-packaged-notices.mjs <resources-directory>')
const root = fileURLToPath(new URL('../', import.meta.url))

for (const [source, destination] of [
  ['src/assets/fonts/OFL.txt', 'licenses/IBM-Plex/OFL.txt'],
  ['THIRD-PARTY-NOTICES.md', 'THIRD-PARTY-NOTICES.md']
]) {
  const original = await readFile(resolve(root, source))
  const packaged = await readFile(resolve(resources, destination))
  assert.ok(original.equals(packaged), `Packaged ${destination} differs from ${source}`)
  console.log(`Verified ${destination}: ${packaged.length} identical bytes`)
}
