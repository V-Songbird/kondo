import { describe, expect, it } from 'vitest'
import type { ConfigOrphan, ConfigOrphanKind, ScanError } from '../shared/contract'
import {
  chosenFrom,
  groupByKind,
  orphanKindOrder,
  refusalFrom
} from '../src/features/orphans/orphan-rows'

/**
 * The reading half of the Leftovers view. It is a pure function of one
 * `Scan<ConfigOrphan[]>`, which is the whole reason it lives apart from the
 * JSX — this repo has no renderer test harness, and the parts worth pinning
 * (which groups appear, what a stale file is called, which ticked rows
 * survive a re-read) never needed one.
 */

function orphan(kind: ConfigOrphanKind, member: string): ConfigOrphan {
  return {
    id: `orphan:${kind}:user:${member}`,
    kind,
    name: member,
    source: '~/.claude.json',
    reason: `nothing stands behind ${member}`
  }
}

function error(code: ScanError['code'], message: string): ScanError {
  return { code, path: '~/.claude.json', message }
}

describe('groupByKind', () => {
  it('groups every kind the contract declares, in the declared order', () => {
    // Deliberately shuffled, and one kind carries two rows: the grouping must
    // come from orphanKindOrder, never from the order the scan happened to
    // return.
    const groups = groupByKind([
      orphan('skill-override', 'writing-style'),
      orphan('enabled-plugin', 'foundry@local'),
      orphan('mcp-declaration', 'apiserver'),
      orphan('project-entry', '/gone/one'),
      orphan('project-entry', '/gone/two')
    ])

    expect(groups.map((group) => group.kind)).toEqual([...orphanKindOrder])
    expect(orphanKindOrder).toHaveLength(4)
    expect(groups.map((group) => group.rows.map((row) => row.name))).toEqual([
      ['/gone/one', '/gone/two'],
      ['apiserver'],
      ['foundry@local'],
      ['writing-style']
    ])
  })

  it('gives every group a label and a hint that are not the internal kind', () => {
    for (const group of groupByKind(orphanKindOrder.map((kind) => orphan(kind, 'x')))) {
      expect(group.label).not.toContain(group.kind)
      expect(group.label.length).toBeGreaterThan(0)
      expect(group.hint.length).toBeGreaterThan(0)
    }
  })

  it('carries each row name, source and reason through untouched', () => {
    const row = orphan('mcp-declaration', 'apiserver')
    expect(groupByKind([row]).map((group) => group.rows)).toEqual([[row]])
  })

  it('drops the kinds that found nothing rather than showing an empty table', () => {
    const groups = groupByKind([orphan('enabled-plugin', 'foundry@local')])
    expect(groups.map((group) => group.kind)).toEqual(['enabled-plugin'])
  })

  it('returns nothing at all for a store with no leftovers', () => {
    expect(groupByKind([])).toEqual([])
  })
})

describe('chosenFrom', () => {
  it('keeps the ticked rows in the order the scan returned them', () => {
    const dead = orphan('project-entry', '/gone/one')
    const plugin = orphan('enabled-plugin', 'foundry@local')
    const skill = orphan('skill-override', 'writing-style')
    const picked = chosenFrom([dead, plugin, skill], [skill.id, dead.id])
    expect(picked.map((row) => row.name)).toEqual(['/gone/one', 'writing-style'])
  })

  it('drops a selected id the fresh scan no longer resolves', () => {
    // What a stale-file refusal leaves behind: the list is read again under
    // the user, and a pick that no longer exists must never be sent back.
    const survivor = orphan('project-entry', '/gone/one')
    const picked = chosenFrom(
      [survivor],
      [survivor.id, 'orphan:project-entry:user:/gone/two']
    )
    expect(picked.map((row) => row.id)).toEqual([survivor.id])
  })

  it('chooses nothing when nothing is ticked', () => {
    expect(chosenFrom([orphan('project-entry', '/gone/one')], [])).toEqual([])
  })
})

describe('refusalFrom', () => {
  it('says nothing when the removal was clean', () => {
    expect(refusalFrom([])).toEqual({ stale: null, failure: null })
  })

  it('gives stale-file its own message and never calls it a failure', () => {
    const refusal = refusalFrom([
      error('stale-file', '~/.claude.json changed since kondo read it — nothing was written.')
    ])
    expect(refusal.failure).toBeNull()
    expect(refusal.stale).not.toBeNull()
    // ADR-0010's refusal is the expected outcome, so the sentence has to say
    // both halves: nothing was written, and reading again is the way on.
    expect(refusal.stale).toContain('nothing was written')
    expect(refusal.stale).toContain('read again')
  })

  it('reports a real problem as a failure, not as staleness', () => {
    const refusal = refusalFrom([error('read-failed', 'Could not read the file.')])
    expect(refusal.stale).toBeNull()
    expect(refusal.failure).toBe('Could not read the file.')
  })

  it('separates the two when a removal hits both', () => {
    const refusal = refusalFrom([
      error('stale-file', 'moved on'),
      error('read-failed', 'Could not read the file.'),
      error('unknown-id', 'That id no longer resolves.')
    ])
    expect(refusal.stale).not.toBeNull()
    expect(refusal.stale).not.toContain('Could not read the file.')
    expect(refusal.failure).toBe('Could not read the file. · That id no longer resolves.')
  })
})
