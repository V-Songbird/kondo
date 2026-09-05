import { describe, expect, it } from 'vitest'
import type { SkillDuplicate, SkillDuplicateGroup } from '../shared/contract'
import { keepReason, shortDigest, verdictFor } from '../src/features/tidy/duplicate-rows'

const member = (id: string, digest: string | null, trashAllowed = true): SkillDuplicate =>
  ({
    digest,
    skill: {
      id,
      capabilities: {
        trash: { allowed: trashAllowed, reason: trashAllowed ? null : 'Ships inside a plugin.' }
      }
    }
  }) as unknown as SkillDuplicate

const group = (members: SkillDuplicate[], identical: boolean): SkillDuplicateGroup => ({
  name: 'twin',
  members,
  identical
})

describe('duplicate skill verdicts', () => {
  it('offers the trash only for an identical group', () => {
    const twins = group([member('skill:user:twin', 'a'.repeat(64)), member('skill:project/p:twin', 'a'.repeat(64))], true)
    expect(verdictFor(twins).trashable).toBe(true)
    expect(keepReason(twins, twins.members[0] as SkillDuplicate)).toBeNull()
  })

  it('keeps every member of a group whose digests differ', () => {
    const rivals = group([member('a', 'a'.repeat(64)), member('b', 'b'.repeat(64))], false)
    expect(verdictFor(rivals)).toMatchObject({ trashable: false, label: 'same name, different contents' })
    for (const each of rivals.members) expect(keepReason(rivals, each)).toMatch(/differ/)
  })

  it('never calls a group redundant on a digest it does not have', () => {
    const unread = group([member('a', 'a'.repeat(64)), member('b', null)], false)
    expect(verdictFor(unread)).toMatchObject({ trashable: false, label: 'one copy could not be read' })
    expect(keepReason(unread, unread.members[1] as SkillDuplicate)).toMatch(/could not be read/)
  })

  it('lets the matrix have the last word on an identical member', () => {
    const plugin = group([member('a', 'a'.repeat(64)), member('b', 'a'.repeat(64), false)], true)
    expect(keepReason(plugin, plugin.members[1] as SkillDuplicate)).toBe('Ships inside a plugin.')
  })

  it('shortens a digest to eight digits and shows a dash for none', () => {
    expect(shortDigest('0123456789abcdef')).toBe('01234567')
    expect(shortDigest(null)).toBe('—')
  })
})
