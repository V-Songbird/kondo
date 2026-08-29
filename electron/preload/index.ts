import { contextBridge, ipcRenderer } from 'electron'
import {
  channels,
  type KondoApi,
  type TidyCategory,
  type ToggleOperation
} from '../../shared/contract'

/** The bridge stays dumb: one invoke per method, no logic, no state. */
const api: KondoApi = {
  storesOverview: () => ipcRenderer.invoke(channels.storesOverview),
  sessionProjects: (refresh?: boolean) =>
    ipcRenderer.invoke(channels.sessionProjects, refresh === true),
  sessionList: (projectId: string) => ipcRenderer.invoke(channels.sessionList, projectId),
  sessionDetail: (sessionId: string) => ipcRenderer.invoke(channels.sessionDetail, sessionId),
  desktopSessions: () => ipcRenderer.invoke(channels.desktopSessions),
  skillsList: () => ipcRenderer.invoke(channels.skillsList),
  skillToggle: (skillId: string, operation: ToggleOperation) =>
    ipcRenderer.invoke(channels.skillToggle, skillId, operation),
  skillMove: (skillId: string, destinationId: string) =>
    ipcRenderer.invoke(channels.skillMove, skillId, destinationId),
  pluginsList: () => ipcRenderer.invoke(channels.pluginsList),
  pluginToggle: (
    pluginId: string,
    layerId: string,
    operation: ToggleOperation,
    createLayer?: boolean
  ) =>
    ipcRenderer.invoke(channels.pluginToggle, pluginId, layerId, operation, createLayer === true),
  hooksList: () => ipcRenderer.invoke(channels.hooksList),
  settingsLayers: () => ipcRenderer.invoke(channels.settingsLayers),
  tidyPreview: () => ipcRenderer.invoke(channels.tidyPreview),
  tidySweep: (categories: TidyCategory[]) =>
    ipcRenderer.invoke(channels.tidySweep, categories),
  journalList: () => ipcRenderer.invoke(channels.journalList),
  journalUndo: (journalId: string) => ipcRenderer.invoke(channels.journalUndo, journalId),
  trashSize: () => ipcRenderer.invoke(channels.trashSize),
  trashEmpty: () => ipcRenderer.invoke(channels.trashEmpty)
}

contextBridge.exposeInMainWorld('kondo', api)
