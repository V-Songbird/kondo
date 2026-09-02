# Projects come from Claude's registry

Everything the owner wants from kondo — a per-project view, moving things
between projects, cleaning up projects that are gone — rests on one question:
which real directory does `~/.claude/projects/<flat>` belong to? Kondo v0.1
answered it by un-flattening the name: every `-` read as a separator, one
candidate, verified by stat. On the owner's machine that resolved 7 of 9,171
directories. Claude's flattening turns *every* character outside
`[A-Za-z0-9]` into `-`, so any project whose path holds a hyphen, an
underscore or a dot can never be reversed from its name. Every per-project
adapter (skills, settings layers, hooks, plugin chips, move destinations)
hangs off that answer, so most real projects were invisible.

Claude Code keeps the answer itself. `~/.claude.json` — a sibling of the user
store, not inside it — holds a `projects` map keyed by the real absolute
path of every directory Claude has run in (4,335 keys on the owner's
machine), alongside the user's MCP server declarations and per-project MCP
state. Flattening those keys with Claude's own rule gives an exact index.

Decision, three parts:

- **`~/.claude.json` is inside kondo's boundary.** It is Claude-owned state,
  the same standing as `~/.claude/settings.json`. The locator names it
  (`userConfigFile`, beside `userRoot`, so a fixture root brings its own).
  Kondo reads it as one parse per inventory and keeps only what a feature
  needs: today the `projects` keys; next the `mcpServers` objects (entry
  023). The per-project entries also carry `lastSessionFirstPrompt` and cost
  figures — kondo never surfaces those, and adapters copy out the keys they
  use rather than passing the parsed object around.
- **The project key is Claude's flattened path.** `[^A-Za-z0-9]` → `-`,
  applied to the registry key, is the join between `~/.claude.json`,
  `~/.claude/projects/<flat>`, and every id that names a project
  (`project:code:<flat>`, `project:<flat>` as a store, `settings:project:<flat>`
  as a layer). This closes the "every new kind defines its key rule" clause
  of ADR-0008 for anything project-scoped. Claude writes the same path under
  both slash spellings on Windows; `path.normalize` folds them before
  indexing.
- **Verification stays a stat.** A registry hit is a claim, not a fact — 52
  keys on the owner's machine point at directories that no longer exist.
  Kondo stats the path (ADR-0002's one permitted touch) before calling it a
  project, and a miss is what "dead project" means (entry 030). The
  un-flattening guess survives only as a fallback for a directory the
  registry has forgotten.

## Considered options

- **Un-flatten the name.** Rejected: lossy by construction; 7 of 9,171.
- **Ask the user to map directories.** Rejected: 9,171 questions, and
  kondo would hold a mapping Claude does not (ADR-0006).
- **Claude's registry, flattened with Claude's rule, verified by stat
  (chosen).** Exact where it applies, honest where it does not.

## Consequences

- Projects with hyphens in their names resolve; the `TMP_OK` gates in the
  suites can go once each fixture registers its paths (`registerProjects`).
- `~/.claude.json` is a 2 MB file Claude rewrites during every session.
  Reading it is tier-1 and safe. Writing it was not, at first: the `write`
  step replaces a whole file with bytes planned from a scan, and its undo
  restores a whole snapshot — either would silently discard whatever Claude
  wrote in between. No mutation could target this file until a step that
  re-reads and checks the bytes it is about to change existed, which
  [ADR-0010](0010-splice-config-files-never-whole-file-writes.md) supplies:
  the registry is written by splice, and only by splice.
- The registry does not know a project that has a `.claude` directory but
  no Claude session yet, and `~/.claude/projects` does not know a project
  whose transcripts were swept. The project set kondo should show is the
  union of both sources (entry 025); today it is still the directory list.
