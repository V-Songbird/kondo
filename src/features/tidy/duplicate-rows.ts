import type { SkillDuplicate, SkillDuplicateGroup } from '../../../shared/contract'

/**
 * The reading half of the duplicate-skills section: what a group's verdict
 * says on screen, and which of its members may be offered to the trash. Kept
 * out of the component so it can be tested without a DOM (kondo has no jsdom).
 */

export interface GroupVerdict {
  /** The pill text. */
  label: string
  /** Tailwind colour class carrying the finding. */
  tone: 'stamp-ok' | 'stamp-unknown'
  /** Whether any member of this group may be trashed from here. */
  trashable: boolean
}

/**
 * Only a group whose every member digested to the same bytes is safe to thin
 * out: a differing digest means two skills that merely share a name, and a
 * missing digest means a tree kondo could not read — and a repeated name is
 * never called redundant on the strength of a digest kondo does not have.
 */
export function verdictFor(group: SkillDuplicateGroup): GroupVerdict {
  if (group.identical) {
    return { label: 'identical copies', tone: 'stamp-ok', trashable: true }
  }
  if (group.members.some((member) => member.digest === null)) {
    return { label: 'one copy could not be read', tone: 'stamp-unknown', trashable: false }
  }
  return { label: 'same name, different contents', tone: 'stamp-unknown', trashable: false }
}

/**
 * Why this one member cannot go, in the sentence the screen shows, or null
 * when the trash control may be offered. The group verdict comes first: a
 * member of a non-identical group is kept whatever its own matrix row says.
 */
export function keepReason(group: SkillDuplicateGroup, member: SkillDuplicate): string | null {
  const verdict = verdictFor(group)
  if (!verdict.trashable) {
    return member.digest === null
      ? 'This copy could not be read, so kondo cannot say it is the same skill.'
      : 'The copies differ, so neither is redundant.'
  }
  return member.skill.capabilities.trash.allowed ? null : member.skill.capabilities.trash.reason
}

/** The first eight hex digits, enough to see two digests agree or not. */
export function shortDigest(digest: string | null): string {
  return digest === null ? '—' : digest.slice(0, 8)
}
