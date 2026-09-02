import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PlacedKind } from '../shared/contract'
import { capabilitiesFor, scopesFor } from '../electron/main/workspace/capabilities'
import { createKindContext, kinds } from '../electron/main/workspace/kinds'
import { collector } from '../electron/main/workspace/scan'
import {
  scanPlacedEntries,
  type VerifiedProject
} from '../electron/main/workspace/user-store'
import {
  flattenPath,
  makeWorld,
  placedManifest,
  skillManifest,
  writeFileTree,
  type FixtureWorld
} from './helpers'

/**
 * Placed entries (entry 024): agents, commands, rules and output styles, read
 * from the user store and from each project store. One reader covers both
 * on-disk shapes — the skill directory and the single `.md` file — so both
 * are asserted here, alongside the matrix rows that keep all four read-only.
 */

describe('placed entries: agents, commands, rules, output styles', () => {
  let world: FixtureWorld
  let workdir: string
  let projects: VerifiedProject[]

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')
    projects = [{ dirName: flattenPath(workdir), absPath: workdir }]

    await writeFileTree(world.userRoot, {
      // The frontmatter name deliberately disagrees with the filename: the
      // id must key on the file.
      'agents/reviewer.md': placedManifest('Reviews a diff', 'not-the-filename'),
      'agents/notes.txt': 'not markdown, not an entry',
      'commands/ship.md': placedManifest('Ships the branch'),
      'rules/house-style.md': placedManifest('House style'),
      'output-styles/terse.md': placedManifest('Say less'),
      // Same directory name one level down: only the top level is listed.
      'agents/nested/deep.md': placedManifest('Too deep to count'),
      // The other shape, so one world proves both.
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'First skill')
    })
    await writeFileTree(workdir, {
      '.claude/agents/scout.md': placedManifest('Project agent'),
      '.claude/commands/deploy.md': placedManifest('Project command'),
      '.claude/rules/no-any.md': placedManifest('Project rule'),
      // A project store carrying output styles is unobserved, so kondo does
      // not look for one; this file must stay invisible.
      '.claude/output-styles/loud.md': placedManifest('Never listed')
    })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  const scan = async (kind: PlacedKind): Promise<Awaited<ReturnType<typeof scanPlacedEntries>>> => {
    const c = collector()
    const entries = await scanPlacedEntries(world.locator, kind, projects, c)
    expect(c.errors).toEqual([])
    return entries
  }

  it('gives every kind ADR-0008 composite ids in both scopes', async () => {
    const flat = flattenPath(workdir)
    expect((await scan('agent')).map((entry) => entry.id)).toEqual([
      `agent:project/${flat}:scout`,
      'agent:user:reviewer'
    ])
    expect((await scan('command')).map((entry) => entry.id)).toEqual([
      `command:project/${flat}:deploy`,
      'command:user:ship'
    ])
    expect((await scan('rule')).map((entry) => entry.id)).toEqual([
      `rule:project/${flat}:no-any`,
      'rule:user:house-style'
    ])
    // Output styles are user-scope only; the project file above is not read.
    expect((await scan('output-style')).map((entry) => entry.id)).toEqual([
      'output-style:user:terse'
    ])
  })

  it('keys on the filename and takes only the description from frontmatter', async () => {
    const reviewer = (await scan('agent')).find((entry) => entry.scope === 'user')
    expect(reviewer?.name).toBe('reviewer')
    expect(reviewer?.description).toBe('Reviews a diff')
    expect(reviewer?.origin).toBe('~/.claude/agents/reviewer.md')
  })

  it('carries the owning project as a field, never as a parsed id (ADR-0008)', async () => {
    const byScope = new Map((await scan('rule')).map((entry) => [entry.scope, entry]))
    expect(byScope.get('user')?.projectId).toBeNull()
    expect(byScope.get('project')?.projectId).toBe(`project:code:${flattenPath(workdir)}`)
  })

  it('lists only the top level, and only markdown', async () => {
    const names = (await scan('agent')).map((entry) => entry.name)
    expect(names).not.toContain('deep')
    expect(names).not.toContain('nested')
    expect(names).not.toContain('notes')
  })

  it('reads both on-disk shapes through the one reader', async () => {
    const c = collector()
    const context = createKindContext({
      locator: world.locator,
      c,
      now: Date.now(),
      inventory: async () => {
        throw new Error('no kind here reads the session inventory')
      },
      projects: async () => projects
    })
    // Shape two: a single `.md` file.
    const agents = (await kinds.agent.discover(context)) ?? []
    expect(agents.map((entry) => entry.name).sort()).toEqual(['reviewer', 'scout'])
    // Shape one: a directory with a SKILL.md, off the same reader.
    const skills = (await kinds.skill.discover(context)) ?? []
    expect(skills.map((skill) => skill.name)).toContain('alpha-skill')
    expect(c.errors).toEqual([])

    expect((await kinds.agent.read('agent:user:reviewer', context))?.name).toBe('reviewer')
    expect(await kinds.agent.read('agent:user:absent', context)).toBeNull()
  })

  it('refuses enable, disable and move in every scope (ADR-0006)', async () => {
    for (const kind of ['agent', 'command', 'rule', 'output-style'] as const) {
      for (const scope of scopesFor(kind)) {
        const row = capabilitiesFor(kind, scope)
        expect(row.enable.allowed, `${kind}/${scope}`).toBe(false)
        expect(row.disable.allowed, `${kind}/${scope}`).toBe(false)
        expect(row.move.allowed, `${kind}/${scope}`).toBe(false)
        expect(row.enable.reason).toContain('no convention')
        expect(row.move.reason).toContain('does not move')
      }
      for (const entry of await scan(kind)) {
        expect(entry.capabilities).toEqual(capabilitiesFor(kind, entry.scope))
      }
    }
    // The registry's seats stay unwired, so no plan can be built either.
    const agent = (await scan('agent'))[0]!
    expect(kinds.agent.enable(agent)).toBeNull()
    expect(kinds.agent.disable(agent)).toBeNull()
  })

  it('degrades on missing directories and malformed frontmatter (ADR-0005)', async () => {
    const empty = await makeWorld()
    const c = collector()
    expect(await scanPlacedEntries(empty.locator, 'rule', [], c)).toEqual([])
    expect(c.errors).toEqual([])
    await empty.cleanup()

    // No fence, and a fence that never closes: neither is an error, and the
    // entry is still listed with a null description.
    await writeFileTree(world.userRoot, {
      'rules/bare.md': '# Just a heading\n',
      'rules/broken.md': '---\ndescription: unterminated\n'
    })
    const rules = await scan('rule')
    const byName = new Map(rules.map((entry) => [entry.name, entry]))
    expect(byName.get('bare')?.description).toBeNull()
    expect(byName.get('broken')?.description).toBeNull()
    expect(byName.get('house-style')?.description).toBe('House style')
  })

  it('ignores a directory named like an entry, silently', async () => {
    // Claude would not load it either, so it is not an entry and not an
    // error — the rest of the directory still comes back whole.
    await fs.mkdir(path.join(world.userRoot, 'commands', 'impostor.md'), { recursive: true })
    const commands = await scan('command')
    expect(commands.map((entry) => entry.name).sort()).toEqual(['deploy', 'ship'])
  })
})
