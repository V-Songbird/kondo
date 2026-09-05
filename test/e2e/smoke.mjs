import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import electron from 'electron'
import { connect, waitForPage } from '../../.claude/skills/run-kondo/cdp.mjs'

/**
 * The end-to-end smoke (docs/testing.md, tier 5): the BUILT app — main,
 * preload and renderer as `npm run build` left them in `out/` — launched
 * against the run-kondo fixture store and driven over Chromium's debugging
 * port. Everything below the seam is already unit-tested; what this proves is
 * the seam itself: the preload bridge is there, the IPC wiring answers, the
 * renderer draws, and a mutation round-trips through all of it and back.
 *
 * Never a real store: the fixture is built in a fresh temp directory and the
 * three KONDO_*_ROOT variables point the locator at it (CLAUDE.md's one
 * repeated warning). `--no-sandbox` is passed only on Linux CI, where the
 * runner's kernel refuses Chromium's sandbox.
 *
 * KONDO_E2E_BINARY names a packaged executable (`release/win-unpacked/Kondo.exe`,
 * `release/linux-unpacked/kondo`) to drive instead of the dev electron over
 * `out/`: the release workflow runs the same assertions against what it is
 * about to publish.
 */

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = Number(process.env.KONDO_E2E_PORT ?? 9333)

let base
let child
let client

before(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'kondo-e2e-'))
  const printed = execFileSync(process.execPath, ['.claude/skills/run-kondo/fixture.mjs', base], {
    cwd: repo,
    encoding: 'utf8'
  })
  const env = JSON.parse(printed)

  const binary = process.env.KONDO_E2E_BINARY ?? electron
  const args = [...(binary === electron ? ['.'] : []), `--remote-debugging-port=${PORT}`]
  if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox')
  child = spawn(binary, args, {
    cwd: repo,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const log = []
  child.stdout.on('data', (chunk) => log.push(String(chunk)))
  child.stderr.on('data', (chunk) => log.push(String(chunk)))
  child.on('exit', (code) => log.push(`electron exited with ${code}`))

  try {
    client = await connect(await waitForPage(PORT))
  } catch (cause) {
    throw new Error(`${cause.message}\n${log.join('')}`)
  }
  // The bridge and the first render, both: a blank frame is a failed launch.
  await client.waitFor(`typeof window.kondo === 'object' && document.querySelectorAll('nav button').length > 0`)
})

after(async () => {
  client?.close()
  if (child && child.exitCode === null) {
    child.kill()
    await new Promise((resolve) => child.once('exit', resolve))
  }
  if (base) await fs.rm(base, { recursive: true, force: true })
})

const call = (expression) => client.evaluate(`(async () => ${expression})()`)

test('the nav has its four destinations and opens on Projects', async () => {
  const labels = await client.evaluate(`[...document.querySelectorAll('nav button')].map((b) => b.textContent.trim())`)
  assert.deepEqual(labels, ['Projects', 'Clean up', 'Leftovers', 'History'])
  await client.waitFor(`document.querySelectorAll('li button').length > 0`)
})

test('the projects list is the fixture union: Global plus the five registry members', async () => {
  const rows = await call(`(await window.kondo.projectsList()).data`)
  assert.equal(rows.length, 6)
  assert.equal(rows[0].global, true)
  assert.deepEqual(
    rows.slice(1).map((row) => row.name).sort(),
    ['apiserver', 'cli', 'oldsite', 'removed', 'website']
  )
  // Two are gone from disk; all sit under the temp root and read as throwaway.
  assert.equal(rows.filter((row) => row.location === 'gone').length, 2)
})

test('the Global page lists the fixture skills and the two plugins', async () => {
  const detail = await call(`(await window.kondo.projectDetail('store:user:user')).data`)
  assert.deepEqual(
    detail.skills.map((skill) => skill.name).sort(),
    ['api-notes', 'commit-writer', 'db-migrate', 'old-linter']
  )
  assert.deepEqual(detail.plugins.map((plugin) => plugin.name).sort(), ['foreman', 'hush'])
  assert.equal(detail.storage.sessions.projectCount, 5)
})

test('Clean up renders its preview and Leftovers finds every orphan kind', async () => {
  await client.evaluate(`[...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Clean up').click()`)
  await client.waitFor(`document.body.textContent.includes('Preview — nothing has moved')`)
  const tidy = await call(`(await window.kondo.tidyPreview()).data`)
  const throwaway = tidy.categories.find((entry) => entry.category === 'scratch-projects')
  assert.equal(throwaway.count, 2)

  const orphans = await call(`(await window.kondo.configOrphansPreview()).data`)
  assert.deepEqual(
    [...new Set(orphans.map((row) => row.kind))].sort(),
    ['enabled-plugin', 'mcp-declaration', 'project-entry', 'skill-override']
  )
})

test('a skill move round-trips through the bridge and its undo puts the store back', async () => {
  const rows = await call(`(await window.kondo.projectsList()).data`)
  const target = rows.find((row) => row.name === 'apiserver').id
  const moved = await call(
    `await window.kondo.entityMutate('skill:user:commit-writer', { op: 'move', targetId: ${JSON.stringify(target)} })`
  )
  assert.deepEqual(moved.errors, [])
  assert.equal(moved.data.op, 'move')
  assert.equal(moved.data.stepCount, 2)

  const after = await call(`(await window.kondo.projectDetail(${JSON.stringify(target)})).data.skills.map((s) => s.name)`)
  assert.ok(after.includes('commit-writer'))

  // The journal on disk is the other half of the proof (ADR-0001).
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').length, 1)

  const undone = await call(`await window.kondo.journalUndo(${JSON.stringify(moved.data.id)})`)
  assert.deepEqual(undone.errors, [])
  const global = await call(`(await window.kondo.projectDetail('store:user:user')).data.skills.map((s) => s.name)`)
  assert.ok(global.includes('commit-writer'))
  assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').length, 2)
})
