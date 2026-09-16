import { describe, expect, it } from 'vitest'
import type { ProjectRow } from '../shared/contract'
import { listView, PAGE } from '../src/features/projects/project-rows'

const row = (
  name: string,
  location: ProjectRow['location'] = 'here',
  global = false,
  throwaway = false
): ProjectRow =>
  ({
    id: global ? 'store:user:user' : `project:code:${name}`,
    label: global ? 'All projects' : `D:/Projects/${name}`,
    name: global ? 'All projects' : name,
    parent: global ? null : 'D:/Projects',
    path: global ? '~/.claude' : `D:/Projects/${name}`,
    global,
    location,
    throwaway,
    hasStore: location === 'here',
    sessionCount: 0,
    lastActivityMs: 0,
    counts: { skills: 0, agents: 0, commands: 0, rules: 0, settings: 0, hooks: null, mcpServers: null }
  }) as ProjectRow

const GLOBAL = row('All projects', 'here', true)

describe('the projects list view (entry 060)', () => {
  it('folds gone and throwaway projects behind a count and keeps the global row first', () => {
    const view = listView(
      [
        GLOBAL,
        row('app'),
        row('old', 'gone'),
        row('lost', 'unlocated'),
        row('tmp-run', 'unlocated', false, true)
      ],
      { query: '', showFolded: false, limit: PAGE }
    )
    expect(view.shown.map((entry) => entry.name)).toEqual(['All projects', 'app', 'lost'])
    expect(view.hidden).toBe(2)
    expect(view.matched).toBe(true)
  })

  it('shows the folded projects when asked, and then hides nothing', () => {
    const view = listView([GLOBAL, row('old', 'gone'), row('tmp', 'here', false, true)], {
      query: '',
      showFolded: true,
      limit: PAGE
    })
    expect(view.shown.map((entry) => entry.name)).toEqual(['All projects', 'old', 'tmp'])
    expect(view.hidden).toBe(0)
  })

  it('hands rows out a page at a time and counts what is left', () => {
    const many = Array.from({ length: PAGE + 5 }, (_, i) => row(`p${i}`))
    const first = listView([GLOBAL, ...many], { query: '', showFolded: false, limit: PAGE })
    expect(first.shown).toHaveLength(PAGE + 1)
    expect(first.more).toBe(5)
    const all = listView([GLOBAL, ...many], { query: '', showFolded: false, limit: PAGE * 2 })
    expect(all.more).toBe(0)
  })

  it('filters on the whole label and never on the global row', () => {
    const view = listView([GLOBAL, row('app'), row('kondo')], {
      query: 'KON',
      showFolded: false,
      limit: PAGE
    })
    expect(view.shown.map((entry) => entry.name)).toEqual(['All projects', 'kondo'])
    const none = listView([GLOBAL, row('app')], { query: 'zzz', showFolded: false, limit: PAGE })
    expect(none.shown.map((entry) => entry.name)).toEqual(['All projects'])
    expect(none.matched).toBe(false)
  })
})
