import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { KondoApi } from '../shared/contract'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { makeWorld, skillManifest, writeFileTree, writeJson, type FixtureWorld } from './helpers'

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
    // Installed, real, and ships no skills at all — there is no `skills/`.
    await writeFileTree(quietInstall, { 'commands/hello.md': '# hello' })
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
