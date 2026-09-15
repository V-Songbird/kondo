# Projects come from Claude's registry

Everything per-project in kondo — a project page, moving things between
projects, cleaning up projects that are gone — rests on one question: which
real directory does `~/.claude/projects/<flat>` belong to? Claude's flattening
turns *every* character outside `[A-Za-z0-9]` into `-`, so any project whose
path holds a hyphen, an underscore or a dot can never be reversed from its
name: un-flattening resolved 7 of 9,171 directories on the owner's machine.

Claude Code keeps the answer itself. `~/.claude.json` — a sibling of the user
store, not inside it — holds a `projects` map keyed by the real absolute
path of every directory Claude has run in (4,335 keys on the owner's
machine). Flattening those keys with Claude's own rule gives an exact index.

Decision, three parts:

- **`~/.claude.json` is inside kondo's boundary.** It is Claude-owned state,
  the same standing as `~/.claude/settings.json`. The locator names it
  (`userConfigFile`, beside `userRoot`, so a fixture root brings its own).
  Kondo keeps only what a feature needs — the `projects` keys, `mcpServers`,
  the per-project MCP disable lists and `skillUsage` — and never surfaces
  session telemetry such as `lastSessionFirstPrompt` or cost figures; adapters
  copy out the keys they use rather than passing the parsed object around.
- **The project key is Claude's flattened path.** `[^A-Za-z0-9]` → `-`,
  applied to the registry key, is the join between `~/.claude.json`,
  `~/.claude/projects/<flat>`, and every id that names a project
  (`project:code:<flat>`, `project:<flat>` as a store, `settings:project:<flat>`
  as a layer). Claude writes the same path under both slash spellings on
  Windows; `path.normalize` folds them before indexing.
- **Verification stays a stat.** A registry hit is a claim, not a fact — 52
  keys on the owner's machine pointed at directories that no longer exist.
  Kondo stats the path (ADR-0002) before calling it a project. The
  un-flattening guess survives only as a fallback for a directory the registry
  has forgotten.

## Considered options

- **Un-flatten the name.** Rejected: lossy by construction; 7 of 9,171.
- **Ask the user to map directories.** Rejected: 9,171 questions, and
  kondo would hold a mapping Claude does not (ADR-0006).
- **Claude's registry, flattened with Claude's rule, verified by stat
  (chosen).** Exact where it applies, honest where it does not.

## Consequences

- Projects with hyphens in their names resolve; test fixtures register their
  paths with `registerProjects`.
- `~/.claude.json` is a 2 MB file Claude rewrites during every session.
  Reading it is tier-1 and safe. A change to it would be a splice, and every
  such plan is refused
  ([ADR-0010](0010-splice-config-files-never-whole-file-writes.md)).
- The project set is the union of the registry and `~/.claude/projects`,
  because each forgets projects the other knows. A figure drawn from the union
  must not wear the narrower half's label: `StoresOverview` reports
  `projectCount` (the union) and `transcriptProjectCount` (members holding at
  least one transcript) as a pair, both from the one tier-1 inventory.
- A failed stat means different things on the two halves, so the seam carries
  four `ProjectLocation` states, not a flag: `here`; `gone`, when the registry
  named the path and the stat returned ENOENT; `unreadable`, when it failed any
  other way (a `stat-failed` error, never read as deletion); and `unlocated`,
  when only the lossy guess proposed a path, which says nothing about whether
  the project lives. Collapsing them would let the sweep offer a live project
  for deletion on the strength of a bad guess. Only `gone` feeds the
  `dead-projects` category and the dead registry entries configuration cleanup
  reports.
