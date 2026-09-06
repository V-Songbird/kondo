import { describe, expect, it } from 'vitest'
import { readFrontmatter } from '../electron/main/workspace/frontmatter'

describe('readFrontmatter', () => {
  it('reads plain name and description', () => {
    const result = readFrontmatter('---\nname: alpha\ndescription: Does things\n---\n# Alpha')
    expect(result).toEqual({ name: 'alpha', description: 'Does things' })
  })

  it('unquotes and unescapes quoted values', () => {
    const result = readFrontmatter('---\ndescription: "Says \\"hi\\" politely"\n---\n')
    expect(result.description).toBe('Says "hi" politely')
  })

  it('tolerates BOM and CRLF', () => {
    const result = readFrontmatter('﻿---\r\nname: crlf-skill\r\n---\r\nbody')
    expect(result.name).toBe('crlf-skill')
  })

  it('returns nulls when there is no frontmatter fence', () => {
    expect(readFrontmatter('# Just a heading')).toEqual({ name: null, description: null })
  })

  it('ignores keys it does not display', () => {
    const result = readFrontmatter('---\nallowed-tools: Bash\nname: x\n---\n')
    expect(result).toEqual({ name: 'x', description: null })
  })

  // How nearly every real skill writes its description. Reading only the key's
  // own line used to print the header, `>-`, into the Library's table.
  it('folds a block scalar into one line', () => {
    const result = readFrontmatter(
      '---\nname: inventory\ndescription: >-\n  Reports everything jig put here\n  and why it is there.\n---\n'
    )
    expect(result).toEqual({
      name: 'inventory',
      description: 'Reports everything jig put here and why it is there.'
    })
  })

  it('keeps the breaks in a literal block scalar', () => {
    const result = readFrontmatter('---\ndescription: |\n  one\n  two\n---\n')
    expect(result.description).toBe('one\ntwo')
  })

  it('treats a blank line inside a folded block as a paragraph break, not the end', () => {
    const result = readFrontmatter('---\ndescription: >\n  first\n\n  second\nname: after\n---\n')
    expect(result).toEqual({ name: 'after', description: 'first second' })
  })

  it('stops a block at the next key rather than swallowing it', () => {
    const result = readFrontmatter('---\ndescription: >-\n  body\nname: beta\n---\n')
    expect(result).toEqual({ name: 'beta', description: 'body' })
  })

  it('continues a plain value across indented lines', () => {
    const result = readFrontmatter('---\ndescription: starts here\n  and continues\nname: g\n---\n')
    expect(result).toEqual({ name: 'g', description: 'starts here and continues' })
  })

  it('answers null for a block scalar with nothing under it', () => {
    expect(readFrontmatter('---\ndescription: >-\nname: h\n---\n')).toEqual({
      name: 'h',
      description: null
    })
  })
})
