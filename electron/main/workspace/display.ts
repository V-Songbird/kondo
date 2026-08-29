import path from 'node:path'

/**
 * Display strings are built in the main process only — the renderer never
 * splits or joins paths (a class of cross-platform bug we refuse to have).
 */

export function tildify(target: string, home: string): string {
  const rel = path.relative(home, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return target
  // Display strings use forward slashes on every OS; adapters append
  // `/child` segments, and mixing separators reads as a bug.
  return `~/${rel.split(path.sep).join('/')}`
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}
