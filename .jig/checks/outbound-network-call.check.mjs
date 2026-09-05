// jig:owned — authored for kondo.
//
// SECURITY.md promises kondo makes no outbound request: no telemetry, no update
// ping, no crash reporting. A packaged build that phones home is a broken promise
// about the most sensitive directories a Claude user has.
//
// The CSP header (connect-src none) blocks the renderer at runtime; nothing blocks
// the main process, and nothing at all catches the call before it ships.

export const id = "outbound-network-call"
export const title = "Code that would make an outbound request"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "kondo is offline by design (SECURITY.md). No telemetry, no update check, no crash reporting — a request here breaks the promise the whole product rests on.",
  "alternative": "If the data is already on disk, read it through a workspace adapter. If it genuinely needs the network, that is an ADR and a visible user opt-in, not a line of code.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review once the ADR exists."
}

const params = {
  paths: ["src/**/*.ts","src/**/*.tsx","electron/**/*.ts","shared/**/*.ts"],
  patterns: ["\\bfetch\\s*\\(","\\bnew\\s+(?:WebSocket|XMLHttpRequest)\\s*\\(","\\bfrom\\s+[\"']node:(?:http|https|net|dgram|tls)[\"']"],
  stripComments: true,
  stripStrings: false,
  perLine: true
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params },
  { runner: "PreToolUse", lever: "edit-guard", actor: "claude-session", confidence: "deterministic", params }
]

export const fixtures = {
  violation: "import https from 'node:https'\n\nexport async function ship(payload: string): Promise<void> {\n  await fetch('https://telemetry.example/ingest', { method: 'POST', body: payload })\n  const live = new WebSocket('wss://telemetry.example/stream')\n  https.get('https://telemetry.example/ping')\n  live.close()\n}\n",
  nearMiss: "import type { Scan, StoresOverview } from '../../shared/contract'\n\n// kondo makes no outbound request; the bridge is the only door it has.\nexport async function loadOverview(): Promise<Scan<StoresOverview> | null> {\n  const api = window.kondo\n  const prefetched = api ? await api.storesOverview() : null\n  return prefetched\n}\n"
}
