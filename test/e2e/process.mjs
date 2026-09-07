import path from 'node:path'

/** AppImage's runtime flag must precede Electron flags; it forwards the rest. */
export function launchOptions(binary, electron, { platform, ci, port, base }) {
  const appImage = platform === 'linux' && binary.endsWith('.AppImage')
  const args = binary === electron ? ['.'] : []
  if (appImage) args.push('--appimage-extract-and-run')
  args.push(`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(base, 'electron-profile')}`)
  if (platform === 'linux' && ci) args.push('--no-sandbox')
  return {
    args,
    // A runtime wrapper may outlive (or leave behind) its Electron subprocess.
    // Its own group lets a failed shutdown kill only this fixture's processes.
    detached: appImage,
    // Keep extraction leftovers inside the fixture if forced cleanup is needed.
    env: appImage ? { TMPDIR: base } : {}
  }
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true
  let timer
  let onExit
  const exited = new Promise((resolve) => {
    onExit = () => resolve(true)
    child.once('exit', onExit)
  })
  try {
    return await Promise.race([
      exited,
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs) })
    ])
  } finally {
    clearTimeout(timer)
    child.removeListener('exit', onExit)
  }
}

/** Let AppImage's wrapper reap Electron and clean up before a fixture restart. */
export async function stopAppImage(child, client, timeoutMs = 10_000) {
  if (!child.pid) throw new Error('AppImage failed to spawn')
  // The debugging socket may disappear before the reply. Do not await it.
  if (child.exitCode === null && child.signalCode === null && client) {
    void client.send('Browser.close').catch(() => {})
  }
  const graceful = await waitForExit(child, timeoutMs)
  if (graceful && child.exitCode === 0) return

  // Also clean up descendants when the wrapper already exited abnormally.
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch (cause) {
    if (cause.code !== 'ESRCH') throw cause
  }
  const terminated = await waitForExit(child, 2000)
  // A forced or abnormal shutdown must fail smoke even if assertions passed.
  const reason = graceful
    ? `AppImage exited with ${child.exitCode ?? child.signalCode}`
    : 'AppImage did not exit cleanly after Browser.close; killed its process group'
  throw new Error(`${reason}${terminated ? '' : '; wrapper termination unconfirmed'}`)
}
