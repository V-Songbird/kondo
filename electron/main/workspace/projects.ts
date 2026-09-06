import path from 'node:path'

/**
 * Which real directory a `~/.claude/projects/<flat>` entry belongs to.
 *
 * Claude Code names the directory by flattening the absolute path: every
 * character outside `[A-Za-z0-9]` becomes `-` (`D:\Projects\my-app` →
 * `D--Projects-my-app`). That is lossy — `-`, `_`, `.`, `\` and `/` all
 * collapse — so the name alone cannot be reversed. Claude's own registry can:
 * `~/.claude.json` keeps a `projects` map keyed by the real path, and
 * flattening those keys the same way yields an exact index (ADR-0009). The
 * single-candidate guess below stays only as a fallback for a directory the
 * registry no longer lists. Either way the caller verifies with a stat before
 * claiming a path (ADR-0002 allows exactly that: an existence check, never a
 * listing or read).
 */

/** Claude Code's flattening rule, as observed on disk (domain.md). */
export function flattenProjectPath(absPath: string): string {
  return absPath.replace(/[^A-Za-z0-9]/g, '-')
}

/** The `projects` keys of a parsed `~/.claude.json`; empty for any other shape. */
export function registeredProjectPaths(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) return []
  const projects = (config as Record<string, unknown>)['projects']
  if (typeof projects !== 'object' || projects === null || Array.isArray(projects)) return []
  return Object.keys(projects)
}

/**
 * Flattened name → real path. Claude writes the same project under both
 * slash spellings on Windows; `normalize` folds them, and the first spelling
 * of a name wins — the stat that follows is what decides anyway.
 */
export function projectIndex(registered: readonly string[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const absPath of registered) {
    const flat = flattenProjectPath(absPath)
    if (!index.has(flat)) index.set(flat, path.normalize(absPath))
  }
  return index
}

/** The fallback guess: one candidate, every `-` read as a separator. */
export function candidateOriginalPaths(dirName: string, platform: NodeJS.Platform): string[] {
  const sep = platform === 'win32' ? '\\' : '/'
  const drive = /^([A-Za-z])--(.+)$/.exec(dirName)

  let prefix: string
  let body: string
  if (platform === 'win32' && drive && drive[1] !== undefined && drive[2] !== undefined) {
    prefix = `${drive[1]}:${sep}`
    body = drive[2]
  } else if (platform !== 'win32' && dirName.startsWith('-')) {
    prefix = sep
    body = dirName.slice(1)
  } else {
    return []
  }

  const candidates: string[] = []
  if (body.includes('--')) {
    // '--' usually flattened '<sep>.' (dot-directories like `.claude-jobs`).
    candidates.push(
      prefix +
        body
          .split('--')
          .map((segment) => segment.replaceAll('-', sep))
          .join(`${sep}.`)
    )
  } else {
    candidates.push(prefix + body.replaceAll('-', sep))
  }
  return candidates
}

/**
 * What a stat on a candidate path found. Three answers and not two,
 * because 'kondo looked and there is nothing there' and 'kondo could not
 * look' mean opposite things to the caller: only the first is evidence a
 * project was deleted, and an unmounted volume or a directory the user
 * cannot read answers the second (ADR-0005).
 */
export type Presence = 'present' | 'absent' | 'unreadable'

export type ExistsFn = (target: string) => Promise<Presence>

export async function guessOriginalPath(
  dirName: string,
  platform: NodeJS.Platform,
  exists: ExistsFn,
  registered: ReadonlyMap<string, string> = new Map()
): Promise<string | null> {
  const known = registered.get(dirName)
  const candidates = known
    ? [known, ...candidateOriginalPaths(dirName, platform).filter((c) => c !== known)]
    : candidateOriginalPaths(dirName, platform)
  for (const candidate of candidates) {
    // A guess is a proposal, so only a path that answered for itself wins.
    // One kondo could not read is not this project any more than a missing
    // one is, and a guess reports nothing either way.
    if ((await exists(candidate)) === 'present') return candidate
  }
  return null
}
