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
  message counts, and duplicate signatures. Results are cached in kondo's
  data directory keyed by `(path, size, mtime)` — a changed file re-parses,
  an unchanged one never does.

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
- Adapters expose both tiers explicitly; nothing silently escalates a whole
  store to tier 2.
- A plugin's own skills are a tier-2 read of the plugins view:
  `pluginSkills(pluginId)` opens each `SKILL.md` under the one plugin whose
  row was opened, never every plugin's at listing time.
