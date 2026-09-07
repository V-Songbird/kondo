import { EventEmitter } from 'node:events'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchOptions, stopAppImage } from './e2e/process.mjs'

afterEach(() => vi.restoreAllMocks())

const context = { platform: 'linux', ci: 'true', port: 9333, base: '/fixture with spaces' }

describe('packaged smoke launch', () => {
  it('forwards Electron flags after the AppImage flag and confines extraction/profile', () => {
    const result = launchOptions('/release/Kondo.AppImage', '/electron', context)
    expect(result.args).toEqual([
      '--appimage-extract-and-run', '--remote-debugging-port=9333',
      `--user-data-dir=${path.join(context.base, 'electron-profile')}`, '--no-sandbox'
    ])
    expect(result.detached).toBe(true)
    expect(result.env).toEqual({ TMPDIR: context.base })
  })

  it.each([
    ['win32', 'C:/temporary install/Kondo.exe'],
    ['darwin', '/release/mac-arm64/Kondo.app/Contents/MacOS/Kondo'],
    ['linux', '/release/linux-unpacked/kondo']
  ])('launches %s executables directly without an app path or AppImage flag', (platform, binary) => {
    const result = launchOptions(binary, '/electron', { ...context, platform, ci: '' })
    expect(result.args).toEqual([
      '--remote-debugging-port=9333', `--user-data-dir=${path.join(context.base, 'electron-profile')}`
    ])
    expect(result.detached).toBe(false)
    expect(result.env).toEqual({})
  })

  it('preserves the dev Electron app argument', () => {
    expect(launchOptions('/electron', '/electron', context).args[0]).toBe('.')
  })
})

function wrapper() {
  return Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null })
}

describe('AppImage shutdown', () => {
  it('waits for wrapper cleanup even when the CDP close response never arrives', async () => {
    const child = wrapper()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const send = vi.fn(() => new Promise(() => {}))
    let finished = false
    const stopped = stopAppImage(child, { send }).then(() => { finished = true })
    await Promise.resolve()
    expect(send).toHaveBeenCalledWith('Browser.close')
    expect(finished).toBe(false)
    child.exitCode = 0
    child.emit('exit', 0)
    await stopped
    expect(kill).not.toHaveBeenCalled()
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('fails smoke and kills the isolated group when the wrapper does not exit', async () => {
    const child = wrapper()
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      setTimeout(() => {
        child.signalCode = 'SIGKILL'
        child.emit('exit', null, 'SIGKILL')
      }, 5)
      return true
    })
    await expect(stopAppImage(child, { send: () => Promise.reject(new Error('socket closed')) }, 5))
      .rejects.toThrow('did not exit cleanly')
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL')
    expect(child.signalCode).toBe('SIGKILL')
    expect(child.listenerCount('exit')).toBe(0)
  })

  it('does not accept a nonzero wrapper exit', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const child = wrapper()
    const stopped = stopAppImage(child, { send: () => Promise.resolve() })
    child.exitCode = 7
    child.emit('exit', 7)
    await expect(stopped).rejects.toThrow('AppImage exited with 7')
  })

  it.each([[7, null], [null, 'SIGTERM']])('rejects and cleans a wrapper that already exited (%s, %s)', async (exitCode, signalCode) => {
    const child = Object.assign(wrapper(), { exitCode, signalCode })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    await expect(stopAppImage(child, null)).rejects.toThrow(`AppImage exited with ${exitCode ?? signalCode}`)
    expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL')
  })

  it('accepts a wrapper that already completed cleanup successfully', async () => {
    const child = Object.assign(wrapper(), { exitCode: 0 })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)
    await stopAppImage(child, null)
    expect(kill).not.toHaveBeenCalled()
  })
})
