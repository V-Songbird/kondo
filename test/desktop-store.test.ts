import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import { collector } from '../electron/main/workspace/scan'
import { desktopSessions, desktopStoreReport } from '../electron/main/workspace/desktop-store'
import { createLocator } from '../electron/main/workspace/locator'
import { makeWorld, writeFileTree, writeJson, type FixtureWorld } from './helpers'

describe('desktop store adapter', () => {
  let world: FixtureWorld
  beforeEach(async () => {
    world = await makeWorld()
    await writeFileTree(world.desktopRoot, {
      'local-agent-mode-sessions/dev-1/acct-1/local_s1.json': writeJson({ title: 'x' }),
      'local-agent-mode-sessions/dev-1/acct-1/local_s1/notes.txt': 'sidecar bytes',
      'local-agent-mode-sessions/dev-1/acct-1/artifacts.json': '[]',
      'local-agent-mode-sessions/dev-1/acct-1/cowork-gb-cache.json': '{}',
      'local-agent-mode-sessions/dev-1/acct-1/agent/state.json': '{}',
      'local-agent-mode-sessions/dev-1/acct-1/rogue.bin': 'suspicious',
      'ant-device-registry.json': '{}'
    })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('inventories desktop sessions including sidecar bytes', async () => {
    const c = collector()
    const sessions = await desktopSessions(world.locator, c)
    expect(c.errors).toEqual([])
    expect(sessions).toHaveLength(1)

    const session = sessions[0]!
    expect(session.id).toBe('session:desktop:dev-1/acct-1/s1')
    expect(session.accountId).toBe('acct-1')

    const jsonBytes = (
      await fs.stat(
        path.join(world.desktopRoot, 'local-agent-mode-sessions', 'dev-1', 'acct-1', 'local_s1.json')
      )
    ).size
    expect(session.bytes).toBe(jsonBytes + 'sidecar bytes'.length)
  })

  it('flags unrecognized account entries, tolerating known support files', async () => {
    const c = collector()
    await desktopSessions(world.locator, c)
    expect(c.unknown.some((entry) => entry.endsWith('rogue.bin'))).toBe(true)
    expect(c.unknown.some((entry) => entry.includes('artifacts'))).toBe(false)
    expect(c.unknown.some((entry) => entry.includes('cowork'))).toBe(false)
    expect(c.unknown.some((entry) => entry.endsWith('agent'))).toBe(false)
  })

  it('reports sizes for top-level entries without failing on a missing store', async () => {
    const c = collector()
    const report = await desktopStoreReport(world.locator, c)
    expect(report.exists).toBe(true)
    expect(report.entries.some((entry) => entry.name === 'ant-device-registry.json')).toBe(true)

    const missing = createLocator({
      home: world.home,
      appData: null,
      userData: world.kondoDataRoot,
      platform: 'linux',
      env: { KONDO_DESKTOP_STORE_ROOT: `${world.base}/nope` }
    })
    const gone = await desktopStoreReport(missing, collector())
    expect(gone.exists).toBe(false)
    expect(gone.entries).toEqual([])
  })
})
