# The project privacy boundary

Kondo is about Claude's files, and users must be able to trust that pointing
it at their machine does not mean it reads their source code, documents, or
anything else. The boundary: **inside a project, kondo opens only the
`.claude` directory** (its `settings.json`, `settings.local.json`, `skills/`,
and other Claude-only entries). The rest of the project tree is never listed,
opened, or statted.

Outside a `.claude` directory kondo touches exactly three things, and
`test/boundary.test.ts` asserts them as a literal:

- the project root and its `.claude` child, **stat only**, to verify that a
  flattened `~/.claude/projects/<name>` still corresponds to a real working
  directory;
- `~/.claude.json`, Claude's registry
  ([ADR-0009](0009-projects-come-from-claudes-registry.md));
- `<project>/.mcp.json`, read by exact name. Project-scope MCP servers are
  declared there and nowhere else; leaving it out would show a user two of
  their three MCP scopes and silently drop the one their team committed. The
  values under its `env` and `headers` hold API keys and bearer tokens and
  never leave the main process.

Nothing else at a project root is readable — not `CLAUDE.md`,
`CLAUDE.local.md`, `package.json` or `.gitignore`. A second file outside
`.claude` needs its own change to this decision.

## Considered options

- **Read project files to enrich insights** (e.g. detect language, size the
  repo). Rejected: any project-content read makes "Claude-only" a lie and
  turns kondo into a scanner users must audit.
- **Read `.mcp.json` through the `.claude` boundary only.** Rejected: it is
  not there. Claude reads project-scope MCP servers from the project root, so
  refusing the path would mean inventing a location Claude does not use
  (ADR-0006).
- **Hard boundary with the stat-only and named-file exceptions (chosen).**

## Consequences

- Enforced in code: the store locator exposes no API that yields a
  non-`.claude` project path, and a safety-invariant test fails if any code
  path escapes (docs/testing.md).
- Some insights stay impossible on purpose; ROADMAP lists this under
  non-goals so it is not re-litigated feature by feature.

## Resolved boundaries

A lexical child path does not establish permission to open its bytes. Each
scanner passes its owning user, desktop or verified project `.claude` root to
the shared boundary helper, which checks containment lexically and again after
resolving the root and target, before listing, statting or opening. An
in-store alias is supported; an alias into another allowed store is still an
escape from this operation's root. The configured root itself may be an alias
and remains the locator's authority. The two exact-file exceptions grant only
their filename beneath its resolved parent, so neither can redirect a read to
a sibling. Chromium Singleton markers are examined with `lstat` without
following their link targets.

Missing optional entries are ordinary absence; dangling links and cycles are
failures that return itemized errors beside healthy siblings. Recursive hashes
and copies need a complete tree and check every member, and transcript
streams, lock handles and cache hits revalidate their path before use. Trash
preserves link metadata so Undo can restore the original entries, but
inventory and verification never follow an archived link, and Undo validates
the future tree before journaling. Live-store copies materialize safe linked
contents rather than creating cross-store aliases. These are pathname checks,
not a kernel sandbox: they do not eliminate every TOCTOU race against another
process replacing directories.

## Hook script paths

A hook command names a script kondo did not choose, so the boundary decides
before any filesystem call. `resolveScript` in `user-store.ts` returns a path
only inside `locator.userRoot` or a verified project's `.claude`; everything
else is `unverifiable` and is never statted:

- a token holding `$` or `%` — kondo expands no variable, because expanding
  one is guessing at a path it was not given;
- a relative path in the **user** layer, whose hooks run wherever Claude was
  started (a **project** layer's relative path resolves against that
  project);
- anything resolving outside both roots.

A hook row carries only `present`, `missing` or `unverifiable`
([ADR-0022](0022-project-settings-data-deny-by-default.md));
`test/hooks.test.ts` asserts unverifiable rows are never probed. Recognized
script references are not a complete execution inventory — variables,
compound commands, other sources and scripts calling scripts can hide one —
so cleanup retains every hook script: `unarmed-hook-scripts` offers nothing and
refuses selection.
