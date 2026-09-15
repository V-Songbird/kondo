# Native conventions over invented state

Kondo could track "disabled" skills and plugins in its own database and
manipulate stores accordingly. But Claude already has conventions:
`skillOverrides` and `enabledPlugins` in settings layers, per-project MCP
disable lists in `~/.claude.json`, hooks armed by settings entries, and
entries loaded because a file sits in a directory Claude reads. State kondo
invents would be state Claude ignores — true in kondo's UI, false in every
actual session.

Decision: kondo's mutations speak Claude's own language, and kondo's own data
directory holds only kondo-private things — the journal, trash, appearance
preference and scan cache — never the truth about the user's Claude setup.

Every settings-based row below is a convention kondo reads and a plan it
builds; executing the plan is refused on every platform until settings writes
can preserve concurrent edits
([ADR-0010](0010-splice-config-files-never-whole-file-writes.md)).

| Entity | Convention kondo reads and plans | Notes |
|---|---|---|
| Skill (user, project, local scope) | `skillOverrides[<name>] = "off"` in the highest-precedence layer of the skill's scope that already names it, else `settings.local.json` for a project skill or `~/.claude/settings.json` for a user skill. Enable withdraws the member from every layer in the chain that says `off`. | Claude's `/skills` writes the same key into the local layer. Of the four values (`on`, `name-only`, `user-invocable-only`, `off`) only `off` disables. |
| Global skill, for one project | The same key in that project's own layers. | The user layer is never written from a project page; a user-scope `off` shows as off in All projects there. |
| Plugin-shipped skill | None reachable: Claude pins it `on` before consulting user, project or local layers. | Refused. |
| Benched skill in `skills.disabled/` | Not a Claude convention in any scope: the string occurs in no Claude Code build read (2.1.255, 2.1.258). | Read back as the `*-disabled` scope and offered only the way back into `skills/`, as a journaled move. Nothing new is put there. |
| Plugin | `enabledPlugins[<name>@<marketplace>]` per settings layer. A move between scopes is two statements in two files in one plan; nothing on disk moves. | Clearing withdraws the member rather than writing `false`. |
| MCP server (local, project) | The name in the project's `disabledMcpServers` (registry declaration) or `disabledMcpjsonServers` (`.mcp.json` declaration) in `~/.claude.json`. | No list exists for the user scope, so that row is refused; a declaration never moves between files. |
| Agent, command, rule, output style | Loaded by presence, with no disable convention, so both toggles are refused. `move` puts the file in the other scope's directory, on the skill move's copy → verify → trash plan. | An output style has no project destination: no project store has been observed holding `output-styles/`. |
| Hook declaration | No per-hook convention. | Read-only ([ADR-0017](0017-hook-layer-boundary.md)). |

## Considered options

- **Kondo-owned toggle database.** Rejected: drifts from reality the moment
  the user edits settings by hand or Claude changes behavior; two sources of
  truth.
- **Symlink tricks** for moves/disables. Rejected: symlinks are second-class
  on Windows (privilege-gated), and Claude's own handling of them is
  unverified.
- **Native conventions (chosen).** The store *is* the state; kondo re-reads
  after every mutation.

## Consequences

- Anything the user does by hand shows up correctly in kondo — it is a reader
  of the same truth.
- Kondo inherits Claude's convention changes; domain.md tracks them, and an
  unrecognized convention degrades per ADR-0005.
- A toggle with no native convention does not ship until a faithful mechanism
  exists, and gets its own decision.
- A statement is withdrawn rather than set to its default: an absent key is
  Claude's default, and stating the default would be a second convention.
- The matrix reflects state rather than directory: a live skill under an `off`
  has `enable` allowed and `disable` refused, naming the layer. Placement lives
  in one table (`PLACEMENTS` in `user-store.ts`), so a scan and a move never
  disagree about where an entry lives.
