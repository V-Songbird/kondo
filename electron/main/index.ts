import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron'
import os from 'node:os'
import path from 'node:path'
import { rendererReadyChannel, type ThemeId } from '../../shared/contract'
import { THEMES } from '../../shared/themes'
import { createLocator } from './workspace/locator'
import { createWorkspace } from './workspace/workspace'
import { registerIpc } from './ipc'

/**
 * Main entry: composition root and window bootstrap only — no domain logic
 * (see docs/foundations.md). Everything OS-specific is resolved here and
 * injected into the workspace.
 */

app.setName('Kondo')

function applyContentSecurityPolicy(): void {
  // Injected as a response header (a meta tag can't differ between dev and
  // packaged). Packaged: no network at all. Dev: vite's HMR websocket and
  // react-refresh inline preamble are allowed, still nothing external.
  const policy = app.isPackaged
    ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'"
    : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; object-src 'none'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

/**
 * The splash is on screen for at least this long. The handover is honest —
 * it waits for the first read — but a store small enough to read in 40ms made
 * the splash a flash of a window rather than kondo arriving, which is worse
 * than the wait it saves.
 */
const SPLASH_MIN_MS = 900

/**
 * And no longer than this after the page has painted. The renderer's signal is
 * the real cue; this is the floor under a read that never settles, so a broken
 * store shows a broken window instead of nothing at all (ADR-0005).
 */
const SPLASH_MAX_MS = 8000

/**
 * Shown while the main window loads and takes its first read, and destroyed
 * once that read has settled. Frameless and out of the taskbar so it reads as
 * kondo arriving rather than as a second window.
 */
function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 240,
    frame: false,
    resizable: false,
    center: true,
    skipTaskbar: true,
    show: false,
    backgroundColor: '#1a1714',
    webPreferences: { sandbox: true }
  })
  loadRendererPage(splash, 'splash.html')
  splash.once('ready-to-show', () => splash.show())
  return splash
}

function loadRendererPage(window: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(`${devUrl}/${page}`)
  else void window.loadFile(path.join(import.meta.dirname, '../renderer', page))
}

const mainWindows = new Set<BrowserWindow>()

function applyWindowTheme(window: BrowserWindow, theme: ThemeId): void {
  if (window.isDestroyed()) return
  const colors = THEMES[theme].colors
  window.setBackgroundColor(colors.base)
  if (process.platform !== 'darwin') {
    window.setTitleBarOverlay({ color: colors.chrome, symbolColor: colors['chrome-ink'], height: 36 })
  }
}

function createMainWindow(theme: ThemeId): void {
  const colors = THEMES[theme].colors
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    // No OS title bar: the page's own top strip drags the window and the
    // minimise/maximise/close buttons come back as a native overlay drawn in
    // kondo's colours. Its height has to match `.titlebar` in src/index.css.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.chrome, symbolColor: colors['chrome-ink'], height: 36 },
    // The ground colour (DESIGN.md), so the first frame is already the page.
    // It has to move with `--base` in src/index.css or the window flashes the
    // old colour on every launch.
    backgroundColor: colors.base,
    // The window is held back until the first read has settled, so the splash
    // hands over to a page with rows in it rather than to a skeleton.
    show: false,
    // Packaged builds take the icon from the executable; a dev run would
    // otherwise show Electron's own.
    icon: app.isPackaged ? undefined : path.join(import.meta.dirname, '../../build/icon.png'),
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindows.add(window)
  window.once('closed', () => mainWindows.delete(window))
  const splash = createSplashWindow()
  const openedAt = Date.now()
  let handedOver = false
  const handOver = (): void => {
    if (handedOver) return
    handedOver = true
    setTimeout(
      () => {
        if (!splash.isDestroyed()) splash.destroy()
        if (!window.isDestroyed()) window.show()
      },
      Math.max(0, SPLASH_MIN_MS - (Date.now() - openedAt))
    )
  }
  // Scoped to this window's contents, so a second window cannot be shown by
  // the first one's signal.
  window.webContents.ipc.once(rendererReadyChannel, handOver)
  window.once('ready-to-show', () => setTimeout(handOver, SPLASH_MAX_MS))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  loadRendererPage(window, 'index.html')
}

void app.whenReady().then(async () => {
  applyContentSecurityPolicy()
  // Windows and Linux draw the app menu inside the window, and kondo has no
  // menu items of its own. macOS keeps it: there the system menu bar owns the
  // copy/paste accelerators.
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

  const locator = createLocator({
    home: os.homedir(),
    appData: process.env['APPDATA'] ?? null,
    // Kondo's own footprint (ADR-0001): the journal and the trash live here,
    // and Electron guarantees it is outside any Claude store.
    userData: app.getPath('userData'),
    platform: process.platform,
    env: process.env
  })
  const workspace = createWorkspace({ locator, platform: process.platform })
  // Read only app preferences before constructing a visible main window.
  // The renderer reads the same Scan and presents any fallback warning.
  let theme = (await workspace.appearanceGet()).data.theme
  nativeTheme.themeSource = THEMES[theme].appearance
  registerIpc(workspace, (preferences) => {
    theme = preferences.theme
    nativeTheme.themeSource = THEMES[theme].appearance
    for (const window of mainWindows) applyWindowTheme(window, theme)
  })

  createMainWindow(theme)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow(theme)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
