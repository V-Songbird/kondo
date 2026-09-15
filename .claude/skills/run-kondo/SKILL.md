---
name: run-kondo
description: "Launch kondo's Electron window against a synthetic fixture store and drive it — open a destination or section, stage and confirm a move, press a control, screenshot the result — over Chromium's debugging port with no Playwright and no risk to a real ~/.claude. Use when a change needs seeing rather than asserting: a new control, how a refusal renders, whether a list re-reads after a mutation, or any check you were about to hand back to the user as 'unverified'. Do NOT use for logic a vitest case already covers, and never point the app at a real store."
user-invocable: true
---

# Running kondo

Kondo writes to real Claude data. CLAUDE.md's one repeated warning is never
to point mutating code at a real store, and the mutations that run today —
moving skills, agents, commands and rules between scopes, a benched skill's
Enable back into `skills/`, selected conversation removal, every Clean up move
to Kondo's trash, and Undo — make that live. So the app is never launched bare for
a check. It is launched against a fixture.

That is the only precaution needed. With it, running is cheap, and a UI
question is yours to answer rather than the user's. Do not write an
`unverified:` note for anything on this page.

Settings edits are refused on every platform for now (098,
[ADR-0010](../../../docs/adr/0010-splice-config-files-never-whole-file-writes.md)).
Skill, plugin and MCP switches, plugin moves and clearing, and settings-leftover
removal answer `Settings changes are temporarily unavailable because Kondo
cannot safely exclude concurrent Claude writes. No files were changed.` and
journal nothing. That refusal is the expected result of those controls, not a
broken run. The exception is a benched skill's Enable (the fixture's
`old-linter`): it moves the directory back into `skills/`, so it runs and
journals.

## Launch

Choose a new absolute directory under the OS temp directory for the fixture;
below it is `<fixture>`. Under the temp root the fixture's projects are
classified as throwaway runs, which the notes at the end rely on. Always pass
it: without an argument `fixture.mjs` falls back to a machine-specific default.

```bash
# 1. Build the fixture store. It prints the three env values.
node .claude/skills/run-kondo/fixture.mjs "<fixture>"

# 2. Build the app. `dev` works too, but the built app has no HMR noise.
npm run build

# 3. Launch it at the fixture, with the debugging port open.
KONDO_STORE_ROOT="<fixture>/home/.claude" \
KONDO_DESKTOP_STORE_ROOT="<fixture>/desktop" \
KONDO_DATA_ROOT="<fixture>/kondo-data" \
  node node_modules/electron/cli.js . --remote-debugging-port=9222
```

Run step 3 in the background — it holds the window open. It calls Electron's
own launcher script rather than `node_modules/.bin/electron`, a shell shim that
a version manager's `exec` (such as `fnm exec`) cannot start on Windows.
`electron/main/workspace/locator.ts` is what reads those three variables —
`createLocator` for the store roots, and `kondoDataRootFor`, which the entry
module calls before the single-instance lock, for `KONDO_DATA_ROOT` — and they
outrank any `CLAUDE_CONFIG_DIR` the shell exports. That is the whole of the
safety story, so if a run ever reports paths under the real home, stop and fix
the launch rather than continuing.

Confirm the port is up, and that kondo is what answers, before driving:

```bash
curl -s http://127.0.0.1:9222/json/list
```

The page's `url` ends in `out/renderer/index.html`. If another program already
listens on 9222, launch on a free port and export `KONDO_CDP_PORT` with it:
`drive.mjs` attaches to whichever page answers on its port.

## Drive

`drive.mjs` is one-shot: each command reconnects, so there is no session to
keep alive. Node 22's global `WebSocket` is why no Playwright is needed. The
protocol client itself is `cdp.mjs` beside it, shared with the end-to-end
smoke test (`npm run test:e2e`, `test/e2e/smoke.mjs`), which launches the
built app against this same fixture and asserts what this page checks by
hand — so a change to how the app is driven lands in one place.

```bash
# All of these run from the repo root.
node .claude/skills/run-kondo/drive.mjs open Projects                 # click a destination or tab, screenshot it
node .claude/skills/run-kondo/drive.mjs shoot before                  # screenshot on demand
node .claude/skills/run-kondo/drive.mjs pick commit-writer apiserver  # stage a move in a row
node .claude/skills/run-kondo/drive.mjs press Move                    # click a button by its text
node .claude/skills/run-kondo/drive.mjs eval "document.title"         # anything else
```

### Reaching a skill or a plugin

The app opens on **Library**. The top navigation holds four destinations —
`Library`, `Projects`, `Clean up` and `History` — and a separate `Themes`
button. `open` tries a whole-text match first, then falls back to the first
button whose text contains the argument. A destination button's text also
carries its description (`ProjectsChoose where they work`), so destinations
are reached through that fallback; the whole-text match is what finds a
section tab.

`open Projects` shows `All projects` — the shared configuration in the user
store — above the project rows. A project page has section tabs: `Overview`,
`Skills`, `Plugins`, `Connections`, `Other tools`, `Conversations` and
`Technical details`; `All projects` has no `Conversations`. A project row is
reached by name, and `All projects` the same way:

```bash
node .claude/skills/run-kondo/drive.mjs open Skills          # after open Projects: All projects' skills
node .claude/skills/run-kondo/drive.mjs open apiserver       # a project row
node .claude/skills/run-kondo/drive.mjs open "All projects"  # back to the shared scope
```

The projects list folds throwaway runs and gone projects behind one count
(entry 060), and the fixture lives under the OS temp root, so every fixture
project is folded on a fresh launch. `open` presses `Show them` for you when
its first look finds no row; a hand-written `eval` has to click that button
itself before a project row exists in the DOM.

`pick` exists because assigning `select.value` does nothing here: React
tracks the value node, so the choice only registers through the prototype's
native setter plus a bubbling `change` event. That is the one piece of this
you would otherwise rediscover. Choosing a destination only stages the move:
the select gives way to `Move <name> to <destination>?` with `Move` and
`Cancel`, and nothing is written until `press Move`.

Its row argument is a substring, and it takes the first row that contains it.
A row is the widest element around a `<select>` that holds no other
`<select>` — a `<tr>` in the Skills table, a div in the Plugins section — so
`pick` reaches both. Name the skill or plugin, not its location; several rows
share a location. The option argument is a substring of a destination label,
and those labels are project paths.

The worked example runs as written against a fresh fixture: `open Projects`,
`open Skills`, then `pick commit-writer apiserver` stages moving that global
skill to the apiserver project, and `press Move` applies it. The banner reads
`Applied — Move skill commit-writer from … to …` and offers `Undo`.

A plugin move is a settings edit. On `All projects`, `open Plugins`, then
`pick foreman cli` and `press Move`: the destination file does not exist yet,
so the app first asks `…/work/cli/.claude/settings.local.json does not exist
yet. Confirm to create it holding just this key.` with `Create it` / `Cancel`.
`press "Create it"` then shows the settings refusal above and journals nothing.
On a project page the plugin's `Move to…` select is disabled unless that
project turns the plugin on; `pick` answers `select is disabled: no reason
given`, and the reason is printed beside the control.

A plugin's three-way position is buttons, so `press` reaches it too, but the
labels change with the scope: `On`/`Off`/`Not set` on All projects, `On
here`/`Off here`/`Follow shared setting` on a project. Pressing one shows the
same settings refusal for now. List them rather than guess:

```bash
node .claude/skills/run-kondo/drive.mjs eval   "JSON.stringify([...document.querySelectorAll('button')].map((b) => b.textContent.trim()))"
```

`press` matches by trimmed, case-sensitive substring, first match wins, so
`press Off` takes the first plugin's `Off`. Each position also carries an
`aria-label` naming its plugin (`Off: foreman`), which an `eval` can click. The
button for the position a plugin is already in is disabled, and `press` says
`button is disabled: …` rather than pretending it clicked.

Clean up has three sections — `Files and caches`, `Settings leftovers` and
`Duplicate skills` — each a button `press` reaches. A category in Files and
caches is a checkbox labelled `Select <category>`, which `press` does not
match; click it with `eval`, then review and confirm:

```bash
node .claude/skills/run-kondo/drive.mjs open "Clean up"
node .claude/skills/run-kondo/drive.mjs eval "document.querySelector('input[aria-label=\"Select Caches the desktop app rebuilds\"]').click()"
node .claude/skills/run-kondo/drive.mjs press "Review selected items"
node .claude/skills/run-kondo/drive.mjs press "Move to trash"
```

### Reading the bridge directly

`eval` can call the preload bridge, which shows the raw `Scan` a view is built
from. `window.kondo.pluginSkills` backs the `Skills it ships` table on a
Library plugin page; across the seam it also shows that an absent `skills/`
directory is an empty list with no error:

```bash
node .claude/skills/run-kondo/drive.mjs eval "window.kondo.pluginSkills('plugin:hush@acme')"
#   {"data":[],"errors":[],"unknown":[]}      — no skills/ directory at all
node .claude/skills/run-kondo/drive.mjs eval "window.kondo.pluginSkills('plugin:foreman@acme')"
#   two rows, roadmap and survey
```

The id shape is `plugin:<name>@<marketplace>` (ADR-0008). With no argument it
answers `bad-request`, not an empty list — an empty `data` really does mean
the plugin ships none.

Set `KONDO_SHOTS` to choose where screenshots land. Unset, every command
writes under the OS temp directory (`kondo-shots/`), never into the working
directory, so a miss cannot leave a PNG in the repo. `KONDO_CDP_PORT` selects
the debugging port, 9222 by default.

**Read every screenshot you take.** A blank frame is a failed launch, not a
passing check.

## Confirm on disk too

The window showing the right thing is half the proof. The store is the other
half, and it is where a broken mutation actually shows:

```bash
find "<fixture>/kondo-data/trash" -type f   # displaced bytes (ADR-0001)
cat "<fixture>/kondo-data/journal.jsonl"    # each operation and its progress records
```

A move's entry holds two steps, `copy` then `trash`, in that order. The journal
also appends progress and completion records for each operation (099,
ADR-0018), so one move is several lines. A refused settings edit appends
nothing.

## Finish

Close the app through its debugging port, which lets Electron shut down
cleanly; the background launch command then exits by itself. Remove the
fixture afterwards:

```bash
node --input-type=module -e "import { findPage, connect } from './.claude/skills/run-kondo/cdp.mjs'; const c = await connect(await findPage(process.env.KONDO_CDP_PORT ?? '9222')); await c.send('Browser.close').catch(() => {}); c.close()"
rm -rf "<fixture>"
```

If the launch command does not exit, stop that background command. Never kill
Electron by process name (`taskkill /IM electron.exe`, `pkill electron`): that
also closes editors, chat apps and every other Electron program on the machine.
A helper that stops only the launched process is tracked as entry 124.

## Fixture notes

The tree `fixture.mjs` builds is shaped to exercise the awkward cases: a
global skill, a benched one, a project-scoped one, a second project that is
empty but valid as a destination, and two plugins that ship skills
differently — `foreman@acme` ships two, neither of which may appear in the
skills list, and `hush@acme` ships none.

Two skill names repeat on purpose, one per verdict of Clean up's `Duplicate
skills` section: `api-notes` is byte-identical in the user store and in
`apiserver`, so it reads `identical copies` and either copy may go to the
trash; `db-migrate` shares its name across the same two scopes with different
bytes, so it reads `same name, different contents` and both buttons stay
disabled. The user store also holds an agent (`planner`) and an output style
(`terse`), and `apiserver` an agent (`reviewer`) and a command (`deploy`). They
are listed under `Other tools`: the agent and command rows have a move picker,
and the output style says `Response styles apply to all projects, so they
cannot be moved to one project.`

The fixture sits under a temp directory, so its projects fold on the Projects
list and Clean up checks them as throwaway folders. On a fresh fixture Files
and caches keeps both transcript projects — `2 temporary or worktree folders
kept: they contain memory, activity within 30 days, or could not be checked
safely.` — because their sessions were just written (102). That is the
category protecting recent work, not a fixture bug.

The desktop half of the fixture carries three Chromium cache directories
(`Cache`, `Code Cache`, one inside `Partitions/cowork-file-preview`) beside a
`Local Storage` and a `vm_bundles` that must never be offered, so Clean up's
`Caches the desktop app rebuilds` row reads 3 items. It carries no `lockfile`
and no `Singleton*` marker, so the row is not blocked. The check reads only the
launched desktop root, so a Claude desktop app running on the same machine does
not change the row; an empty `SingletonLock` file in `<fixture>/desktop` shows
the blocked state, "The Claude desktop app is running…" with its checkbox dark.

`hush@acme` is there for that empty case alone. Its install root at
`plugins/cache/acme/hush/1.0.0` holds a `commands/` file and **no `skills/`
directory at all** — an absent directory is a different case from an empty
one, and the absent one is what `pluginSkills` must answer with an empty
list and no error. Do not add `skills/` there to tidy the tree up.

The fixture also writes Claude's registry, `home/.claude.json` (a sibling of
the store, ADR-0009), with five keys, so the project set is the union the
projects home counts. On a fresh fixture, All projects → `Technical details`
reads `5 projects Claude has on record · 4 sessions · …` and `Of those: 2
projects with sessions saved, 3 projects Claude has on record but never worked
in.`:

| key | on disk | under `projects/` | what it is for |
| --- | --- | --- | --- |
| `work/apiserver` | yes | yes, 3 sessions | the ordinary project; declares two MCP servers in the registry (`search` switched off) and one in its `.mcp.json` (`linter`), so Connections shows both states |
| `work/website` | yes | yes, 1 session | an empty but valid move destination |
| `work/cli` | yes | no | registry-only member with a `.claude` store: one of the three members behind the 5-versus-2 counts, and a move destination with no transcripts |
| `work/removed` | no | no | dead project; Settings leftovers lists its registry entry and the two MCP servers it declares |
| `work/oldsite` | no | no | dead project with nothing else attached; a registry-entry leftover |

`settings.json` carries `ghost@acme` under `enabledPlugins` and
`retired-helper` under `skillOverrides`. Only the missing marketplace plugin
is a leftover: every skill override is preserved because the local catalog
cannot prove absence (100). `foreman@acme` and `commit-writer` are the live
pair beside them and must never be listed there.

Because every project with a transcript directory is registered, kondo takes
its real path from the registry and never un-flattens the directory name, so
the base path may hold a hyphen. A project that is **not** registered still
needs both halves — a `projects/<flattened>/` directory and a real `.claude`
directory at the path that name reconstructs to — or it stays unverified.
