import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Builds a synthetic Claude store for kondo to run against.
 *
 * CLAUDE.md forbids pointing mutating code at a real `~/.claude`, and kondo
 * now writes. This tree is what the app is aimed at instead; it prints the
 * three env values the launch needs.
 *
 *   node fixture.mjs [baseDirectory]
 *
 * The base must contain no hyphen. Claude Code names a project directory by
 * flattening its absolute path with '-', and kondo reconstructs the original
 * by unflattening — a hyphen in the real path cannot round-trip, the project
 * fails to verify, and it then never appears as a move destination.
 */

const BASE = (process.argv[2] ?? 'X:/Temp/kondofix').split(path.sep).join('/')
if (path.basename(BASE).includes('-') || BASE.includes('-')) {
  throw new Error(`base path must hold no hyphen, or projects will not verify: ${BASE}`)
}

const home = path.join(BASE, 'home')
const userRoot = path.join(home, '.claude')
const desktopRoot = path.join(BASE, 'desktop')
const dataRoot = path.join(BASE, 'kondo-data')
const projA = path.join(BASE, 'work', 'apiserver')
const projB = path.join(BASE, 'work', 'website')

const BACKSLASH = String.fromCharCode(92)

/** Flatten an absolute path the way Claude Code names project directories. */
const flatten = (target) =>
  target
    .replace(/^([A-Za-z]):[\\/]/, '$1--')
    .split(BACKSLASH)
    .join('-')
    .split('/')
    .join('-')

const skill = (name, description) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`

const transcript = (id, prompt = 'hello kondo') =>
  [
    { type: 'summary', leafUuid: 'leaf', sessionId: id },
    {
      type: 'user',
      timestamp: '2026-08-20T10:00:00.000Z',
      message: { role: 'user', content: prompt }
    },
    {
      type: 'assistant',
      timestamp: '2026-08-20T10:00:05.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
    }
  ]
    .map((line) => JSON.stringify(line))
    .join('\n')

const write = async (root, files) => {
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'))
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, content, 'utf8')
  }
}

await fs.rm(BASE, { recursive: true, force: true })
await fs.mkdir(desktopRoot, { recursive: true })
await fs.mkdir(dataRoot, { recursive: true })

const pluginInstall = path.join(userRoot, 'plugins', 'cache', 'acme', 'foreman', '2.3.0')
const hushInstall = path.join(userRoot, 'plugins', 'cache', 'acme', 'hush', '1.0.0')

await write(userRoot, {
  'settings.json': JSON.stringify({ enabledPlugins: { 'foreman@acme': true } }, null, 2),
  'skills/commit-writer/SKILL.md': skill(
    'commit-writer',
    'Writes conventional commit messages from a staged diff'
  ),
  'skills/api-notes/SKILL.md': skill('api-notes', 'Summarises an OpenAPI spec into reviewer notes'),
  'skills.disabled/old-linter/SKILL.md': skill(
    'old-linter',
    'Superseded by the project linter, kept for reference'
  ),
  'plugins/installed_plugins.json': JSON.stringify(
    {
      version: 2,
      plugins: {
        'foreman@acme': [{ scope: 'user', installPath: pluginInstall, version: '2.3.0' }],
        'hush@acme': [{ scope: 'user', installPath: hushInstall, version: '1.0.0' }]
      }
    },
    null,
    2
  ),
  // Three sessions in one project, shaped for entry 034: the first two open
  // with the same request restated, the third with a different one. The
  // first also has a sidecar, so trashing it is two steps rather than one.
  [`projects/${flatten(projA)}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl`]: transcript(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'refactor the transcript reader'
  ),
  [`projects/${flatten(projA)}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/state.json`]: '{}',
  [`projects/${flatten(projA)}/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jsonl`]: transcript(
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    '  Refactor, the  TRANSCRIPT reader!  '
  ),
  [`projects/${flatten(projA)}/dddddddd-dddd-4ddd-8ddd-dddddddddddd.jsonl`]: transcript(
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    'ship the release notes today'
  ),
  [`projects/${flatten(projB)}/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl`]: transcript(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  )
})

// The desktop app holds one of those sessions under its own naming, so the
// mirror flag has something to find (entry 034).
await write(desktopRoot, {
  'local-agent-mode-sessions/device-1/account-1/local_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json':
    '{}'
})

// Ships inside a plugin, so kondo's skills catalogue must not list it. Two of
// them, so the per-plugin listing is a list rather than a single row.
await write(pluginInstall, {
  'skills/roadmap/SKILL.md': skill('roadmap', 'Ships with the foreman plugin, not the user'),
  'skills/survey/SKILL.md': skill('survey', 'Also ships with foreman, never with the user')
})

// Installed and real, and ships nothing: no 'skills' directory at all, which
// is the empty state under test. An empty directory is a different case.
await write(hushInstall, { 'commands/hush.md': '# hush\n' })

// A project verifies only when it has BOTH a transcript directory above and
// a real `.claude` directory here.
await write(projA, {
  '.claude/skills/db-migrate/SKILL.md': skill('db-migrate', 'Project-scoped migration helper')
})
await write(projB, { '.claude/skills/.keep': '' })

console.log(
  JSON.stringify(
    { KONDO_STORE_ROOT: userRoot, KONDO_DESKTOP_STORE_ROOT: desktopRoot, KONDO_DATA_ROOT: dataRoot },
    null,
    2
  )
)
