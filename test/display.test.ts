import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { slashed, tildify } from '../electron/main/workspace/display'

const home = path.join(path.sep === '\\' ? 'C:\\Users' : '/home', 'someone')

describe('tildify', () => {
  it('shortens a path under home with forward slashes', () => {
    expect(tildify(path.join(home, '.claude', 'skills', 'x'), home)).toBe('~/.claude/skills/x')
  })

  it('answers home itself as-is, never as ~/', () => {
    expect(tildify(home, home)).toBe(slashed(home))
  })

  it('uses forward slashes for a path outside home too, so an appended /child never mixes', () => {
    const outside = path.join(path.parse(home).root, 'Temp', 'kondofix', 'home', '.claude')
    const display = tildify(outside, home)
    expect(display).not.toContain('\\')
    expect(`${display}/plugins/cache`).not.toMatch(/\\/)
    // Nothing but the separator changes: the drive letter and every segment stay.
    expect(display.split('/').filter(Boolean)).toEqual(outside.split(path.sep).filter(Boolean))
  })
})
