import path from 'node:path'

/**
 * Display strings are built in the main process only — the renderer never
 * splits or joins paths (a class of cross-platform bug we refuse to have).
 */

export function tildify(target: string, home: string): string {
  const rel = path.relative(home, target)
  // Display strings use forward slashes on every OS; adapters append
  // `/child` segments, and mixing separators reads as a bug. That holds for
  // a path outside home too — the fixture store is one — so the separator is
  // normalised here, once, rather than at every caller.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return slashed(target)
  return `~/${slashed(rel)}`
}

/** The OS-native path with forward slashes, the one separator display strings use. */
export function slashed(target: string): string {
  return target.split(path.sep).join('/')
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
