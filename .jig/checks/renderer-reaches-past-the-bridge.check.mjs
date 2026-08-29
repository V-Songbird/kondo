// jig:owned — authored for kondo.
//
// The renderer has no filesystem and no Electron access: it reaches disk only
// through the context-isolated preload bridge (ADR-0004). An `fs` or `electron`
// import under src/ silently removes that boundary — the process that renders
// attacker-influenced transcript text would gain the power to read any file.
//
// Strings are left intact on purpose: the module specifier IS the evidence, and
// the blanker would erase it. Comments are stripped, so prose about node: imports
// never fires.

export const id = "renderer-reaches-past-the-bridge"
export const title = "Renderer code imports node or electron directly"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "src/ is the renderer. It has no Node and no Electron access by design (ADR-0004); importing them removes the sandbox that keeps transcript rendering safe.",
  "alternative": "Add the capability to electron/main/workspace/, expose it as a typed method on shared/contract.ts, and call it through window.kondo.",
  "override": "If this file is genuinely main-process code, move it under electron/. To bypass once, set .jig/off; to retire the guard, run /jig:review."
}

const params = {
  paths: ["src/**/*.ts","src/**/*.tsx"],
  patterns: ["\\bfrom\\s+[\"']node:","\\bfrom\\s+[\"']electron[\"']","\\brequire\\s*\\("],
  stripComments: true,
  stripStrings: false,
  perLine: true
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params },
  { runner: "PostToolUse", lever: "edit-observe-guard", actor: "claude-session", confidence: "deterministic", params }
]

export const fixtures = {
  violation: "import fs from 'node:fs'\nimport { ipcRenderer } from 'electron'\n\nconst nodePath = require('node:path')\n\nexport function readSetting(file: string): string {\n  return fs.readFileSync(nodePath.join('/tmp', file), 'utf8') + String(ipcRenderer)\n}\n",
  nearMiss: "import type { KondoApi } from '../../shared/contract'\n\n// Disk access lives in electron/main; the renderer only ever holds ids.\nexport function requireBridge(): KondoApi {\n  const api = window.kondo\n  if (!api) throw new Error('the kondo bridge is unavailable')\n  return api\n}\n"
}
