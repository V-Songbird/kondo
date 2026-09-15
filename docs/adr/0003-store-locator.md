# One store locator owns every path

Kondo targets Windows, macOS, and Linux from day one, and its stores live in
OS-specific places (`~/.claude`, `%APPDATA%\Claude`,
`~/Library/Application Support/Claude`, `~/.config/Claude`). Path knowledge
scattered through features is how cross-platform tools rot, and hard-coded
real paths are how tests end up touching real data.

Decision: a single `StoreLocator` module (`locator.ts`) in the main process is
the only code that constructs store root paths. Everything else receives
roots from it. It is built from injected `{ home, appData, userData, platform,
env }`, honours the `KONDO_STORE_ROOT`, `KONDO_DESKTOP_STORE_ROOT` and
`KONDO_DATA_ROOT` overrides, and names `~/.claude.json` (`userConfigFile`,
`userConfigRoot`) and the OS temporary root (`tmpRoot`). Injection is what
keeps the test suite and fixture runs off real stores. The composition root
also reads `KONDO_DATA_ROOT`, to select Electron's `userData` before the
single-instance lock (ADR-0004).

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
- Path joining and normalization use Node `path`. Paths are built outside the
  locator in three places only. Project stores come from the inventory: the
  workspace, kind registry and adapters join a verified project's path with
  `.claude`, because only the inventory knows which projects verified
  (ADR-0002, ADR-0009). The fallback that guesses a project's path from its
  flattened name (`candidateOriginalPaths` in `projects.ts`) writes the target
  platform's separator itself, because it reconstructs a path for that
  platform. Display strings use forward slashes on every OS (`display.ts`,
  ADR-0008).
