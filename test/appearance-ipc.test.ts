import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channels, type AppearancePreferences } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { makeWorld, type FixtureWorld } from './helpers'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) }
}))
import { registerIpc } from '../electron/main/ipc'

describe('appearance IPC native-window notification', () => {
  let world: FixtureWorld
  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => {
    vi.restoreAllMocks()
    handlers.clear()
    await world.cleanup()
  })

  it('notifies native chrome only after a successful saved selection', async () => {
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const changed = vi.fn<(preferences: AppearancePreferences) => void>()
    registerIpc(api, changed)
    const set = handlers.get(channels.appearanceSet)!
    const get = handlers.get(channels.appearanceGet)!
    expect(await get(null)).toEqual({ data: { theme: 'chalk' }, errors: [], unknown: [] })
    expect(changed).not.toHaveBeenCalled()
    await set(null, 'carbon')
    expect(changed).toHaveBeenCalledExactlyOnceWith({ theme: 'carbon' })
    await set(null, { theme: 'slate' })
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('fixture rename denied'))
    await set(null, 'slate')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(await get(null)).toEqual({ data: { theme: 'carbon' }, errors: [], unknown: [] })
  })

  it('forwards removal review identities and opaque tokens unchanged', async () => {
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const result = { data: null, errors: [], unknown: [] }
    const preview = vi.spyOn(api, 'sessionTrashPreview').mockResolvedValue(result)
    const sessions = vi.spyOn(api, 'sessionTrash').mockResolvedValue(result)
    const sweep = vi.spyOn(api, 'tidySweep').mockResolvedValue(result)
    const mutate = vi.spyOn(api, 'entityMutate').mockResolvedValue(result)
    registerIpc(api)
    const ids = ['session:code:fixture/reviewed-session']
    const token = 'opaque-reviewed-token'
    expect(await handlers.get(channels.sessionTrashPreview)!(null, ids)).toBe(result)
    expect(preview).toHaveBeenCalledExactlyOnceWith(ids)
    expect(await handlers.get(channels.sessionTrash)!(null, ids, token)).toBe(result)
    expect(sessions).toHaveBeenCalledExactlyOnceWith(ids, token)
    expect(await handlers.get(channels.tidySweep)!(null, ['reclaimable-caches'], token)).toBe(result)
    expect(sweep).toHaveBeenCalledExactlyOnceWith(['reclaimable-caches'], token)
    const request = { op: 'trash', reviewToken: token }
    expect(await handlers.get(channels.entityMutate)!(null, 'skill:user:fixture', request)).toBe(result)
    expect(mutate).toHaveBeenCalledExactlyOnceWith('skill:user:fixture', request)
  })
})
