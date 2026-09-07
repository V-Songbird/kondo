import assert from 'node:assert/strict'

/** Subscribe before Network.enable; retain evidence until the run is over. */
export async function monitorRenderer(client) {
  const requests = []
  client.on('Network.requestWillBeSent', (event) => requests.push(event))
  await client.send('Network.enable')
  return { exceptions: client.exceptions, consoleErrors: client.consoleErrors, requests }
}

export function assertRendererHealthy(evidence) {
  const disallowedRequests = evidence.requests.filter(({ request }) => {
    try {
      return !['file:', 'devtools:'].includes(new URL(request.url).protocol)
    } catch {
      return true
    }
  })
  const violations = {
    exceptions: evidence.exceptions,
    consoleErrors: evidence.consoleErrors,
    disallowedRequests
  }
  assert.ok(Object.values(violations).every((events) => events.length === 0),
    `Renderer health violations: ${JSON.stringify(violations, null, 2)}`)
}
