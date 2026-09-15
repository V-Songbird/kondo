import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Offline: the fixture is a temporary directory laid out the way
// electron-builder lays out packaged resources, filled from the repository's
// own notice files. Nothing packages, nothing launches, nothing leaves disk.
const script = fileURLToPath(new URL('../scripts/verify-packaged-notices.mjs', import.meta.url))
const NOTICES = fileURLToPath(new URL('../THIRD-PARTY-NOTICES.md', import.meta.url))
const OFL = fileURLToPath(new URL('../src/assets/fonts/OFL.txt', import.meta.url))
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A packaged resources directory: THIRD-PARTY-NOTICES.md at its root and the
// unchanged OFL under licenses/IBM-Plex/. `edit` rewrites the shipped notices,
// so a test can drop or alter one without touching the repository's copy.
function resources(edit = (text) => text) {
  const root = mkdtempSync(join(tmpdir(), 'kondo-notices-'))
  roots.push(root)
  mkdirSync(join(root, 'licenses', 'IBM-Plex'), { recursive: true })
  writeFileSync(join(root, 'licenses', 'IBM-Plex', 'OFL.txt'), readFileSync(OFL))
  writeFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), edit(readFileSync(NOTICES, 'utf8')))
  return root
}

const verify = (root) => spawnSync(process.execPath, [script, root], { encoding: 'utf8' })

// Drop one `## <heading>` section, up to the next heading or the end of the
// file. Line-based rather than a regular expression, so the fixture does not
// depend on how the checkout wrote its line endings.
function without(heading) {
  return (text) => {
    const lines = text.split(/\r?\n/)
    const start = lines.indexOf(`## ${heading}`)
    expect(start, `section ## ${heading}`).toBeGreaterThan(-1)
    const next = lines.slice(start + 1).findIndex((line) => line.startsWith('## '))
    lines.splice(start, next === -1 ? lines.length - start : next + 1)
    return lines.join('\n')
  }
}

describe('packaged third-party notices', () => {
  it('passes a complete packaged set and names every notice it checked', () => {
    const result = verify(resources())
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toContain('Verified THIRD-PARTY-NOTICES.md')
    expect(result.stdout).toContain('Verified licenses/IBM-Plex/OFL.txt')
    expect(result.stdout).toContain('IBM Plex, Electron, React, React DOM, Scheduler, Tailwind CSS')
  })

  it('fails a packaged copy with a notice removed, naming that notice', () => {
    const result = verify(resources(without('React DOM')))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Packaged THIRD-PARTY-NOTICES.md carries no React DOM notice')
  })

  it('fails a packaged copy whose notice text is stale, with every heading intact', () => {
    const stale = (text) => {
      const edited = text.replace('Copyright (c) Tailwind Labs, Inc.', 'Copyright (c) Tailwind Labs, Inc. 2019')
      expect(edited, 'the stale fixture changed nothing').not.toBe(text)
      return edited
    }
    const result = verify(resources(stale))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Packaged THIRD-PARTY-NOTICES.md differs from THIRD-PARTY-NOTICES.md')
  })

  it('fails when the packaged resources directory has no notices at all', () => {
    const root = mkdtempSync(join(tmpdir(), 'kondo-notices-'))
    roots.push(root)
    const result = verify(root)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('THIRD-PARTY-NOTICES.md')
  })
})

describe('release workflow notice gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const job = (name) => {
    const start = workflow.indexOf(`\n  ${name}:\n`)
    expect(start, `job ${name}`).toBeGreaterThan(-1)
    const rest = workflow.slice(start + 1)
    const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
    return end === -1 ? rest : rest.slice(0, end + 1)
  }

  it('verifies the packaged notices in the package job, after electron-builder', () => {
    const packaging = job('package')
    const built = packaging.indexOf('npx electron-builder --publish never')
    const verified = packaging.indexOf('node scripts/verify-packaged-notices.mjs')
    expect(built).toBeGreaterThan(-1)
    expect(verified).toBeGreaterThan(built)
  })

  it('leaves the provenance job and the publish gate alone', () => {
    expect(job('provenance')).toContain('run: node scripts/verify-release-provenance.mjs')
    expect(job('publish')).toContain("\n    if: github.event_name == 'push' && github.ref_type == 'tag'\n")
  })
})
