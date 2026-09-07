/**
 * The one CDP client kondo drives itself with: the run-kondo skill's
 * `drive.mjs` and the end-to-end smoke test (`test/e2e/smoke.mjs`) both import
 * this, so the two cannot drift apart.
 *
 * No Playwright, and none is wanted: Node 22 ships a global `WebSocket`, so
 * driving Chromium's debugging protocol is a fetch and a socket.
 */

/**
 * The app's page on the debugging port, or null when nothing answers yet — a
 * launch in progress, or no kondo at all. The splash the main process shows
 * while the window builds is a page target too, and it is gone a second
 * later, so it is never the one to drive.
 */
export async function findPage(port) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    return (
      targets.find((target) => target.type === 'page' && !target.url.endsWith('splash.html')) ?? null
    )
  } catch {
    return null
  }
}

/** Poll for a page target until one appears or `timeoutMs` passes. */
export async function waitForPage(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = await findPage(port)
    if (page) return page
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`no page target on port ${port} after ${timeoutMs} ms — is kondo running?`)
}

/**
 * Connect to one page. The returned client evaluates expressions (awaiting
 * promises, returning values), captures screenshots, and closes.
 */
export async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const listeners = new Map()
  const exceptions = []
  const consoleErrors = []
  let closed = false
  const on = (method, handler) => {
    if (closed) throw new Error('CDP connection is closed')
    if (!listeners.has(method)) listeners.set(method, new Set())
    const handlers = listeners.get(method)
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0 && listeners.get(method) === handlers) listeners.delete(method)
    }
  }
  // Runtime.enable can replay evidence before its command response arrives.
  on('Runtime.exceptionThrown', (params) => exceptions.push(params))
  on('Runtime.consoleAPICalled', (params) => {
    if (params.type === 'error') consoleErrors.push(params)
  })
  const disconnect = () => {
    closed = true
    for (const entry of pending.values()) entry.reject(new Error('CDP connection closed before replying'))
    pending.clear()
    listeners.clear()
  }
  socket.addEventListener('close', disconnect)
  socket.addEventListener('error', disconnect)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) {
      // Snapshot: handlers added during delivery start with the next event.
      // oxlint-disable-next-line unicorn/no-useless-spread
      for (const handler of [...(listeners.get(message.method) ?? [])]) handler(message.params)
      return
    }
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })

  const send = (method, params = {}) => {
    if (closed) return Promise.reject(new Error('CDP connection is closed'))
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        socket.send(JSON.stringify({ id, method, params }))
      } catch (cause) {
        pending.delete(id)
        reject(cause)
      }
    })
  }

  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? String(expression))
    }
    return result.result.value
  }

  try {
    await send('Page.enable')
    await send('Runtime.enable')
  } catch (cause) {
    disconnect()
    socket.close()
    throw cause
  }

  return {
    send,
    on,
    exceptions,
    consoleErrors,
    evaluate,
    /** PNG bytes of the current frame. */
    async screenshot() {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      return Buffer.from(data, 'base64')
    },
    /** Evaluate until `expression` is truthy, or fail after `timeoutMs`. */
    async waitFor(expression, timeoutMs = 15_000) {
      const deadline = Date.now() + timeoutMs
      let last
      while (Date.now() < deadline) {
        last = await evaluate(expression)
        if (last) return last
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      throw new Error(`timed out waiting for ${expression} (last value: ${JSON.stringify(last)})`)
    },
    close() {
      disconnect()
      socket.close()
    }
  }
}

/** A string literal safe to paste into an evaluated expression. */
export const quoted = (value) => JSON.stringify(String(value))
