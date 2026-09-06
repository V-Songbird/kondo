import { describe, expect, it } from 'vitest'
import path from 'node:path'
import {
  candidateOriginalPaths,
  flattenProjectPath,
  guessOriginalPath,
  projectIndex,
  registeredProjectPaths,
  type ExistsFn
} from '../electron/main/workspace/projects'

describe('flattenProjectPath', () => {
  it('turns every non-alphanumeric character into a dash, as Claude does', () => {
    expect(flattenProjectPath('D:\\Projects\\my-app')).toBe('D--Projects-my-app')
    expect(flattenProjectPath('D:/Projects/my-app')).toBe('D--Projects-my-app')
    expect(flattenProjectPath('/home/x/snake_case.dir')).toBe('-home-x-snake-case-dir')
    expect(flattenProjectPath('C:\\Users\\x\\.claude-jobs\\p')).toBe('C--Users-x--claude-jobs-p')
  })
})

describe('projectIndex', () => {
  it('indexes registry keys by flattened name and folds slash spellings', () => {
    const index = projectIndex(['D:\\Projects\\my-app', 'D:/Projects/my-app', '/home/x/proj'])
    expect(index.get('D--Projects-my-app')).toBeDefined()
    expect(index.get('-home-x-proj')).toBe(path.normalize('/home/x/proj'))
    expect(index.size).toBe(2)
  })

  it('reads only the projects keys and tolerates any other shape', () => {
    expect(registeredProjectPaths({ projects: { '/a': { lastCost: 1 }, '/b': {} } })).toEqual([
      '/a',
      '/b'
    ])
    expect(registeredProjectPaths({ projects: [] })).toEqual([])
    expect(registeredProjectPaths(null)).toEqual([])
    expect(registeredProjectPaths('nope')).toEqual([])
  })
})

describe('candidateOriginalPaths (fallback guess)', () => {
  it('maps a plain Windows flattened name', () => {
    expect(candidateOriginalPaths('D--Programs-cmder', 'win32')).toEqual([
      'D:\\Programs\\cmder'
    ])
  })

  it('treats interior double dashes as dot-directories', () => {
    expect(candidateOriginalPaths('C--Users-x--claude-jobs-probe', 'win32')).toEqual([
      'C:\\Users\\x\\.claude\\jobs\\probe'
    ])
  })

  it('maps a POSIX flattened name', () => {
    expect(candidateOriginalPaths('-home-x-proj', 'linux')).toEqual(['/home/x/proj'])
  })

  it('returns nothing for names that fit no known shape', () => {
    expect(candidateOriginalPaths('not-a-flattened-root', 'win32')).toEqual([])
  })
})

describe('guessOriginalPath', () => {
  it('verifies candidates with the injected existence check and returns the hit', async () => {
    const guess = await guessOriginalPath('D--Programs-cmder', 'win32', async (target) => {
      return target === 'D:\\Programs\\cmder' ? 'present' : 'absent'
    })
    expect(guess).toBe('D:\\Programs\\cmder')
  })

  it('resolves a hyphenated name through the registry, which the guess never could', async () => {
    const registered = projectIndex(['D:\\Projects\\my-app'])
    const exists: ExistsFn = async (target) =>
      target === 'D:\\Projects\\my-app' ? 'present' : 'absent'
    expect(await guessOriginalPath('D--Projects-my-app', 'win32', exists, registered)).toBe(
      'D:\\Projects\\my-app'
    )
    expect(await guessOriginalPath('D--Projects-my-app', 'win32', exists)).toBeNull()
  })

  it('returns null when nothing verifies — the UI shows the raw name instead', async () => {
    const registered = projectIndex(['D:\\Projects\\my-app'])
    const guess = await guessOriginalPath('D--Projects-my-app', 'win32', async () => 'absent', registered)
    expect(guess).toBeNull()
  })
})
