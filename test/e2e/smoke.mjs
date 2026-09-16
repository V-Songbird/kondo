import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, afterEach, before, test } from 'node:test'
import assert from 'node:assert/strict'
import electron from 'electron'
import { connect, waitForPage } from '../../.claude/skills/run-kondo/cdp.mjs'
import { launchOptions, stopAppImage, stopElectron } from './process.mjs'
import { assertRendererHealthy, monitorRenderer } from './renderer-health.mjs'

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
 * KONDO_E2E_BINARY names the installed Kondo.exe, Linux .AppImage, or macOS
 * app-bundle executable instead of dev Electron over `out/`. AppImages use
 * extract-and-run (no FUSE); their wrapper must exit before fixture restart.
 */

const repo = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = Number(process.env.KONDO_E2E_PORT ?? 9333)

let base
let child
let client
let fixtureEnv
let appImage
const rendererRuns = []
// Exempt only the sole console argument proven to be the injected Error.
// Retain all evidence, including every exception and request.
const expectedRenderErrors = new Set()
const assertSmokeHealthy = (evidence) => assertRendererHealthy({
  ...evidence,
  consoleErrors: evidence.consoleErrors.filter((event) => !expectedRenderErrors.has(event))
})

/** Reuse the same injected roots when testing a real application restart. */
const launch = async () => {
  const binary = process.env.KONDO_E2E_BINARY ?? electron
  const options = launchOptions(binary, electron, {
    platform: process.platform, ci: process.env.CI, port: PORT, base
  })
  appImage = options.detached
  const env = { ...process.env, ...options.env, ...fixtureEnv }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  child = spawn(binary, options.args, {
    cwd: repo,
    env,
    detached: options.detached,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const log = []
  child.stdout.on('data', (chunk) => log.push(String(chunk)))
  child.stderr.on('data', (chunk) => log.push(String(chunk)))
  child.on('exit', (code) => log.push(`electron exited with ${code}`))
  child.on('error', (cause) => log.push(`launch failed: ${cause.message}`))

  try {
    // Only drive the endpoint published by this fixture's child, never a
    // pre-existing app that happens to own the requested debugging port.
    const endpointDeadline = Date.now() + 30_000
    let endpoint
    while (!endpoint && Date.now() < endpointDeadline) {
      endpoint = log.join('').match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1]
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Fixture exited before CDP attachment')
      if (!endpoint) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(endpoint, 'Fixture did not publish its own debugging endpoint')
    const port = Number(new URL(endpoint).port)
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    assert.equal(version.webSocketDebuggerUrl, endpoint)
    client = await connect(await waitForPage(port))
    const evidence = await monitorRenderer(client)
    rendererRuns.push(evidence)
    // Capture a complete renderer initialization after both domains are on.
    // The process's first navigation may have happened before CDP attached.
    const origin = await client.evaluate('performance.timeOrigin')
    await client.send('Page.reload', { ignoreCache: true })
    const deadline = Date.now() + 30_000
    let ready = false
    while (!ready && Date.now() < deadline) {
      try {
        ready = await client.evaluate(`performance.timeOrigin !== ${origin} && typeof window.kondo === 'object' && document.querySelector('nav[aria-label="Main navigation"]') !== null`)
      } catch (cause) {
        if (!/context|navigat/i.test(cause.message)) throw cause
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(ready, 'Monitored renderer reload did not become ready')
    assert.ok(evidence.requests.some(({ type, request }) => type === 'Document' && request.url.startsWith('file:')),
      'Network monitoring did not observe the built renderer document')
    assertRendererHealthy(evidence)
  } catch (cause) {
    throw new Error(`${cause.message}\n${log.join('')}`)
  }
  // The bridge and the first render, both: a blank frame is a failed launch.
  await client.waitFor(`typeof window.kondo === 'object' && document.querySelectorAll('nav[aria-label="Main navigation"] button').length > 0`)
}

const stop = async () => {
  if (appImage && child) {
    try {
      await stopAppImage(child, client)
    } finally {
      client?.close()
      client = null
    }
    child = null
    return
  }
  try {
    if (child) await stopElectron(child, client)
  } finally {
    client?.close()
    client = null
  }
  child = null
}

before(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'kondo-e2e_.with space-')))
  const printed = execFileSync(process.execPath, ['.claude/skills/run-kondo/fixture.mjs', base], {
    cwd: repo,
    encoding: 'utf8'
  })
  fixtureEnv = JSON.parse(printed)
  for (const key of ['KONDO_STORE_ROOT', 'KONDO_DESKTOP_STORE_ROOT', 'KONDO_DATA_ROOT']) {
    assert.equal(typeof fixtureEnv[key], 'string', `Missing fixture override: ${key}`)
    const relative = path.relative(base, fixtureEnv[key])
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      `${key} must be inside this test's disposable fixture`)
  }
  await launch()
})

afterEach(() => {
  for (const evidence of rendererRuns) assertSmokeHealthy(evidence)
})

after(async () => {
  try {
    await stop()
  } finally {
    // Keep evidence if a failed shutdown could still be using the fixture.
    const stopped = !child?.pid || child.exitCode !== null || child.signalCode !== null
    if (base && stopped) await fs.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
  for (const evidence of rendererRuns) assertSmokeHealthy(evidence)
})

const call = (expression) => client.evaluate(`(async () => ${expression})()`)

const button = (label, within = 'document') =>
  `[...${within}.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? b.textContent.trim()) === ${JSON.stringify(label)})`

const navigate = async (label) => {
  await client.evaluate(`${button(label, 'document.querySelector(\'nav[aria-label="Main navigation"]\')')}.click()`)
  await client.waitFor(`document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.getAttribute('aria-label') === ${JSON.stringify(label)}`)
}

const section = async (navigation, label) => {
  const nav = `document.querySelector(${JSON.stringify(`nav[aria-label="${navigation}"]`)})`
  await client.waitFor(`${nav} !== null`)
  await client.evaluate(`${button(label, nav)}.click()`)
  await client.waitFor(`${button(label, nav)}?.getAttribute('aria-current') === 'page'`)
}

const press = async (key, modifiers = 0) => {
  const codes = { Enter: 13, Escape: 27, Tab: 9, ' ': 32, Backspace: 8,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 }
  const params = { key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key], modifiers }
  await client.send('Input.dispatchKeyEvent', {
    ...params, type: 'keyDown',
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
    ...(key === ' ' ? { text: ' ', unmodifiedText: ' ' } : {})
  })
  await client.send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
}

const keyboardActivate = async (expression) => {
  await client.waitFor(`${expression} !== undefined && ${expression} !== null`)
  await client.evaluate(`${expression}.focus()`)
  await press('Enter')
}

/** Follow the real Tab order rather than jumping over inaccessible controls. */
const tabTo = async (expression, limit = 40) => {
  for (let step = 0; step < limit; step++) {
    if (await client.evaluate(`document.activeElement === ${expression}`)) return
    await press('Tab')
  }
  assert.fail(`Keyboard focus did not reach ${expression} in ${limit} Tab presses`)
}

const browseLibrary = async () => {
  await navigate('Library')
  const back = button('Back to Library', 'document.querySelector(\'.library-workspace\')')
  await client.waitFor(`document.querySelector('.library-workspace') !== null`)
  if (await client.evaluate(`${back} !== undefined`)) await client.evaluate(`${back}.click()`)
  await client.waitFor(`document.querySelector('input[aria-label="Search the Library"]') !== null`)
}

const openProject = async (name) => {
  await navigate('Projects')
  const back = button('Back to projects')
  if (await client.evaluate(`${back} !== undefined`)) await client.evaluate(`${back}.click()`)
  await client.waitFor(`document.querySelector('.workspace-browser li button') !== null`)
  const show = button('Show them')
  if (await client.evaluate(`${show} !== undefined`)) await client.evaluate(`${show}.click()`)
  const row = `[...document.querySelectorAll('li button')].find((b) => b.textContent.includes(${JSON.stringify(name)}))`
  await client.waitFor(`${row} !== undefined`)
  await client.evaluate(`${row}.click()`)
}

const openGlobalSkills = async () => {
  await openProject('All projects')
  await section('Project sections', 'Skills')
  await client.waitFor(`document.querySelector('select[aria-label="Move to: commit-writer"]') !== null`)
}

const assertNoHorizontalOverflow = async () => {
  const widths = await client.evaluate(`(() => {
    const main = document.querySelector('main');
    const right = main.getBoundingClientRect().left + main.clientWidth;
    return {
      viewport: innerWidth,
      document: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      main: main.clientWidth, mainScroll: main.scrollWidth,
      overflow: [...main.querySelectorAll('*')].filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.right > right + 1;
      }).slice(0, 8).map((element) => ({ tag: element.tagName, class: element.className,
        right: element.getBoundingClientRect().right, text: element.textContent.trim().slice(0, 60) }))
    };
  })()`)
  if (widths.document > widths.viewport + 1 || widths.mainScroll > widths.main + 1) {
    await capture('horizontal-overflow-failure')
  }
  assert.ok(widths.document <= widths.viewport + 1, `Document overflows: ${JSON.stringify(widths)}`)
  assert.ok(widths.mainScroll <= widths.main + 1, `Main content overflows: ${JSON.stringify(widths)}`)
}

const assertInViewport = async (expression, minWidth = 40) => {
  const rect = await client.evaluate(`(() => {
    const element = ${expression};
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, right: box.right, bottom: box.bottom,
      width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight };
  })()`)
  assert.ok(rect.width >= minWidth && rect.height >= 16, `Control has no usable size: ${JSON.stringify(rect)}`)
  assert.ok(rect.x >= -1 && rect.right <= rect.viewportWidth + 1, `Control is clipped horizontally: ${JSON.stringify(rect)}`)
  assert.ok(rect.y >= -1 && rect.bottom <= rect.viewportHeight + 1, `Control is outside the viewport: ${JSON.stringify(rect)}`)
}

const capture = async (name) => {
  if (!process.env.KONDO_E2E_SHOTS) return
  await fs.mkdir(process.env.KONDO_E2E_SHOTS, { recursive: true })
  await fs.writeFile(path.join(process.env.KONDO_E2E_SHOTS, `${name}.png`), await client.screenshot())
}

/** Record only the synthetic Claude roots; Kondo's own preference is separate. */
const fixtureSnapshot = async () => {
  const files = []
  const visit = async (directory, relative) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name)
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        files.push([`${name}/`, null])
        await visit(target, name)
      } else files.push([name, (await fs.readFile(target)).toString('base64')])
    }
  }
  for (const root of ['home', 'desktop', 'work']) await visit(path.join(base, root), root)
  return files.sort(([left], [right]) => left.localeCompare(right))
}

const journalBytes = async () => {
  try {
    return await fs.readFile(path.join(base, 'kondo-data', 'journal.jsonl'), 'utf8')
  } catch (cause) {
    if (cause.code === 'ENOENT') return null
    throw cause
  }
}

const themeRadio = (theme) => `document.querySelector('input[name="kondo-theme"][value="${theme}"]')`

const openThemes = async () => {
  await keyboardActivate(button('Themes'))
  await client.waitFor(`document.querySelector('h1')?.textContent === 'Themes' && document.querySelectorAll('input[name="kondo-theme"]').length === 6`)
}

const waitForTheme = async (theme) => {
  await client.waitFor(`document.documentElement.dataset.theme === ${JSON.stringify(theme)} && ${themeRadio(theme)}?.checked && !${themeRadio(theme)}.disabled`)
  await client.waitFor(`(async () => {
    const result = await window.kondo.appearanceGet();
    return result.errors.length === 0 && result.data.theme === ${JSON.stringify(theme)};
  })()`)
}

const chooseTheme = async (theme) => {
  await client.waitFor(`${themeRadio(theme)} !== null && !${themeRadio(theme)}.disabled`)
  await client.evaluate(`${themeRadio(theme)}.focus()`)
  await press(' ')
  await waitForTheme(theme)
}

test('the four work destinations and separate Themes entry retain native keyboard navigation', async () => {
  await client.waitFor(`document.querySelector('.library-item') !== null && document.querySelector('[aria-busy="true"]') === null`)
  assert.ok(await client.evaluate(`document.getElementById('root').childNodes.length > 0`),
    'The root must remain populated after the initial read settles')
  const labels = await client.evaluate(`[...document.querySelectorAll('nav[aria-label="Main navigation"] button')].map((b) => b.getAttribute('aria-label'))`)
  assert.deepEqual(labels, ['Library', 'Projects', 'Clean up', 'History'])
  assert.equal(await client.evaluate(`document.querySelectorAll('button[aria-label="Themes"]').length`), 1)
  assert.equal(await client.evaluate(`document.querySelector('nav[aria-label="Main navigation"] button[aria-label="Themes"]') === null`), true)
  await client.waitFor(`document.documentElement.dataset.theme === 'chalk'`)
  assert.equal((await call(`await window.kondo.appearanceGet()`)).data.theme, 'chalk')
  assert.equal(await client.evaluate(`document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]').getAttribute('aria-label')`), 'Library')
  await client.waitFor(`document.querySelector('input[aria-label="Search the Library"]') !== null`)
  await client.evaluate(`document.querySelector('.skip-link').focus()`)
  await press('Enter')
  assert.equal(await client.evaluate(`document.activeElement?.id`), 'main-content')

  await client.evaluate(`document.querySelector('nav[aria-label="Main navigation"] button[aria-label="Library"]').focus()`)
  await press('Tab')
  assert.equal(await client.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Projects')
  await press('Tab', 8)
  assert.equal(await client.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Library')
  await press('Tab')
  await press(' ')
  await client.waitFor(`document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.getAttribute('aria-label') === 'Projects'`)
  await navigate('Library')
})

test('a descendant render failure shows accessible recovery and keyboard reload restores App', async () => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  const { version } = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'))
  const message = 'Synthetic render failure: <img src="invalid" onerror="throw 1"> & ' + 'long-detail-'.repeat(24)
  try {
    for (const theme of ['chalk', 'carbon']) {
      await openThemes()
      await chooseTheme(theme)
      await browseLibrary()
      await client.waitFor(`document.querySelector('.library-item') !== null`)
      const evidence = rendererRuns.at(-1)
      const consoleStart = evidence.consoleErrors.length
      const origin = await client.evaluate('performance.timeOrigin')
      // React keeps its handler on the host node. The synthetic onChange
      // succeeds; catalog filtering throws during the next descendant render.
      // This test-only input adds no production crash switch or bridge override.
      await client.evaluate(`(() => {
        const input = document.querySelector('input[aria-label="Search the Library"]');
        const key = Object.keys(input).find((key) => key.startsWith('__reactProps$'));
        if (!key || typeof input[key].onChange !== 'function') throw new Error('Search handler unavailable to smoke');
        window.__kondoSmokeRenderError = new Error(${JSON.stringify(message)});
        input[key].onChange({ target: { value: { trim() { throw window.__kondoSmokeRenderError; } } } });
      })()`)
      await client.waitFor(`document.querySelector('.error-boundary [role="alert"]') !== null`)
      const intentional = evidence.consoleErrors.slice(consoleStart)
      assert.equal(intentional.length, 1, 'Expected exactly one React caught-error report')
      assert.equal(intentional[0].args.length, 1)
      const objectId = intentional[0].args[0].objectId
      assert.ok(objectId, 'Caught report must retain the original Error object')
      const identity = await client.send('Runtime.callFunctionOn', {
        objectId, functionDeclaration: 'function () { return this === window.__kondoSmokeRenderError }', returnByValue: true
      })
      assert.equal(identity.result.value, true, 'Only the injected Error may be exempted')
      expectedRenderErrors.add(intentional[0])
      assertSmokeHealthy(evidence)
      assert.equal(await client.evaluate(`document.querySelector('[role="alert"]').textContent`), message)
      assert.equal(await client.evaluate(`document.querySelector('[role="alert"] img') === null`), true)
      assert.equal(await client.evaluate(`document.querySelector('.error-boundary .font-mono').textContent`), `Kondo v${version}`)
      assert.equal(await client.evaluate(`document.activeElement?.id`), 'render-error-title')
      const accessibility = await client.send('Accessibility.getFullAXTree')
      assert.ok(accessibility.nodes.some((node) => node.role?.value === 'alert' && !node.ignored))
      assert.ok(accessibility.nodes.some((node) => node.role?.value === 'button' && node.name?.value === 'Reload Kondo' && !node.ignored))
      await press('Tab')
      assert.equal(await client.evaluate(`document.activeElement?.textContent.trim()`), 'Reload Kondo')
      assert.equal(await client.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid')
      for (const [width, height] of [[1360, 860], [900, 600]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await assertNoHorizontalOverflow()
        await assertInViewport(button('Reload Kondo'))
        await capture(`render-error-${theme}-${width}`)
      }
      await press('Enter')
      await client.waitFor(`performance.timeOrigin !== ${origin} && document.querySelector('.library-item') !== null && document.querySelector('[aria-busy="true"]') === null`)
      assert.equal(await client.evaluate(`document.querySelector('.error-boundary') === null && document.getElementById('root').childNodes.length > 0`), true)
      assert.equal(await client.evaluate(`document.documentElement.dataset.theme`), theme)
      assert.deepEqual(await fixtureSnapshot(), beforeFiles)
      assert.equal(await journalBytes(), beforeJournal)
      assertSmokeHealthy(evidence)
    }
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
  await openThemes()
  await chooseTheme('chalk')
  await browseLibrary()
})

test('six named native theme choices respond to arrow keys without changing Claude data', async (t) => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  await client.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false })
  t.after(() => client.send('Emulation.clearDeviceMetricsOverride'))
  await client.evaluate(`document.querySelector('nav[aria-label="Main navigation"] button[aria-label="Library"]').focus()`)
  await tabTo(button('Themes'), 10)
  await press('Enter')
  await client.waitFor(`document.querySelector('h1')?.textContent === 'Themes' && document.querySelectorAll('input[name="kondo-theme"]').length === 6`)
  const choices = [
    ['chalk', 'Chalk'], ['parchment', 'Parchment'], ['sage', 'Sage'],
    ['slate', 'Slate'], ['carbon', 'Carbon'], ['signal', 'Signal Original']
  ]
  assert.deepEqual(await client.evaluate(`[...document.querySelectorAll('input[name="kondo-theme"]')].map((input) => input.value)`), choices.map(([id]) => id))
  const { root } = await client.send('DOM.getDocument')
  for (const [id, name] of choices) {
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: root.nodeId, selector: `input[name="kondo-theme"][value="${id}"]`
    })
    const { nodes } = await client.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })
    const radio = nodes.find((node) => !node.ignored && node.role?.value === 'radio')
    assert.ok(radio?.name?.value.includes(name), `No accessible radio named ${name}: ${JSON.stringify(nodes)}`)
    assert.equal(await client.evaluate(`${themeRadio(id)}.type`), 'radio')
  }
  assert.equal(await client.evaluate(`${themeRadio('chalk')}.checked`), true)
  assert.ok((await client.evaluate(`${themeRadio('chalk')}.closest('.theme-option').textContent`)).includes('Default'))
  await capture('themes-chalk-desktop')

  await tabTo(themeRadio('chalk'), 12)
  const chalkBackground = await client.evaluate(`getComputedStyle(document.body).backgroundColor`)
  const headerHeight = await client.evaluate(`document.querySelector('.side').getBoundingClientRect().height`)
  assert.ok(headerHeight > 0)
  for (const [id] of choices.slice(1)) {
    await press('ArrowDown')
    await waitForTheme(id)
    assert.equal(await client.evaluate(`document.activeElement === ${themeRadio(id)}`), true,
      `Selecting ${id} lost keyboard focus`)
    assert.ok((await client.evaluate(`${themeRadio(id)}.closest('.theme-option').textContent`)).includes('Current theme'))
    assert.equal(await client.evaluate(`document.querySelector('.side').getBoundingClientRect().height`), headerHeight,
      `Selecting ${id} changed the shell header height at 1360px`)
    if (id === 'carbon') {
      assert.notEqual(await client.evaluate(`getComputedStyle(document.body).backgroundColor`), chalkBackground)
    }
  }
  // Native radio navigation wraps back to the first choice, without six Tab stops.
  await press('ArrowDown')
  await waitForTheme('chalk')
  assert.equal(await client.evaluate(`document.activeElement === ${themeRadio('chalk')}`), true)
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(base, 'kondo-data', 'appearance.json'), 'utf8')), { theme: 'chalk' })
  assert.deepEqual(await fixtureSnapshot(), beforeFiles)
  assert.equal(await journalBytes(), beforeJournal)
  await navigate('Library')
})

test('Library lists the machine by object, and finds what needs a look', async () => {
  await browseLibrary()
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
  assert.ok(objects.some((row) => row.startsWith('ghost') && row.includes('installation not found')))
  assert.ok(objects.some((row) => row.startsWith('apiserver') && row.includes('project is gone')))
  // A skill's every scope, which no other screen in the app can show.
  await client.evaluate(
    `[...document.querySelectorAll('.row-item')].find((b) => b.textContent.includes('api-notes')).click()`
  )
  await client.waitFor(`document.querySelector('.library-workspace h1')?.textContent === 'api-notes'`)
  assert.equal(await client.evaluate(`${button('Manage in Global')} !== undefined`), true)
  assert.equal(await client.evaluate(`${button('Manage in apiserver')} !== undefined`), true)
  await browseLibrary()
  await client.evaluate(`[...document.querySelectorAll('.row-item')].find((b) => b.textContent.startsWith('ghost')).click()`)
  await client.waitFor(`${button('Review settings leftovers')} !== undefined`)
  await keyboardActivate(button('Review settings leftovers'))
  await client.waitFor(`document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]')?.getAttribute('aria-label') === 'Clean up'`)
  await client.waitFor(`document.querySelector('nav[aria-label="Cleanup sections"] [aria-current="page"]')?.textContent.trim() === 'Settings leftovers'`)
  await client.waitFor(`document.body.textContent.includes('ghost@acme')`)
  // Back to Projects, so the destinations that follow start where they used to.
  await navigate('Projects')
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

test('Clean up contains files, settings leftovers and duplicate skills', async () => {
  await navigate('Clean up')
  await section('Cleanup sections', 'Files and caches')
  const sections = await client.evaluate(`[...document.querySelectorAll('nav[aria-label="Cleanup sections"] button')].map((b) => b.textContent.trim())`)
  assert.deepEqual(sections, ['Files and caches', 'Settings leftovers', 'Duplicate skills'])
  await client.waitFor(`document.querySelector('input[aria-label^="Select "]') !== null`)
  const tidy = await call(`(await window.kondo.tidyPreview()).data`)
  const throwaway = tidy.categories.find((entry) => entry.category === 'scratch-projects')
  assert.equal(throwaway.count, 0, 'Fresh temporary session trees must be withheld')
  assert.equal(tidy.withheldScratchCount, 2)
  assert.equal(await client.evaluate(`document.querySelectorAll('main input[type="checkbox"]:checked').length`), 0)

  await section('Cleanup sections', 'Settings leftovers')
  await client.waitFor(`document.body.textContent.includes('ghost@acme') && document.body.textContent.includes('Skill preferences')`)
  const orphans = await call(`(await window.kondo.configOrphansPreview()).data`)
  assert.deepEqual(
    [...new Set(orphans.map((row) => row.kind))].sort(),
    ['enabled-plugin', 'mcp-declaration', 'project-entry']
  )
  await capture('cleanup-settings')
  await section('Cleanup sections', 'Duplicate skills')
  await client.waitFor(`document.body.textContent.includes('api-notes') && document.body.textContent.includes('db-migrate')`)
  await capture('cleanup-duplicates')
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
  assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.progressOf && !row.failedOf).length, 1)

  const undone = await call(`await window.kondo.journalUndo(${JSON.stringify(moved.data.id)})`)
  assert.deepEqual(undone.errors, [])
  const global = await call(`(await window.kondo.projectDetail('store:user:user')).data.skills.map((s) => s.name)`)
  assert.ok(global.includes('commit-writer'))
  assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.progressOf && !row.failedOf).length, 2)
})

test('the Library-to-project keyboard workflow preserves the item and search at 900px', async () => {
  await browseLibrary()
  await client.waitFor(`document.querySelectorAll('.row-item').length > 0 && !document.body.textContent.includes('Reading your Claude Code setup…')`)
  await capture('library-overview')
  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  try {
    const search = `document.querySelector('input[aria-label="Search the Library"]')`
    const kind = `document.querySelector('select[aria-label="Item type"]')`
    await client.evaluate(`(() => {
      const select = ${kind};
      const option = [...select.options].find((entry) => entry.textContent.startsWith('Skills'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, option.value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await client.waitFor(`${kind}.value !== ''`)
    const selectedKind = await client.evaluate(`${kind}.value`)
    assert.ok(selectedKind)
    await client.evaluate(`${search}.focus(); ${search}.select()`)
    await client.send('Input.insertText', { text: 'api-notes' })
    await client.waitFor(`document.querySelectorAll('.row-item').length === 1`)
    await assertNoHorizontalOverflow()
    await assertInViewport(search, 200)
    await capture('library-minimum-browser')

    const row = `document.querySelector('.row-item')`
    const selectedKey = await client.evaluate(`${row}.getAttribute('data-library-key')`)
    assert.ok(selectedKey)
    await tabTo(row)
    await press('Enter')
    const heading = `document.querySelector('.library-workspace .workspace-detail h1')`
    await client.waitFor(`${heading}?.textContent === 'api-notes' && document.activeElement === ${heading}`)
    // A resize must not leave focus in the browser after that pane is hidden.
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
    await client.waitFor(`getComputedStyle(document.querySelector('.library-workspace .workspace-browser')).display !== 'none'`)
    await client.evaluate(`${search}.focus()`)
    assert.equal(await client.evaluate(`document.activeElement === ${search}`), true)
    await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
    try {
      await client.waitFor(`document.activeElement === ${heading}`)
    } catch (cause) {
      const focused = await client.evaluate(`({ tag: document.activeElement?.tagName,
        label: document.activeElement?.getAttribute('aria-label'),
        rects: document.activeElement?.getClientRects().length,
        headingRects: ${heading}.getClientRects().length,
        browserDisplay: getComputedStyle(document.querySelector('.library-workspace .workspace-browser')).display })`)
      assert.fail(`${cause.message}; focus after resizing: ${JSON.stringify(focused)}`)
    }
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.library-workspace .workspace-browser')).display`), 'none')
    const detailWidth = await client.evaluate(`document.querySelector('.library-workspace .workspace-detail').getBoundingClientRect().width`)
    assert.ok(detailWidth >= 400, `Detail is compressed to ${detailWidth}px`)
    await assertNoHorizontalOverflow()
    await assertInViewport(heading, 300)
    await capture('library-minimum-detail')

    // Technical metadata is optional, and its native disclosure works with
    // both activation keys without changing where keyboard focus lives.
    const disclosure = `document.querySelector('.library-workspace .workspace-detail details')`
    await client.waitFor(`${disclosure} !== null`)
    assert.equal(await client.evaluate(`${disclosure}.open`), false)
    const summary = `${disclosure}.querySelector('summary')`
    await tabTo(summary)
    await press(' ')
    await client.waitFor(`${disclosure}.open`)
    assert.equal(await client.evaluate(`document.activeElement === ${summary}`), true)
    await press('Enter')
    await client.waitFor(`!${disclosure}.open`)

    const manage = button('Manage in apiserver')
    await keyboardActivate(manage)
    await client.waitFor(`document.querySelector('h1')?.textContent.startsWith('apiserver')`)
    await client.waitFor(`document.activeElement === document.querySelector('main') || document.activeElement === document.querySelector('h1')`)
    assert.equal(await client.evaluate(`document.querySelector('nav[aria-label="Main navigation"] [aria-current="page"]').getAttribute('aria-label')`), 'Projects')
    const sections = await client.evaluate(`[...document.querySelectorAll('nav[aria-label="Project sections"] button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim())`)
    assert.deepEqual(sections, ['Overview', 'Skills', 'Plugins', 'Connections', 'Other tools', 'Conversations', 'Technical details'])
    assert.equal(await client.evaluate(`${button('Skills', 'document.querySelector(\'nav[aria-label="Project sections"]\')')}.getAttribute('aria-current')`), 'page')
    await client.waitFor(`document.querySelector('select[aria-label="Move to: api-notes"]') !== null`)
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.workspace-browser')).display`), 'none')
    await assertInViewport(`document.querySelector('.workspace-detail h1')`, 300)
    await assertNoHorizontalOverflow()
    await capture('project-minimum-skills')

    await keyboardActivate(button('Back to Library item'))
    await client.waitFor(`${heading}?.textContent === 'api-notes' && document.activeElement === ${heading}`)
    assert.equal(await client.evaluate(`${search}.value`), 'api-notes')
    assert.equal(await client.evaluate(`${kind}.value`), selectedKind)
    await keyboardActivate(button('Back to Library', 'document.querySelector(\'.library-workspace\')'))
    await client.waitFor(`document.activeElement?.getAttribute('data-library-key') === ${JSON.stringify(selectedKey)}`)
    assert.equal(await client.evaluate(`${search}.value`), 'api-notes')
    assert.equal(await client.evaluate(`${kind}.value`), selectedKind)
    assert.equal(await client.evaluate(`document.querySelectorAll('.row-item').length`), 1)
    await assertNoHorizontalOverflow()
    await capture('library-minimum-return')
    await keyboardActivate(button('Clear filters'))
    await client.waitFor(`document.querySelectorAll('.row-item').length > 1 && document.activeElement === ${search}`)
    assert.equal(await client.evaluate(`${search}.value`), '')
    assert.equal(await client.evaluate(`${kind}.value`), '')
    assert.equal(await client.evaluate(`document.activeElement === ${search}`), true)
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('project conversations and technical details remain reachable with native controls', async () => {
  await openProject('apiserver')
  await section('Project sections', 'Conversations')
  await client.waitFor(`document.querySelector('button[aria-label^="Session "]') !== null`)
  const conversation = `document.querySelector('button[aria-label^="Session "]')`
  await keyboardActivate(conversation)
  await client.waitFor(`${conversation}?.getAttribute('aria-expanded') === 'true'`)
  await press(' ')
  await client.waitFor(`${conversation}?.getAttribute('aria-expanded') === 'false'`)
  assert.equal(await client.evaluate(`[...document.querySelectorAll('input, select')].every((el) => Boolean(el.getAttribute('aria-label') || el.labels?.length))`), true)
  await section('Project sections', 'Technical details')
  await capture('project-technical-details')
})

test('move cancellation and leaving a project discard pending writes at 900px', async () => {
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  const before = await fs.readFile(journal, 'utf8')
  const stageMove = async () => {
    await client.evaluate(`(() => {
      const picker = document.querySelector('select[aria-label="Move to: commit-writer"]');
      picker.focus();
      const target = [...picker.options].find((o) => o.textContent.includes('apiserver'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(picker, target.value);
      picker.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await client.waitFor(`document.activeElement?.textContent === 'Cancel'`)
  }
  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  try {
    await openGlobalSkills()
    await stageMove()
    assert.equal(await fs.readFile(journal, 'utf8'), before)
    await assertNoHorizontalOverflow()
    await assertInViewport('document.activeElement')
    await capture('move-minimum-confirmation')
    await press('Escape')
    await client.waitFor(`document.activeElement?.getAttribute('aria-label') === 'Move to: commit-writer'`)
    assert.equal(await fs.readFile(journal, 'utf8'), before)

    await stageMove()
    await keyboardActivate(button('Back to projects'))
    await openGlobalSkills()
    assert.equal(await client.evaluate(`${button('Move commit-writer to apiserver')} === undefined`), true)
    assert.equal(await fs.readFile(journal, 'utf8'), before)
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('cleanup review and permanent trash confirmation cancel safely at 900px', async () => {
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  const settings = path.join(base, 'home', '.claude', 'settings.json')
  const beforeJournal = await fs.readFile(journal, 'utf8')
  const beforeSettings = await fs.readFile(settings, 'utf8')
  const beforeTrash = await call(`(await window.kondo.trashSize()).data`)
  assert.ok(beforeTrash.bytes > 0)
  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  try {
    await navigate('Clean up')
    for (const [label, reviewLabel, shot] of [
      ['Files and caches', 'Review selected items', 'cleanup-minimum-files-review'],
      ['Settings leftovers', 'Review selected settings', 'cleanup-minimum-settings-review']
    ]) {
      await section('Cleanup sections', label)
      const checkbox = `document.querySelector('main input[type="checkbox"]:not(:disabled)')`
      await client.waitFor(`${checkbox} !== null`)
      await client.evaluate(`${checkbox}.focus()`)
      await press(' ')
      const review = button(reviewLabel)
      await client.waitFor(`${review} !== undefined && !${review}.disabled`)
      await keyboardActivate(review)
      await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
      await assertNoHorizontalOverflow()
      await assertInViewport('document.activeElement')
      await capture(shot)
      assert.equal(await fs.readFile(journal, 'utf8'), beforeJournal)
      assert.equal(await fs.readFile(settings, 'utf8'), beforeSettings)
      await press('Escape')
      await client.waitFor(`document.activeElement === ${review}`)
      assert.equal(await fs.readFile(journal, 'utf8'), beforeJournal)
    }

    await section('Cleanup sections', 'Files and caches')
    assert.equal(await client.evaluate(`${button('Move to trash')} === undefined`), true)
    await navigate('History')
    const empty = `[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Empty the trash'))`
    await client.waitFor(`${empty} !== undefined && !${empty}.disabled`)
    await keyboardActivate(empty)
    await client.waitFor(`document.activeElement?.textContent.trim() === 'Keep the trash'`)
    await assertNoHorizontalOverflow()
    await assertInViewport('document.activeElement')
    await capture('history-minimum-trash-confirmation')
    await press('Escape')
    await client.waitFor(`document.activeElement === ${empty}`)
    assert.equal(await fs.readFile(journal, 'utf8'), beforeJournal)
    assert.equal(await fs.readFile(settings, 'utf8'), beforeSettings)
    assert.deepEqual(await call(`(await window.kondo.trashSize()).data`), beforeTrash)
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('hook cleanup stays blocked for a HOME reference at both supported window sizes', async () => {
  const root = path.join(base, 'home', '.claude')
  const settings = path.join(root, 'settings.json')
  const script = path.join(root, 'hooks', '101-live.js')
  const original = await fs.readFile(settings, 'utf8')
  const parsed = JSON.parse(original)
  parsed.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'node "$HOME/.claude/hooks/101-live.js"' }] }] }
  await fs.mkdir(path.dirname(script), { recursive: true })
  await fs.writeFile(script, 'throw new Error("Scanned commands must never execute")\n')
  await fs.writeFile(settings, JSON.stringify(parsed))
  const before = await fixtureSnapshot()
  const journal = await journalBytes()
  try {
    for (const [width, height] of [[1360, 860], [900, 600]]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await navigate('Library')
      await navigate('Clean up')
      await section('Cleanup sections', 'Files and caches')
      const checkbox = `document.querySelector('input[aria-label="Select Hook scripts kondo keeps"]')`
      await client.waitFor(`${checkbox}?.disabled === true`)
      assert.ok((await client.evaluate(`${checkbox}.closest('tr').textContent`)).includes('cannot establish that they are unused'))
      assert.equal(await client.evaluate(`${checkbox}.checked`), false)
      await client.evaluate(`${button('Files and caches')}.focus()`)
      await press('Tab')
      assert.equal(await client.evaluate(`document.activeElement === ${checkbox}`), false)
      await assertInViewport('document.activeElement')
      await assertNoHorizontalOverflow()
      await capture(`101-hooks-keyboard-${width}`)
      await client.evaluate(`${checkbox}.closest('tr').scrollIntoView({ block: 'center' })`)
      await assertInViewport(`${checkbox}.closest('tr')`)
      await capture(`101-hooks-kept-${width}`)
      const preview = await call(`(await window.kondo.tidyPreview()).data`)
      const result = await call(`await window.kondo.tidySweep(['reclaimable-caches', 'unarmed-hook-scripts'], ${JSON.stringify(preview.reviewToken)})`)
      assert.equal(result.data, null)
      assert.deepEqual(result.errors.map((error) => error.code), ['not-permitted'])
      assert.deepEqual(await fixtureSnapshot(), before)
      assert.equal(await journalBytes(), journal)
    }
  } finally {
    await fs.writeFile(settings, original)
    await fs.rm(script)
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('settings-derived secrets stay out of pages, tooltips and bridge responses in Chalk and Carbon', async () => {
  const userSettings = path.join(base, 'home', '.claude', 'settings.json')
  const projectStore = path.join(base, 'work', 'apiserver', '.claude')
  const mcpFile = path.join(base, 'work', 'apiserver', '.mcp.json')
  const originalUser = await fs.readFile(userSettings, 'utf8')
  const originalMcp = await fs.readFile(mcpFile, 'utf8')
  const before = await fixtureSnapshot()
  const journal = await journalBytes()
  // Synthetic sentinels in the positions 117 names (ADR-0022); no real store.
  await fs.writeFile(userSettings, JSON.stringify({
    ...JSON.parse(originalUser),
    S117_TOP_LEVEL_NAME: 'S117_TOP_LEVEL_VALUE',
    env: { S117_ENV_NAME: 'S117_ENV_VALUE' },
    permissions: { allow: ['Bash(S117_PERMISSION_RULE)'], S117_NESTED_NAME: true },
    hooks: {
      // `~` is the app's real home, outside the fixture store: unverifiable and never statted.
      PreToolUse: [{ matcher: 'S117_MATCHER', hooks: [{ type: 'command', command: 'node ~/.claude/hooks/S117_UNCHECKED_SCRIPT.js --token=S117_COMMAND_ARG' }] }],
      S117_EVENT_NAME: [{ hooks: [{ type: 'S117_HANDLER_TYPE', command: 'echo S117_UNKNOWN_EVENT_COMMAND' }] }]
    }
  }, null, 2))
  // A project-relative script resolves inside the fixture project, so its absence is checked.
  await fs.writeFile(path.join(projectStore, 'settings.json'), JSON.stringify({ hooks: {
    Stop: [{ hooks: [{ type: 'prompt', prompt: 'S117_PROMPT' }] }],
    PostToolUse: [{ matcher: 'S117_PROJECT_MATCHER', hooks: [{ type: 'command', command: '.claude/hooks/S117_MISSING_SCRIPT.sh S117_PROJECT_ARG' }] }]
  } }))
  await fs.writeFile(path.join(projectStore, 'settings.local.json'), '{"env":{"S117_MALFORMED_NAME":S117_MALFORMED_VALUE}}')
  await fs.writeFile(mcpFile, JSON.stringify({ mcpServers: { linter: {
    type: 'S117_TRANSPORT', command: 'npx',
    env: { S117_MCP_ENV_NAME: 'S117_MCP_ENV_VALUE' }, headers: { S117_HEADER_NAME: 'S117_HEADER_VALUE' }
  } } }))

  /** Opens problem lists and technical details, then reads text and every tooltip-like attribute. */
  const leaks = async () => {
    await client.evaluate(`(() => {
      for (const toggle of document.querySelectorAll('.band button[aria-expanded="false"]')) toggle.click()
      for (const details of document.querySelectorAll('details')) details.open = true
    })()`)
    await client.waitFor(`document.querySelector('.band button[aria-expanded="false"]') === null`)
    return client.evaluate(`(() => {
      const found = new Set()
      const scan = (text) => { for (const match of String(text ?? '').matchAll(/S117_\\w*/g)) found.add(match[0]) }
      scan(document.body.innerText)
      scan(document.body.textContent)
      for (const element of document.querySelectorAll('*')) {
        for (const name of ['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'value']) scan(element.getAttribute(name))
      }
      return [...found]
    })()`)
  }
  const technical = `document.querySelector('nav[aria-label="Project sections"]')`
  /** Returning to the list refocuses the previous row on the next frame; wait before the next key press. */
  const backToLibrary = async () => {
    await keyboardActivate(button('Back to Library'))
    await client.waitFor(`document.activeElement?.hasAttribute('data-library-key') === true || document.activeElement?.id === 'library-search'`)
  }
  /** The focused top of the page, then the changed section, when screenshots are requested. */
  const shoot = async (name, heading) => {
    if (!process.env.KONDO_E2E_SHOTS) return
    await capture(`${name}-top`)
    await client.evaluate(`[...document.querySelectorAll('section h2')].find((title) => title.textContent.trim() === ${JSON.stringify(heading)})?.closest('section')?.scrollIntoView({ block: 'start' })`)
    await capture(`${name}-section`)
  }

  try {
    // Screenshots show settled control colors rather than a 90ms transition.
    await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    for (const theme of ['chalk', 'carbon']) {
      await openThemes()
      await chooseTheme(theme)
      for (const [width, height] of [[1360, 860], [900, 600]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

        await openProject('All projects')
        await client.waitFor(`${technical} !== null`)
        await keyboardActivate(button('Technical details', technical))
        await client.waitFor(`document.body.innerText.includes('Other top-level settings are not shown')`)
        const shared = await client.evaluate('document.body.innerText')
        for (const text of ['PreToolUse', 'not recognized', 'cannot check', 'env · permissions · hooks']) {
          assert.ok(shared.includes(text), `All projects technical details lack ${text}`)
        }
        assert.notEqual(await client.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'none')
        await assertNoHorizontalOverflow()
        await shoot(`117-shared-technical-${theme}-${width}`, 'Hooks')
        assert.deepEqual(await leaks(), [])

        await openProject('apiserver')
        await section('Project sections', 'Technical details')
        await client.waitFor(`document.body.innerText.includes('prompt')`)
        const own = await client.evaluate('document.body.innerText')
        for (const text of ['Stop', 'PostToolUse', 'not found']) assert.ok(own.includes(text), `apiserver technical details lack ${text}`)
        await assertNoHorizontalOverflow()
        await shoot(`117-project-technical-${theme}-${width}`, 'Hooks')
        assert.deepEqual(await leaks(), [])

        await navigate('Projects')
        await browseLibrary()
        const clear = button('Clear filters')
        if (await client.evaluate(`${clear} !== undefined`)) await client.evaluate(`${clear}.click()`)
        assert.deepEqual(await leaks(), [])
        const hook = `[...document.querySelectorAll('[data-library-key]')].find((item) => item.textContent.includes('PreToolUse'))`
        await client.waitFor(`${hook} !== undefined`)
        await keyboardActivate(hook)
        await client.waitFor(`document.body.innerText.includes('Set (pattern not shown)')`)
        assert.equal(await client.evaluate(`document.activeElement?.tagName`), 'H1')
        await assertNoHorizontalOverflow()
        await shoot(`117-library-hook-${theme}-${width}`, 'What it runs')
        assert.deepEqual(await leaks(), [])

        await backToLibrary()
        const layer = `[...document.querySelectorAll('[data-library-key]')].find((item) => item.textContent.includes('Global · user'))`
        await client.waitFor(`${layer} !== undefined`)
        await keyboardActivate(layer)
        await client.waitFor(`document.querySelector('.workspace-detail h1')?.textContent === 'Global · user'`)
        await client.waitFor(`document.querySelector('.workspace-detail details') !== null`)
        await client.evaluate(`document.querySelector('.workspace-detail details').open = true`)
        await client.waitFor(`document.body.innerText.includes('Other top-level settings are not shown')`)
        await assertNoHorizontalOverflow()
        await shoot(`117-library-settings-${theme}-${width}`, 'What it states')
        assert.deepEqual(await leaks(), [])
        await backToLibrary()
      }
    }

    const bridge = await call(`JSON.stringify(await (async () => {
      const projects = await window.kondo.projectsList()
      const apiserver = projects.data.find((row) => row.name === 'apiserver')
      return {
        projects,
        layers: await window.kondo.settingsLayers(),
        hooks: await window.kondo.hooksList(),
        shared: await window.kondo.projectDetail('store:user:user'),
        project: await window.kondo.projectDetail(apiserver.id),
        mcp: await window.kondo.entityList('mcp'),
        journal: await window.kondo.journalList()
      }
    })())`)
    assert.deepEqual(bridge.match(/S117_\w*/g) ?? [], [])
    const responses = JSON.parse(bridge)
    assert.equal(responses.project.data.mcpServers.find((server) => server.name === 'linter').transport, 'unknown')
    assert.ok(responses.project.errors.some((error) => error.code === 'parse-failed'))
  } finally {
    await fs.writeFile(userSettings, originalUser)
    await fs.writeFile(mcpFile, originalMcp)
    await fs.rm(path.join(projectStore, 'settings.json'), { force: true })
    await fs.rm(path.join(projectStore, 'settings.local.json'), { force: true })
    await client.send('Emulation.clearDeviceMetricsOverride')
    await client.send('Emulation.setEmulatedMedia', { features: [] })
    await openThemes()
    await chooseTheme('chalk')
    await browseLibrary()
  }
  assert.deepEqual(await fixtureSnapshot(), before)
  assert.equal(await journalBytes(), journal)
})

test('file cleanup review applies once and Undo restores all fixture bytes', async () => {
  const snapshot = async (root) => {
    const files = []
    const visit = async (directory, relative = '') => {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const name = path.join(relative, entry.name)
        if (entry.isDirectory()) await visit(path.join(directory, entry.name), name)
        else files.push([name, (await fs.readFile(path.join(directory, entry.name))).toString('base64')])
      }
    }
    await visit(root)
    return files.sort(([left], [right]) => left.localeCompare(right))
  }
  const savedProjects = path.join(base, 'home', '.claude', 'projects')
  const actualProjects = path.join(base, 'work')
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  const beforeSaved = await snapshot(savedProjects)
  const beforeWork = await snapshot(actualProjects)
  const beforeJournal = (await fs.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.progressOf && !row.failedOf).length
  assert.ok(beforeSaved.length > 0)
  assert.equal((await fs.readdir(savedProjects)).length, 2)
  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  const timestamps = []
  const rememberTimes = async (at) => {
    const info = await fs.stat(at)
    timestamps.push({ at, atime: info.atime, mtime: info.mtime })
    if (info.isDirectory()) {
      for (const entry of await fs.readdir(at)) await rememberTimes(path.join(at, entry))
    }
  }
  await rememberTimes(savedProjects)
  const preview = await call(`(await window.kondo.tidyPreview()).data`)
  const old = new Date(Date.now() - (preview.staleAfterDays + 30) * 86_400_000)
  try {
    // Intentional whole-tree success: age every child and directory, not just
    // transcripts. Ordinary fresh scratch trees stay protected elsewhere.
    for (const { at } of timestamps) await fs.utimes(at, old, old)
    await navigate('Clean up')
    await section('Cleanup sections', 'Duplicate skills')
    await section('Cleanup sections', 'Files and caches')
    const checkbox = `document.querySelector('input[aria-label="Select Throwaway folders"]')`
    await client.waitFor(`${checkbox} !== null && !${checkbox}.disabled`)
    assert.equal(await client.evaluate(`${checkbox}.checked`), false)
    await client.evaluate(`${checkbox}.focus()`)
    await press(' ')
    await keyboardActivate(button('Review selected items'))
    await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
    assert.deepEqual(await snapshot(savedProjects), beforeSaved)
    await keyboardActivate(button('Move to trash'))
    const result = `document.querySelector('[aria-label="Cleanup result"]')`
    const undo = `${result}.querySelector('button[aria-label^="Undo "]')`
    await client.waitFor(`${undo} !== null && ${result}.contains(document.activeElement)`)
    assert.deepEqual(await fs.readdir(savedProjects), [])
    assert.deepEqual(await snapshot(actualProjects), beforeWork)
    assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.progressOf && !row.failedOf).length, beforeJournal + 1)
    await assertNoHorizontalOverflow()
    await assertInViewport(undo)
    await capture('cleanup-minimum-applied')

    await keyboardActivate(undo)
    await client.waitFor(`${result}.querySelector('[role="status"]')?.textContent.startsWith('Undone —')`)
    assert.deepEqual(await snapshot(savedProjects), beforeSaved)
    assert.deepEqual(await snapshot(actualProjects), beforeWork)
    assert.equal((await fs.readFile(journal, 'utf8')).trim().split('\n').map((line) => JSON.parse(line)).filter((row) => !row.progressOf && !row.failedOf).length, beforeJournal + 2)
    assert.equal(await client.evaluate(`${undo} === null`), true)
    await capture('cleanup-minimum-restored')
  } finally {
    for (const { at, atime, mtime } of timestamps) await fs.utimes(at, atime, mtime)
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('Library keeps healthy items visible when the MCP read is malformed', async () => {
  const file = path.join(base, 'work', 'apiserver', '.mcp.json')
  const original = await fs.readFile(file, 'utf8')
  try {
    await fs.writeFile(file, '{ broken MCP fixture')
    await browseLibrary()
    await client.waitFor(`document.body.textContent.includes('Some information could not be read or recognized.')`)
    await client.waitFor(`[...document.querySelectorAll('.row-item')].some((b) => b.textContent.includes('api-notes'))`)
    assert.equal(await client.evaluate(`[...document.querySelectorAll('.row-item')].some((b) => b.textContent.includes('api-notes'))`), true)
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

test('settings toggle refusal stays visible and retry preserves fixture bytes and history', async () => {
  await openGlobalSkills()
  const toggle = `document.querySelector('button[aria-label="Disable commit-writer"]')`
  const message = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'
  const alert = `[...document.querySelectorAll('main [role="alert"]')].find((element) => element.textContent === ${JSON.stringify(message)})`
  await client.waitFor(`${toggle} !== null && !${toggle}.disabled`)
  const settings = path.join(base, 'home', '.claude', 'settings.json')
  const beforeSettings = await fs.readFile(settings, 'utf8')
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  for (let attempt = 0; attempt < 2; attempt++) {
    await keyboardActivate(toggle)
    await client.waitFor(`${alert} !== undefined && document.activeElement === ${alert}`)
    await client.waitFor(`${toggle} !== null && !${toggle}.disabled`)
    assert.equal(await fs.readFile(settings, 'utf8'), beforeSettings)
    assert.deepEqual(await fixtureSnapshot(), beforeFiles)
    assert.equal(await journalBytes(), beforeJournal)
    assert.equal(await client.evaluate(`document.querySelector('.band-stamp button[aria-label^="Undo "]') === null`), true)
    assert.equal(await client.evaluate(`document.querySelector('.band-stamp [role="status"]') === null`), true)
    await assertNoHorizontalOverflow()
    await assertInViewport(alert)
  }
  await capture('settings-toggle-refused')
})

test('Themes preserves Library and Projects context and remains usable in light and dark at 900px', async () => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  await browseLibrary()
  const search = `document.querySelector('input[aria-label="Search the Library"]')`
  await client.waitFor(`!document.body.textContent.includes('Reading your Claude Code setup…')`)
  await client.evaluate(`${search}.focus(); ${search}.select()`)
  await client.send('Input.insertText', { text: 'api-notes' })
  await client.waitFor(`document.querySelectorAll('.library-item').length === 1`)
  const row = `document.querySelector('.library-item')`
  const selectedKey = await client.evaluate(`${row}.getAttribute('data-library-key')`)
  await keyboardActivate(row)
  const heading = `document.querySelector('.library-workspace .workspace-detail h1')`
  await client.waitFor(`${heading}?.textContent === 'api-notes'`)

  await client.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false })
  try {
    await openThemes()
    for (const id of ['chalk', 'carbon']) {
      await chooseTheme(id)
      const card = `${themeRadio(id)}.closest('.theme-option')`
      await client.evaluate(`${card}.scrollIntoView({ block: 'center' })`)
      await assertNoHorizontalOverflow()
      await assertInViewport(card, 180)
      await capture(`themes-${id}-minimum`)
      await navigate('Library')
      await client.waitFor(`${heading}?.textContent === 'api-notes'`)
      assert.equal(await client.evaluate(`${search}.value`), 'api-notes')
      assert.equal(await client.evaluate(`document.querySelector('.library-item[aria-current="true"]')?.getAttribute('data-library-key')`), selectedKey)
      await assertNoHorizontalOverflow()
      await assertInViewport(heading, 300)
      await capture(`theme-${id}-library-minimum`)
      await openThemes()
    }

    await openProject('apiserver')
    await section('Project sections', 'Skills')
    await client.waitFor(`document.querySelector('select[aria-label="Move to: api-notes"]') !== null`)
    await openThemes()
    await chooseTheme('chalk')
    await navigate('Projects')
    await client.waitFor(`document.querySelector('.workspace-detail h1')?.textContent.startsWith('apiserver')`)
    assert.equal(await client.evaluate(`${button('Skills', 'document.querySelector(\'nav[aria-label="Project sections"]\')')}.getAttribute('aria-current')`), 'page')
    assert.equal(await client.evaluate(`getComputedStyle(document.querySelector('.workspace-browser')).display`), 'none')
    await client.waitFor(`document.querySelector('select[aria-label="Move to: api-notes"]') !== null`)
    await assertNoHorizontalOverflow()
    assert.deepEqual(await fixtureSnapshot(), beforeFiles)
    assert.equal(await journalBytes(), beforeJournal)
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('a chosen theme survives renderer reload and application relaunch without Claude or journal writes', async () => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  await openThemes()
  await chooseTheme('carbon')
  const firstOrigin = await client.evaluate('performance.timeOrigin')
  await client.send('Page.reload')
  // A navigation briefly destroys the execution context. Retry across that
  // boundary, and require a new origin so the old page cannot satisfy it.
  const deadline = Date.now() + 30_000
  let reloaded = false
  let reloadFailure
  while (!reloaded && Date.now() < deadline) {
    try {
      await client.waitFor(`performance.timeOrigin !== ${firstOrigin} && document.documentElement.dataset.theme === 'carbon' && typeof window.kondo === 'object' && document.querySelector('button[aria-label="Themes"]') !== null`, 1000)
      reloaded = true
    } catch (cause) {
      reloadFailure = cause
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  assert.ok(reloaded, `Saved theme was not restored after reload: ${reloadFailure?.message}`)
  await openThemes()
  await waitForTheme('carbon')
  assert.equal(await client.evaluate(`${themeRadio('chalk')}.checked`), false)
  assert.deepEqual(await fixtureSnapshot(), beforeFiles)
  assert.equal(await journalBytes(), beforeJournal)

  await stop()
  await launch()
  await client.waitFor(`document.documentElement.dataset.theme === 'carbon'`)
  const restored = await call(`await window.kondo.appearanceGet()`)
  assert.deepEqual(restored.errors, [])
  assert.deepEqual(restored.data, { theme: 'carbon' })
  await openThemes()
  await waitForTheme('carbon')
  await capture('themes-carbon-relaunched')
  assert.deepEqual(await fixtureSnapshot(), beforeFiles)
  assert.equal(await journalBytes(), beforeJournal)
  await chooseTheme('chalk')
})

test('retrying an appearance save keeps keyboard focus on the checked choice through failure and recovery', async () => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = await journalBytes()
  await openThemes()
  await chooseTheme('signal')
  await client.evaluate(`document.querySelector('main').scrollTop = 0`)
  await capture('themes-signal-original-desktop')
  await client.evaluate(`${themeRadio('signal')}.closest('.theme-option').scrollIntoView({ block: 'center' })`)
  await capture('themes-signal-original-selected')
  await chooseTheme('chalk')

  const preference = path.join(base, 'kondo-data', 'appearance.json')
  const original = await fs.readFile(preference, 'utf8')
  // A directory cannot be replaced by the adapter's atomic file rename.
  // Unlike chmod, this fixture collision is reproducible on Windows too.
  await fs.unlink(preference)
  await fs.mkdir(preference)
  try {
    await client.evaluate(`${themeRadio('carbon')}.focus()`)
    await press(' ')
    const error = `document.querySelector('.theme-save-error[role="alert"]')`
    const retry = button('Save current theme again')
    const checked = `document.querySelector('input[name="kondo-theme"]:checked')`
    await client.waitFor(`${error} !== null && ${retry} !== undefined && document.documentElement.dataset.theme === 'chalk'`)
    assert.equal(await client.evaluate(`${checked}.value`), 'chalk')
    assert.equal((await fs.lstat(preference)).isDirectory(), true)

    for (let attempt = 0; attempt < 2; attempt++) {
      await keyboardActivate(retry)
      // Retry's button disappears while saving. Its replacement must not
      // steal focus back from the stable, checked native radio.
      await client.waitFor(`document.activeElement === ${checked}`)
      await client.waitFor(`${error} !== null && ${retry} !== undefined`)
      assert.equal(await client.evaluate(`document.activeElement === ${checked}`), true)
      assert.equal((await fs.lstat(preference)).isDirectory(), true)
    }
    await client.evaluate(`${error}.scrollIntoView({ block: 'center' })`)
    await capture('themes-save-retry-failure')

    // Remove only the empty directory this test created; the next keyboard
    // retry now reaches the real preference writer successfully.
    await fs.rmdir(preference)
    await keyboardActivate(retry)
    await client.waitFor(`document.activeElement === ${checked}`)
    await waitForTheme('chalk')
    await client.waitFor(`${error} === null && document.querySelector('.theme-save-status')?.textContent.includes('Chalk saved')`)
    assert.equal(await client.evaluate(`document.activeElement === ${checked}`), true)
    assert.equal(await fs.readFile(preference, 'utf8'), original)
    await capture('themes-save-retry-restored')
    assert.deepEqual(await fixtureSnapshot(), beforeFiles)
    assert.equal(await journalBytes(), beforeJournal)
  } finally {
    const entry = await fs.lstat(preference).catch((cause) => {
      if (cause.code === 'ENOENT') return null
      throw cause
    })
    if (entry?.isDirectory()) await fs.rmdir(preference)
    await fs.writeFile(preference, original)
  }
})


// These races change only the harness's disposable fixture while the actual
// renderer holds a review. No bridge override manufactures a stale response.
const staleAlert = `[...document.querySelectorAll('[role="alert"]')].find((element) => element.querySelector('h3')?.textContent === 'Review changed — nothing moved')`

const inspectStaleReview = async (flow, theme, selection, beforeFiles, beforeJournal) => {
  await client.waitFor(`${staleAlert} !== undefined && document.activeElement === ${staleAlert}`)
  assert.ok(await client.evaluate(`${staleAlert}.textContent.includes(${JSON.stringify(selection)})`))
  assert.equal(await client.evaluate(`document.querySelectorAll('main input[type="checkbox"]:checked').length`), 0)
  assert.equal(await journalBytes(), beforeJournal, 'Stale review must not append even a failed journal entry')
  assert.deepEqual(await fixtureSnapshot(), beforeFiles, 'Refusal must preserve the externally changed fixture')
  const accessibility = await client.send('Accessibility.getFullAXTree')
  assert.ok(accessibility.nodes.some((node) => node.role?.value === 'alert' && !node.ignored))
  assert.ok(accessibility.nodes.some((node) => node.role?.value === 'button' && node.name?.value === 'Return to review' && !node.ignored))
  await press('Tab')
  assert.equal(await client.evaluate(`document.activeElement === ${button('Return to review')}`), true)
  assert.equal(await client.evaluate(`getComputedStyle(document.activeElement).outlineStyle`), 'solid')
  for (const [width, height] of [[1360, 860], [900, 600]]) {
    await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    await client.evaluate(`${staleAlert}.scrollIntoView({ block: 'center' })`)
    await assertNoHorizontalOverflow()
    await assertInViewport(button('Return to review'))
    await capture(`review-stale-${flow}-${theme}-${width}x${height}`)
  }
  await keyboardActivate(button('Return to review'))
  await client.waitFor(`${staleAlert} === undefined`)
  if (flow === 'cache') {
    assert.equal(await client.evaluate(`document.activeElement?.matches('h3') && document.activeElement.textContent === '1. Choose what to clean up'`), true)
  } else assert.equal(await client.evaluate(`document.activeElement?.matches('h1, h2')`), true)
  assert.equal(await client.evaluate(`document.querySelectorAll('main input[type="checkbox"]:checked').length`), 0)
  assert.equal(await journalBytes(), beforeJournal)
}

const applyAndUndoReviewedRemoval = async (apply) => {
  const beforeFiles = await fixtureSnapshot()
  const beforeJournal = (await call(`(await window.kondo.journalList()).data`)).length
  await keyboardActivate(apply)
  const undo = `document.querySelector('main button[aria-label^="Undo "]')`
  await client.waitFor(`${undo} !== null && !${undo}.disabled`)
  assert.notDeepEqual(await fixtureSnapshot(), beforeFiles)
  assert.equal((await call(`(await window.kondo.journalList()).data`)).length, beforeJournal + 1)
  await keyboardActivate(undo)
  await client.waitFor(`[...document.querySelectorAll('main [role="status"]')].some((element) => element.textContent.startsWith('Undone —'))`)
  assert.deepEqual(await fixtureSnapshot(), beforeFiles)
  assert.equal((await call(`(await window.kondo.journalList()).data`)).length, beforeJournal + 2)
}

test('cleanup refuses a cache that appeared after review, then a fresh choice applies and undoes', async () => {
  const cache = path.join(fixtureEnv.KONDO_STORE_ROOT, 'cache')
  const appeared = path.join(fixtureEnv.KONDO_STORE_ROOT, 'debug')
  // mkdir without recursive refuses collisions rather than claiming existing fixtures.
  await fs.mkdir(cache)
  await fs.writeFile(path.join(cache, 'reviewed-cache'), 'reviewed cache fixture')
  let ownsAppeared = false
  const checkbox = `document.querySelector('input[aria-label="Select Caches Claude rebuilds"]')`
  const review = button('Review selected items')
  const selectAndReview = async () => {
    await client.waitFor(`${checkbox} !== null && !${checkbox}.disabled`)
    assert.equal(await client.evaluate(`${checkbox}.checked`), false)
    await client.evaluate(`${checkbox}.focus()`)
    await press(' ')
    // After a refusal the checkbox is usable while the preview reloads; Review is not.
    await client.waitFor(`${review} !== undefined && !${review}.disabled`)
    await keyboardActivate(review)
    await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
  }
  try {
    for (const theme of ['chalk', 'carbon']) {
      await openThemes()
      await chooseTheme(theme)
      await navigate('Clean up')
      await section('Cleanup sections', 'Files and caches')
      await selectAndReview()
      const beforeJournal = await journalBytes()
      await fs.mkdir(appeared)
      ownsAppeared = true
      await fs.writeFile(path.join(appeared, 'new-cache-not-in-review'), 'appeared after review')
      const changedFiles = await fixtureSnapshot()
      await keyboardActivate(button('Move to trash'))
      await inspectStaleReview('cache', theme, 'Caches Claude rebuilds', changedFiles, beforeJournal)
      assert.equal(await client.evaluate(`${review}.disabled`), true)
      // Explicitly choose the refreshed category. The new cache is now reviewed.
      await selectAndReview()
      await applyAndUndoReviewedRemoval(button('Move to trash'))
      await fs.rm(appeared, { recursive: true })
      ownsAppeared = false
    }
  } finally {
    if (ownsAppeared) await fs.rm(appeared, { recursive: true, force: true })
    await fs.rm(cache, { recursive: true, force: true })
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('conversation review refuses a resumed transcript, clears selection, and allows renewed review with Undo', async () => {
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const flattened = path.join(base, 'work', 'apiserver').replace(/[^a-zA-Z0-9]/g, '-')
  const transcript = path.join(fixtureEnv.KONDO_STORE_ROOT, 'projects', flattened, uuid + '.jsonl')
  const original = await fs.readFile(transcript)
  const stat = await fs.stat(transcript)
  const checkbox = `document.querySelector('input[aria-label="Select session ${uuid}"]')`
  const review = button('Move 1 conversation to trash')
  const selectAndReview = async () => {
    await client.waitFor(`${checkbox} !== null && !${checkbox}.disabled`)
    assert.equal(await client.evaluate(`${checkbox}.checked`), false)
    await client.evaluate(`${checkbox}.focus()`)
    await press(' ')
    await keyboardActivate(review)
    await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel' && ${button('Move to trash')} !== undefined`)
  }
  try {
    for (const theme of ['chalk', 'carbon']) {
      await openThemes()
      await chooseTheme(theme)
      await openProject('apiserver')
      await section('Project sections', 'Conversations')
      await selectAndReview()
      const beforeJournal = await journalBytes()
      await press('Escape')
      await client.waitFor(`document.activeElement === ${review} && ${button('Move to trash')} === undefined`)
      assert.equal(await journalBytes(), beforeJournal)
      await keyboardActivate(review)
      await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel' && ${button('Move to trash')} !== undefined`)
      await fs.appendFile(transcript, '\n' + JSON.stringify({ type: 'user', timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'Resumed fixture conversation after its removal was reviewed' } }) + '\n')
      const changedFiles = await fixtureSnapshot()
      await keyboardActivate(button('Move to trash'))
      await inspectStaleReview('session', theme, '1 conversation', changedFiles, beforeJournal)
      await client.waitFor(`${button('Pick conversations to move to trash')}?.disabled`)
      await selectAndReview()
      await applyAndUndoReviewedRemoval(button('Move to trash'))
      await fs.writeFile(transcript, original)
      await fs.utimes(transcript, stat.atime, stat.mtime)
    }
  } finally {
    await fs.writeFile(transcript, original)
    await fs.utimes(transcript, stat.atime, stat.mtime)
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('duplicate review refuses ambiguous paths and changed equivalence, and preserves renewed-review Undo', async () => {
  const name = 'reviewed-duplicate-with-a-deliberately-long-name-for-compact-window-checks'
  const global = path.join(fixtureEnv.KONDO_STORE_ROOT, 'skills', name)
  const project = path.join(base, 'work', 'apiserver', '.claude', 'skills', name)
  await fs.mkdir(global)
  let ownsProject = false
  const content = `---\nname: ${name}\ndescription: Synthetic identical copies for reviewed-removal smoke\n---\n`
  const choose = `document.querySelector('button[aria-label^="Move this copy to trash: ${name} from "]')`
  const apply = `document.querySelector('button[aria-label^="Move to trash: ${name} from "]')`
  try {
    await fs.mkdir(project)
    ownsProject = true
    await fs.writeFile(path.join(global, 'SKILL.md'), content)
    await fs.writeFile(path.join(project, 'SKILL.md'), content)
    await fs.writeFile(path.join(global, 'a'), 'bc')
    for (const theme of ['chalk', 'carbon']) {
      await fs.writeFile(path.join(project, 'ab'), 'c')
      await openThemes()
      await chooseTheme(theme)
      await navigate('Clean up')
      await section('Cleanup sections', 'Duplicate skills')
      await client.waitFor(`${choose} !== null && ${choose}.disabled`)
      const duplicates = await call(`await window.kondo.skillDuplicates()`)
      assert.deepEqual(duplicates.errors, [])
      const group = duplicates.data.find((entry) => entry.name === name)
      assert.equal(group.identical, false)
      assert.equal(group.reviewToken, null)
      assert.notEqual(group.members[0].digest, group.members[1].digest)
      const unchangedJournal = await journalBytes()
      const unchangedFiles = await fixtureSnapshot()
      const refused = await call(`await window.kondo.entityMutate('skill:user:${name}', { op: 'trash', reviewToken: 'forged' })`)
      assert.equal(refused.data, null)
      assert.equal(refused.errors[0]?.code, 'stale-plan')
      assert.equal(await journalBytes(), unchangedJournal)
      assert.deepEqual(await fixtureSnapshot(), unchangedFiles)
      assert.equal(await fs.readFile(path.join(global, 'a'), 'utf8'), 'bc')
      assert.equal(await fs.readFile(path.join(project, 'ab'), 'utf8'), 'c')
      assert.equal(await client.evaluate(`${apply} === null`), true)
      for (const [width, height] of [[1360, 860], [900, 600]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await client.evaluate(`${choose}.scrollIntoView({ block: 'center' })`)
        await assertNoHorizontalOverflow()
        await assertInViewport(choose)
        await capture(`duplicate-distinct-paths-${theme}-${width}x${height}`)
      }
      await fs.rename(path.join(project, 'ab'), path.join(project, 'a'))
      await fs.writeFile(path.join(project, 'a'), 'bc')
      await section('Cleanup sections', 'Files and caches')
      await section('Cleanup sections', 'Duplicate skills')
      await client.waitFor(`${choose} !== null && !${choose}.disabled`)
      await keyboardActivate(choose)
      await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
      const beforeJournal = await journalBytes()
      await press('Escape')
      await client.waitFor(`document.activeElement === ${choose} && ${apply} === null`)
      assert.equal(await journalBytes(), beforeJournal)
      await keyboardActivate(choose)
      await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
      await fs.appendFile(path.join(project, 'SKILL.md'), '\nChanged after reviewing the identical group.\n')
      const changedFiles = await fixtureSnapshot()
      await keyboardActivate(apply)
      await inspectStaleReview('duplicate', theme, name, changedFiles, beforeJournal)
      await client.waitFor(`${choose} !== null && ${choose}.disabled`)
      assert.equal(await client.evaluate(`${apply} === null`), true)
      // Restore equivalence, then obtain a new list and make a new explicit choice.
      await fs.writeFile(path.join(project, 'SKILL.md'), content)
      await section('Cleanup sections', 'Files and caches')
      await section('Cleanup sections', 'Duplicate skills')
      await client.waitFor(`${choose} !== null && !${choose}.disabled`)
      await keyboardActivate(choose)
      await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
      await applyAndUndoReviewedRemoval(apply)
      await fs.unlink(path.join(project, 'a'))
    }
  } finally {
    if (ownsProject) await fs.rm(project, { recursive: true, force: true })
    await fs.rm(global, { recursive: true, force: true })
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})


test('a newly created empty scratch folder is withheld and never chosen automatically', async () => {
  const flattened = path.join(base, 'work', 'recent-empty-scratch').replace(/[^a-zA-Z0-9]/g, '-')
  const folder = path.join(fixtureEnv.KONDO_STORE_ROOT, 'projects', flattened)
  await fs.mkdir(folder)
  try {
    const beforeFiles = await fixtureSnapshot()
    const beforeJournal = await journalBytes()
    await call(`await window.kondo.sessionProjects(true)`)
    await navigate('Clean up')
    await section('Cleanup sections', 'Duplicate skills')
    await section('Cleanup sections', 'Files and caches')
    await client.waitFor(`${button('Review selected items')} !== undefined`)
    const preview = await call(`(await window.kondo.tidyPreview()).data`)
    assert.equal(preview.categories.find((entry) => entry.category === 'scratch-projects').count, 0)
    assert.ok(preview.withheldScratchCount >= 1)
    assert.equal(await client.evaluate(`document.querySelectorAll('main input[type="checkbox"]:checked').length`), 0)
    assert.equal(await client.evaluate(`${button('Review selected items')}.disabled`), true)
    assert.deepEqual(await fs.readdir(folder), [])
    assert.deepEqual(await fixtureSnapshot(), beforeFiles)
    assert.equal(await journalBytes(), beforeJournal)
  } finally {
    await fs.rmdir(folder)
  }
})

test('settings cleanup preserves uncertain preferences and rechecks degraded inventory', async () => {
  const root = path.join(base, 'home', '.claude')
  const settings = path.join(root, 'settings.json')
  const manifest = path.join(root, 'plugins', 'installed_plugins.json')
  const beforeSettings = await fs.readFile(settings, 'utf8')
  const beforeManifest = await fs.readFile(manifest, 'utf8')
  const journal = path.join(base, 'kondo-data', 'journal.jsonl')
  const readJournal = () => fs.readFile(journal, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  const beforeJournal = await readJournal()
  const next = JSON.parse(beforeSettings)
  next.enabledPlugins['my-tool@skills-dir'] = false
  next.enabledPlugins['unknown@future-source'] = false
  next.skillOverrides.doctor = 'off'
  const protectedSettings = JSON.stringify(next, null, 2)
  try {
    await fs.writeFile(settings, protectedSettings)
    await navigate('Clean up')
    await section('Cleanup sections', 'Files and caches')
    await section('Cleanup sections', 'Settings leftovers')
    const ghost = `document.querySelector('input[aria-label^="Select ghost@acme "]')`
    await client.waitFor(ghost + ' !== null')
    const labels = await client.evaluate(`[...document.querySelectorAll('main input[type="checkbox"]')].map((input) => input.getAttribute('aria-label'))`)
    for (const name of ['my-tool@skills-dir', 'unknown@future-source', 'doctor', 'retired-helper']) {
      assert.ok(labels.every((label) => !label.includes(name)), name + ' must never be selectable')
    }
    await client.evaluate(ghost + '.focus()')
    await press(' ')
    await keyboardActivate(button('Review selected settings'))
    await client.waitFor(`document.activeElement?.textContent.trim() === 'Cancel'`)
    await fs.writeFile(manifest, '{broken')
    await keyboardActivate(button('Remove selected settings'))
    await client.waitFor(`document.querySelector('[role="alert"]')?.textContent.includes('No configuration orphan')`)
    await client.waitFor(ghost + ' === null')
    assert.equal(await client.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'Settings cleanup result')
    const result = await call(`await window.kondo.configOrphansPreview()`)
    assert.ok(result.errors.some((error) => error.code === 'parse-failed'))
    assert.deepEqual([...new Set(result.data.map((row) => row.kind))].sort(), ['mcp-declaration', 'project-entry'])
    const problems = `[...document.querySelectorAll('button')].find((b) => /^\\d+ problems?$/.test(b.textContent.trim()))`
    await keyboardActivate(problems)
    await client.waitFor(`document.body.textContent.includes('installed_plugins.json')`)
    await assertNoHorizontalOverflow()
    await capture('cleanup-incomplete-inventory')
    assert.equal(await fs.readFile(settings, 'utf8'), protectedSettings)
    assert.equal(await readJournal(), beforeJournal)
  } finally {
    await fs.writeFile(settings, beforeSettings)
    await fs.writeFile(manifest, beforeManifest)
  }
  // Inspect the affected reading surface in both shipped sizes and appearances.
  for (const theme of ['chalk', 'carbon']) {
    await openThemes()
    await chooseTheme(theme)
    await navigate('Clean up')
    await section('Cleanup sections', 'Settings leftovers')
    await client.waitFor(`document.querySelector('input[aria-label^="Select ghost@acme "]') !== null`)
    for (const [width, height] of [[1360, 860], [900, 600]]) {
      await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await client.evaluate("document.querySelector('main').scrollTo(0, 0); window.scrollTo(0, 0)")
      await assertNoHorizontalOverflow()
      await capture('cleanup-inventory-' + theme + '-' + width)
    }
  }
  await client.send('Emulation.clearDeviceMetricsOverride')
  await openThemes()
  await chooseTheme('chalk')
  assert.equal(await fs.readFile(settings, 'utf8'), beforeSettings)
  assert.equal(await readJournal(), beforeJournal)
})

test('inline Undo keeps a no-effect refusal retryable with focused feedback', async () => {
  const cache = path.join(fixtureEnv.KONDO_STORE_ROOT, 'cache')
  const parked = path.join(base, '099-parked-trash')
  const checkbox = `document.querySelector('input[aria-label="Select Caches Claude rebuilds"]')`
  let saved
  try {
    for (const theme of ['chalk', 'carbon']) {
      await fs.mkdir(cache)
      await fs.writeFile(path.join(cache, '099-fixture'), 'cache bytes for Undo refusal')
      const before = await fixtureSnapshot()
      await openThemes()
      await chooseTheme(theme)
      await navigate('Clean up')
      await section('Cleanup sections', 'Files and caches')
      await client.waitFor(`${checkbox} !== null && !${checkbox}.disabled`)
      await client.evaluate(`${checkbox}.focus()`)
      await press(' ')
      await keyboardActivate(button('Review selected items'))
      await keyboardActivate(button('Move to trash'))
      const banner = `document.querySelector('.band-stamp')`
      const undo = `${banner}.querySelector('button[aria-label^="Undo "]')`
      await client.waitFor(`${banner} !== null && ${undo} !== null && !${undo}.disabled`)
      const original = (await call(`(await window.kondo.journalList()).data`))[0]
      saved = path.join(fixtureEnv.KONDO_DATA_ROOT, 'trash', original.id.slice(8))
      await fs.rename(saved, parked)
      const journal = await journalBytes()
      await keyboardActivate(undo)
      await client.waitFor(`${banner}.querySelector('[role="alert"]') !== null && !${undo}.disabled`)
      assert.equal(await client.evaluate(`${banner}.querySelector('[role="status"]').textContent.startsWith('Undone')`), false)
      assert.equal(await client.evaluate(`document.activeElement === ${banner}.querySelector('[role="status"]')`), true)
      assert.equal((await call(`(await window.kondo.journalList()).data.find((row) => row.id === ${JSON.stringify(original.id)})`)).undoneBy, null)
      assert.equal(await journalBytes(), journal)
      for (const [width, height] of [[1360, 860], [900, 600]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await client.evaluate(`${banner}.scrollIntoView({ block: 'center' })`)
        await assertNoHorizontalOverflow()
        await assertInViewport(undo)
        await capture(`undo-refused-${theme}-${width}`)
      }
      await fs.rename(parked, saved)
      saved = undefined
      await keyboardActivate(undo)
      await client.waitFor(`${banner}.querySelector('[role="status"]').textContent.startsWith('Undone —')`)
      assert.equal(await client.evaluate(`${undo} === null`), true)
      assert.equal(await client.evaluate(`document.activeElement === ${banner}.querySelector('[role="status"]')`), true)
      assert.deepEqual(await fixtureSnapshot(), before)
      await fs.rm(cache, { recursive: true })
    }
  } finally {
    if (saved) await fs.rename(parked, saved)
    await fs.rm(cache, { recursive: true, force: true })
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})

test('History resumes a partial Undo after relaunch and skips the confirmed action', async () => {
  const roots = { user: fixtureEnv.KONDO_STORE_ROOT, desktop: fixtureEnv.KONDO_DESKTOP_STORE_ROOT }
  const journal = path.join(fixtureEnv.KONDO_DATA_ROOT, 'journal.jsonl')
  const cache = path.join(roots.user, 'cache')
  const debug = path.join(roots.user, 'debug')
  const endpoint = (at) => at.trashId
    ? path.join(fixtureEnv.KONDO_DATA_ROOT, 'trash', at.trashId, at.relative.replaceAll(':', '-'))
    : path.join(roots[at.store], at.relative)
  try {
    for (const theme of ['chalk', 'carbon']) {
      await fs.mkdir(cache)
      await fs.mkdir(debug)
      await fs.writeFile(path.join(cache, '099-fixture'), 'original cache bytes')
      await fs.writeFile(path.join(debug, '099-fixture'), 'original debug bytes')
      const review = await call(`await window.kondo.tidyPreview()`)
      const applied = await call(`await window.kondo.tidySweep(['reclaimable-caches'], ${JSON.stringify(review.data.reviewToken)})`)
      assert.deepEqual(applied.errors, [])
      const restored = await call(`await window.kondo.journalUndo(${JSON.stringify(applied.data.id)})`)
      assert.deepEqual(restored.errors, [])
      const rows = (await journalBytes()).trim().split('\n').map((line) => JSON.parse(line))
      const undoId = restored.data.id.slice(8)
      const intent = rows.find((row) => row.id === undoId)
      assert.equal(intent.actions.length, 2)
      const first = intent.actions[0]
      const second = intent.actions[1]
      // Build an interrupted fixture from the application's own real intent
      // and checkpoints. No production-only switch or bridge mock is involved.
      const cutoff = rows.findIndex((row) => row.progressOf === undoId && row.progress.next === 1 && row.progress.pending === null)
      assert.ok(cutoff > 0)
      await stop()
      await fs.mkdir(path.dirname(endpoint(second.from)), { recursive: true })
      await fs.rename(endpoint(second.to), endpoint(second.from))
      await fs.writeFile(journal, rows.slice(0, cutoff + 1).map((row) => JSON.stringify(row)).join('\n') + '\n')
      const changed = path.join(endpoint(first.to), '099-fixture')
      await fs.writeFile(changed, 'external edit after confirmed restoration')
      await launch()
      await openThemes()
      await chooseTheme(theme)
      await navigate('History')
      const row = `[...document.querySelectorAll('tbody tr')].find((row) => row.querySelector('button')?.getAttribute('aria-label') === ${JSON.stringify('Undo ' + applied.data.summary)})`
      const retry = `${row}.querySelector('button')`
      await client.waitFor(`${row} !== undefined && ${row}.textContent.includes('Undo incomplete')`)
      assert.equal(await client.evaluate(`${retry}.disabled`), false)
      const listed = await call(`(await window.kondo.journalList()).data`)
      assert.equal(listed.find((entry) => entry.id === applied.data.id).undoneBy, null)
      assert.equal(listed.find((entry) => entry.id === restored.data.id).outcome, 'partial')
      for (const [width, height] of [[1360, 860], [900, 600]]) {
        await client.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
        await client.evaluate(`${row}.scrollIntoView({ block: 'center' })`)
        await assertNoHorizontalOverflow()
        await assertInViewport(retry)
        await capture(`undo-partial-${theme}-${width}`)
      }
      await keyboardActivate(retry)
      await client.waitFor(`document.querySelector('[aria-label="History result"] [role="status"]')?.textContent.startsWith('restored')`)
      assert.equal(await client.evaluate(`document.activeElement?.getAttribute('aria-label')`), 'History result')
      assert.equal(await fs.readFile(changed, 'utf8'), 'external edit after confirmed restoration')
      assert.equal(await fs.readFile(path.join(endpoint(second.to), '099-fixture'), 'utf8'),
        second.to.relative === 'cache' ? 'original cache bytes' : 'original debug bytes')
      const after = await call(`(await window.kondo.journalList()).data`)
      assert.equal(after.find((entry) => entry.id === applied.data.id).undoneBy, restored.data.id)
      assert.equal(after.length, listed.length)
      await fs.rm(cache, { recursive: true })
      await fs.rm(debug, { recursive: true })
    }
  } finally {
    await fs.rm(cache, { recursive: true, force: true })
    await fs.rm(debug, { recursive: true, force: true })
    await client.send('Emulation.clearDeviceMetricsOverride')
  }
})
