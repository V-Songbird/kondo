# The project privacy boundary

Kondo is about Claude's files, and users must be able to trust that pointing
it at their machine does not mean it reads their source code, documents, or
anything else. The boundary: **inside a project, kondo opens only the
`.claude` directory** (its `settings.json`, `settings.local.json`, `skills/`,
and other Claude-only entries). The rest of the project tree is never listed,
opened, or statted.

One deliberate refinement: verifying that a flattened
`~/.claude/projects/<name>` still corresponds to a real working directory
requires an existence check on the reconstructed path. That is a `stat` of
the project root and its `.claude` child only — never a directory listing,
never file reads.

## Amendment (entry 023): `<project>/.mcp.json`

**`<project>/.mcp.json` is the one Claude-owned file kondo may open outside a
`.claude` directory.** Nothing else at a project root is readable — not
`CLAUDE.md`, not `CLAUDE.local.md`, not `package.json`, not `.gitignore`.

Why this one file and no other: project-scope MCP servers are declared there
and nowhere else. Claude Code fixed that name and that location, so the file
is Claude's own data that merely happens to sit one directory above the
boundary; the alternative — leaving project-scope servers invisible — would
mean kondo shows a user two of their three MCP scopes and silently drops the
one their team committed. The read is by exact name, so no listing of the
project root is needed to find it, and the values under `env` and `headers`
are never carried out of it: they hold API keys and bearer tokens.

The exception buys exactly one file. Any second file outside `.claude`
requires its own amendment here, and `test/boundary.test.ts` pins the list so
a widening fails a test rather than passing review.

## Considered options

- **Read project files to enrich insights** (e.g. detect language, size the
  repo). Rejected: any project-content read makes "Claude-only" a lie and
  turns kondo into a scanner users must audit.
- **Hard boundary with the stat-only exception (chosen).**
- **Read `.mcp.json` through the `.claude` boundary only.** Rejected: it is
  not there. Claude reads project-scope MCP servers from the project root, so
  refusing the path would mean inventing a location Claude does not use
  (ADR-0006).

## Consequences

- Enforced in code: the store locator exposes no API that yields a
  non-`.claude` project path, and a safety-invariant test fails if any code
  path escapes (docs/testing.md).
- The allowed set outside a `.claude` directory is exactly three things and
  `test/boundary.test.ts` asserts it as a literal: the project root itself
  (stat only), `~/.claude.json` (ADR-0009), and `<project>/.mcp.json`.
- Some insights stay impossible on purpose; ROADMAP lists this under
  non-goals so it is not re-litigated feature by feature.

## Amendment, 2026-09-03 — a hook's script is checked, or reported unchecked

Entry 036 added `HookInfo.script`: the script a hook command runs, and
whether it is on disk. That is a stat against a path kondo did not choose —
the command did — so the boundary decides it *before* any filesystem call,
never after.

`resolveScript` in `user-store.ts` returns a path only when it lands inside
`locator.userRoot` or inside a verified project's `.claude`. Everything else
answers null and the row reads `unverifiable`:

- a token holding `$` or `%` — `$CLAUDE_PROJECT_DIR`, `$CLAUDE_PLUGIN_ROOT`,
  `%USERPROFILE%`. Kondo expands no shell variable, because expanding one is
  guessing at a path it was not given;
- a relative path in the **user** layer, whose hooks run in whatever directory
  Claude was started in. A **project** layer's relative path does resolve —
  against that project, which is where Claude runs its hooks;
- anything resolving outside both roots, however ordinary it looks.

The allowed set outside a `.claude` directory is unchanged: this amendment
buys no fourth path. It records that a *reported* path and a *statted* path
are different things, and that `unverifiable` is the honest answer rather
than a reach. `test/hooks.test.ts` spies on `fs.stat` and asserts neither
unverifiable row was ever probed.
