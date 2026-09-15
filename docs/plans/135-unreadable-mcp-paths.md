# Plan: an unreadable MCP project path is not a removable orphan

Status: **in progress**

`readMcp` stats the registry path of every project that declares a local MCP
server and marks the declaration `orphan` whenever that stat throws — ENOENT or
not. `scanConfigOrphans` offers only projects whose path is gone, so a path
kondo merely could not read was stamped "project is gone", listed under Findings
as a leftover, and refused its switch with a sentence pointing at Leftovers,
which never offers it. The reader must separate "gone" from "could not check".

## Scope

- **workspace.** `readMcp` (`electron/main/workspace/user-store.ts`) resolves
  each registry path into one of three reach states instead of a boolean;
  `evaluateMcp` takes that state, keeps `orphan` for ENOENT alone, and gives an
  unreadable path the `unknown` status with its own fixed sentence and a
  `blocked` reason that refuses both switch directions.
- **capabilities.** No new branch: `mcpSwitchCapabilities`
  (`electron/main/workspace/capabilities.ts`) already refuses both directions on
  `blocked`. Its doc comment gains the case.
- **seam / renderer.** Nothing. See Seam changes.

## Out of scope

- Settings writes, which stay refused whole under entry 098.
- What `configOrphansPreview` offers, which is already ENOENT-only and correct.
- Any new status word for the gone case (Decision 3).
- The `.mcp.json` and user scopes, neither of which stats a project path.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | `orphan` means ENOENT and nothing else. | It is the seam word Leftovers keys on, and `shared/contract.ts` already defines it as "no longer on disk". The reader was broader than its own contract. |
| 2 | An unreadable path reads `unknown`, with a fixed sentence naming the checked folder and claiming nothing about it. | ADR-0005: a positive answer never stands over a source that could not be read. ADR-0022: a fixed sentence, never the exception's text. |
| 3 | The gone case keeps `configured` plus `orphan: true`. No new `McpServerStatus` member. | The distinction already crosses the seam and both pages already stamp it. A new status word would ripple through the contract, `mcpStatusFlag` and `McpTable` for no behaviour nobody can already see, while four entries run in parallel on those files. |
| 4 | The refusal rides `McpSwitchState.blocked`. | That field is already documented as "a reason both directions are refused: gone, shadowed, or unreadable", and `mcpSwitchCapabilities` already refuses both on it. A new constant and branch would duplicate a path that exists. |
| 5 | The `stat-failed` scan error stays exactly as it is. | ADR-0005 itemizes the failure beside the partial data; the sentence on the declaration is the display half of the same fact. |
| 6 | The unreachable check sits above the per-project switch and the approval sources in `evaluateMcp`. | It refuses the switch whatever else the entry says, so a project kondo cannot even find never offers a write. It is also the most specific thing to say, so it wins the one `statusReason` slot. |

## Seam changes

None. `McpServerStatus` already carries `unknown`, and `McpServerInfo.orphan`
stays a boolean whose documented meaning — "the path this declaration is tied to
is no longer on disk" — becomes true of the code for the first time. No ADR is
owed, because nothing about the seam or a governing decision changes; the
narrowed reading is a store fact and lands in `docs/domain.md`.

## Tests

In `test/mcp.test.ts`, against the existing synthetic world, a third registry
entry whose path is present on disk but whose `fs.stat` is made to fail
`EACCES` (the house pattern from `test/workspace.test.ts`), beside the present
`live` and the ENOENT `dead`:

- the unreadable declaration has `orphan: false`, and `dead-local` is still the
  only `orphan: true` name;
- its `status` is `unknown` and its `statusReason` names the checked folder,
  contains neither "gone" nor "Leftovers";
- the scan itemizes one `stat-failed` error for that path, and the present and
  gone entries add none;
- both `enable` and `disable` are refused, and neither refusal says "gone" or
  "Leftovers", while the gone declaration's refusal still says both;
- `configOrphansPreview` offers the gone project and not the unreadable one.

## Done when

A project whose folder kondo cannot read no longer reads as deleted anywhere:
its MCP servers show "cannot tell" with a sentence naming the folder kondo could
not check, its switch is refused without promising that Leftovers will clear it,
and it is absent from Findings — while a project that really is gone keeps its
"project is gone" stamp and its place in Leftovers.
