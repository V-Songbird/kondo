import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { slashed } from '../electron/main/workspace/display'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi, McpServerInfo, ScanError } from '../shared/contract'
import { capabilitiesFor } from '../electron/main/workspace/capabilities'
import { createKindContext, kinds } from '../electron/main/workspace/kinds'
import { applyEdits } from '../electron/main/workspace/mutations'
import { collector } from '../electron/main/workspace/scan'
import { scanSessionInventory } from '../electron/main/workspace/sessions'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { readSettingsLayers, scanMcpServers, type VerifiedProject } from '../electron/main/workspace/user-store'
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
 *
 * The registry path of a local declaration has three answers, not two (entry
 * 135): there, gone, and could-not-look. Only the second is an orphan.
 */

const SETTINGS_REFUSAL = 'Settings changes are temporarily unavailable because Kondo cannot safely exclude concurrent Claude writes. No files were changed.'

describe('mcp server discovery', () => {
  let world: FixtureWorld
  let live: string
  let dead: string
  let sealed: string
  let projects: VerifiedProject[]

  beforeEach(async () => {
    world = await makeWorld()
    live = path.join(world.base, 'work', 'live')
    // Never created on disk: a project Claude still remembers and the user
    // has since deleted — the orphan case.
    dead = path.join(world.base, 'work', 'gone')
    // On disk, but `denyStat` makes the look fail with something other than
    // ENOENT — a permission kondo does not have, or a volume gone quiet. Not
    // a deleted project, and not kondo's to offer for removal (entry 135).
    sealed = path.join(world.base, 'work', 'unreadable')
    projects = [{ dirName: flattenPath(live), absPath: live }]

    await writeFileTree(live, { '.claude/settings.json': writeJson({}) })
    await fs.mkdir(sealed, { recursive: true })
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
          [dead]: { mcpServers: { 'dead-local': mcpServer() } },
          [sealed]: { mcpServers: { 'sealed-local': mcpServer() } }
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
    vi.restoreAllMocks()
    await world.cleanup()
  })

  /** Deny exactly one path its `stat`, the way a directory kondo may not enter does. */
  const denyStat = (target: string): void => {
    const real = fs.stat.bind(fs)
    vi.spyOn(fs, 'stat').mockImplementation(async (candidate) => {
      if (String(candidate) === target) {
        throw Object.assign(
          new Error(`EACCES: permission denied, stat '${target}'`),
          { code: 'EACCES' }
        )
      }
      return real(candidate)
    })
  }

  const read = async (): Promise<{ servers: McpServerInfo[]; errors: ScanError[] }> => {
    const c = collector()
    const layers = await readSettingsLayers(world.locator, projects, c)
    const servers = await scanMcpServers(world.locator, projects, layers, c)
    return { servers, errors: c.errors }
  }

  const scan = async (): Promise<Awaited<ReturnType<typeof scanMcpServers>>> => {
    const { servers, errors } = await read()
    expect(errors).toEqual([])
    return servers
  }

  it('lists the three native scopes with ADR-0008 composite ids', async () => {
    const flat = flattenPath(live)
    expect((await scan()).map((server) => server.id)).toEqual([
      `mcp:local:${flattenPath(dead)}/dead-local`,
      `mcp:local:${flat}/benched`,
      `mcp:local:${flat}/live-local`,
      `mcp:local:${flattenPath(sealed)}/sealed-local`,
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

  it('reads the per-project switch and the rejection an older registry holds', async () => {
    const status = new Map((await scan()).map((server) => [server.id, server.status]))
    const flat = flattenPath(live)
    expect(status.get(`mcp:local:${flat}/benched`)).toBe('disabled')
    expect(status.get(`mcp:local:${flat}/live-local`)).toBe('configured')
    // `disabledMcpjsonServers` in the registry entry is the shape older Claude
    // Code versions kept a rejection in, and it still rejects the server.
    expect(status.get(`mcp:project:${flat}/committed-off`)).toBe('rejected')
    // Nothing approves its sibling, so Claude Code asks before using it.
    expect(status.get(`mcp:project:${flat}/committed`)).toBe('pending')
    // A user-scope declaration is switched per project, never globally.
    expect(status.get('mcp:user:user-wide')).toBe('configured')
  })

  it('marks a declaration whose project path is gone as an orphan', async () => {
    const orphans = (await scan()).filter((server) => server.orphan)
    expect(orphans.map((server) => server.name)).toEqual(['dead-local'])
  })

  it('leaves a declaration whose project path could not be read out of the orphans', async () => {
    denyStat(sealed)
    const { servers } = await read()
    expect(servers.filter((server) => server.orphan).map((server) => server.name))
      .toEqual(['dead-local'])
  })

  it('reads a declaration whose project path could not be read as unknown, naming the folder', async () => {
    denyStat(sealed)
    const server = (await read()).servers
      .find((candidate) => candidate.name === 'sealed-local')!
    expect(server.status).toBe('unknown')
    expect(server.statusReason).toContain(slashed(sealed))
    // ADR-0022: a fixed sentence that says kondo could not look, never that
    // the folder is gone and never the errno's own text.
    expect(server.statusReason).not.toContain('gone')
    expect(server.statusReason).not.toContain('EACCES')
    expect(server.statusReason).not.toContain('permission denied')
  })

  it('itemizes the failed look beside the declarations it did read (ADR-0005)', async () => {
    denyStat(sealed)
    const { servers, errors } = await read()
    expect(errors.map((error) => [error.code, error.path]))
      .toEqual([['stat-failed', slashed(sealed)]])
    // The present and gone entries owe no error, and every scope still came back.
    expect(servers.map((server) => server.id)).toHaveLength(7)
  })

  it('refuses both switch directions for an unreadable path without naming Leftovers', async () => {
    denyStat(sealed)
    const byId = new Map((await read()).servers.map((server) => [server.id, server]))
    const server = byId.get(`mcp:local:${flattenPath(sealed)}/sealed-local`)!
    for (const decision of [server.capabilities.enable, server.capabilities.disable]) {
      expect(decision.allowed).toBe(false)
      expect(decision.reason).not.toContain('Leftovers')
      expect(decision.reason).not.toContain('gone')
    }
    // The genuinely gone one keeps the refusal that points at Leftovers.
    const orphan = byId.get(`mcp:local:${flattenPath(dead)}/dead-local`)!
    expect(orphan.capabilities.enable.reason).toContain('Leftovers')
    expect(orphan.capabilities.disable.reason).toContain('Leftovers')
  })

  it('offers only the gone project to Leftovers, never the unreadable one', async () => {
    denyStat(sealed)
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const offered = (await api.configOrphansPreview()).data ?? []
    expect(offered.map((orphan) => orphan.name)).toContain('dead-local')
    expect(offered.map((orphan) => orphan.name)).not.toContain('sealed-local')
    expect(offered.map((orphan) => orphan.source).join(' ')).not.toContain(slashed(sealed))
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
    expect(user.capabilities.disable.reason).toContain('per project')
    // A declaration whose project is gone is a leftover, not a toggle.
    const orphan = byId.get(`mcp:local:${flattenPath(dead)}/dead-local`)!
    expect(orphan.capabilities.disable.allowed).toBe(false)
    expect(orphan.capabilities.disable.reason).toContain('Leftovers')
  })

  it('degrades to a partial result on a malformed .mcp.json (ADR-0005)', async () => {
    await writeFileTree(live, { '.mcp.json': '{ not json' })
    const c = collector()
    const servers = await scanMcpServers(
      world.locator,
      projects,
      await readSettingsLayers(world.locator, projects, c),
      c
    )
    expect(c.errors.map((error) => error.code)).toEqual(['parse-failed'])
    // The registry's own scopes still came back whole.
    expect(servers.map((server) => server.scope)).toEqual(['local', 'local', 'local', 'local', 'user'])
  })

  it('answers empty rather than throwing when no registry exists at all', async () => {
    const empty = await makeWorld()
    const c = collector()
    expect(await scanMcpServers(empty.locator, [], await readSettingsLayers(empty.locator, [], c), c))
      .toEqual([])
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
    expect(user.errors[0]?.message).toContain('per project')
    expect((await api.journalList()).data).toEqual([])
  })
})

/**
 * Entry 103: approval, the per-project switch and restrictions as Claude Code
 * 2.1.271 reads them (docs/plans/103-mcp-approval-and-disable-scopes.md), over
 * fixtures built in Claude's own scopes. A switch is a correct plan plus the
 * 098 refusal, and what Kondo cannot read is `unknown` rather than on or off.
 */
describe('mcp approval and disable scopes (entry 103)', () => {
  let world: FixtureWorld
  let trusted: string
  let untrusted: string
  let plain: string
  let broken: string
  let limited: string
  let api: KondoApi
  /** A second secret shape beside the helper's `env`, for the same assertion. */
  const bearer = { headers: { Authorization: 'Bearer sk-never-surface-me' } }

  beforeEach(async () => {
    world = await makeWorld()
    const work = path.join(world.base, 'work')
    trusted = path.join(work, 'trusted')
    untrusted = path.join(work, 'untrusted')
    plain = path.join(work, 'plain')
    broken = path.join(work, 'broken')
    limited = path.join(work, 'limited')

    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({
        enabledMcpjsonServers: ['user-approved'],
        deniedMcpServers: [{ serverName: 'blocked' }]
      })
    })
    await writeFileTree(trusted, {
      '.claude/settings.json': writeJson({
        enabledMcpjsonServers: ['team-approved'],
        disabledMcpjsonServers: ['team-rejected']
      }),
      '.claude/settings.local.json': writeJson({
        enabledMcpjsonServers: ['local-approved', 'switched-off'],
        disabledMcpjsonServers: ['local-rejected']
      })
    })
    await writeFileTree(untrusted, {
      '.claude/settings.json': writeJson({ enabledMcpjsonServers: ['team-approved'] }),
      '.claude/settings.local.json': writeJson({ enabledMcpjsonServers: ['local-approved'] })
    })
    await writeFileTree(broken, { '.claude/settings.local.json': '{ not json' })
    await writeFileTree(limited, {
      '.claude/settings.json': writeJson({
        allowedMcpServers: [{ serverUrl: 'https://*.example.test/*' }]
      })
    })
    await registerMcp(
      world,
      {
        mcpServers: { 'user-wide': mcpServer(), shared: mcpServer(), 'user-off': mcpServer(bearer) },
        projects: {
          [trusted]: {
            hasTrustDialogAccepted: true,
            mcpServers: { 'local-srv': mcpServer(), 'local-off': mcpServer(), shared: mcpServer() },
            disabledMcpServers: ['local-off', 'user-off', 'switched-off'],
            // The shape older Claude Code versions kept approvals in; 2.1.271
            // migrates it into this project's settings.local.json.
            disabledMcpjsonServers: ['legacy-rejected']
          },
          [untrusted]: {},
          [plain]: { hasTrustDialogAccepted: true },
          [broken]: { hasTrustDialogAccepted: true },
          [limited]: { hasTrustDialogAccepted: true, mcpServers: { 'limited-local': mcpServer() } }
        }
      },
      {
        [trusted]: {
          mcpServers: {
            'local-rejected': mcpServer(bearer),
            'team-rejected': mcpServer(),
            'legacy-rejected': mcpServer(),
            'local-approved': mcpServer(),
            'team-approved': mcpServer(),
            'user-approved': mcpServer(),
            waiting: mcpServer(),
            blocked: mcpServer(),
            shared: mcpServer(),
            'switched-off': mcpServer()
          }
        },
        [untrusted]: {
          mcpServers: {
            'team-approved': mcpServer(),
            'local-approved': mcpServer(),
            'user-approved': mcpServer()
          }
        },
        // Registered, present, and holding no `.claude` at all (A13).
        [plain]: { mcpServers: { committed: mcpServer(), 'user-approved': mcpServer() } },
        [broken]: { mcpServers: { 'broken-srv': mcpServer() } },
        [limited]: { mcpServers: { 'user-approved': mcpServer() } }
      }
    )
    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  const id = (scope: 'local' | 'project', project: string, name: string): string =>
    `mcp:${scope}:${flattenPath(project)}/${name}`

  const projectId = (project: string): string => `project:code:${flattenPath(project)}`

  const listed = async (): Promise<Map<string, McpServerInfo>> =>
    new Map(
      (await api.entityList('mcp')).data.map((server) => [server.id, server as McpServerInfo])
    )

  it('reads a rejection that only settings.local.json states (A12)', async () => {
    const server = (await listed()).get(id('project', trusted, 'local-rejected'))
    expect(server?.status).toBe('rejected')
    expect(server?.statusReason).toContain(
      slashed(path.join(trusted, '.claude', 'settings.local.json'))
    )
  })

  it('lists a registered project that holds only .mcp.json (A13)', async () => {
    expect((await listed()).get(id('project', plain, 'committed'))?.status).toBe('pending')
    const detail = await api.projectDetail(projectId(plain))
    expect(detail.errors).toEqual([])
    expect(detail.data?.mcpServers.map((server) => server.name).sort()).toEqual([
      'committed',
      'user-approved'
    ])
    expect(detail.data?.row.counts.mcpServers).toBe(2)
  })

  it('decides each status the way Claude Code 2.1.271 decides it', async () => {
    const all = await listed()
    const status = (key: string): string | undefined => all.get(key)?.status
    expect({
      userWide: status('mcp:user:user-wide'),
      userOffGlobally: status('mcp:user:user-off'),
      local: status(id('local', trusted, 'local-srv')),
      localOff: status(id('local', trusted, 'local-off')),
      localWins: status(id('local', trusted, 'shared')),
      teamRejected: status(id('project', trusted, 'team-rejected')),
      legacyRejected: status(id('project', trusted, 'legacy-rejected')),
      localApproved: status(id('project', trusted, 'local-approved')),
      teamApproved: status(id('project', trusted, 'team-approved')),
      userApproved: status(id('project', trusted, 'user-approved')),
      waiting: status(id('project', trusted, 'waiting')),
      blocked: status(id('project', trusted, 'blocked')),
      shadowed: status(id('project', trusted, 'shared')),
      approvedAndSwitchedOff: status(id('project', trusted, 'switched-off')),
      untrustedTeamApproval: status(id('project', untrusted, 'team-approved')),
      untrustedUserApproval: status(id('project', untrusted, 'user-approved'))
    }).toEqual({
      userWide: 'configured',
      userOffGlobally: 'configured',
      local: 'configured',
      localOff: 'disabled',
      localWins: 'configured',
      teamRejected: 'rejected',
      legacyRejected: 'rejected',
      localApproved: 'approved',
      teamApproved: 'approved',
      userApproved: 'approved',
      waiting: 'pending',
      blocked: 'restricted',
      shadowed: 'overridden',
      approvedAndSwitchedOff: 'disabled',
      untrustedTeamApproval: 'pending',
      untrustedUserApproval: 'approved'
    })
    // A reason accompanies every status but the two that need none.
    for (const server of all.values()) {
      expect(server.statusReason === null, server.id).toBe(
        server.status === 'configured' || server.status === 'approved'
      )
    }
  })

  it('evaluates a user-scope declaration once per project, on that project page', async () => {
    const detail = (await api.projectDetail(projectId(trusted))).data
    expect(
      detail?.inheritedMcpServers.map((entry) => [entry.server.name, entry.status, entry.projectId])
    ).toEqual([
      ['shared', 'overridden', projectId(trusted)],
      ['user-off', 'disabled', projectId(trusted)],
      ['user-wide', 'configured', projectId(trusted)]
    ])
    const global = (await api.projectDetail('store:user:user')).data
    expect(global?.inheritedMcpServers).toEqual([])
    expect(global?.mcpServers.map((server) => [server.name, server.status])).toEqual([
      ['shared', 'configured'],
      ['user-off', 'configured'],
      ['user-wide', 'configured']
    ])
  })

  it('reports unknown where the answer lies outside what it may read', async () => {
    const listing = await api.entityList('mcp')
    const all = new Map(listing.data.map((server) => [server.id, server as McpServerInfo]))
    // Git tracking decides an untrusted project's local approval, and kondo
    // does not look outside `.claude` to find out (ADR-0002).
    expect(all.get(id('project', untrusted, 'local-approved'))?.status).toBe('unknown')
    // A settings file that does not parse may hold a rejection or a restriction.
    expect(all.get(id('project', broken, 'broken-srv'))?.status).toBe('unknown')
    expect(listing.errors).toContainEqual(
      expect.objectContaining({
        code: 'parse-failed',
        path: slashed(path.join(broken, '.claude', 'settings.local.json'))
      })
    )
    // An allowlist whose URL patterns kondo does not evaluate.
    expect(all.get(id('project', limited, 'user-approved'))?.status).toBe('unknown')
    expect(all.get(id('local', limited, 'limited-local'))?.status).toBe('unknown')

    // A registry that does not parse leaves the switch and the legacy lists unread.
    await fs.writeFile(world.locator.userConfigFile, '{ not json', 'utf8')
    const c = collector()
    const projects: VerifiedProject[] = [{ dirName: flattenPath(trusted), absPath: trusted }]
    const layers = await readSettingsLayers(world.locator, projects, c)
    const byName = new Map(
      (await scanMcpServers(world.locator, projects, layers, c)).map((server) => [
        server.name,
        server.status
      ])
    )
    expect(byName.get('local-rejected')).toBe('rejected')
    expect(byName.get('waiting')).toBe('unknown')
    expect(byName.get('local-approved')).toBe('unknown')
  })

  it('offers the per-project switch one direction at a time, and none where there is none', async () => {
    const all = await listed()
    const caps = (key: string): McpServerInfo['capabilities'] => {
      const server = all.get(key)
      if (server === undefined) throw new Error(`${key} is not in the listing`)
      return server.capabilities
    }
    expect(caps(id('local', trusted, 'local-srv')).disable.allowed).toBe(true)
    expect(caps(id('local', trusted, 'local-srv')).enable.allowed).toBe(false)
    expect(caps(id('local', trusted, 'local-off')).enable.allowed).toBe(true)
    expect(caps(id('local', trusted, 'local-off')).disable.allowed).toBe(false)
    // A server waiting for approval can still be switched off for the project;
    // approving it is the prompt Claude Code shows itself.
    expect(caps(id('project', trusted, 'waiting')).disable.allowed).toBe(true)
    expect(caps(id('project', trusted, 'waiting')).enable.allowed).toBe(false)
    expect(caps(id('project', trusted, 'waiting')).enable.reason).toContain('Claude Code')
    // The switch is a list of names, so the shadowed declaration offers none.
    const shadowed = caps(id('project', trusted, 'shared'))
    expect([shadowed.enable.allowed, shadowed.disable.allowed]).toEqual([false, false])
    expect(shadowed.disable.reason).toContain('~/.claude.json')
    // Nothing switches a user-scope declaration off everywhere.
    const global = caps('mcp:user:user-wide')
    expect([global.enable.allowed, global.disable.allowed]).toEqual([false, false])
    expect(global.disable.reason).toContain('per project')
    for (const server of all.values()) {
      expect(server.capabilities.move.allowed, server.id).toBe(false)
      expect(server.capabilities.trash.allowed, server.id).toBe(false)
    }
    const detail = (await api.projectDetail(projectId(trusted))).data
    const inherited = new Map(
      (detail?.inheritedMcpServers ?? []).map((entry) => [entry.server.name, entry.capabilities])
    )
    expect(inherited.get('user-wide')?.disable.allowed).toBe(true)
    expect(inherited.get('user-off')?.enable.allowed).toBe(true)
    expect(inherited.get('shared')?.disable.allowed).toBe(false)
  })

  it('plans every switch as one splice of that project’s disabledMcpServers', async () => {
    const registry = await fs.readFile(world.locator.userConfigFile, 'utf8')
    const inventory = (await scanSessionInventory(world.locator, process.platform)).data
    const verified: VerifiedProject[] = [trusted, untrusted, broken, limited].map((absPath) => ({
      dirName: flattenPath(absPath),
      absPath
    }))
    const switched = async (
      key: string,
      op: 'enable' | 'disable',
      targetId?: string
    ): Promise<unknown> => {
      const context = createKindContext({
        locator: world.locator,
        c: collector(),
        now: Date.now(),
        inventory: async () => inventory,
        projects: async () => verified
      })
      const entity = await kinds.mcp.read(key, context)
      if (entity === null) throw new Error(`${key} did not resolve`)
      const planned = await kinds.mcp.plan(
        entity,
        targetId === undefined ? { op } : { op, targetId },
        context
      )
      if (!planned.ok) throw new Error(planned.message)
      const [step, ...rest] = planned.plan.steps
      expect(rest).toEqual([])
      if (step === undefined || step.type !== 'splice') throw new Error('expected one splice step')
      expect(step).toMatchObject({ store: 'user-config', at: '.claude.json' })
      const after = applyEdits(registry, step.edits)
      if (after === null) throw new Error('the planned splice did not apply')
      return JSON.parse(after)
    }
    const only = (list: string[]): unknown => {
      const expected = JSON.parse(registry) as { projects: Record<string, Record<string, unknown>> }
      const entry = expected.projects[trusted]
      if (entry === undefined) throw new Error('the fixture lost its project entry')
      entry['disabledMcpServers'] = list
      return expected
    }

    // Every scope switches through the same list, and nothing else in the
    // registry moves — the legacy approval list included.
    expect(await switched(id('local', trusted, 'local-srv'), 'disable'))
      .toEqual(only(['local-off', 'user-off', 'switched-off', 'local-srv']))
    expect(await switched(id('local', trusted, 'local-off'), 'enable'))
      .toEqual(only(['user-off', 'switched-off']))
    expect(await switched(id('project', trusted, 'waiting'), 'disable'))
      .toEqual(only(['local-off', 'user-off', 'switched-off', 'waiting']))
    expect(await switched('mcp:user:user-wide', 'disable', projectId(trusted)))
      .toEqual(only(['local-off', 'user-off', 'switched-off', 'user-wide']))
    expect(await switched('mcp:user:user-off', 'enable', projectId(trusted)))
      .toEqual(only(['local-off', 'switched-off']))
  })

  it('refuses every switch under 098, leaving the fixture and History untouched', async () => {
    const before = await hashTree(world.base)
    const requests: Array<[string, 'enable' | 'disable', string | undefined]> = [
      [id('local', trusted, 'local-srv'), 'disable', undefined],
      [id('local', trusted, 'local-off'), 'enable', undefined],
      [id('project', trusted, 'waiting'), 'disable', undefined],
      ['mcp:user:user-wide', 'disable', projectId(trusted)],
      ['mcp:user:user-off', 'enable', projectId(trusted)]
    ]
    for (const [key, op, targetId] of requests) {
      const result = await api.entityMutate(key, targetId === undefined ? { op } : { op, targetId })
      expect(result.data, key).toBeNull()
      expect(result.errors, key).toEqual([
        expect.objectContaining({ code: 'not-permitted', message: SETTINGS_REFUSAL })
      ])
    }
    expect(await hashTree(world.base)).toBe(before)
    expect((await api.journalList()).data).toEqual([])
  })

  it('never carries an env or header name or value across the seam', async () => {
    const serialized = JSON.stringify([
      await api.entityList('mcp'),
      await api.projectDetail(projectId(trusted)),
      await api.projectDetail(projectId(plain)),
      await api.entityMutate(id('project', trusted, 'local-rejected'), { op: 'enable' })
    ])
    for (const secret of ['sk-never-surface-me', 'API_KEY', 'Authorization']) {
      expect(serialized, secret).not.toContain(secret)
    }
  })
})
