/**
 * Minimal, dependency-free SKILL.md frontmatter reader. Extracts only what
 * kondo displays; deliberately lossy and read-only — structured *writing*
 * of manifests is out of scope until a round-tripping parser exists.
 */

const FENCE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/
const KEY_VALUE = /^([A-Za-z0-9_-]+):\s?(.*)$/

export interface SkillFrontmatter {
  name: string | null
  description: string | null
}

export function readFrontmatter(content: string): SkillFrontmatter {
  const result: SkillFrontmatter = { name: null, description: null }
  const fence = FENCE.exec(content)
  if (!fence || fence[1] === undefined) return result

  for (const line of fence[1].split(/\r?\n/)) {
    const match = KEY_VALUE.exec(line)
    if (!match || match[1] === undefined || match[2] === undefined) continue
    const key = match[1].toLowerCase()
    if (key !== 'name' && key !== 'description') continue
    result[key] = unquote(match[2].trim())
  }
  return result
}

function unquote(value: string): string | null {
  if (value === '') return null
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(["'\\])/g, '$1')
  }
  return value
}
