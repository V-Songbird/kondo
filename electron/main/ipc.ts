import { ipcMain } from 'electron'
import { channels, type KondoApi } from '../../shared/contract'

/**
 * Channel registration: one line per KondoApi method, argument types checked
 * again in the workspace (the seam is a trust boundary — renderer-supplied
 * values are validated there, ADR-0008).
 */
export function registerIpc(api: KondoApi): void {
  ipcMain.handle(channels.storesOverview, () => api.storesOverview())
  ipcMain.handle(channels.sessionProjects, (_event, refresh: unknown) =>
    api.sessionProjects(refresh === true)
  )
  ipcMain.handle(channels.sessionList, (_event, projectId: unknown) =>
    api.sessionList(String(projectId))
  )
  ipcMain.handle(channels.sessionDetail, (_event, sessionId: unknown) =>
    api.sessionDetail(String(sessionId))
  )
  ipcMain.handle(channels.desktopSessions, () => api.desktopSessions())
  ipcMain.handle(channels.skillsList, () => api.skillsList())
  ipcMain.handle(channels.pluginsList, () => api.pluginsList())
  ipcMain.handle(channels.hooksList, () => api.hooksList())
  ipcMain.handle(channels.settingsLayers, () => api.settingsLayers())
  ipcMain.handle(channels.journalList, () => api.journalList())
  ipcMain.handle(channels.journalUndo, (_event, journalId: unknown) =>
    api.journalUndo(String(journalId))
  )
  ipcMain.handle(channels.trashSize, () => api.trashSize())
}
