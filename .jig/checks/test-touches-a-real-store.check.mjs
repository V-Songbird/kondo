// jig:owned — authored for kondo.
//
// docs/testing.md: tests never touch real stores. The locator takes injected roots
// for exactly this reason. Today the suite only reads, so a violation is merely
// wrong; from v0.2 the same line runs mutation code against the real ~/.claude and
// the damage is somebody's whole session history.
//
// The three doors to a real store are homedir(), the home-ish env vars, and a
// hard-coded store path handed to an fs or path call. The third pattern wants that
// call: a test TITLE mentioning ~/.claude, or an expected-value string in a
// pure-function assertion, is prose or data and reaches no store, so neither fires.
// path.join(home, '.claude') on a fixture home does not fire either — no separator
// precedes .claude in that literal.

export const id = "test-touches-a-real-store"
export const title = "A test resolving a real Claude store"
export const severity = "safety"
export const confidence = "deterministic"

export const deny = {
  "reason": "Tests must never resolve a real store (docs/testing.md). Read-only today, destructive the moment v0.2 mutations land.",
  "alternative": "Build a fixture world with makeWorld() from test/helpers.ts; it creates a temp home and hands you a locator already pointed at it.",
  "override": "Set .jig/off for one pass, or retire the guard via /jig:review."
}

const params = {
  paths: ["test/**/*.ts"],
  patterns: ["\\b(?:os\\.)?homedir\\s*\\(","\\bprocess\\.env(?:\\.(?:APPDATA|USERPROFILE|HOME)\\b|\\[[\"'](?:APPDATA|USERPROFILE|HOME))","(?:readFile|readdir|writeFile|mkdir|rm|stat|join|resolve)\\w*\\s*\\([^)]*[\"'][^\"']*[\\\\/]\\.claude"],
  stripComments: true,
  stripStrings: false,
  perLine: true
}

export const detectors = [
  { runner: "checks", lever: "check-driver", actor: "human-editor", confidence: "deterministic", params },
  { runner: "PreToolUse", lever: "edit-guard", actor: "claude-session", confidence: "deterministic", params }
]

export const fixtures = {
  violation: "import fs from 'node:fs/promises'\nimport os from 'node:os'\nimport path from 'node:path'\n\nconst store = path.join(os.homedir(), '.claude')\nconst desktop = process.env.APPDATA\n\nexport async function readReal(): Promise<string> {\n  const raw = await fs.readFile('C:/Users/me/.claude/settings.json', 'utf8')\n  return raw + store + String(desktop)\n}\n",
  nearMiss: "import { makeWorld, writeFileTree } from './helpers'\n\n// Fixtures only: a temp home, never the real one (docs/testing.md).\nexport async function seedStore(): Promise<string> {\n  const world = await makeWorld()\n  await writeFileTree(world.userRoot, { 'settings.json': '{}' })\n  return world.userRoot\n}\n"
}
