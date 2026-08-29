import { describe, expect, it } from 'vitest'
import { candidateOriginalPaths, guessOriginalPath } from '../electron/main/workspace/projects'

describe('candidateOriginalPaths', () => {
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
      return target === 'D:\\Programs\\cmder'
    })
    expect(guess).toBe('D:\\Programs\\cmder')
  })

  it('returns null when no candidate verifies — the UI shows the raw name instead', async () => {
    const guess = await guessOriginalPath('D--Projects-my-app', 'win32', async () => false)
    expect(guess).toBeNull()
  })
})
