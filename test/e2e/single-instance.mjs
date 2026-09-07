import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
import { connect, waitForPage } from '../../.claude/skills/run-kondo/cdp.mjs'
import { launchOptions, stopAppImage } from './process.mjs'

// Requires `npm run build` and a desktop display. Both processes use synthetic
// stores and the same Kondo data root, but DIFFERENT Chromium profile flags.
// A lock accidentally keyed by those flags would allow the second to survive.
const repo = fileURLToPath(new URL('../..', import.meta.url))
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const running = (child) => child.exitCode === null && child.signalCode === null

async function until(check, message, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await pause(100)
  }
  throw new Error(message)
}

function launch(binary, fixtureEnv, base, name, inspect = false) {
  const options = launchOptions(binary, electron, {
    platform: process.platform, ci: process.env.CI, port: 0,
    base: path.join(base, name)
  })
  if (inspect) options.args.push('--inspect=0')
  const env = { ...process.env, ...options.env, ...fixtureEnv }
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(binary, options.args, {
    cwd: repo, env, detached: options.detached,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  const instance = { child, appImage: options.detached, log: '', failure: null }
  child.stdout.on('data', (chunk) => { instance.log += String(chunk) })
  child.stderr.on('data', (chunk) => { instance.log += String(chunk) })
  child.on('error', (cause) => { instance.failure = cause })
  return instance
}

// Electron omits Browser.getWindowForTarget on some versions. The fixture's
// own main-process inspector can exercise native window state without adding
// a test-only API to the production bridge. Every RPC has a bounded lifetime.
async function connectInspector(endpoint) {
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error('Inspector connection timed out')) }, 5000)
    socket.addEventListener('open', () => { clearTimeout(timer); resolve() }, { once: true })
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Inspector connection failed')) }, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timer)
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  socket.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('Inspector closed before replying'))
    }
    pending.clear()
  })
  return {
    async evaluate(expression) {
      const id = ++nextId
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('Inspector evaluation timed out'))
        }, 5000)
        pending.set(id, { resolve, reject, timer })
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
          expression, returnByValue: true, awaitPromise: true
        } }))
      })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'Inspector evaluation failed')
      return result.result.value
    },
    close() { socket.close() }
  }
}

async function stop(instance, client) {
  if (!instance?.child.pid) return
  if (instance.appImage) return stopAppImage(instance.child, client)
  if (!running(instance.child)) return
  if (client) void client.send('Browser.close').catch(() => {})
  try {
    await until(() => !running(instance.child), 'Fixture did not exit cleanly', 5000)
  } catch {
    instance.child.kill()
    await until(() => !running(instance.child), 'Fixture process could not be stopped', 5000)
  }
}

test('one data root excludes a second process with a different Chromium profile', { timeout: 60_000 }, async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'kondo-single-instance-'))
  const instances = []
  let client
  let inspector
  let failure
  try {
    const fixtureEnv = JSON.parse(execFileSync(process.execPath,
      ['.claude/skills/run-kondo/fixture.mjs', base], { cwd: repo, encoding: 'utf8' }))
    for (const key of ['KONDO_STORE_ROOT', 'KONDO_DESKTOP_STORE_ROOT', 'KONDO_DATA_ROOT']) {
      assert.equal(typeof fixtureEnv[key], 'string', `Missing fixture override: ${key}`)
      const relative = path.relative(base, fixtureEnv[key])
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
        `${key} must be inside this test's disposable fixture`)
    }
    await fs.mkdir(path.join(base, 'first-profile'))
    await fs.mkdir(path.join(base, 'second-profile'))
    const binary = process.env.KONDO_E2E_BINARY ?? electron
    const first = launch(binary, fixtureEnv, base, 'first-profile', true)
    instances.push(first)
    // Port 0 lets the OS choose an unused port. Trust only the endpoint emitted
    // by our own child, and confirm its browser id before connecting to a page.
    const endpoint = await until(() => {
      if (first.failure) throw first.failure
      assert.ok(running(first.child), `First process exited during startup:\n${first.log}`)
      return first.log.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1]
    }, 'First process did not publish its own debugging endpoint', 30_000)
    const port = Number(new URL(endpoint).port)
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    assert.equal(version.webSocketDebuggerUrl, endpoint)
    client = await connect(await waitForPage(port))
    await client.waitFor('typeof window.kondo === "object" && document.querySelector(\'nav[aria-label="Main navigation"]\') !== null')
    await client.waitFor('document.visibilityState === "visible" && document.hasFocus()')
    const canonicalDataRoot = await fs.realpath(fixtureEnv.KONDO_DATA_ROOT)

    let windowId
    let nativeWindow
    try {
      ;({ windowId } = await client.send('Browser.getWindowForTarget'))
    } catch (cause) {
      if (!cause.message.includes("'Browser.getWindowForTarget' wasn't found")) throw cause
      const inspectorEndpoint = await until(() => first.log.match(/Debugger listening on (ws:\/\/127\.0\.0\.1:\d+\/[^\s]+)/)?.[1],
        'Primary fixture did not publish its own inspector endpoint', 5000)
      inspector = await connectInspector(inspectorEndpoint)
      nativeWindow = (expression) => inspector.evaluate(`(() => {
        const { app, BrowserWindow } = process.getBuiltinModule('module').createRequire(${JSON.stringify(path.join(repo, 'package.json'))})('electron');
        if (app.getPath('userData') !== ${JSON.stringify(canonicalDataRoot)}) throw new Error('Unexpected fixture data root');
        const windows = BrowserWindow.getAllWindows().filter(window => !window.webContents.getURL().endsWith('splash.html'));
        if (windows.length !== 1) throw new Error('Expected one fixture main window');
        const window = windows[0];
        return ${expression};
      })()`)
      await nativeWindow('window.minimize()')
      await until(() => nativeWindow('window.isMinimized()'), 'Primary did not minimize through its inspector')
      t.diagnostic('Native minimize verified through the primary fixture inspector; CDP window bounds are unavailable.')
    }
    if (windowId !== undefined) {
      await client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'minimized' } })
      await until(async () => (await client.send('Browser.getWindowBounds', { windowId })).bounds.windowState === 'minimized',
        'First window did not minimize')
    }

    const second = launch(binary, fixtureEnv, base, 'second-profile')
    instances.push(second)
    await until(() => {
      if (second.failure) throw second.failure
      return !running(second.child)
    }, 'Second process remained alive despite sharing KONDO_DATA_ROOT', 10_000)
    assert.equal(second.child.exitCode, 0, `Second launch failed instead of yielding the lock:\n${second.log}`)
    assert.ok(running(first.child), `First process exited:\n${first.log}`)
    await t.test('second launch restores and focuses the minimized primary', async () => {
      if (nativeWindow) {
        await until(() => nativeWindow('!window.isMinimized() && window.isVisible() && window.isFocused()'),
          'Second launch did not restore and focus the native primary window')
      } else {
        await until(async () => (await client.send('Browser.getWindowBounds', { windowId })).bounds.windowState !== 'minimized',
          'Second launch did not restore the first window')
      }
      await client.waitFor('document.visibilityState === "visible" && document.hasFocus()')
    })
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    assert.equal(pages.filter((page) => page.type === 'page').length, 1,
      'Second launch must not create another window in the primary process')
    t.diagnostic('Verified same-data-root exclusion, clean secondary exit, primary survival, and one primary page on this desktop.')
  } catch (cause) {
    failure = new Error(`${cause.message}\n${instances.map((instance, index) => `Process ${index + 1}:\n${instance.log}`).join('\n')}`, { cause })
  } finally {
    try {
      inspector?.close()
      const failures = []
      for (let index = instances.length - 1; index >= 0; index--) {
        try {
          await stop(instances[index], index === 0 ? client : null)
        } catch (cause) {
          failures.push(cause)
        }
      }
      if (failures.length) {
        failure = new AggregateError(failure ? [failure, ...failures] : failures, 'Fixture shutdown failed')
      }
    } finally {
      client?.close()
      // Never remove a fixture while a child could still be using it.
      if (instances.every(({ child }) => !child.pid || !running(child))) {
        await fs.rm(base, { recursive: true, force: true })
      } else {
        t.diagnostic(`Fixture retained because a child is still running: ${base}`)
      }
    }
  }
  if (failure) throw failure
})
