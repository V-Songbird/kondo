import { app, BrowserWindow, session } from 'electron'
import os from 'node:os'
import path from 'node:path'
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

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void window.loadURL(devUrl)
  else void window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'))
}

void app.whenReady().then(() => {
  applyContentSecurityPolicy()

  const locator = createLocator({
    home: os.homedir(),
    appData: process.env['APPDATA'] ?? null,
    // Kondo's own footprint (ADR-0001): the journal and the trash live here,
    // and Electron guarantees it is outside any Claude store.
    userData: app.getPath('userData'),
    platform: process.platform,
    env: process.env
  })
  registerIpc(createWorkspace({ locator, platform: process.platform }))

  createMainWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
