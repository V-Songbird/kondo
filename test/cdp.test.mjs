import { afterEach, describe, expect, it, vi } from 'vitest'
import { connect } from '../.claude/skills/run-kondo/cdp.mjs'
import { assertRendererHealthy, monitorRenderer } from './e2e/renderer-health.mjs'

// No sockets or requests: exercise the real client with protocol frames.
class ProtocolSocket extends EventTarget {
  static instance
  static respond = () => ({})
  commands = []

  constructor() {
    super()
    ProtocolSocket.instance = this
    queueMicrotask(() => this.dispatchEvent(new Event('open')))
  }

  frame(message) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }

  send(raw) {
    const command = JSON.parse(raw)
    this.commands.push(command)
    const result = ProtocolSocket.respond(command, this)
    if (result !== undefined) this.frame({ id: command.id, result })
  }

  close() { this.dispatchEvent(new Event('close')) }
}

const page = { webSocketDebuggerUrl: 'ws://synthetic.invalid' }
const exception = { exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: synthetic failure' } } }
const consoleError = { type: 'error', args: [{ type: 'string', value: 'synthetic console error' }] }
const request = (url) => ({ requestId: 'synthetic', type: 'Document', request: { url } })

async function open(respond = () => ({})) {
  ProtocolSocket.respond = respond
  vi.stubGlobal('WebSocket', ProtocolSocket)
  return connect(page)
}

afterEach(() => {
  ProtocolSocket.instance?.close()
  vi.unstubAllGlobals()
})

describe('shared CDP events and commands', () => {
  it('captures replayed Runtime evidence before enable replies, without warnings', async () => {
    const client = await open(({ method }, socket) => {
      if (method === 'Runtime.enable') {
        socket.frame({ method: 'Runtime.exceptionThrown', params: exception })
        socket.frame({ method: 'Runtime.consoleAPICalled', params: consoleError })
        socket.frame({ method: 'Runtime.consoleAPICalled', params: { type: 'warning', args: [] } })
      }
      return {}
    })
    expect(client.exceptions).toEqual([exception])
    expect(client.consoleErrors).toEqual([consoleError])
    client.close()
    expect(client.exceptions).toEqual([exception])
  })

  it('delivers unsolicited events to subscribers and supports unsubscribe', async () => {
    const client = await open()
    const first = vi.fn()
    const second = vi.fn()
    const off = client.on('Page.loadEventFired', first)
    client.on('Page.loadEventFired', second)
    ProtocolSocket.instance.frame({ method: 'Page.loadEventFired', params: { timestamp: 1 } })
    off()
    ProtocolSocket.instance.frame({ method: 'Page.loadEventFired', params: { timestamp: 2 } })
    expect(first).toHaveBeenCalledExactlyOnceWith({ timestamp: 1 })
    expect(second.mock.calls).toEqual([[{ timestamp: 1 }], [{ timestamp: 2 }]])
  })

  it('correlates out-of-order replies around events and rejects protocol errors', async () => {
    const client = await open()
    ProtocolSocket.respond = () => undefined
    const one = client.send('one')
    const two = client.send('two')
    const socket = ProtocolSocket.instance
    const [a, b] = socket.commands.slice(-2)
    socket.frame({ method: 'Runtime.exceptionThrown', params: exception })
    socket.frame({ id: 999, result: {} })
    socket.frame({ id: b.id, result: { value: 2 } })
    socket.frame({ id: a.id, error: { message: 'command rejected' } })
    await expect(two).resolves.toEqual({ value: 2 })
    await expect(one).rejects.toThrow('command rejected')
    expect(client.exceptions).toEqual([exception])
  })

  it('defers subscriptions added during dispatch and makes unsubscribe idempotent', async () => {
    const client = await open()
    const later = vi.fn()
    let off
    off = client.on('event', () => {
      off()
      client.on('event', later)
    })
    ProtocolSocket.instance.frame({ method: 'event', params: {} })
    expect(later).not.toHaveBeenCalled()
    off()
    ProtocolSocket.instance.frame({ method: 'event', params: {} })
    expect(later).toHaveBeenCalledOnce()
  })

  it.each(['local', 'remote', 'error'])('rejects outstanding and future commands on %s disconnect', async (kind) => {
    const client = await open()
    ProtocolSocket.respond = () => undefined
    const pending = client.send('waiting')
    if (kind === 'local') client.close()
    else ProtocolSocket.instance.dispatchEvent(new Event(kind === 'remote' ? 'close' : 'error'))
    await expect(pending).rejects.toThrow('closed before replying')
    await expect(client.send('later')).rejects.toThrow('closed')
    expect(() => client.on('event', () => {})).toThrow('closed')
  })

  it('preserves evaluate values and evaluation rejection', async () => {
    const client = await open()
    ProtocolSocket.respond = () => ({ result: { value: 42 } })
    await expect(client.evaluate('6 * 7')).resolves.toBe(42)
    ProtocolSocket.respond = () => exception
    await expect(client.evaluate('throw new Error()')).rejects.toThrow('synthetic failure')
  })
})

describe('smoke renderer gate', () => {
  it('observes Network events emitted during enable and permits local schemes', async () => {
    const client = await open()
    ProtocolSocket.respond = ({ method }, socket) => {
      if (method === 'Network.enable') {
        for (const url of ['file:///fixture/index.html', 'devtools://devtools/bundled/']) {
          socket.frame({ method: 'Network.requestWillBeSent', params: request(url) })
        }
      }
      return {}
    }
    const evidence = await monitorRenderer(client)
    expect(evidence.requests).toHaveLength(2)
    expect(() => assertRendererHealthy(evidence)).not.toThrow()
  })

  it.each(['https://synthetic.invalid/', 'http://127.0.0.1/', 'data:text/plain,test', 'blob:file:///test', 'invalid'])
    ('fails on a synthetic disallowed request: %s', async (url) => {
      const client = await open()
      const evidence = await monitorRenderer(client)
      ProtocolSocket.instance.frame({ method: 'Network.requestWillBeSent', params: request(url) })
      expect(() => assertRendererHealthy(evidence)).toThrow('disallowedRequests')
      expect(() => assertRendererHealthy(evidence)).toThrow(url)
    })

  it.each([
    ['Runtime.exceptionThrown', exception, 'synthetic failure'],
    ['Runtime.consoleAPICalled', consoleError, 'synthetic console error']
  ])('fails on %s and retains the evidence across close', async (method, params, text) => {
    const client = await open()
    const evidence = await monitorRenderer(client)
    ProtocolSocket.instance.frame({ method, params })
    client.close()
    expect(() => assertRendererHealthy(evidence)).toThrow(text)
  })
})
