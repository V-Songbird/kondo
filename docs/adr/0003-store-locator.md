# One store locator owns every path

Kondo targets Windows, macOS, and Linux from day one, and its stores live in
OS-specific places (`~/.claude`, `%APPDATA%\Claude`,
`~/Library/Application Support/Claude`, `~/.config/Claude`). Path knowledge
scattered through features is how cross-platform tools rot, and hard-coded
real paths are how tests end up touching real data. Claude Code also lets a
user keep several configuration profiles and pick one per launch, so which
store Kondo reads is a decision rather than a constant.

Decision: a single `StoreLocator` module (`locator.ts`) in the main process is
the only code that constructs store root paths. Everything else receives roots
from it. It is built from injected `{ home, appData, userData, platform, env,
argv }` and chooses the Claude profile in one order, highest first:

1. `KONDO_STORE_ROOT`, the fixture override, with `.claude.json` beside it so a
   fixture root brings its own registry along;
2. `--claude-config-dir=<absolute path>` on Kondo's own command line, for a
   desktop launch that inherits no terminal environment;
3. an inherited absolute `CLAUDE_CONFIG_DIR`;
4. Claude Code's default `~/.claude`, with `~/.claude.json` beside it.

A profile chosen by 2 or 3 keeps its registry *inside* the chosen directory,
which is where Claude Code reads it (docs/domain.md). An empty value is no
selection and a relative one is not followed. `KONDO_DESKTOP_STORE_ROOT` and
`KONDO_DATA_ROOT` override their own roots as before. The locator names the
registry (`userConfigFile`, `userConfigRoot`), the OS temporary root
(`tmpRoot`), which rule won and every selection that lost (`profile`), and
derives Kondo's data root for the resulting store set (`kondoDataRootFor`,
`storeSetIdentity`), which the composition root applies before the
single-instance lock (ADR-0004). Injection is what keeps the test suite and
fixture runs off real stores.

## Considered options

- **Per-adapter path logic.** Rejected: three adapters × three OSes of
  drift, and no single choke point to enforce ADR-0002.
- **A path-utils grab bag.** Rejected: utilities get copied; a locator owns
  policy (what exists, what is overridden, what is forbidden).
- **Read only `KONDO_STORE_ROOT` and default otherwise.** Rejected: Kondo then
  inspects a different profile than the Claude Code beside it, and says nothing
  about it.
- **Let an inherited `CLAUDE_CONFIG_DIR` outrank the fixture override.**
  Rejected: a developer's shell would point fixture runs and tests at a real
  profile, against the one rule this repository repeats.
- **An in-app profile picker.** Not now: it needs a native dialog, a relaunch
  and validation of a directory nobody has vouched for, and the fixture harness
  cannot drive it. A launch argument reaches every desktop launcher and is
  visible in the window.
- **Single locator with injected roots, profile chosen at launch (chosen).**

## Consequences

- New store kind = new locator entry + adapter; features stay path-free.
- The privacy boundary and the tests' "never touch real stores" rule are both
  enforced at one seam.
- The registry is inside the user store for a selected profile and beside it
  otherwise. The `user-config` store still resolves exactly one file name
  (ADR-0010), so the same exact-file boundary holds either way.
- Which profile a window shows is display-safe data on the seam
  (`profileGet`, ADR-0004); no path is accepted back.
- Path joining and normalization use Node `path`. Paths are built outside the
  locator in three places only. Project stores come from the inventory: the
  workspace, kind registry and adapters join a verified project's path with
  `.claude`, because only the inventory knows which projects verified
  (ADR-0002, ADR-0009). The fallback that guesses a project's path from its
  flattened name (`candidateOriginalPaths` in `projects.ts`) writes the target
  platform's separator itself, because it reconstructs a path for that
  platform. Display strings use forward slashes on every OS (`display.ts`,
  ADR-0008).
