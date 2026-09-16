# Plan: resolved overlap between Kondo's data root and Claude's stores

Status: **in progress**

ADR-0001 decision 6 says `<kondo-data>` must never sit inside a Claude store:
kondo's trash inside a store would show up in kondo's own scan, and a sweep
could trash its own undo history. Today the rule is enforced lexically and
once — `createAppearance` computes `overlapsClaude` at construction
(`appearance.ts:31`), `createMutations` computes `nested` at construction
(`mutations.ts:444`), and `rootOf` applies the same string comparison to a
dynamic project root (`mutations.ts:461`). A `KONDO_DATA_ROOT`, or any ancestor
of it, that is a link into a Claude store passes every one of those
comparisons, and a link created after the workspace exists is never looked at
again. `scan-cache.ts` and `profile.ts` do not compare at all. This slice
replaces the lexical, construction-time comparison with a resolved one taken at
each operation, before any read or write.

## Scope

**workspace**

- `scan.ts` gains one exported helper, `overlapRefusal`, beside the resolution
  helpers it already owns (`realpathWithMissing`, `samePath`, `pathWithin`,
  `BoundaryError`).
- `appearance.ts` calls it on read and on write, replacing `overlapsClaude`.
- `mutations.ts` calls it at `list`, `trashSize`, `mutate`, `undo` and
  `emptyTrash`, replacing the construction-time `nested` value, and inside
  `rootOf` for a dynamic project root, replacing the lexical test there.
- `scan-cache.ts` calls it in `openScanCache` and returns an inert cache when
  it refuses; `kinds.ts` passes the store roots at the one call site.
- `profile.ts` calls it at the top of `claimDataRoot`, which becomes `async`;
  `index.ts` awaits it.

**seam** — none.

**renderer** — none.

## Out of scope

- The direction "a Claude store resolves inside `<kondo-data>`". Today's
  lexical tests check containment one way only, and this slice keeps that
  reading of ADR-0001 decision 6.
- `boundaryOf` keeps treating `kondoData` as a filesystem authority
  (`mutations.ts:474`). Once the footprint is known to be disjoint, the
  authority is sound; changing it is a different question.
- The `user-config` root stays out of the comparison, as the comment at
  `mutations.ts:434-441` already records: the home directory is not a store,
  and `<kondo-data>` under the same home is ordinary.
- Canonicalising `locator.kondoDataRoot` at startup (docs/status.md finding 4).
  The check resolves at each operation instead, so the raw value stays the
  spelling the user reads back.

## Operation sites

| File | Function | What it checks today | What it will check |
|---|---|---|---|
| `appearance.ts` | `createAppearance` → `read` | `overlapsClaude`, computed once at construction, lexical, against user and desktop | `overlapRefusal` at each read, resolved, against user and desktop |
| `appearance.ts` | `createAppearance` → `appearanceSet` | the same construction-time `overlapsClaude` | `overlapRefusal` again before the temporary file is created |
| `mutations.ts` | `list` | nothing | `overlapRefusal` for `journal.jsonl` before `readJournal` |
| `mutations.ts` | `trashSize` | nothing | `overlapRefusal` for `trash/` before `readTrash` |
| `mutations.ts` | `mutate` | `nested`, construction-time, lexical | `overlapRefusal` before planning any step |
| `mutations.ts` | `undo` | `nested`, construction-time, lexical | `overlapRefusal` before reading the journal |
| `mutations.ts` | `emptyTrash` | `nested`, construction-time, lexical | `overlapRefusal` before measuring or removing |
| `mutations.ts` | `rootOf` | lexical `kondoData === dynamic \|\| pathWithin(...)` | `overlapRefusal` against the resolved dynamic project root |
| `scan-cache.ts` | `openScanCache` | nothing | `overlapRefusal`; an inert cache when it refuses |
| `scan-cache.ts` | `ScanCache.save` | nothing | covered by `openScanCache`: an inert cache's `save` is a no-op |
| `profile.ts` | `claimDataRoot` | nothing | `overlapRefusal` for `stores.json` before the first `readFileSync` |

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | One helper, `overlapRefusal(kondoPath, display, roots, home?)`, exported from `scan.ts` | That module already owns `realpathWithMissing`, `samePath`, `pathWithin` and `BoundaryError`, and every caller imports it already. It takes roots and derives none, so `locator.ts` stays the only module that constructs store roots (ADR-0003). |
| 2 | It returns the refusal sentence, or `null` | The four sites that report differ in code and display path but not in wording, and the one site that reports nothing (`scan-cache.ts`) just tests for `null`. A single return type keeps the call sites to two lines each. |
| 3 | `appearance.ts`, `mutations.ts` (operations), `scan-cache.ts` and `profile.ts` compare against `userRoot` and `desktopRoot` | These are the Claude stores the locator fixes for the launch. `userConfigRoot` is excluded on purpose, as today. |
| 4 | `mutations.ts` `rootOf` compares against the dynamic project root it just resolved | A verified project's `.claude` is a store the operation knows only at step-resolution time; `workspace.ts:164` supplies it. The lexical test there becomes a resolved one and keeps its `Refused('out-of-store')`. |
| 5 | An overlapping scan cache degrades: `openScanCache` returns a cache whose `get` is always a miss, whose `set` records nothing and whose `save` writes nothing | ADR-0005: a cache that cannot be used is a slower answer, never a thrown error, and the module reports nothing into a collector by design (ADR-0007). |
| 6 | `stores.json` joins the check; `claimDataRoot` becomes `async` | It is the earliest write into `<kondo-data>`, at `index.ts:220`, before the workspace and before any window. Leaving it out would let a launch write kondo's own file into a Claude store before a single operation-time check ran, which is exactly the invariant this entry is for. Its call site is already inside an `async` function, and its body stays synchronous, so the "no other Kondo process to race" rationale at `profile.ts:55` is unchanged. |
| 7 | `mutate`, `undo` and `emptyTrash` refuse with `out-of-store` rather than today's `bad-request` | A path that resolves into a store it must not touch is the seam's `out-of-store` case, and it now matches `rootOf`, `appearance.ts` and the boundary refusals in `scan.ts`. |
| 8 | A missing `<kondo-data>` tail resolves through its nearest existing ancestor | `realpathWithMissing` already does this, and a first launch has no data directory yet. A footprint that does not exist can still be inside a store, and refusing before `mkdir` is what stops it being created there. |
| 9 | A resolution failure is refused, not allowed | `realpathWithMissing` throws `BoundaryError` for a dangling link. An unverifiable footprint is not a proven-safe one, so the helper turns the failure into a refusal naming what could not be verified. |
| 10 | No cached result; the helper runs per operation | That is the whole point of the entry: a link can appear after construction. The cost is a `realpath` per root per operation, which is a stat-level cost on paths kondo already stats. |

### Error code and message per site

Every message is built by the same helper: the kondo path, the store it
resolves into, and the fix.

> `<kondo-data>/journal.jsonl` resolves inside the Claude store at `~/.claude`.
> Kondo keeps its journal, trash, preferences and caches outside every Claude
> store (ADR-0001), so nothing was read or changed. Choose another
> KONDO_DATA_ROOT, or remove the link that points into the store.

| Site | Code | Display path | Data returned |
|---|---|---|---|
| `appearanceGet` | `out-of-store` | `<kondo-data>/appearance.json` | Chalk, as today |
| `appearanceSet` | `out-of-store` | `<kondo-data>/appearance.json` | the previous preference, as today |
| `list` | `out-of-store` | `<kondo-data>/journal.jsonl` | an empty list |
| `trashSize` | `out-of-store` | `<kondo-data>/trash` | a zeroed report |
| `mutate` | `out-of-store` | `<kondo-data>` | `null` |
| `undo` | `out-of-store` | `<kondo-data>` | `null` |
| `emptyTrash` | `out-of-store` | `<kondo-data>/trash` | a zeroed report |
| `rootOf` | `out-of-store` | the store name | throws `Refused`, as today |
| `openScanCache` | none | none | an inert cache (ADR-0005) |
| `claimDataRoot` | none | `<kondo-data>/stores.json` | the refusal sentence for the startup dialog |

## Seam changes

None. `out-of-store` is already a `ScanErrorCode` in `shared/contract.ts`, and
no method signature or payload changes. Nothing new crosses the bridge.

## Tests

All of these live in a new `describe` in `test/boundary.test.ts`, beside the
junction cases it already holds, with `fixtureLink` skipping where a platform
cannot create links. Existing coverage is extended, not duplicated:
`test/appearance.test.ts:144` keeps its lexical case, `test/mutation.test.ts`
keeps its per-platform `outside()` assertion, and
`test/session-duplicates.test.ts` gains the store roots at its five
`openScanCache` calls.

Five ways an overlap is formed, each built with synthetic links inside the
fixture:

- `<kondo-data>` is itself a directory link into the user store.
- An ancestor of `<kondo-data>` is a directory link into the desktop store.
- The link is created after the workspace is constructed, so a
  construction-time check would pass.
- `<kondo-data>` does not exist and its nearest existing ancestor resolves into
  the user store.
- A verified project's resolved `.claude` root contains the resolved
  `<kondo-data>`.

For each of `appearanceGet`, `appearanceSet`, `list`, `trashSize`, `mutate`,
`undo`, `emptyTrash`, the scan cache's open and the scan cache's save:

- the call refuses, or in the cache's case reports nothing and caches nothing.
- `hashTree` over the whole fixture base is byte-identical before and after.
- `recordWrites` records no write call at all.
- the refusal's `code` is `out-of-store`, except the cache, which has none.
- the refusal's `message` contains the kondo file or directory name.
- the refusal's `message` contains the store root it resolves into.
- no `readdir` of the store root shows a new entry.

And the control cases:

- `<kondo-data>` reached through a link that resolves outside every store reads
  and writes exactly as an unlinked one does.
- `claimDataRoot` refuses an overlapping root and writes no `stores.json`.
- `claimDataRoot` returns `null` for an aliased root that resolves outside.
- An inert scan cache's `get` misses and its `save` creates no `scan-cache`
  directory in the store.

## Done when

A `KONDO_DATA_ROOT` that resolves inside a Claude store — directly, through an
ancestor, through a link made after the app started, or through a directory
that does not exist yet — is refused by every operation that would read or
write kondo's own files, with an error that names the file and the store it
lands in and says what to change; nothing is read from or written to either
tree; and a data root reached through an alias that resolves outside every
Claude store keeps working exactly as before.
