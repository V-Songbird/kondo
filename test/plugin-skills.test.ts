import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import {
  flattenPath,
  makeWorld,
  placedManifest,
  registerProjects,
  skillManifest,
  writeFileTree,
  writeJson,
  type FixtureWorld
} from './helpers'

/**
 * The plugins view's child listing: a plugin's own skills, surfaced under the
 * plugin that owns them and nowhere else. Everything here runs over the whole
 * seam (`createWorkspace`), because what the entry is about is what reaches
 * the renderer — the listing, its emptiness, and the refusals that outlive it.
 */

describe("a plugin's own skills", () => {
  let world: FixtureWorld
  let api: KondoApi
  let escapedInstall: string
  let installed: Record<string, unknown>

  beforeEach(async () => {
    world = await makeWorld()
    const cache = path.join(world.userRoot, 'plugins', 'cache', 'acme')
    const alphaInstall = path.join(cache, 'alpha', '1.0.0')
    const quietInstall = path.join(cache, 'quiet', '1.0.0')
    escapedInstall = path.join(world.base, 'outside-the-store', 'omega', '1.0.0')

    // The escaping plugin is not in the manifest yet: its refusal is reported
    // wherever the manifest is read, so leaving it here would put an
    // out-of-store error in every scan below. The one test about it plants it.
    installed = {
      'alpha@acme': [{ scope: 'user', installPath: alphaInstall, version: '1.0.0' }],
      'quiet@acme': [{ scope: 'user', installPath: quietInstall, version: '1.0.0' }]
    }
    await writeFileTree(world.userRoot, {
      'settings.json': writeJson({ enabledPlugins: { 'alpha@acme': true } }),
      // A skill the user placed by hand, so the two catalogues can be told
      // apart by more than one being empty.
      'skills/alpha-skill/SKILL.md': skillManifest('alpha-skill', 'Placed by the user'),
      'plugins/installed_plugins.json': writeJson({ version: 2, plugins: installed })
    })
    await writeFileTree(alphaInstall, {
      'skills/gamma-skill/SKILL.md': skillManifest('gamma-skill', 'Ships with alpha'),
      'skills/delta-skill/SKILL.md': skillManifest('delta-skill', 'Also ships with alpha'),
      // Neither a skill nor an error: a directory with no manifest is skipped.
      'skills/not-a-skill/README.md': 'no manifest here'
    })
    // Installed, real, and ships nothing at all — no `skills/`, no `commands/`.
    await writeFileTree(quietInstall, { 'README.md': '# quiet' })
    await writeFileTree(escapedInstall, {
      'skills/rogue-skill/SKILL.md': skillManifest('rogue-skill', 'Must never be read')
    })

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('lists the skills a plugin ships, under that plugin', async () => {
    const scan = await api.pluginSkills('plugin:alpha@acme')
    expect(scan.errors).toEqual([])
    expect(scan.data.map((skill) => skill.id)).toEqual([
      'skill:plugin/alpha@acme:delta-skill',
      'skill:plugin/alpha@acme:gamma-skill'
    ])

    const gamma = scan.data.find((skill) => skill.name === 'gamma-skill')!
    expect(gamma.description).toBe('Ships with alpha')
    expect(gamma.scope).toBe('plugin')
    expect(gamma.kind).toBe('skill')
    // A directory without a SKILL.md is not a skill, and not a complaint.
    expect(scan.data.some((skill) => skill.name === 'not-a-skill')).toBe(false)
  })

  it('renders a plugin that ships no skills as empty, not as an error', async () => {
    const scan = await api.pluginSkills('plugin:quiet@acme')
    expect(scan.data).toEqual([])
    // ENOENT on the skills directory is the ordinary answer for a plugin that
    // ships none — nothing for the view to apologise for.
    expect(scan.errors).toEqual([])
  })

  it('refuses every operation on a plugin-shipped skill (ADR-0006)', async () => {
    const scan = await api.pluginSkills('plugin:alpha@acme')
    const gamma = scan.data.find((skill) => skill.name === 'gamma-skill')!

    for (const operation of ['enable', 'disable', 'move'] as const) {
      expect(gamma.capabilities[operation].allowed, operation).toBe(false)
      expect(gamma.capabilities[operation].reason, operation).toContain('follow their plugin')
    }

    // And the seam holds the same line: neither mutation gets a journal entry.
    const disabled = await api.skillToggle(gamma.id, 'disable')
    expect(disabled.data).toBeNull()
    expect(disabled.errors).not.toEqual([])
    const moved = await api.skillMove(gamma.id, 'user')
    expect(moved.data).toBeNull()
    expect(moved.errors).not.toEqual([])
    expect((await api.journalList()).data).toEqual([])
  })

  it('keeps plugin-shipped skills out of the Skills tab', async () => {
    const skills = await api.skillsList()
    expect(skills.data.map((skill) => skill.name)).toEqual(['alpha-skill'])
    expect(skills.data.some((skill) => skill.scope === 'plugin')).toBe(false)
  })

  it('follows no installPath that escaped the user store', async () => {
    installed['omega@acme'] = [
      { scope: 'user', installPath: escapedInstall, version: '1.0.0' }
    ]
    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({ version: 2, plugins: installed })
    })
    const readdir = vi.spyOn(fsp, 'readdir')
    const scan = await api.pluginSkills('plugin:omega@acme')

    expect(scan.data).toEqual([])
    // The pointer was refused where it was resolved, so the listing says why
    // rather than silently answering empty (ADR-0005).
    expect(scan.errors.map((error) => error.code)).toEqual(['out-of-store'])
    for (const call of readdir.mock.calls) {
      expect(String(call[0])).not.toContain('outside-the-store')
    }
  })

  it('answers an id no scan produced with unknown-id, and a bad one as such', async () => {
    const missing = await api.pluginSkills('plugin:not-installed@acme')
    expect(missing.data).toEqual([])
    expect(missing.errors[0]?.code).toBe('unknown-id')

    const malformed = await api.pluginSkills('skill:user:alpha-skill')
    expect(malformed.data).toEqual([])
    expect(malformed.errors[0]?.code).toBe('bad-request')
  })

  it('reads no SKILL.md until a plugin is actually opened (ADR-0007)', async () => {
    const readFile = vi.spyOn(fsp, 'readFile')
    await api.pluginsList()
    const manifests = () =>
      readFile.mock.calls.filter((call) => String(call[0]).endsWith('SKILL.md'))
    expect(manifests()).toEqual([])

    await api.pluginSkills('plugin:alpha@acme')
    // Resolution rejects the absent not-a-skill/SKILL.md before a content
    // open. Only the two manifests that exist are read, still lazily.
    expect(manifests().length).toBe(2)
    for (const call of manifests()) {
      expect(String(call[0])).toContain(path.join('acme', 'alpha', '1.0.0'))
    }
  })
})

/**
 * Every component layout the plan admits, one fixture each: the default
 * `skills/`, a manifest `skills` path beside it, a manifest `commands` path
 * that replaces the default, the default `commands/`, and the two shapes that
 * must be itemized rather than answered empty.
 */
describe('the component layouts a plugin may ship through', () => {
  let world: FixtureWorld
  let api: KondoApi
  let cache: string

  const install = (name: string): string => path.join(cache, name, '1.0.0')

  const skills = async (id: string): Promise<string[]> =>
    (await api.pluginSkills(id)).data.map((skill) => skill.name)

  beforeEach(async () => {
    world = await makeWorld()
    cache = path.join(world.userRoot, 'plugins', 'cache', 'acme')
    const entry = (name: string): unknown[] => [
      { scope: 'user', installPath: install(name), version: '1.0.0' }
    ]

    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: Object.fromEntries(
          ['extra', 'swapped', 'classic', 'onefile', 'rooted', 'broken', 'mapped', 'astray'].map(
            (name) => [`${name}@acme`, entry(name)]
          )
        )
      })
    })

    // `skills` adds to the default rather than replacing it.
    await writeFileTree(install('extra'), {
      '.claude-plugin/plugin.json': writeJson({ name: 'extra', skills: ['./more-skills'] }),
      'skills/default-one/SKILL.md': skillManifest('default-one', 'From skills/'),
      'more-skills/extra-one/SKILL.md': skillManifest('extra-one', 'From the manifest path')
    })

    // `commands` replaces the default: `commands/` is not auto-loaded.
    await writeFileTree(install('swapped'), {
      '.claude-plugin/plugin.json': writeJson({ name: 'swapped', commands: './elsewhere' }),
      'commands/ignored.md': placedManifest('Not loaded once commands is set'),
      'elsewhere/chosen.md': placedManifest('Loaded instead')
    })

    // No manifest at all: `commands/` loads as command-backed skills.
    await writeFileTree(install('classic'), {
      'commands/deploy.md': placedManifest('A command-backed skill'),
      'skills/paired/SKILL.md': skillManifest('paired', 'Beside the commands')
    })

    // A `commands` entry naming one file, and one naming a skill directory.
    await writeFileTree(install('onefile'), {
      '.claude-plugin/plugin.json': writeJson({
        name: 'onefile',
        commands: ['./bin/solo.md', './bundled']
      }),
      'bin/solo.md': placedManifest('One named command file'),
      'bundled/SKILL.md': skillManifest('bundled', 'A skill directory named by commands')
    })

    // `.` denotes the plugin root itself.
    await writeFileTree(install('rooted'), {
      '.claude-plugin/plugin.json': writeJson({ name: 'rooted', skills: '.' }),
      'at-the-root/SKILL.md': skillManifest('at-the-root', 'Under the plugin root')
    })

    // An unreadable manifest must not hide the default directory.
    await writeFileTree(install('broken'), {
      '.claude-plugin/plugin.json': '{ not json at all',
      'skills/survivor/SKILL.md': skillManifest('survivor', 'Still listed')
    })

    // The object form of `commands` is a source kondo does not read.
    await writeFileTree(install('mapped'), {
      '.claude-plugin/plugin.json': writeJson({
        name: 'mapped',
        commands: { about: { source: './about.md' } }
      }),
      'about.md': placedManifest('Named through the object form'),
      'skills/reachable/SKILL.md': skillManifest('reachable', 'Listed anyway')
    })

    // A manifest path that leaves the install directory is refused.
    await writeFileTree(install('astray'), {
      '.claude-plugin/plugin.json': writeJson({ name: 'astray', skills: ['../../../../outside'] }),
      'skills/inside/SKILL.md': skillManifest('inside', 'The one that is readable')
    })
    await writeFileTree(path.join(world.userRoot, 'plugins', 'outside'), {
      'trespasser/SKILL.md': skillManifest('trespasser', 'Must never be read')
    })

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanup()
  })

  it('adds a manifest skills path to the default directory', async () => {
    expect(await skills('plugin:extra@acme')).toEqual(['default-one', 'extra-one'])
    expect((await api.pluginSkills('plugin:extra@acme')).errors).toEqual([])
  })

  it('lets a manifest commands path replace the default commands directory', async () => {
    expect(await skills('plugin:swapped@acme')).toEqual(['chosen'])
  })

  it('reads commands/ as command-backed skills when no manifest sets one', async () => {
    expect(await skills('plugin:classic@acme')).toEqual(['deploy', 'paired'])
    const deploy = (await api.pluginSkills('plugin:classic@acme')).data
      .find((skill) => skill.name === 'deploy')!
    expect(deploy.description).toBe('A command-backed skill')
    expect(deploy.scope).toBe('plugin')
    expect(deploy.origin.endsWith('commands/deploy.md')).toBe(true)
  })

  it('reads a commands entry naming one file, and one naming a skill directory', async () => {
    expect(await skills('plugin:onefile@acme')).toEqual(['bundled', 'solo'])
  })

  it('treats "." as the plugin root itself', async () => {
    expect(await skills('plugin:rooted@acme')).toEqual(['at-the-root'])
  })

  it('itemizes an unreadable manifest and still lists the default directory', async () => {
    const scan = await api.pluginSkills('plugin:broken@acme')
    expect(scan.data.map((skill) => skill.name)).toEqual(['survivor'])
    expect(scan.errors.map((error) => error.code)).toEqual(['parse-failed'])
    // ADR-0022: no parser text and no file content cross the seam.
    expect(scan.errors[0]?.message).toBe(
      'The plugin manifest is not valid JSON, so only the default component directories were listed.'
    )
  })

  it('itemizes a commands shape it does not read rather than answering empty', async () => {
    const scan = await api.pluginSkills('plugin:mapped@acme')
    expect(scan.data.map((skill) => skill.name)).toEqual(['reachable'])
    expect(scan.errors.map((error) => error.code)).toEqual(['parse-failed'])
    expect(scan.errors[0]?.message).toContain('"commands"')
    expect(scan.errors[0]?.message).toContain('does not read')
  })

  it('refuses a manifest path that leaves the install directory, and reads nothing there', async () => {
    const readdir = vi.spyOn(fsp, 'readdir')
    const scan = await api.pluginSkills('plugin:astray@acme')

    expect(scan.data.map((skill) => skill.name)).toEqual(['inside'])
    expect(scan.errors.map((error) => error.code)).toEqual(['out-of-store'])
    for (const call of readdir.mock.calls) {
      expect(String(call[0])).not.toContain(`${path.sep}outside`)
    }
  })
})

describe('a plugin installed in more than one place', () => {
  let world: FixtureWorld
  let api: KondoApi
  let workdir: string

  const cacheAt = (version: string): string =>
    path.join(world.userRoot, 'plugins', 'cache', 'acme', 'multi', version)

  beforeEach(async () => {
    world = await makeWorld()
    workdir = path.join(world.base, 'work', 'proj')

    // Deliberately written with the file's array in a different order from the
    // documented one, so array position alone cannot pass these.
    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'multi@acme': [
            { scope: 'local', projectPath: workdir, installPath: cacheAt('3.0.0'), version: '3.0.0' },
            { scope: 'user', installPath: cacheAt('1.0.0'), version: '1.0.0' },
            { scope: 'project', projectPath: workdir, installPath: cacheAt('2.0.0'), version: '2.0.0' }
          ]
        }
      })
    })
    await writeFileTree(cacheAt('1.0.0'), {
      'skills/shared/SKILL.md': skillManifest('shared', 'From the user install'),
      'skills/only-old/SKILL.md': skillManifest('only-old', 'Only in 1.0.0')
    })
    await writeFileTree(cacheAt('2.0.0'), {
      'skills/shared/SKILL.md': skillManifest('shared', 'From the project install')
    })
    await writeFileTree(cacheAt('3.0.0'), {
      'skills/only-new/SKILL.md': skillManifest('only-new', 'Only in 3.0.0')
    })
    await writeFileTree(workdir, { '.claude/settings.json': '{}' })
    await registerProjects(world, [workdir])

    api = createWorkspace({ locator: world.locator, platform: process.platform })
  })
  afterEach(async () => {
    await world.cleanup()
  })

  it('keeps every record, in the documented order, with no record hiding another', async () => {
    const multi = (await api.pluginsList()).data.find((row) => row.id === 'plugin:multi@acme')!
    expect(multi.installations.map((place) => [place.scope, place.version])).toEqual([
      ['user', '1.0.0'],
      ['project', '2.0.0'],
      ['local', '3.0.0']
    ])
    expect(multi.installations.every((place) => place.followed)).toBe(true)
    expect(multi.installations[1]?.projectPath).toBe(multi.installations[2]?.projectPath)
    expect(multi.installations[1]?.projectPath).not.toBeNull()
    expect(multi.installations[0]?.projectPath).toBeNull()
  })

  it('shows the first installation under that order, not the file order', async () => {
    const multi = (await api.pluginsList()).data.find((row) => row.id === 'plugin:multi@acme')!
    expect(multi.version).toBe('1.0.0')
    expect(multi.installScope).toBe('user')
    expect(multi.installPath.endsWith('1.0.0')).toBe(true)
  })

  it('lists the skills of every installation, and a shared name once', async () => {
    const scan = await api.pluginSkills('plugin:multi@acme')
    expect(scan.errors).toEqual([])
    expect(scan.data.map((skill) => skill.name)).toEqual(['only-new', 'only-old', 'shared'])
    // The first installation under the order wins the duplicate, as Claude
    // keeps the first copy it loaded.
    expect(scan.data.find((skill) => skill.name === 'shared')?.description).toBe(
      'From the user install'
    )
  })

  it('keeps a record pointing into a project store without ever reading it', async () => {
    // ADR-0002: a plugin's code lives under the user store. A record naming a
    // path inside a verified project store is still a fact of the manifest, so
    // it is kept and refused rather than followed — the project tree is not
    // kondo's to walk, however the record is scoped.
    const inProject = path.join(workdir, '.claude', 'plugins', 'multi', '4.0.0')
    await writeFileTree(inProject, {
      'skills/off-limits/SKILL.md': skillManifest('off-limits', 'Must never be read')
    })
    await writeFileTree(world.userRoot, {
      'plugins/installed_plugins.json': writeJson({
        version: 2,
        plugins: {
          'multi@acme': [
            { scope: 'user', installPath: cacheAt('1.0.0'), version: '1.0.0' },
            { scope: 'project', projectPath: workdir, installPath: inProject, version: '4.0.0' }
          ]
        }
      })
    })
    const readdir = vi.spyOn(fsp, 'readdir')

    const multi = (await api.pluginsList()).data.find((row) => row.id === 'plugin:multi@acme')!
    expect(multi.installations.map((place) => [place.version, place.followed])).toEqual([
      ['1.0.0', true],
      ['4.0.0', false]
    ])

    const scan = await api.pluginSkills('plugin:multi@acme')
    expect(scan.data.map((skill) => skill.name)).toEqual(['only-old', 'shared'])
    expect(scan.errors.map((error) => error.code)).toEqual(['out-of-store'])
    for (const call of readdir.mock.calls) {
      expect(String(call[0]).startsWith(workdir)).toBe(false)
    }
    vi.restoreAllMocks()
  })

  it('attributes the plugin on a project page exactly as the Library does', async () => {
    const library = (await api.pluginsList()).data.find((row) => row.id === 'plugin:multi@acme')!
    const detail = await api.projectDetail(`project:code:${flattenPath(workdir)}`)
    const here = detail.data?.plugins.find((state) => state.pluginId === 'plugin:multi@acme')

    expect(here?.source).toBe(library.source)
    expect(here?.installations).toEqual(library.installations)
  })
})
