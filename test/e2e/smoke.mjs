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

const navigate = async (label) => {
  await client.evaluate(`[...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)}).click()`)
}

const capture = async (name) => {
  if (!process.env.KONDO_E2E_SHOTS) return
  await fs.mkdir(process.env.KONDO_E2E_SHOTS, { recursive: true })
  await fs.writeFile(path.join(process.env.KONDO_E2E_SHOTS, `${name}.png`), await client.screenshot())
}

test('the nav has its five destinations and opens on Projects', async () => {
  const labels = await client.evaluate(`[...document.querySelectorAll('nav button')].map((b) => b.textContent.trim())`)
  assert.deepEqual(labels, ['Library', 'Projects', 'Clean up', 'Leftovers', 'History'])
  await client.waitFor(`document.querySelectorAll('li button').length > 0`)
})

test('Library lists the machine by object, and finds what needs a look', async () => {
  await client.evaluate(`[...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Library').click()`)
  // The verdict chip comes from a second scan than the list, so waiting on a
  // row would race it. Wait on the answer instead.
  await client.waitFor(`document.body.textContent.includes('identical copies')`)
  const rows = await client.evaluate(
    `JSON.stringify([...document.querySelectorAll('.row-item')].map((b) => b.textContent.trim()))`
  )
  const objects = JSON.parse(rows)
  // The fixture's two designed verdicts, and the two leftovers behind them.
  assert.ok(objects.some((row) => row.startsWith('api-notes') && row.includes('identical copies')))
  assert.ok(objects.some((row) => row.startsWith('db-migrate') && row.includes('same name, different contents')))
  assert.ok(objects.some((row) => row.startsWith('ghost') && row.includes('leftover')))
  assert.ok(objects.some((row) => row.startsWith('apiserver') && row.includes('project is gone')))
  // A skill's every scope, which no other screen in the app can show.
  await client.evaluate(
    `[...document.querySelectorAll('.row-item')].find((b) => b.textContent.includes('api-notes')).click()`
  )
  await client.waitFor(`document.body.textContent.includes('Where it lives')`)
  const scopes = await client.evaluate(`document.querySelectorAll('.ledger tbody tr').length`)
  assert.equal(scopes, 2)
  // Back to Projects, so the destinations that follow start where they used to.
  await client.evaluate(`[...document.querySelectorAll('nav button')].find((b) => b.textContent.trim() === 'Projects').click()`)
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

test('Library explains the kinds and opens the selected management location', async () => {
  await navigate('Library')
  await client.waitFor(`document.querySelectorAll('.row-item').length > 0 && !document.body.textContent.includes('Reading your Claude Code setup…')`)
  // Clear any previous selection without discarding the catalogue filters.
  await client.evaluate(`document.querySelector('.row-item[aria-current="true"]')?.click()`)
  await client.waitFor(`document.body.textContent.includes('Instructions for a repeatable task')`)
  await capture('library-overview')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  await capture('library-minimum')
  await client.send('Emulation.clearDeviceMetricsOverride')
  await client.evaluate(`[...document.querySelectorAll('.row-item')].find((b) => b.textContent.includes('api-notes')).click()`)
  await client.waitFor(`document.body.textContent.includes('Manage in apiserver')`)
  await capture('library-skill')
  await client.evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Manage in apiserver').click()`)
  await client.waitFor(`document.querySelector('h1')?.textContent === 'apiserver'`)
  assert.equal(await client.evaluate(`document.querySelector('nav [aria-current="page"]').textContent.trim()`), 'Projects')
  // Session details must open through a native button, including Enter.
  await client.waitFor(`document.querySelector('button[aria-label^="Session "]') !== null`)
  await client.evaluate(`document.querySelector('button[aria-label^="Session "]').focus()`)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await client.waitFor(`document.querySelector('button[aria-label^="Session "]')?.getAttribute('aria-expanded') === 'true'`)
  assert.equal(await client.evaluate(`[...document.querySelectorAll('input, select')].every((el) => Boolean(el.getAttribute('aria-label') || el.labels?.length))`), true)
})

test('a staged move focuses Cancel and Escape restores the picker without writing', async () => {
  await navigate('Projects')
  await client.waitFor(`[...document.querySelectorAll('li button')].some((b) => b.textContent.includes('Global'))`)
  await client.evaluate(`[...document.querySelectorAll('li button')].find((b) => b.textContent.includes('Global')).click()`)
  await client.waitFor(`document.querySelector('select[aria-label="Move to: commit-writer"]') !== null`)
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  const before = await fs.readFile(journal, 'utf8')
  await client.evaluate(`(() => {
    const picker = document.querySelector('select[aria-label="Move to: commit-writer"]');
    picker.focus();
    const target = [...picker.options].find((o) => o.textContent.includes('apiserver'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(picker, target.value);
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await client.waitFor(`document.activeElement?.textContent === 'Cancel'`)
  assert.equal(await fs.readFile(journal, 'utf8'), before)
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await client.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Move to: commit-writer'`)
  assert.equal(await fs.readFile(journal, 'utf8'), before)
})

test('Library keeps healthy items visible when the MCP read is malformed', async () => {
  const file = path.join(base, 'work', 'apiserver', '.mcp.json')
  const original = await fs.readFile(file, 'utf8')
  try {
    await fs.writeFile(file, '{ broken MCP fixture')
    await navigate('Library')
    await client.waitFor(`document.body.textContent.includes('Some information could not be read or recognized.')`)
    assert.equal(await client.evaluate(`[...document.querySelectorAll('.row-item')].some((b) => b.textContent.includes('api-notes'))`), true)
    await client.evaluate(`document.querySelector('.row-item[aria-current="true"]')?.click()`)
    await client.waitFor(`document.querySelector('[aria-label="MCP servers reading problems"]') !== null`)
    await client.evaluate(`document.querySelector('[aria-label="MCP servers reading problems"] button').click()`)
    assert.ok((await client.evaluate(`document.body.textContent`)).includes('parse-failed'))
    assert.ok(!(await client.evaluate(`document.body.textContent`)).includes('No issues found in the information Kondo checked.'))
    await capture('library-partial-read')
  } finally {
    await fs.writeFile(file, original)
    await navigate('Projects')
  }
})

test('inline undo reports success even when a different history line is malformed', async () => {
  await navigate('Projects')
  await client.waitFor(`[...document.querySelectorAll('li button')].some((b) => b.textContent.includes('Global'))`)
  await client.evaluate(`[...document.querySelectorAll('li button')].find((b) => b.textContent.includes('Global')).click()`)
  await client.waitFor(`document.querySelector('button[aria-label="Disable commit-writer"]') !== null`)
  const settings = path.join(base, 'home', '.claude', 'settings.json')
  const before = await fs.readFile(settings, 'utf8')
  await client.evaluate(`document.querySelector('button[aria-label="Disable commit-writer"]').click()`)
  await client.waitFor(`document.querySelector('.band-stamp button[aria-label^="Undo "]') !== null`)
  await fs.appendFile(path.join(base, 'kondo-data', 'journal.jsonl'), '{}\n')
  await client.evaluate(`document.querySelector('.band-stamp button[aria-label^="Undo "]').click()`)
  await client.waitFor(`document.querySelector('.band-stamp [role="status"]')?.textContent.startsWith('Undone —')`)
  assert.equal(await client.evaluate(`document.querySelector('.band-stamp button[aria-label^="Undo "]') === null`), true)
  assert.equal(await fs.readFile(settings, 'utf8'), before)
  assert.ok((await client.evaluate(`document.querySelector('.band-stamp [role="alert"]').textContent`)).includes('history entry is incomplete'))
})
