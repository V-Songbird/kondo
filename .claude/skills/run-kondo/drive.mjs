import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { connect, findPage, quoted } from './cdp.mjs'

/**
 * A one-shot CDP driver for a running kondo window.
 *
 * The protocol client lives in `cdp.mjs`, shared with the end-to-end smoke
 * test so the two cannot drift apart. Each command reconnects, which costs a
 * few milliseconds and keeps the driver stateless — the state that matters
 * lives in the app, not in here.
 *
 *   node drive.mjs shoot <name>              screenshot to <name>.png
 *   node drive.mjs open <TabLabel|rowText>  click a nav tab or a project row, then shoot
 *   node drive.mjs eval <expression>         evaluate in the page, print JSON
 *   node drive.mjs pick <rowText> <option>   choose a <select> option in a row
 *   node drive.mjs press <buttonText>        click a button by its text
 *
 * `open` takes the button whose whole text equals the argument first (a nav
 * tab), then the first whose text contains it (a project row, whose text
 * carries count chips). `press` and `pick` match by trimmed substring, first
 * match wins. Every screenshot lands in $KONDO_SHOTS if set, else under the
 * OS temp directory — never in the working directory, which is usually the
 * repo.
 */

const PORT = process.env.KONDO_CDP_PORT ?? '9222'
const SHOTS = process.env.KONDO_SHOTS ?? path.join(os.tmpdir(), 'kondo-shots')
await fs.mkdir(SHOTS, { recursive: true })

const page = await findPage(PORT)
if (!page) throw new Error(`no page target on port ${PORT} — is kondo running?`)
const client = await connect(page)
const { evaluate } = client

const shoot = async (name) => {
  const file = path.join(SHOTS, `${name.replace(/\.png$/, '').replace(/[^A-Za-z0-9._-]+/g, '-')}.png`)
  await fs.writeFile(file, await client.screenshot())
  return file
}

const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms))


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
          .find((element) => element.textContent.trim().includes(${label}))
        if (!target) return 'no button containing ' + ${label}
        if (target.disabled) return 'button is disabled: ' + ${label}
        target.click()
        return 'pressed ' + ${label}
      })()`)
    )
    await settle(900)
    say(await shoot('after-press'))
  } else if (command === 'open') {
    const label = quoted(rest.join(' '))
    const openExpression = `(() => {
      const buttons = [...document.querySelectorAll('button,a')]
      const tab =
        buttons.find((element) => element.textContent.trim() === ${label}) ??
        buttons.find((element) => element.textContent.includes(${label}))
      if (!tab) return null
      tab.click()
      return 'opened ' + tab.textContent.trim()
    })()`
    let opened = await evaluate(openExpression)
    if (opened === null) {
      // The projects list folds throwaway and gone rows away by default, and
      // the fixture sits under the OS temp root, so its rows are folded on a
      // fresh launch: unfold, let React render, and look again.
      const unfolded = await evaluate(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((element) => element.textContent.trim() === 'Show them')
        if (!button) return false
        button.click()
        return true
      })()`)
      if (unfolded) {
        await settle(400)
        opened = await evaluate(openExpression)
      }
    }
    say(opened ?? 'no tab or row containing ' + rest.join(' '))
    await settle(1200)
    say(await shoot(`tab-${rest.join('-').toLowerCase()}`))
  } else if (command === 'pick') {
    const [row, ...option] = rest
    // React tracks the value node itself, so assigning `select.value` is
    // ignored. Going through the prototype's native setter and dispatching a
    // bubbling `change` is what makes React see the choice.
    say(
      await evaluate(`(() => {
        // A row is the widest ancestor of a <select> that holds no other
        // <select>: a <tr> in the Skills table, a div in the Plugins section.
        const rowOf = (select) => {
          let node = select
          while (node.parentElement && node.parentElement.querySelectorAll('select').length === 1) {
            node = node.parentElement
          }
          return node
        }
        const select = [...document.querySelectorAll('select')]
          .find((candidate) => rowOf(candidate).textContent.includes(${quoted(row)}))
        if (!select) return 'no row with a select containing ' + ${quoted(row)}
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
  client.close()
}
