# Stat-first, lazy scanning

A real user store held 8,921 project directories, with transcripts from
kilobytes to hundreds of megabytes. Parsing every JSONL at startup would take
minutes and burn memory for data no one is looking at.

Decision: scanning happens in two tiers.

- **Tier 1 — inventory (default):** directory entries + `stat` only. Yields
  counts, sizes, mtimes — enough for the dashboard, staleness, and sorting.
  No file contents are read.
- **Tier 2 — detail (on demand):** for a session the user opens or an
  analysis that needs it, read the transcript's first and last lines to bound
  it in time, and stream lines (never `readFile` whole) for worked time,
  message counts, and duplicate signatures. A read that only needs the
  opening stops at the first user message rather than running the file out
  (`readFirstUserPrompt` in `jsonl.ts`). Results are cached in kondo's data
  directory keyed by `(path, size, mtime)` — a changed file re-parses, an
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
  detail-derived numbers (worked time, duplicates) fill in as computed.
- The scan cache is disposable by design — deleting it only costs re-parsing.
  That is also why nothing in `scan-cache.ts` reports into a collector: a
  cache that cannot be read or written gives a slower answer, never a wrong
  one, and raising a "problem" over one would misdescribe the data (ADR-0005).
- Duplicate sessions are the split in one feature (entry 034).
  `SessionSummary.mirroredIn` is tier 1 — the desktop store's `local_<uuid>`
  stems joined to the code store's uuids, two listings and no file opened.
  `sessionNearDuplicates(projectId)` is tier 2, and takes a project rather
  than a store precisely because the alternative is the whole-store parse
  this ADR refuses; it is reached by a button in the sessions table, never by
  drawing one.
- Adapters expose both tiers explicitly; nothing silently escalates a whole
  store to tier 2.
- A plugin's own skills are a tier-2 read of the plugins view:
  `pluginSkills(pluginId)` opens each `SKILL.md` under the one plugin whose
  row was opened, never every plugin's at listing time.
- The tidy sweep classifies on names, never on contents. A `session-env/`
  snapshot is a candidate because its uuid is absent from the transcript set,
  and a `plugins/cache/<mp>/<plugin>/<version>/` tree because it is not the
  `installPath` `installed_plugins.json` names — so neither opens a snapshot
  nor walks a plugin tree to decide one (entry 033). Sizes are still measured,
  because what a category reclaims is the whole reason to offer it; that is a
  cost per *candidate*, not per store entry.
- The projects home is the same split at the app's front door.
  `projectsList` is tier 1 — the cached inventory plus a readdir per
  directory it counts, opening no file in any store — and `projectDetail` is
  tier 2 for the one row a user picked. Two of the counts a row would like to
  show cannot be made at tier 1 at all, because they live inside files: hooks
  and MCP servers are `null` in the listing and counted in the detail. The
  honest null is the point; reading every project's `settings.json` to draw a
  list is exactly the startup cost this ADR exists to refuse.
- The cached inventory is not trusted past the store it was read from
  (entry 056). Every `inventory()` call stats the two things the inventory is
  built from — `~/.claude.json` and the `projects/` directory — and rebuilds
  when either's mtime or size moved, so a registry entry Claude wrote after
  kondo started is seen without a restart and without a full rescan. Two
  stats per call is the tier-1 price; the rebuild itself is the same tier-1
  readdir the first read was. A rescan the user asks for (entry 051) re-reads
  the detail pane as well as the list, because both are projections of that
  one inventory and must never disagree about the project set.
