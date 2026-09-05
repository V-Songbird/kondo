---
name: run-kondo
description: "Launch kondo's Electron window against a synthetic fixture store and drive it — click tabs, choose a skill's move destination, press a toggle, screenshot the result — over Chromium's debugging port with no Playwright and no risk to a real ~/.claude. Use when a change needs seeing rather than asserting: a new control, how a refusal renders, whether a list re-reads after a mutation, or any check you were about to hand back to the user as 'unverified'. Do NOT use for logic a vitest case already covers, and never point the app at a real store."
user-invocable: true
---

# Running kondo

Kondo writes to real Claude data. CLAUDE.md's one repeated warning is never
to point mutating code at a real store, and every mutation now shipped —
skill toggle, plugin toggle, cross-scope skill move — makes that live. So the
app is never launched bare for a check. It is launched against a fixture.

That is the only precaution needed. With it, running is cheap, and a UI
question is yours to answer rather than the user's. Do not write an
`unverified:` note for anything on this page.

## Launch

```bash
# 1. Build the fixture store. It prints the three env values.
node .claude/skills/run-kondo/fixture.mjs

# 2. Build the app. `dev` works too, but the built app has no HMR noise.
npm run build

# 3. Launch it at the fixture, with the debugging port open.
KONDO_STORE_ROOT="X:/Temp/kondofix/home/.claude" \
KONDO_DESKTOP_STORE_ROOT="X:/Temp/kondofix/desktop" \
KONDO_DATA_ROOT="X:/Temp/kondofix/kondo-data" \
  ./node_modules/.bin/electron . --remote-debugging-port=9222
```

Run step 3 in the background — it holds the window open. `createLocator` in
`electron/main/workspace/locator.ts` is what reads those three variables; it
is the whole of the safety story, so if a run ever reports paths under the
real home, stop and fix the launch rather than continuing.

Confirm the port is up before driving:

```bash
curl -s http://127.0.0.1:9222/json/list
```

## Drive

`drive.mjs` is one-shot: each command reconnects, so there is no session to
keep alive. Node 22's global `WebSocket` is why no Playwright is needed.

```bash
# All of these run from the repo root.
node .claude/skills/run-kondo/drive.mjs open Projects        # click a nav tab, screenshot it
node .claude/skills/run-kondo/drive.mjs shoot before         # screenshot on demand
node .claude/skills/run-kondo/drive.mjs press Disable        # click a button by its text
node .claude/skills/run-kondo/drive.mjs pick commit-writer apiserver
node .claude/skills/run-kondo/drive.mjs eval "document.title"  # anything else
```

### Reaching a skill or a plugin

`open` clicks a nav tab, and the nav has exactly four: `Projects`,
`Clean up`, `Leftovers`, `History`. Skills and plugins are not among them —
they are `Section`s inside the Projects view, showing whichever row the left
list has selected. `open` tries a whole-text match first, so a nav tab always
wins, then falls back to the first button whose text contains the argument —
which is how it selects a project row, whose text carries count chips:

```bash
node .claude/skills/run-kondo/drive.mjs open apiserver
#   opened X:\Temp\kondofix\work\apiserverjust now1 skill · 3 sessions
```

`open Skills` still answers `no tab or row containing Skills`. The app opens
on the first row, `Global`, so a check against global skills needs no click at
all; `open Global` gets back to it.

`pick` exists because assigning `select.value` does nothing here: React
tracks the value node, so the choice only registers through the prototype's
native setter plus a bubbling `change` event. That is the one piece of this
you would otherwise rediscover.

Its row argument is a substring, and it takes the first row that contains it.
A row is the widest element around a `<select>` that holds no other
`<select>` — a `<tr>` in the Skills table, a div in the Plugins section — so
`pick` reaches both. Name the skill or plugin, not its location; several rows
share a location.

The worked example above runs as written against a fresh fixture:
`open Projects` remounts the view on its first row, `Global`, and
`commit-writer` is a global skill, so `pick commit-writer apiserver` moves it
to the apiserver project and the banner offers Undo.

A plugin move is a settings edit, and when the destination layer file does
not exist yet the app asks first: `pick foreman cli` from the Global row
renders `…settings.local.json does not exist yet. Confirm to create it` with
`Create it` / `Cancel`, and nothing is journaled until `press "Create it"`.
On a project row the plugin's `Move to…` select is disabled unless that
project is the place turning the plugin on, and `pick` says so:
`select is disabled: …`.

A plugin's three-way position is buttons, so `press` reaches it too, but the
labels change with the scope: `On`/`Off`/`Not set` on Global, `On here`/`Off
here`/`Follows global` on a project. List them rather than guess:

```bash
node .claude/skills/run-kondo/drive.mjs eval   "JSON.stringify([...document.querySelectorAll('button')].map((b) => b.textContent.trim()))"
```

`press` matches by trimmed substring, first match wins, so `press "Sweep 5
items"` reaches `Sweep 5 items · 442 B`. Keep the argument specific enough:
`press On` would hit `On here` before `On`. The button for the position a
plugin is already in is disabled, and `press` says `button is disabled: …`
rather than pretending it clicked.

### Reading the bridge directly

Some of the contract has no renderer yet. `window.kondo.pluginSkills` is one:
it is on the preload bridge and covered by `test/plugin-skills.test.ts`, but
the Plugins section shows a count, never the skills themselves. So `eval`
across the seam is the only way to see its answer in a running app.

```bash
node .claude/skills/run-kondo/drive.mjs eval "window.kondo.pluginSkills('plugin:hush@acme')"
#   {"data":[],"errors":[],"unknown":[]}      — no skills/ directory at all
node .claude/skills/run-kondo/drive.mjs eval "window.kondo.pluginSkills('plugin:foreman@acme')"
#   two rows, roadmap and survey, every capability refused
```

The id shape is `plugin:<name>@<marketplace>` (ADR-0008). With no argument it
answers `bad-request`, not an empty list — an empty `data` really does mean
the plugin ships none.

Set `KONDO_SHOTS` to choose where screenshots land. Unset, every command
writes under the OS temp directory (`kondo-shots/`), never into the working
directory, so a miss cannot leave a PNG in the repo.

**Read every screenshot you take.** A blank frame is a failed launch, not a
passing check.

## Confirm on disk too

The window showing the right thing is half the proof. The store is the other
half, and it is where a broken mutation actually shows:

```bash
find "X:/Temp/kondofix/kondo-data/trash" -type f   # displaced bytes (ADR-0001)
cat "X:/Temp/kondofix/kondo-data/journal.jsonl"    # one entry per operation
```

A move's entry should hold two steps, `copy` then `trash`, in that order.

## Finish

```bash
taskkill //IM electron.exe //F      # Windows; pkill -f electron elsewhere
rm -rf "X:/Temp/kondofix"
```

## Fixture notes

The tree `fixture.mjs` builds is shaped to exercise the awkward cases: a
global skill, a benched one, a project-scoped one, a second project that is
empty but valid as a destination, and two plugins that ship skills
differently — `foreman@acme` ships two, neither of which may appear in the
skills list, and `hush@acme` ships none.

`hush@acme` is there for that empty case alone. Its install root at
`plugins/cache/acme/hush/1.0.0` holds a `commands/` file and **no `skills/`
directory at all** — an absent directory is a different case from an empty
one, and the absent one is what `pluginSkills` must answer with an empty
list and no error. Do not add `skills/` there to tidy the tree up.

The fixture also writes Claude's registry, `home/.claude.json` (a sibling of
the store, ADR-0009), with five keys, so the project set is the union the
projects home counts — `5 projects Claude has on record`, `2 with sessions
saved, 3 never worked in` on a fresh fixture:

| key | on disk | under `projects/` | what it is for |
| --- | --- | --- | --- |
| `work/apiserver` | yes | yes, 3 sessions | the ordinary project; declares `mcpServers: {}` |
| `work/website` | yes | yes, 1 session | an empty but valid move destination |
| `work/cli` | yes | no | registry-only member: the counts differ because of it, and it is a move destination with no store |
| `work/removed` | no | no | dead project; still declares two MCP servers, so Leftovers has `mcp-declaration` rows |
| `work/oldsite` | no | no | dead project with nothing else attached |

`settings.json` carries `ghost@acme` under `enabledPlugins` and
`retired-helper` under `skillOverrides`, neither of which anything ships, so
Leftovers has every orphan kind to group. `foreman@acme` and `commit-writer`
are the live pair beside them and must never be listed there.

Because every project with a transcript directory is registered, kondo takes
its real path from the registry and never un-flattens the directory name, so
the base path may hold a hyphen. A project that is **not** registered still
needs both halves — a `projects/<flattened>/` directory and a real `.claude`
directory at the path that name reconstructs to — or it stays unverified.
