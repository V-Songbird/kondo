# Stat-first, lazy scanning

A real user store held 8,921 project directories, with transcripts from
kilobytes to hundreds of megabytes. Parsing every JSONL at startup would take
minutes and burn memory for data no one is looking at.

Decision: scanning happens in two tiers.

- **Tier 1 — inventory (default):** directory entries + `stat` only. Yields
  counts, sizes, mtimes — enough for the dashboard, staleness, and sorting.
  No file contents are read.
- **Tier 2 — detail (on demand):** for a session the user opens or an
  analysis that needs it, stream the transcript's lines (never `readFile`
  whole) for its line and message counts, first user prompt and first and last
  timestamps. A read that only needs the opening stops at the first user
  message (`readFirstUserPrompt` in `jsonl.ts`). Results are cached in kondo's
  data directory keyed by `(path, size, mtime)` — a changed file re-parses, an
  unchanged one never does. `scan-cache.ts` is that cache: one JSON file per
  namespace under `<kondo-data>/scan-cache/`, written aside and renamed so a
  half-written file cannot outlive the process. Beside it sits the
  process-lifetime tier-1 inventory in the workspace, dropped after any
  sweep, trash or undo.

## Considered options

- **Full parse up front.** Rejected: minutes-long startup at observed scale.
- **A persistent watcher + live index.** Rejected for now: watching ~9k
  directories cross-platform is its own project; revisit if refresh feels
  slow.
- **Stat-first + on-demand streaming + mtime-keyed cache (chosen).**

## Consequences

- The UI must be honest about tiers: inventory numbers appear instantly,
  detail-derived numbers fill in as computed.
- The scan cache is disposable by design — deleting it only costs re-parsing.
  That is also why nothing in `scan-cache.ts` reports into a collector: a
  cache that cannot be read or written gives a slower answer, never a wrong
  one, and raising a "problem" over one would misdescribe the data (ADR-0005).
- Adapters expose both tiers explicitly; nothing silently escalates a whole
  store to tier 2.
- Tier 1 in practice:
  - `SessionSummary.mirroredIn` joins the desktop store's `local_<uuid>` stems
    to the code store's uuids — two listings, no file opened.
  - `projectsList` is the cached inventory plus a readdir per counted
    directory. Hooks and MCP servers live inside files, so their counts are
    `null` in the listing and counted by `projectDetail` for the one project
    opened; reading every project's `settings.json` to draw a list is the
    startup cost this decision refuses.
  - The tidy sweep classifies on names, never contents: a `session-env/`
    snapshot because its uuid is absent from the transcript set, a plugin
    cache version because no installation entry names it. Sizes are still
    measured, a cost per candidate rather than per store entry.
  - The cached inventory stats `~/.claude.json` and `projects/` on every read
    and rebuilds when either's mtime or size moved, so a registry entry Claude
    wrote after kondo started is seen without a restart. A rescan re-reads the
    detail pane as well as the list, because both project the same inventory.
- Tier 2 in practice: `sessionNearDuplicates(projectId)` compares opening
  prompts within one project and is reached by a button, never by drawing a
  row; `pluginSkills(pluginId)` opens each `SKILL.md` of the one plugin whose
  row was opened.
