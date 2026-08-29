import { contextBridge, ipcRenderer } from 'electron'
import { channels, type KondoApi } from '../../shared/contract'

/** The bridge stays dumb: one invoke per method, no logic, no state. */
const api: KondoApi = {
  storesOverview: () => ipcRenderer.invoke(channels.storesOverview),
  sessionProjects: (refresh?: boolean) =>
    ipcRenderer.invoke(channels.sessionProjects, refresh === true),
  sessionList: (projectId: string) => ipcRenderer.invoke(channels.sessionList, projectId),
  sessionDetail: (sessionId: string) => ipcRenderer.invoke(channels.sessionDetail, sessionId),
  desktopSessions: () => ipcRenderer.invoke(channels.desktopSessions),
  skillsList: () => ipcRenderer.invoke(channels.skillsList),
  pluginsList: () => ipcRenderer.invoke(channels.pluginsList),
  hooksList: () => ipcRenderer.invoke(channels.hooksList),
  settingsLayers: () => ipcRenderer.invoke(channels.settingsLayers),
  journalList: () => ipcRenderer.invoke(channels.journalList),
  journalUndo: (journalId: string) => ipcRenderer.invoke(channels.journalUndo, journalId),
  trashSize: () => ipcRenderer.invoke(channels.trashSize)
}

contextBridge.exposeInMainWorld('kondo', api)
