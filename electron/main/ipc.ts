import { ipcMain } from 'electron'
import {
  channels,
  type EntityKind,
  type KondoApi,
  type MutateRequest,
  type TidyCategory,
  type ToggleOperation
} from '../../shared/contract'

/**
 * Channel registration: one line per KondoApi method, argument types checked
 * again in the workspace (the seam is a trust boundary — renderer-supplied
 * values are validated there, ADR-0008).
 *
 * The two generic channels lead. Every kind-specific channel below them is
 * an alias the workspace forwards, kept for the views already written
 * against it; new work adds an operation, not a channel (ADR-0004).
 */
export function registerIpc(api: KondoApi): void {
  ipcMain.handle(channels.entityList, (_event, kind: unknown, parentId: unknown) =>
    api.entityList(
      kind as EntityKind,
      parentId === undefined || parentId === null ? undefined : String(parentId)
    )
  )
  ipcMain.handle(channels.entityMutate, (_event, entityId: unknown, request: unknown) =>
    api.entityMutate(String(entityId), request as MutateRequest)
  )
  ipcMain.handle(channels.projectsList, (_event, refresh: unknown) =>
    api.projectsList(refresh === true)
  )
  ipcMain.handle(channels.projectDetail, (_event, id: unknown) =>
    api.projectDetail(String(id))
  )
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
  ipcMain.handle(channels.skillToggle, (_event, skillId: unknown, operation: unknown) =>
    api.skillToggle(String(skillId), operation as ToggleOperation)
  )
  ipcMain.handle(channels.skillMove, (_event, skillId: unknown, destinationId: unknown) =>
    api.skillMove(String(skillId), String(destinationId))
  )
  ipcMain.handle(channels.pluginsList, () => api.pluginsList())
  ipcMain.handle(channels.pluginSkills, (_event, pluginId: unknown) =>
    api.pluginSkills(String(pluginId))
  )
  ipcMain.handle(
    channels.pluginToggle,
    (_event, pluginId: unknown, layerId: unknown, operation: unknown, createLayer: unknown) =>
      api.pluginToggle(
        String(pluginId),
        String(layerId),
        operation as ToggleOperation,
        createLayer === true
      )
  )
  ipcMain.handle(channels.pluginClear, (_event, pluginId: unknown, layerId: unknown) =>
    api.pluginClear(String(pluginId), String(layerId))
  )
  ipcMain.handle(channels.hooksList, () => api.hooksList())
  ipcMain.handle(channels.settingsLayers, () => api.settingsLayers())
  ipcMain.handle(channels.tidyPreview, () => api.tidyPreview())
  ipcMain.handle(channels.tidySweep, (_event, categories: unknown) =>
    api.tidySweep(categories as TidyCategory[])
  )
  ipcMain.handle(channels.configOrphansPreview, () => api.configOrphansPreview())
  ipcMain.handle(channels.configOrphansRemove, (_event, orphanIds: unknown) =>
    api.configOrphansRemove(orphanIds as string[])
  )
  ipcMain.handle(channels.journalList, () => api.journalList())
  ipcMain.handle(channels.journalUndo, (_event, journalId: unknown) =>
    api.journalUndo(String(journalId))
  )
  ipcMain.handle(channels.trashSize, () => api.trashSize())
  // Its own channel, taking no argument: the only way to empty the trash is
  // to ask for exactly that and nothing else (ADR-0001).
  ipcMain.handle(channels.trashEmpty, () => api.trashEmpty())
}
