import { contextBridge, ipcRenderer } from 'electron'
import {
  channels,
  type EntityKind,
  type KondoApi,
  type MutateRequest,
  type TidyCategory,
  type ToggleOperation
} from '../../shared/contract'

/** The bridge stays dumb: one invoke per method, no logic, no state. */
const api: KondoApi = {
  entityList: (kind: EntityKind, parentId?: string) =>
    ipcRenderer.invoke(channels.entityList, kind, parentId),
  entityMutate: (entityId: string, request: MutateRequest) =>
    ipcRenderer.invoke(channels.entityMutate, entityId, request),
  projectsList: (refresh?: boolean) =>
    ipcRenderer.invoke(channels.projectsList, refresh === true),
  projectDetail: (id: string) => ipcRenderer.invoke(channels.projectDetail, id),
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
  pluginSkills: (pluginId: string) => ipcRenderer.invoke(channels.pluginSkills, pluginId),
  pluginToggle: (
    pluginId: string,
    layerId: string,
    operation: ToggleOperation,
    createLayer?: boolean
  ) =>
    ipcRenderer.invoke(channels.pluginToggle, pluginId, layerId, operation, createLayer === true),
  pluginClear: (pluginId: string, layerId: string) =>
    ipcRenderer.invoke(channels.pluginClear, pluginId, layerId),
  hooksList: () => ipcRenderer.invoke(channels.hooksList),
  settingsLayers: () => ipcRenderer.invoke(channels.settingsLayers),
  tidyPreview: () => ipcRenderer.invoke(channels.tidyPreview),
  tidySweep: (categories: TidyCategory[]) =>
    ipcRenderer.invoke(channels.tidySweep, categories),
  configOrphansPreview: () => ipcRenderer.invoke(channels.configOrphansPreview),
  configOrphansRemove: (orphanIds: string[]) =>
    ipcRenderer.invoke(channels.configOrphansRemove, orphanIds),
  journalList: () => ipcRenderer.invoke(channels.journalList),
  journalUndo: (journalId: string) => ipcRenderer.invoke(channels.journalUndo, journalId),
  trashSize: () => ipcRenderer.invoke(channels.trashSize),
  trashEmpty: () => ipcRenderer.invoke(channels.trashEmpty)
}

contextBridge.exposeInMainWorld('kondo', api)
