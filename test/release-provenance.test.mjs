import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// Offline: "origin" is a temporary repository reached over Git's file
// transport, and GIT_ALLOW_PROTOCOL makes Git refuse every other transport.
const script = fileURLToPath(new URL('../scripts/verify-release-provenance.mjs', import.meta.url))
const roots = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function world(branch = 'main') {
  const root = mkdtempSync(join(tmpdir(), 'kondo-provenance-'))
  roots.push(root)
  const config = join(root, 'gitconfig')
  writeFileSync(config, '')
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_ALLOW_PROTOCOL: 'file', GIT_TERMINAL_PROMPT: '0',
    GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid'
  })
  const upstream = join(root, 'upstream')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' }).trim()
  git(root, 'init', '-q', '-b', branch, upstream)
  const commit = (message) => { git(upstream, 'commit', '-q', '--allow-empty', '-m', message); return git(upstream, 'rev-parse', 'HEAD') }
  const clone = (...args) => {
    const work = join(root, `work-${roots.length}-${Math.random().toString(36).slice(2)}`)
    git(root, 'clone', '-q', '--depth', '1', ...args, pathToFileURL(upstream).href, work)
    return work
  }
  const verify = (cwd, event, ref, sha) => {
    const result = spawnSync(process.execPath, [script], {
      cwd, encoding: 'utf8', env: { ...env, GITHUB_EVENT_NAME: event, GITHUB_REF: ref, GITHUB_SHA: sha }
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  }
  return { upstream, git, commit, clone, verify }
}

// main: first ─ second; side branches from first.
function mainWithSide() {
  const w = world()
  const first = w.commit('first')
  const second = w.commit('second')
  w.git(w.upstream, 'checkout', '-q', '-b', 'side', first)
  const side = w.commit('side')
  w.git(w.upstream, 'checkout', '-q', 'main')
  return { ...w, first, second, side }
}

describe('release tag provenance', { timeout: 60_000 }, () => {
  it('passes a lightweight tag on main\'s tip in a depth-1 checkout, naming both commits', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', 'v1.0.0', w.second)
    const work = w.clone('--branch', 'v1.0.0')
    expect(w.git(work, 'rev-parse', '--is-shallow-repository')).toBe('true')
    const result = w.verify(work, 'push', 'refs/tags/v1.0.0', w.second)
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toContain(`tag commit ${w.second} is origin/main's tip, candidate commit ${w.second}`)
  })

  it('peels an annotated tag, whether the run names its commit or the tag object', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', '-a', 'v1.0.0', '-m', 'Release 1.0.0', w.second)
    const object = w.git(w.upstream, 'rev-parse', 'refs/tags/v1.0.0')
    expect(object).not.toBe(w.second)
    const work = w.clone('--branch', 'v1.0.0')
    for (const sha of [w.second, object]) {
      const result = w.verify(work, 'push', 'refs/tags/v1.0.0', sha)
      expect(result).toMatchObject({ status: 0, stderr: '' })
      expect(result.stdout).toContain(`tag commit ${w.second} is origin/main's tip, candidate commit ${w.second}`)
    }
  })

  it('rejects a tag on an unrelated branch, naming both commits', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', 'v1.0.0', w.side)
    const result = w.verify(w.clone('--branch', 'v1.0.0'), 'push', 'refs/tags/v1.0.0', w.side)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain(`tag commit ${w.side} is not reachable from origin/main; candidate commit ${w.second}`)
  })

  it('rejects a superseded main commit even when the checkout\'s own origin/main is stale', () => {
    const w = world()
    const first = w.commit('first')
    w.git(w.upstream, 'tag', 'v1.0.0', first)
    const work = w.clone()
    expect(w.git(work, 'rev-parse', 'refs/remotes/origin/main')).toBe(first)
    const second = w.commit('second')
    const result = w.verify(work, 'push', 'refs/tags/v1.0.0', first)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`tag commit ${first} is on origin/main but is not its tip; candidate commit ${second}`)
  })

  it('deepens a checkout shallow at main\'s tip before comparing an older main commit', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', 'v1.0.0', w.first)
    const work = w.clone()
    expect(w.git(work, 'rev-parse', '--is-shallow-repository')).toBe('true')
    const result = w.verify(work, 'push', 'refs/tags/v1.0.0', w.first)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`tag commit ${w.first} is on origin/main but is not its tip; candidate commit ${w.second}`)
  })

  it('rejects a tag that origin no longer points at the run\'s commit', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', 'v1.0.0', w.second)
    const work = w.clone('--branch', 'v1.0.0')
    expect(w.git(work, 'rev-parse', 'refs/tags/v1.0.0')).toBe(w.second)
    w.git(w.upstream, 'tag', '-f', 'v1.0.0', w.side)
    const result = w.verify(work, 'push', 'refs/tags/v1.0.0', w.second)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`origin's tag points at commit ${w.side}, not this run's commit ${w.second}`)
  })

  it('fails when origin has no such tag', () => {
    const w = mainWithSide()
    const result = w.verify(w.clone(), 'push', 'refs/tags/v9.9.9', w.second)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(`cannot be established for refs/tags/v9.9.9 at run commit ${w.second}: could not fetch refs/tags/v9.9.9 from origin`)
  })

  it('fails when origin has no main branch', () => {
    const w = world('trunk')
    const only = w.commit('only')
    w.git(w.upstream, 'tag', 'v1.0.0', only)
    const result = w.verify(w.clone('--branch', 'v1.0.0'), 'push', 'refs/tags/v1.0.0', only)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('could not fetch refs/heads/main from origin')
  })

  it('refuses a push event whose ref is not a v* tag', () => {
    const w = mainWithSide()
    const result = w.verify(w.clone(), 'push', 'refs/heads/main', w.second)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('refs/heads/main is not a v* tag')
  })

  it('reports a rehearsal on main\'s tip and exits 0', () => {
    const w = mainWithSide()
    const result = w.verify(w.clone(), 'workflow_dispatch', 'refs/heads/main', w.second)
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toContain(`Rehearsal commit ${w.second} is origin/main's tip, candidate commit ${w.second}: a tag on it would pass`)
  })

  it('reports a rehearsal on a tag ref at a side-branch commit without failing it', () => {
    const w = mainWithSide()
    w.git(w.upstream, 'tag', 'v1.0.0', w.side)
    const result = w.verify(w.clone('--branch', 'v1.0.0'), 'workflow_dispatch', 'refs/tags/v1.0.0', w.side)
    expect(result).toMatchObject({ status: 0, stderr: '' })
    expect(result.stdout).toContain(`Rehearsal commit ${w.side} is not reachable from origin/main, candidate commit ${w.second}: a tag on it would be rejected`)
  })
})

describe('release workflow gates', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const job = (name) => {
    const start = workflow.indexOf(`\n  ${name}:\n`)
    expect(start, `job ${name}`).toBeGreaterThan(-1)
    const rest = workflow.slice(start + 1)
    const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
    return end === -1 ? rest : rest.slice(0, end + 1)
  }

  it('checks provenance before any packaging step', () => {
    expect(job('provenance')).toContain('run: node scripts/verify-release-provenance.mjs')
    expect(job('package')).toContain('\n    needs: provenance\n')
  })

  it('drafts a release only for a tag push that passed provenance and packaging', () => {
    const publish = job('publish')
    expect(publish).toContain('\n    needs: [provenance, package]\n')
    expect(publish).toContain("\n    if: github.event_name == 'push' && github.ref_type == 'tag'\n")
    expect(publish).toContain('draft: true')
  })

  it('keeps the version and CHANGELOG gates', () => {
    expect(job('package')).toContain('does not name package.json version')
    expect(job('publish')).toContain('CHANGELOG.md has no entries under')
  })
})
