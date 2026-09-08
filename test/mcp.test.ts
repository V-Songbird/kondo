import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { slashed } from '../electron/main/workspace/display'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
import { collector } from '../electron/main/workspace/scan'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { scanMcpServers, type VerifiedProject } from '../electron/main/workspace/user-store'
import {
  flattenPath,
  hashTree,
  makeWorld,
  mcpServer,
  registerMcp,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * MCP discovery (entry 023): the three native scopes, the orphan signal, and
 * the two keys that must never cross the seam. Read-only throughout — the
 * matrix row is asserted here as well, because it is what keeps the kind
 * read-only until entry 031.
 */

const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

describe('mcp server discovery', () => {
  let world: FixtureWorld
  let live: string
  let dead: string
  let projects: VerifiedProject[]

  beforeEach(async () => {
    world = await makeWorld()
    live = path.join(world.base, 'work', 'live')
    // Never created on disk: a project Claude still remembers and the user
    // has since deleted — the orphan case.
    dead = path.join(world.base, 'work', 'gone')
    projects = [{ dirName: flattenPath(live), absPath: live }]

    await writeFileTree(live, { '.claude/settings.json': writeJson({}) })
    await registerMcp(
      world,
      {
        mcpServers: { 'user-wide': mcpServer({ type: 'http', url: 'https://example.test/mcp' }) },
        projects: {
          [live]: {
            mcpServers: { 'live-local': mcpServer(), benched: mcpServer() },
            disabledMcpServers: ['benched'],
            disabledMcpjsonServers: ['committed-off'],
            // Session telemetry sitting beside them; nothing reads it.
            lastCost: 1.23
          },
          [dead]: { mcpServers: { 'dead-local': mcpServer() } }
        }
      },
      {
        [live]: {
          mcpServers: { committed: mcpServer(), 'committed-off': mcpServer() }
        }
      }
    )
  })
  afterEach(async () => {
    await world.cleanup()
  })

  const scan = async (): Promise<Awaited<ReturnType<typeof scanMcpServers>>> => {
    const c = collector()
    const servers = await scanMcpServers(world.locator, projects, c)
    expect(c.errors).toEqual([])
    return servers
  }

  it('lists the three native scopes with ADR-0008 composite ids', async () => {
    const flat = flattenPath(live)
    expect((await scan()).map((server) => server.id)).toEqual([
      `mcp:local:${flattenPath(dead)}/dead-local`,
      `mcp:local:${flat}/benched`,
      `mcp:local:${flat}/live-local`,
      `mcp:project:${flat}/committed`,
      `mcp:project:${flat}/committed-off`,
      'mcp:user:user-wide'
    ])
  })

  it('names the file each declaration came from, and the transport', async () => {
    const servers = await scan()
    const byName = new Map(servers.map((server) => [server.name, server]))
    expect(byName.get('user-wide')?.transport).toBe('http')
    expect(byName.get('user-wide')?.source).toBe('~/.claude.json')
    expect(byName.get('live-local')?.source).toBe('~/.claude.json')
    expect(byName.get('committed')?.source).toBe(slashed(path.join(live, '.mcp.json')))
    expect(byName.get('committed')?.transport).toBe('stdio')
    expect(byName.get('user-wide')?.project).toBeNull()
    expect(byName.get('live-local')?.project).toBe(flattenPath(live))
  })

  it('reads both disable lists: disabledMcpServers and disabledMcpjsonServers', async () => {
    const enabled = new Map((await scan()).map((server) => [server.id, server.enabled]))
    const flat = flattenPath(live)
    expect(enabled.get(`mcp:local:${flat}/benched`)).toBe(false)
    expect(enabled.get(`mcp:local:${flat}/live-local`)).toBe(true)
    expect(enabled.get(`mcp:project:${flat}/committed-off`)).toBe(false)
    expect(enabled.get(`mcp:project:${flat}/committed`)).toBe(true)
    // The user scope has no disable list to read, so it is never off.
    expect(enabled.get('mcp:user:user-wide')).toBe(true)
  })

  it('marks a declaration whose project path is gone as an orphan', async () => {
    const orphans = (await scan()).filter((server) => server.orphan)
    expect(orphans.map((server) => server.name)).toEqual(['dead-local'])
  })

  it('never surfaces an env or headers value, nor their key names', async () => {
    const serialized = JSON.stringify(await scan())
    expect(serialized).not.toContain('sk-never-surface-me')
    expect(serialized).not.toContain('API_KEY')
    expect(serialized).not.toContain('Authorization')
  })

  it('offers one toggle direction per project-gated server and none for the user scope (entry 061)', async () => {
    const byId = new Map((await scan()).map((server) => [server.id, server]))
    const flat = flattenPath(live)
    // Listed in the disable list: the way back on is the only toggle offered.
    const benched = byId.get(`mcp:local:${flat}/benched`)!
    expect(benched.capabilities.enable.allowed).toBe(true)
    expect(benched.capabilities.disable.allowed).toBe(false)
    // Not listed: only disable, and never a move or a trash.
    const on = byId.get(`mcp:project:${flat}/committed`)!
    expect(on.capabilities.disable.allowed).toBe(true)
    expect(on.capabilities.enable.allowed).toBe(false)
    expect(on.capabilities.move.allowed).toBe(false)
    expect(on.capabilities.trash.allowed).toBe(false)
    // The user scope has no disable list, so the matrix refuses both, with the reason.
    const user = byId.get('mcp:user:user-wide')!
    expect(user.capabilities).toEqual(capabilitiesFor('mcp', 'user'))
    expect(user.capabilities.disable.allowed).toBe(false)
    expect(user.capabilities.disable.reason).toContain('no disable list')
    // A declaration whose project is gone is a leftover, not a toggle.
    const orphan = byId.get(`mcp:local:${flattenPath(dead)}/dead-local`)!
    expect(orphan.capabilities.disable.allowed).toBe(false)
    expect(orphan.capabilities.disable.reason).toContain('Leftovers')
  })

  it('degrades to a partial result on a malformed .mcp.json (ADR-0005)', async () => {
    await writeFileTree(live, { '.mcp.json': '{ not json' })
    const c = collector()
    const servers = await scanMcpServers(world.locator, projects, c)
    expect(c.errors.map((error) => error.code)).toEqual(['parse-failed'])
    // The registry's own scopes still came back whole.
    expect(servers.map((server) => server.scope)).toEqual(['local', 'local', 'local', 'user'])
  })

  it('answers empty rather than throwing when no registry exists at all', async () => {
    const empty = await makeWorld()
    const c = collector()
    expect(await scanMcpServers(empty.locator, [], c)).toEqual([])
    expect(c.errors).toEqual([])
    await empty.cleanup()
  })
})

/**
 * MCP toggle plans target per-project disable lists in ~/.claude.json.
 * Entry 098 refuses those settings edits before touching registry or history.
 */
describe('mcp server toggle (entry 061)', () => {
  let world: FixtureWorld
  let live: string
  let api: KondoApi

  beforeEach(async () => {
    world = await makeWorld()
    live = path.join(world.base, 'work', 'live')
    await writeFileTree(live, { '.claude/settings.json': writeJson({}) })
    await registerMcp(
      world,
      {
        mcpServers: { 'user-wide': mcpServer({ type: 'http', url: 'https://example.test/mcp' }) },
        projects: {
          [live]: {
            mcpServers: { 'live-local': mcpServer(), benched: mcpServer() },
            disabledMcpServers: ['benched'],
            lastCost: 1.23
          }
        }
      },
      { [live]: { mcpServers: { committed: mcpServer() } } }
    )
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('refuses a registry-declared server toggle without changing registry or history', async () => {
    const before = await hashTree(world.base)
    const result = await api.entityMutate(`mcp:local:${flattenPath(live)}/live-local`, { op: 'disable' })
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('preserves the disabled server list when enabling is refused', async () => {
    const before = await hashTree(world.base)
    const result = await api.entityMutate(`mcp:local:${flattenPath(live)}/benched`, { op: 'enable' })
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('preserves both registry and .mcp.json when a project server toggle is refused', async () => {
    const before = await hashTree(world.base)
    const result = await api.entityMutate(`mcp:project:${flattenPath(live)}/committed`, { op: 'disable' })
    expect(result.data).toBeNull()
    expect(result.errors).toEqual([
      expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
    ])
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('refuses the direction the list already answers, and the user scope entirely', async () => {
    const twice = await api.entityMutate(`mcp:local:${flattenPath(live)}/benched`, { op: 'disable' })
    expect(twice.data).toBeNull()
    expect(twice.errors.map((error) => error.code)).toContain('not-permitted')
    const user = await api.entityMutate('mcp:user:user-wide', { op: 'disable' })
    expect(user.data).toBeNull()
    expect(user.errors[0]?.message).toContain('no disable list')
    expect((await api.journalList()).data).toEqual([])
  })
})
