import fs from 'node:fs/promises'

/**
 * A one-shot CDP driver for a running kondo window.
 *
 * No Playwright, and none is wanted: Node 22 ships a global `WebSocket`, so
 * driving Chromium's debugging protocol is a fetch and a socket. Each command
 * reconnects, which costs a few milliseconds and keeps the driver stateless —
 * the state that matters lives in the app, not in here.
 *
 *   node drive.mjs shoot <name>              screenshot to <name>.png
 *   node drive.mjs open <TabLabel>           click a sidebar tab, then shoot
 *   node drive.mjs eval <expression>         evaluate in the page, print JSON
 *   node drive.mjs pick <rowText> <option>   choose a <select> option in a row
 *   node drive.mjs press <buttonText>        click a button by its text
 *
 * `shoot` writes into $KONDO_SHOTS if set, else the working directory.
 */

const PORT = process.env.KONDO_CDP_PORT ?? '9222'
const SHOTS = process.env.KONDO_SHOTS ?? '.'

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error(`no page target on port ${PORT} — is kondo running?`)

const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(event.data)
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
  else entry.resolve(message.result)
})

const send = (method, params = {}) => {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
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

const shoot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const file = `${SHOTS}/${name.replace(/\.png$/, '')}.png`
  await fs.writeFile(file, Buffer.from(data, 'base64'))
  return file
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A string literal safe to paste into an evaluated expression. */
const quoted = (value) => JSON.stringify(String(value))

await send('Page.enable')
await send('Runtime.enable')

const [command, ...rest] = process.argv.slice(2)
const say = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))

try {
  if (command === 'shoot') {
    say(await shoot(rest[0] ?? 'shot'))
  } else if (command === 'eval') {
    say(await evaluate(rest.join(' ')))
  } else if (command === 'press') {
    const label = quoted(rest.join(' '))
    say(
      await evaluate(`(() => {
        const target = [...document.querySelectorAll('button,a')]
          .find((element) => element.textContent.trim() === ${label})
        if (!target) return 'no button matching ' + ${label}
        if (target.disabled) return 'button is disabled: ' + ${label}
        target.click()
        return 'pressed ' + ${label}
      })()`)
    )
    await settle(900)
    say(await shoot('after-press'))
  } else if (command === 'open') {
    const label = quoted(rest.join(' '))
    say(
      await evaluate(`(() => {
        const tab = [...document.querySelectorAll('button,a')]
          .find((element) => element.textContent.trim() === ${label})
        if (!tab) return 'no tab named ' + ${label}
        tab.click()
        return 'opened ' + ${label}
      })()`)
    )
    await settle(1200)
    say(await shoot(`tab-${rest.join('-').toLowerCase()}`))
  } else if (command === 'pick') {
    const [row, ...option] = rest
    // React tracks the value node itself, so assigning `select.value` is
    // ignored. Going through the prototype's native setter and dispatching a
    // bubbling `change` is what makes React see the choice.
    say(
      await evaluate(`(() => {
        const row = [...document.querySelectorAll('tbody tr')]
          .find((candidate) => candidate.textContent.includes(${quoted(row)}))
        if (!row) return 'no row containing ' + ${quoted(row)}
        const select = row.querySelector('select')
        if (!select) return 'row has no select'
        if (select.disabled) return 'select is disabled: ' + (select.title || 'no reason given')
        const choice = [...select.options]
          .find((candidate) => candidate.textContent.includes(${quoted(option.join(' '))}))
        if (!choice) return 'no option matching ' + ${quoted(option.join(' '))}
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype, 'value'
        ).set
        setter.call(select, choice.value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
        return 'picked ' + choice.textContent.trim()
      })()`)
    )
    await settle(1800)
    say(await shoot('after-pick'))
  } else {
    say(`unknown command ${command ?? '(none)'} — see the header of this file`)
  }
} finally {
  socket.close()
}
