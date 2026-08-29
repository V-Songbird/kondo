import { describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Safety invariants (docs/testing.md): structural rules that must never
 * regress, enforced against the source tree itself.
 */

const repoRoot = path.resolve(import.meta.dirname, '..')

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('safety invariants', () => {
  it('the renderer never imports Node or Electron modules', async () => {
    for (const file of await sourceFiles(path.join(repoRoot, 'src'))) {
      const content = await fs.readFile(file, 'utf8')
      expect(content, file).not.toMatch(/from ['"]node:/)
      expect(content, file).not.toMatch(/from ['"]electron['"]/)
      expect(content, file).not.toMatch(/\brequire\s*\(/)
    }
  })

  it('the shared contract stays platform-free', async () => {
    const content = await fs.readFile(path.join(repoRoot, 'shared', 'contract.ts'), 'utf8')
    expect(content).not.toMatch(/from ['"]node:/)
    expect(content).not.toMatch(/from ['"]electron['"]/)
  })

  it('the preload bridge imports only electron and the shared contract', async () => {
    const content = await fs.readFile(
      path.join(repoRoot, 'electron', 'preload', 'index.ts'),
      'utf8'
    )
    const imports = [...content.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1])
    for (const source of imports) {
      expect(['electron', '../../shared/contract']).toContain(source)
    }
  })

  it('only the locator and the composition root resolve machine locations', async () => {
    for (const file of await sourceFiles(path.join(repoRoot, 'electron'))) {
      const content = await fs.readFile(file, 'utf8')
      const allowed =
        file.endsWith(`${path.sep}locator.ts`) || file.endsWith(`main${path.sep}index.ts`)
      if (allowed) continue
      expect(content, file).not.toMatch(/homedir\s*\(/)
      expect(content, file).not.toMatch(/APPDATA/)
      expect(content, file).not.toMatch(/AppData[\\/]+Roaming/)
    }
  })
})
