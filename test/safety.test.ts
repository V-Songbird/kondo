import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindowConstructorOptions } from 'electron'
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

// Run the actual composition root, replacing its machine and workspace
// boundaries. No real store or machine location is resolved by this harness.
const shell = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    static windows: Window[] = []
    visible = false
    minimized = false
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      ipc: new EventEmitter(),
      setWindowOpenHandler: vi.fn()
    })
    constructor(readonly options: BrowserWindowConstructorOptions) {
      super()
      Window.windows.push(this)
    }
    isVisible = () => this.visible
    isMinimized = () => this.minimized
    isDestroyed = () => this.destroyed
    show = vi.fn(() => { this.visible = true })
    restore = vi.fn(() => { this.minimized = false; this.visible = true })
    focus = vi.fn()
    destroy = () => { this.destroyed = true; this.visible = false; this.emit('closed') }
    loadURL = vi.fn()
    loadFile = vi.fn()
    setBackgroundColor = vi.fn()
    setTitleBarOverlay = vi.fn()
  }
  const app = Object.assign(new EventEmitter(), {
    setName: vi.fn(), setPath: vi.fn(), getPath: vi.fn(() => '/fixture/profile'),
    requestSingleInstanceLock: vi.fn(() => true), quit: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()), isPackaged: false
  })
  return {
    app, Window,
    headers: vi.fn(), menu: vi.fn(), nativeTheme: { themeSource: 'light' },
    locator: vi.fn<(environment: unknown) => object>(() => ({})), workspace: vi.fn(), registerIpc: vi.fn(),
    appearanceGet: vi.fn(), mkdir: vi.fn(), realpath: vi.fn((root: string) => root)
  }
})

vi.mock('electron', () => ({
  app: shell.app, BrowserWindow: shell.Window,
  Menu: { setApplicationMenu: shell.menu }, nativeTheme: shell.nativeTheme,
  session: { defaultSession: { webRequest: { onHeadersReceived: shell.headers } } }
}))
vi.mock('node:os', () => ({ default: { homedir: () => '/fixture/home' } }))
vi.mock('node:fs', () => ({ mkdirSync: shell.mkdir, realpathSync: shell.realpath }))
vi.mock('../electron/main/workspace/locator', () => ({ createLocator: shell.locator }))
vi.mock('../electron/main/workspace/workspace', () => ({ createWorkspace: shell.workspace }))
vi.mock('../electron/main/ipc', () => ({ registerIpc: shell.registerIpc }))

describe('ADR-0004 entry-module security and lifecycle (mocked Electron)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubEnv('KONDO_DATA_ROOT', undefined)
    vi.stubEnv('ELECTRON_RENDERER_URL', undefined)
    shell.app.removeAllListeners()
    shell.Window.windows = []
    shell.app.isPackaged = false
    shell.app.requestSingleInstanceLock.mockReturnValue(true)
    shell.app.whenReady.mockResolvedValue(undefined)
    shell.appearanceGet.mockResolvedValue({ data: { theme: 'chalk' } })
    shell.workspace.mockReturnValue({ appearanceGet: shell.appearanceGet })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const start = async () => {
    await import('../electron/main/index')
    await Promise.resolve()
  }
  const showMain = async () => {
    const { rendererReadyChannel } = await import('../shared/contract')
    shell.Window.windows[0]!.webContents.ipc.emit(rendererReadyChannel)
    await vi.advanceTimersByTimeAsync(900)
    return shell.Window.windows[0]!
  }

  it('refusal quits without readiness, workspace, IPC, session or windows', async () => {
    shell.app.requestSingleInstanceLock.mockReturnValue(false)
    await start()
    expect(shell.app.requestSingleInstanceLock).toHaveBeenCalledTimes(1)
    expect(shell.app.quit).toHaveBeenCalledTimes(1)
    expect(shell.app.whenReady).not.toHaveBeenCalled()
    expect(shell.locator).not.toHaveBeenCalled()
    expect(shell.workspace).not.toHaveBeenCalled()
    expect(shell.appearanceGet).not.toHaveBeenCalled()
    expect(shell.registerIpc).not.toHaveBeenCalled()
    expect(shell.headers).not.toHaveBeenCalled()
    expect(shell.Window.windows).toHaveLength(0)
    expect(shell.app.eventNames()).toEqual([])
  })

  it('locks the canonical data override before readiness and workspace creation', async () => {
    const root = path.join(repoRoot, 'fixture-data')
    const canonical = path.join(repoRoot, 'canonical-fixture-data')
    vi.stubEnv('KONDO_DATA_ROOT', root)
    shell.realpath.mockReturnValueOnce(canonical)
    await start()
    expect(shell.mkdir).toHaveBeenCalledExactlyOnceWith(root, { recursive: true })
    expect(shell.realpath).toHaveBeenCalledExactlyOnceWith(root)
    expect(shell.app.setPath).toHaveBeenCalledExactlyOnceWith('userData', canonical)
    expect(shell.app.setPath.mock.invocationCallOrder[0])
      .toBeLessThan(shell.app.requestSingleInstanceLock.mock.invocationCallOrder[0]!)
    expect(shell.app.requestSingleInstanceLock.mock.invocationCallOrder[0])
      .toBeLessThan(shell.app.whenReady.mock.invocationCallOrder[0]!)
    expect(shell.app.whenReady.mock.invocationCallOrder[0])
      .toBeLessThan(shell.workspace.mock.invocationCallOrder[0]!)
  })

  it('retains Electron profile selection when no data override is supplied', async () => {
    await start()
    expect(shell.app.setPath).not.toHaveBeenCalled()
    expect(shell.mkdir).not.toHaveBeenCalled()
    expect(shell.locator.mock.calls[0]![0]).toMatchObject({ userData: '/fixture/profile' })
  })

  it('hardens every created window and installs denial handlers before loading', async () => {
    await start()
    expect(shell.Window.windows).toHaveLength(2)
    for (const window of shell.Window.windows) {
      expect(window.options.webPreferences).toMatchObject({
        contextIsolation: true, nodeIntegration: false, sandbox: true
      })
      const open = window.webContents.setWindowOpenHandler
      expect(open).toHaveBeenCalledTimes(1)
      expect(open.mock.calls[0]![0]({ url: 'https://example.invalid' })).toEqual({ action: 'deny' })
      const preventDefault = vi.fn()
      window.webContents.emit('will-navigate', { preventDefault }, 'https://example.invalid')
      expect(preventDefault).toHaveBeenCalledTimes(1)
      expect(open.mock.invocationCallOrder[0]).toBeLessThan(window.loadFile.mock.invocationCallOrder[0]!)
    }
  })

  it.each([
    [true, "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'"],
    [false, "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'"]
  ])('injects the actual CSP response header (packaged=%s)', async (packaged, policy) => {
    shell.app.isPackaged = packaged
    await start()
    expect(shell.headers).toHaveBeenCalledTimes(1)
    const callback = vi.fn()
    shell.headers.mock.calls[0]![0]({ responseHeaders: { Existing: ['kept'] } }, callback)
    expect(callback).toHaveBeenCalledExactlyOnceWith({
      responseHeaders: { Existing: ['kept'], 'Content-Security-Policy': [policy] }
    })
  })

  it('restores and focuses the existing main window without another workspace', async () => {
    await start()
    const window = await showMain()
    window.minimized = true
    window.visible = false
    shell.app.emit('second-instance')
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.visible).toBe(true)
    shell.app.emit('second-instance')
    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(2)
    expect(shell.workspace).toHaveBeenCalledTimes(1)
    expect(shell.Window.windows).toHaveLength(2)
  })

  it.each(['readiness', 'preferences', 'handover'])('queues focus during %s', async (phase) => {
    let release!: () => void
    if (phase === 'readiness') {
      shell.app.whenReady.mockReturnValue(new Promise<void>((resolve) => { release = resolve }))
    } else if (phase === 'preferences') {
      shell.appearanceGet.mockReturnValue(new Promise((resolve) => {
        release = () => resolve({ data: { theme: 'chalk' } })
      }))
    }
    await start()
    shell.app.emit('second-instance')
    shell.app.emit('second-instance')
    if (phase !== 'handover') {
      expect(shell.Window.windows).toHaveLength(0)
      release()
      await Promise.resolve()
      await Promise.resolve()
    }
    expect(shell.Window.windows[0]!.show).not.toHaveBeenCalled()
    const window = await showMain()
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(shell.workspace).toHaveBeenCalledTimes(1)
    expect(shell.registerIpc).toHaveBeenCalledTimes(1)
    expect(shell.Window.windows).toHaveLength(2)
  })

  it('shows a window hidden after handover instead of waiting for startup again', async () => {
    await start()
    const window = await showMain()
    window.visible = false
    shell.app.emit('second-instance')
    expect(window.visible).toBe(true)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.restore).not.toHaveBeenCalled()
    expect(shell.workspace).toHaveBeenCalledTimes(1)
    expect(shell.Window.windows).toHaveLength(2)
  })

  it.each(['second-instance', 'activate'])('reopens after closing without reinitializing (%s)', async (event) => {
    await start()
    const window = await showMain()
    window.destroy()
    shell.app.emit(event)
    shell.app.emit(event)
    expect(shell.Window.windows).toHaveLength(4)
    expect(shell.workspace).toHaveBeenCalledTimes(1)
    expect(shell.registerIpc).toHaveBeenCalledTimes(1)
  })
})

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
