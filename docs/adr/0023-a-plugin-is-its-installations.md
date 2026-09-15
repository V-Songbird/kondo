# A plugin is its installations, not its first record

`installed_plugins.json` keys each plugin to an *array* of installation
records, and Claude fills that array whenever the same plugin is installed at
more than one scope, in more than one project, or at more than one version.
Kondo took `installs[0]`, so a machine with a project-scope 2.0.0 and a
user-scope 1.0.0 showed one of them and gave no sign the other existed. Which
one it showed came from the file's write order, which Claude promises nothing
about, so the same store could render two ways.

A plugin's identity across the seam is therefore its whole inventory.
`PluginInfo.installations` carries every validated record — scope,
`projectPath`, version, timestamps, install path, and whether Kondo may read
that path — ordered by scope rank (`managed`, `user`, `project`, `local`), then
project path, version and install path. The scalars that were already on
`PluginInfo` stay, redefined as a projection over that array: they are the
first installation's, under the stated order. A renderer that wants one line
still gets one; a renderer that wants the truth has it beside.

Two further facts travel with it. `PluginSource` says whether a plugin came
from an installation record or from a skills directory — a folder holding
`.claude-plugin/plugin.json`, which Claude loads as `<name>@skills-dir` with no
record at all, so an empty `installations` means two different things without
it. And `ProjectPluginState` carries both fields, because a project page and
the Library describing the same plugin differently is the bug this ADR is
about, one layer up.

## Considered options

- **Keep `installs[0]` and document it.** Rejected: the hidden records are what
  a user needs when a project runs a version they did not expect, and array
  position is not an ordering Claude maintains.
- **Send the raw array across the seam.** Rejected: the records carry
  `gitCommitSha`, `resolvedVersion` and whatever Claude adds next, and a
  validated projection is what ADR-0022 requires of everything settings-derived.
- **Pick a winner — highest version, or newest `installedAt`.** Rejected: there
  is no winner. Claude loads the installation belonging to the scope in play,
  so "the current version" is a per-project question the Library cannot answer.
- **A second call, `pluginInstallations(id)`.** Rejected: the records are
  already in hand when the listing is built, so a second round trip would buy
  nothing but a loading state (ADR-0007 is about reads that cost, and this one
  does not).
- **Every record, ordered, with the scalars as a documented projection
  (chosen).** One row per plugin, one rule for what it shows, and nothing
  hidden.

## Consequences

- A plugin installed once renders exactly as before; its single record is also
  `installations[0]`.
- A record whose `installPath` escapes the user store stays in the list with
  `followed: false` rather than vanishing. It contributes no components, and the
  refusal is itemized where the path is resolved (ADR-0005).
- Skills-directory plugins now appear in `pluginsList`, and their folders leave
  the skills catalogue, because Claude loads a folder as one or the other and
  never both. Tier-1 project counts still count such a folder as a skill: they
  count by `readdir` alone (ADR-0007).
- The capability matrix keys on the first installation's scope. `managed` has no
  row, so a managed-scope plugin refuses every operation with the matrix's
  unrecognized-scope sentence until domain.md and the matrix learn it.
- Adding a field to an installation record is a reviewed contract change, the
  same as any other settings-derived projection (ADR-0022).
