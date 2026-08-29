/**
 * Reverse-mapping of flattened project directory names
 * (`D--Projects-app` → `D:\Projects\app`). The flattening is lossy — '-'
 * may have been '\', '.', or a literal hyphen — so this generates a small
 * set of candidates and the caller verifies with a stat (ADR-0002 allows
 * exactly that: an existence check, never a listing or read). No hit → null,
 * and kondo shows the flattened name instead of a guess.
 */

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

export type ExistsFn = (target: string) => Promise<boolean>

export async function guessOriginalPath(
  dirName: string,
  platform: NodeJS.Platform,
  exists: ExistsFn
): Promise<string | null> {
  for (const candidate of candidateOriginalPaths(dirName, platform)) {
    if (await exists(candidate)) return candidate
  }
  return null
}
