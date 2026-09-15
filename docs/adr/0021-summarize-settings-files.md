# Summarize settings files instead of promising an effective-settings viewer

Status: **accepted by the owner — decision 107 (2026-09-07)**

The README promised a layered settings view that showed "what wins and why",
and the roadmap called the shipped screen a settings viewer. The implementation
is narrower. `SettingsLayerInfo` is a metadata projection: layer identity,
project attribution, display location, existence, size and top-level key names.
Precedence is resolved only for named fields: `enabledPlugins` per project
(`PluginInfo.effectiveIn`) and `skillOverrides` per skill (`SkillInfo.override`).
Kondo reads the user settings file and the project and local settings files
under verified projects' `.claude` directories. It does not read managed
policy, command-line or supplied settings, live session state or Claude's
defaults.

## Decision

Describe the shipped capability as settings-file summaries plus the existing
skill and plugin precedence. Do not claim or commit to a general
effective-settings viewer. An expansion needs its own reviewed contract, an
explicit field allowlist, a source-completeness model and fixture evidence.

## Considered options

- **Narrow the promise (chosen).** Describes the implemented value without
  adding unverified runtime semantics or a new secret-bearing projection.
- **Build an allowlisted effective-settings viewer.** Useful for diagnosis, but
  it needs field-specific merge and default semantics, a reviewed source model
  that includes managed policy, cross-project isolation, safe error projection
  and much larger fixtures. A generic deep merge or a key-name denylist cannot
  meet the privacy and accuracy requirements.

## Consequences

- README describes settings-file summaries, the roadmap records that a general
  viewer has not shipped, and foundations describes the metadata projection.
- The existing projections are not secret-safe: top-level key names, hook
  command text and parser diagnostics can still reach the renderer. Entry 117
  owns that hardening. Any expansion is deny-by-default, redacts in main before
  a DTO is built — errors, refusals and tooltips included — and adds no reveal
  or copy-raw action.
- Future resolution work keeps unknown states distinct: an unreadable or
  invalid higher layer never becomes a definitive answer from a lower one, and
  unknown is never shown as off or as the default.
