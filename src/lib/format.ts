import type { ScanError } from '../../shared/contract'

/**
 * Every message a result carries, not just the first. A mutation refuses per
 * step (ADR-0005), so reading `errors[0]` and dropping the rest told the user
 * one thing went wrong when four did — and the four were the finding.
 */
export function joinErrors(errors: readonly ScanError[]): string | null {
  if (errors.length === 0) return null
  return errors.map((error) => error.message).join(' · ')
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`
}

export function formatAgo(mtimeMs: number, nowMs = Date.now()): string {
  if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return '—'
  const seconds = Math.max(0, Math.floor((nowMs - mtimeMs) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 60) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

export function formatCount(value: number, noun: string): string {
  return `${value.toLocaleString()} ${noun}${value === 1 ? '' : 's'}`
}

/**
 * A flattened project key, split so its damage shows. Claude Code names a
 * project directory by replacing every character outside `[A-Za-z0-9]` with a
 * hyphen, which is lossy and irreversible; drawing the surviving runs in the
 * primary ink and the hyphen runs faint says that on screen rather than in a
 * comment (DESIGN.md, "The signature").
 *
 * Only ever call this on a key the seam flattened — `ProjectRow.name` when
 * `parent` is null, which is main's way of saying it could not locate the
 * project. A hyphen in a real path is a legitimate character, and dimming one
 * there would draw a lie.
 */
export function flatKeyParts(key: string): { text: string; gap: boolean }[] {
  return key
    .split(/(-+)/)
    .filter((part) => part !== '')
    .map((text) => ({ text, gap: /^-+$/.test(text) }))
}
