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
list has selected. `open Skills` answers `no tab named Skills`.

`open` matches a button's whole text, and a project row's text carries its
count chips — `Global3 skills · 1 settings file` on a fresh fixture, and the
counts move as you mutate — so it cannot select one.
Selecting a row is an `eval`:

```bash
node .claude/skills/run-kondo/drive.mjs eval \
  "(() => { const row = [...document.querySelectorAll('li button')].find((b) => b.textContent.includes('apiserver')); if (!row) return 'no project row matching apiserver'; row.click(); return 'opened ' + row.textContent.trim() })()"
```

The app opens on the first row, `Global`, so a check against global skills
needs no click at all.

`pick` exists because assigning `select.value` does nothing here: React
tracks the value node, so the choice only registers through the prototype's
native setter plus a bubbling `change` event. That is the one piece of this
you would otherwise rediscover.

Its row argument is a substring, and it takes the first row that contains it.
Name the skill, not its location — several rows share a location.

The worked example above runs as written against a fresh fixture:
`open Projects` remounts the view on its first row, `Global`, and
`commit-writer` is a global skill, so `pick commit-writer apiserver` moves it
to the apiserver project and the banner offers Undo.

`pick` scans `tbody tr`, so it reaches the tables in the selected project's
detail — Skills among them. The Plugins section is not a table: its rows are
divs, so `pick foreman off` answers `no row containing foreman`. A plugin's
three-way position is buttons, so `press` does reach it, but the labels change
with the scope: `On`/`Off`/`Not set` on Global, `On here`/`Off here`/`Follows
global` on a project. List them rather than guess:

```bash
node .claude/skills/run-kondo/drive.mjs eval \
  "JSON.stringify([...document.querySelectorAll('button')].map((b) => b.textContent.trim()))"
```

The button for the position a plugin is already in is disabled, and `press`
says `button is disabled: Not set` rather than pretending it clicked. The
plugin row's own `Move to…` select is out of `pick`'s reach for now.

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

Set `KONDO_SHOTS` to choose where screenshots land.

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

Two things it has to get right, both of which cost an afternoon once:

- **No hyphen anywhere in the base path.** Claude Code names a project
  directory by flattening its absolute path with `-`, and kondo unflattens to
  reconstruct it. A hyphen cannot round-trip, so the project fails to verify
  and never appears as a move destination. `fixture.mjs` refuses such a path.
- **A project needs both halves.** A transcript directory under
  `projects/<flattened>/` *and* a real `.claude` directory at the path that
  name reconstructs to. Either alone leaves it unverified.
