import fs from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspace } from '../electron/main/workspace/workspace'
import { hashTree, makeWorld, recordWrites, registerProjects, writeFileTree, writeJson, type FixtureWorld } from './helpers'

describe('conservative hook script cleanup', () => {
  let world: FixtureWorld
  beforeEach(async () => { world = await makeWorld() })
  afterEach(async () => { vi.restoreAllMocks(); await world.cleanup() })

  it('A8: never offers or removes a script referenced through HOME', async () => {
    const command = 'node "$HOME/.claude/hooks/live.js"'
    const settings = writeJson({ hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command }] }]
    } })
    await writeFileTree(world.userRoot, {
      'settings.json': settings,
      'hooks/live.js': 'throw new Error("Kondo must never execute this fixture")\n'
    })
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const before = await hashTree(world.userRoot)
    const preview = await api.tidyPreview()
    const category = preview.data.categories.find((entry) => entry.category === 'unarmed-hook-scripts')!
    expect(category.count).toBe(0)
    expect(category.blocked).toContain('cannot establish')
    const result = await api.tidySweep(['unarmed-hook-scripts'], preview.data.reviewToken!)
    expect(result.data).toBeNull()
    expect(result.errors[0]?.code).toBe('not-permitted')
    expect(await hashTree(world.userRoot)).toBe(before)
    expect(await fs.readFile(path.join(world.userRoot, 'hooks/live.js'), 'utf8')).toContain('must never execute')
    expect((await api.journalList()).data).toEqual([])
  })

  it.each([
    'node "${HOME}/.claude/hooks/live.js"',
    'node "%USERPROFILE%\\.claude\\hooks\\live.js"',
    'node "$env:USERPROFILE/.claude/hooks/live.js"',
    'node "$CLAUDE_PLUGIN_ROOT/hooks/live.js"',
    'node "$CLAUDE_PROJECT_DIR/.claude/hooks/live.js"',
    'node "~/.claude/hooks/live script.js"',
    "node '~/.claude/hooks/live script.js'",
    'node ~/.claude/hooks/first.js;node ~/.claude/hooks/live.js',
    'node ~/.claude/hooks/first.js && node ~/.claude/hooks/live.js',
    'cat ~/.claude/hooks/live.js | node',
    'node "$(echo ~/.claude)/hooks/live.js"',
    'node hooks/live.js',
    'custom-hook-runner',
    'node ~/.claude/hooks/first.js',
    'echo hello'
  ])('retains possible direct or indirect references: %s', async (command) => {
    const settings = writeJson({ hooks: { Stop: [{ hooks: [{ type: 'command', command }] }] } })
    await writeFileTree(world.userRoot, {
      'settings.json': settings,
      'hooks/live.js': 'never execute',
      'hooks/live script.js': 'never execute',
      'hooks/first.js': 'require("./live.js")',
      'cache/disposable': 'cache bytes'
    })
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const before = await hashTree(world.userRoot)
    const preview = await api.tidyPreview()
    expect(preview.data.categories.find((entry) => entry.category === 'unarmed-hook-scripts'))
      .toMatchObject({ count: 0, bytes: 0, examples: [], blocked: expect.any(String) })
    const writes: string[] = []
    const restores = recordWrites(writes)
    try {
      const result = await api.tidySweep(['reclaimable-caches', 'unarmed-hook-scripts'], preview.data.reviewToken!)
      expect(result.data).toBeNull()
      expect(result.errors.map((error) => error.code)).toEqual(['not-permitted'])
    } finally { restores.forEach((restore) => restore()) }
    expect(writes).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
    expect((await api.journalList()).data).toEqual([])

    // A permitted selection still uses the ordinary reviewed snapshot and Undo.
    const fresh = await api.tidyPreview()
    const swept = await api.tidySweep(['reclaimable-caches'], fresh.data.reviewToken!)
    expect(swept.errors).toEqual([])
    expect(swept.data?.stepCount).toBe(1)
    expect(await fs.readFile(path.join(world.userRoot, 'hooks/live.js'), 'utf8')).toBe('never execute')
    expect((await api.journalUndo(swept.data!.id)).errors).toEqual([])
    expect(await hashTree(world.userRoot)).toBe(before)
  })

  it.each([undefined, '{}', '{"hooks":{}}', '{', '[]', '{"hooks":[]}',
    '{"hooks":{"Stop":"unsupported"}}', '{"hooks":{"Stop":[{"hooks":[{"type":"unknown"}]}]}}'
  ])('never treats missing, empty or unsupported settings as complete coverage: %s', async (settings) => {
    await writeFileTree(world.userRoot, { 'hooks/live.js': 'kept', ...(settings === undefined ? {} : { 'settings.json': settings }) })
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const before = await hashTree(world.userRoot)
    const preview = await api.tidyPreview()
    expect(preview.data.categories.find((entry) => entry.category === 'unarmed-hook-scripts')?.blocked)
      .toContain('sources and command forms are not checked')
    expect(preview.data.totalCount).toBe(0)
    expect((await api.tidySweep(['unarmed-hook-scripts'], preview.data.reviewToken!)).errors[0]?.code).toBe('not-permitted')
    expect(await hashTree(world.userRoot)).toBe(before)
    if (settings === '{') expect((await api.hooksList()).errors.some((error) => error.code === 'parse-failed')).toBe(true)
  })

  it('retains scripts with an unreadable project layer and preserves healthy hook rows and errors', async () => {
    const project = path.join(world.base, 'project')
    const settings = writeJson({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo healthy' }] }] } })
    await writeFileTree(world.userRoot, { 'settings.json': settings, 'hooks/live.js': 'kept' })
    await writeFileTree(project, { '.claude/settings.local.json': settings })
    await registerProjects(world, [project])
    const blockedLayer = path.join(project, '.claude', 'settings.local.json')
    const read = fs.readFile.bind(fs)
    vi.spyOn(fs, 'readFile').mockImplementation(async (...args) => {
      if (String(args[0]) === blockedLayer) throw Object.assign(new Error('fixture access denied'), { code: 'EACCES' })
      return read(...args)
    })
    const api = createWorkspace({ locator: world.locator, platform: process.platform })
    const listed = await api.hooksList()
    expect(listed.data.flatMap((group) => group.hooks))
      .toContainEqual(expect.objectContaining({ event: 'Stop', type: 'command', script: null, layer: 'user' }))
    expect(listed.errors)
      .toContainEqual(expect.objectContaining({ code: 'read-failed', message: 'Kondo could not read this settings file.' }))
    expect(JSON.stringify(listed)).not.toContain('fixture access denied')
    const preview = await api.tidyPreview()
    expect(preview.data.categories.find((entry) => entry.category === 'unarmed-hook-scripts'))
      .toMatchObject({ count: 0, blocked: expect.any(String) })
    expect((await api.tidySweep(['unarmed-hook-scripts'], preview.data.reviewToken!)).errors[0]?.code).toBe('not-permitted')
    expect((await api.journalList()).data).toEqual([])
  })
})
