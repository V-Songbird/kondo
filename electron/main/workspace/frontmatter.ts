/**
 * Minimal, dependency-free SKILL.md frontmatter reader. Extracts only what
 * kondo displays; deliberately lossy and read-only — structured *writing*
 * of manifests is out of scope until a round-tripping parser exists.
 */

const FENCE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/
const KEY_VALUE = /^([A-Za-z0-9_-]+):\s?(.*)$/
/**
 * A YAML block scalar header — `>` folds the lines under it into one string,
 * `|` keeps their newlines — with the chomping and indent indicators YAML
 * allows after it (`>-`, `|+`, `>2`). Nearly every skill on a real machine
 * writes its description as one of these, because a description is a
 * paragraph and nobody puts a paragraph on one line. Reading only the key's
 * own line printed the header itself, `>-`, as the description.
 */
const BLOCK_SCALAR = /^([>|])[\d+-]*$/

export interface SkillFrontmatter {
  name: string | null
  description: string | null
}

export function readFrontmatter(content: string): SkillFrontmatter {
  const result: SkillFrontmatter = { name: null, description: null }
  const fence = FENCE.exec(content)
  if (!fence || fence[1] === undefined) return result

  const lines = fence[1].split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const match = KEY_VALUE.exec(lines[index] ?? '')
    if (!match || match[1] === undefined || match[2] === undefined) continue
    const key = match[1].toLowerCase()
    if (key !== 'name' && key !== 'description') continue

    // Whatever sits on the key's own line, then the lines it owns. The key
    // pattern is anchored at column 0, so an indented line can never be
    // mistaken for the next key — which is also how a plain value continued
    // across lines is picked up, block scalar or not.
    const head = match[2].trim()
    const block = BLOCK_SCALAR.exec(head)
    const owned: string[] = []
    while (index + 1 < lines.length && owns(lines[index + 1] ?? '', block !== null)) {
      index += 1
      owned.push((lines[index] ?? '').trim())
    }
    result[key] = block
      ? joinBlock(owned, block[1] === '|')
      : unquote([head, ...owned].join(' ').trim())
  }
  return result
}

/**
 * Indented lines belong to the key above them. A blank line belongs to it too
 * inside a block scalar, where it is a paragraph break rather than the end of
 * the value; outside one it ends the value.
 */
function owns(line: string, insideBlock: boolean): boolean {
  if (line.trim() === '') return insideBlock
  return /^\s/.test(line)
}

/**
 * Kondo displays these, so a folded block collapses to a single line and a
 * literal one keeps its breaks. Neither is round-trippable, which this reader
 * has never claimed to be.
 */
function joinBlock(lines: string[], literal: boolean): string | null {
  const text = literal
    ? lines.join('\n').replace(/\s+$/, '')
    : lines.join(' ').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

function unquote(value: string): string | null {
  if (value === '') return null
  const first = value[0]
  if ((first === '"' || first === "'") && value.endsWith(first) && value.length >= 2) {
    return value.slice(1, -1).replace(/\\(["'\\])/g, '$1')
  }
  return value
}
