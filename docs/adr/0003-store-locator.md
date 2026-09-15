# One store locator owns every path

Kondo targets Windows, macOS, and Linux from day one, and its stores live in
OS-specific places (`~/.claude`, `%APPDATA%\Claude`,
`~/Library/Application Support/Claude`, `~/.config/Claude`). Path knowledge
scattered through features is how cross-platform tools rot, and hard-coded
real paths are how tests end up touching real data.

Decision: a single `StoreLocator` module in the main process is the only code
that constructs store root paths. Everything else receives roots from it.
The locator is constructed with overridable roots (env override
`KONDO_STORE_ROOT` and test injection), which is also what keeps the test
suite off real stores.

## Considered options

- **Per-adapter path logic.** Rejected: three adapters × three OSes of
  drift, and no single choke point to enforce ADR-0002.
- **A path-utils grab bag.** Rejected: utilities get copied; a locator owns
  policy (what exists, what is overridden, what is forbidden).
- **Single locator with injected roots (chosen).**

## Consequences

- New store kind = new locator entry + adapter; features stay path-free.
- The privacy boundary and the tests' "never touch real stores" rule are both
  enforced at one seam.
- All path joining/normalization happens with Node `path` — no hand-built
  separators anywhere else.

## Amendment: project stores and the un-flattening guess

Two kinds of path are built outside the locator. Project stores come from the
inventory: the workspace, the kind registry and the adapters join a verified
project's path with `.claude`, because only the inventory knows which projects
verified (ADR-0002, ADR-0009). The fallback that guesses a project's path from
its flattened directory name (`candidateOriginalPaths` in `projects.ts`)
writes the target platform's separator itself, because it reconstructs a path
for that platform rather than joining parts on this one.
