# Summarize settings files instead of promising an effective-settings viewer

`SettingsLayerInfo` is a metadata projection: layer identity, project
attribution, display location, existence, size, the top-level setting names
Claude Code documents that the file states, and whether it states others
(`unlistedKeys`). Precedence is resolved only for named fields:
`enabledPlugins` per project (`PluginInfo.effectiveIn`) and `skillOverrides`
per skill (`SkillInfo.override`). Kondo reads the user settings file and the
project and local settings files under verified projects' `.claude`
directories. It does not read managed policy, command-line or supplied
settings, live session state or Claude's defaults.

## Decision

Describe the capability as settings-file summaries plus the existing skill and
plugin precedence. Do not claim or commit to a general effective-settings
viewer. An expansion needs its own reviewed contract, an explicit field
allowlist, a source-completeness model and fixture evidence.

## Considered options

- **Narrow the promise (chosen).** Describes the implemented value without
  adding unverified runtime semantics or a new secret-bearing projection.
- **Build an allowlisted effective-settings viewer.** Useful for diagnosis, but
  it needs field-specific merge and default semantics, a reviewed source model
  that includes managed policy, cross-project isolation, safe error projection
  and much larger fixtures. A generic deep merge or a key-name denylist cannot
  meet the privacy and accuracy requirements.

## Consequences

- Any expansion is deny-by-default
  ([ADR-0022](0022-project-settings-data-deny-by-default.md)): it redacts in
  main before a DTO is built — errors, refusals and tooltips included — and
  adds no reveal or copy-raw action.
- Future resolution work keeps unknown states distinct: an unreadable or
  invalid higher layer never becomes a definitive answer from a lower one, and
  unknown is never shown as off or as the default.
