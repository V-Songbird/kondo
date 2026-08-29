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
})
