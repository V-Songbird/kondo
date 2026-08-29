# Adapters degrade, never die

Kondo reads undocumented, version-drifting, occasionally half-written state
(interrupted JSONL appends, files from newer Claude versions, permission
oddities). If a scan throws on the first bad file, the app is useless on
exactly the messy machines it exists for.

Decision: every store adapter returns `{ data, errors }`. `data` is whatever
was readable; `errors` is an itemized list (path, operation, message). A
malformed transcript line is skipped and counted. An unknown file or
directory is reported as *unknown*, not as an error — new Claude versions
adding entries is normal life, and the "unknown" list is kondo's early-warning
system for domain.md updates.

## Considered options

- **Throw on first failure.** Rejected: one corrupt file among 8,921 project
  directories would blank the whole sessions view.
- **Silently skip unreadable items.** Rejected: silent gaps make kondo's
  numbers lies; users tidy based on these numbers.
- **Partial data + itemized errors + unknown tracking (chosen).**

## Consequences

- The seam type for every scan carries errors as values; the UI renders them
  (a "problems" affordance), so failures are visible without being fatal.
- Tests feed adapters deliberately broken fixtures and assert both halves.
- Schema drift surfaces as an unknown-entry report instead of a crash.
