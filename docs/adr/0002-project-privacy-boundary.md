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

## Considered options

- **Read project files to enrich insights** (e.g. detect language, size the
  repo). Rejected: any project-content read makes "Claude-only" a lie and
  turns kondo into a scanner users must audit.
- **Hard boundary with the stat-only exception (chosen).**

## Consequences

- Enforced in code: the store locator exposes no API that yields a
  non-`.claude` project path, and a safety-invariant test fails if any code
  path escapes (docs/testing.md).
- Some insights stay impossible on purpose; ROADMAP lists this under
  non-goals so it is not re-litigated feature by feature.
