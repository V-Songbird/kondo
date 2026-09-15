# Keep private working records local

Keep `ROADMAP.jsonl` and all of `.foreman/` out of Git, alongside private agent
memory, workstation IDE setup, and generated Jig planning records. Preserve the
local files and their complete working history; remove only their index
entries.

Publish reusable project knowledge in `ROADMAP.md`, plans, ADRs, and contributor
documentation. Shared Claude settings, portable rules, the fixture-run skill,
and Jig configuration, manifest, activation instructions, checks, and hooks
remain tracked so project tooling travels with a clone.

## Considered options

- **Publish scrubbed Foreman records.** Rejected because every later note or
  configuration change would require another privacy review, and scrubbing
  would alter the working history maintainers rely on.
- **Keep Foreman records local (chosen).** Preserves the full working context
  while making reviewed public documents the shared source of project knowledge.

## Consequences

Fresh clones do not receive the maintainers' task queue, Foreman settings,
archives, or lessons. Foreman remains optional and can be initialized locally;
existing local data remains usable through its CLI. Promote reusable findings
into public documentation before relying on them across clones. Task numbers
in public documents may refer to private history, so those documents must carry
enough context without requiring access to the queue.

Ignore rules and `git rm --cached` protect future snapshots; they do not remove
previously committed data from Git history. How the repository is published
without that history is the
[public-history decision](../plans/111-public-history-decision.md).
