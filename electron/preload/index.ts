import { contextBridge, ipcRenderer } from 'electron'
import {
  channels,
  type EntityKind,
  type KondoApi,
  type MutateRequest,
  type TidyCategory,
  type ThemeId,
  type ToggleOperation,
  rendererReadyChannel,
  rendererReloadChannel
} from '../../shared/contract'

/** The bridge stays dumb: one invoke per method, no logic, no state. */
const api: KondoApi = {
  appearanceGet: () => ipcRenderer.invoke(channels.appearanceGet),
  appearanceSet: (theme: ThemeId) => ipcRenderer.invoke(channels.appearanceSet, theme),
  profileGet: () => ipcRenderer.invoke(channels.profileGet),
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
  sessionNearDuplicates: (projectId: string) =>
    ipcRenderer.invoke(channels.sessionNearDuplicates, projectId),
  sessionTrashPreview: (ids: string[]) => ipcRenderer.invoke(channels.sessionTrashPreview, ids),
  sessionTrash: (ids: string[], reviewToken?: string) =>
    ipcRenderer.invoke(channels.sessionTrash, ids, reviewToken),
  desktopSessions: () => ipcRenderer.invoke(channels.desktopSessions),
  skillsList: () => ipcRenderer.invoke(channels.skillsList),
  skillToggle: (skillId: string, operation: ToggleOperation) =>
    ipcRenderer.invoke(channels.skillToggle, skillId, operation),
  skillMove: (skillId: string, destinationId: string) =>
    ipcRenderer.invoke(channels.skillMove, skillId, destinationId),
  skillDuplicates: () => ipcRenderer.invoke(channels.skillDuplicates),
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
  pluginMove: (
    pluginId: string,
    fromLayerId: string,
    destinationId: string,
    createLayer?: boolean
  ) =>
    ipcRenderer.invoke(
      channels.pluginMove,
      pluginId,
      fromLayerId,
      destinationId,
      createLayer === true
    ),
  hooksList: () => ipcRenderer.invoke(channels.hooksList),
  settingsLayers: () => ipcRenderer.invoke(channels.settingsLayers),
  tidyPreview: () => ipcRenderer.invoke(channels.tidyPreview),
  tidySweep: (categories: TidyCategory[], reviewToken?: string) =>
    ipcRenderer.invoke(channels.tidySweep, categories, reviewToken),
  configOrphansPreview: () => ipcRenderer.invoke(channels.configOrphansPreview),
  configOrphansRemove: (orphanIds: string[]) =>
    ipcRenderer.invoke(channels.configOrphansRemove, orphanIds),
  journalList: () => ipcRenderer.invoke(channels.journalList),
  journalUndo: (journalId: string) => ipcRenderer.invoke(channels.journalUndo, journalId),
  trashSize: () => ipcRenderer.invoke(channels.trashSize),
  trashEmpty: () => ipcRenderer.invoke(channels.trashEmpty)
}

contextBridge.exposeInMainWorld('kondo', api)

// Separate from the data bridge on purpose: this says the page is done reading,
// so the main process can retire the splash (electron/main/index.ts). Send, not
// invoke — there is no answer to wait for.
contextBridge.exposeInMainWorld('kondoReady', () => ipcRenderer.send(rendererReadyChannel))
contextBridge.exposeInMainWorld('kondoReload', () => ipcRenderer.send(rendererReloadChannel))
