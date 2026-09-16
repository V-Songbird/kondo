# Plan: a jig check for drifting `file:line` anchors

Status: **in progress**

`docs/status.md` cites source locations as `file:line` anchors and every
landing moves them: 147 found 11 of 24 anchors wrong after a single batch, and
157 moved four `contract.ts` anchors and dropped two more. Nothing under
`.jig/checks/` reads them, so a stale anchor sends the next session to the
wrong line with no signal at all. This plan adds a check that opens each
anchor's target and says which anchors no longer point at anything.

## Scope

- A third detector kind, `anchor`, in `.jig/checks/run.mjs`, so the existing
  driver runs the check in all three lanes it already serves (`npm run guards`,
  `.jig/hooks/pre-commit`, and CI's `node .jig/checks/run.mjs` plus
  `--selftest`) with no workflow, hook or `package.json` change.
- One check module, `.jig/checks/doc-anchor-outruns-its-target.check.mjs`, with
  its violation/near-miss fixture pair.
- The new row and the updated count sentence in `docs/testing.md`
  "## The guards".

## Out of scope

- Any change to `.jig/config.json` or `.jig/manifest.json`. The check has no
  `PreToolUse` detector — an anchor drifts because code moved, not because
  somebody typed the doc — so there is nothing for the session lane to arm.
  Registering the check in jig's own catalogue is an owner action with the
  plugin, not something this entry writes.
- Upgrading the driver to jig 2.18.1's template. See decision 1.
- Rewriting any anchor in `docs/status.md`. Every one of them is correct at
  `f4fbb24`; this entry only adds the thing that will notice when they stop
  being.
- Checking prose that merely names a file without a link, and checking a link
  whose target lies outside the repository root.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | A third detector kind, `anchor`, added to the repository's own `.jig/checks/run.mjs`, modelled on the `extract` kind of jig 2.18.1's template: a `driverDetectors`-style filter, a findings function, a branch in `runChecks` and a branch in `runSelftest`. Discriminated by `params.kind === "anchor"`; neither existing kind reads `params.kind`, and an anchor detector declares no `patterns` and no `pairedWith`, so neither existing filter can claim it. | The driver runs only `pattern` and `paired-change`, and neither can open an anchor's target: a regular expression over one file cannot know how many lines another file has. The rejected alternative was a vitest case or a separate npm script. It was rejected because the pre-commit hook and CI's guard step run `run.mjs` and nothing else, and the constraints forbid a hook or workflow change — a test would not run in the lane where the drift is committed. Wholesale adoption of the 2.18.1 template was also rejected: 787 diff lines, a different lane model, and its `extract` kind still only compares two texts, so it would not answer this question either. Following the template's *shape* keeps a later upgrade able to carry this kind across. |
| 2 | The anchor grammar, taken shape by shape from `docs/status.md` at `f4fbb24`. A **link** is `[text](href)`, images excluded. An href with a scheme or a leading `#` is ignored. An **anchor** is a link whose text is `<basename>:<line>` or `<basename>:<from>-<to>`. A **continuation** is `, line <n>` or ` and line <n>` immediately after an anchor's closing `)`, checked against that anchor's target. A **bare link** is any other relative link. | These are the four shapes that actually occur: 21 anchors over 19 distinct targets, one range (`index.ts:40-45`), four continuations (`docs/status.md:90`, `:103`, `:139`, `:173`) and the rest bare. The continuation rule is deliberately the tightest reading that covers all four — adjacency to the anchor's own `)`, not "somewhere in the paragraph" — because a looser rule would have to guess which file a stray line number belongs to. |
| 3 | The symbol rule: the symbol is the backticked token that ends immediately before the anchor, separated from it by whitespace and at most one `(`, and only when that token is a plain identifier of three characters or more. It must appear as a whole word within **2 lines** of the cited line. Nothing else beside an anchor is treated as a symbol, and an anchor with no symbol is checked for existence and range only. | Adjacency and the identifier shape are what make the rule safe. Measured over every anchor in the tree, four qualify — `rootOf`/`mutations.ts:466`, `overlapRefusal`/`scan.ts:109` twice, `KONDO_DATA_ROOT`/`locator.ts:171` — and all four sit at **distance 0**, on the cited line itself, so a window of 2 is already generous. The looser readings were measured and rejected: "nearest backticked token in the preceding lines" would ask `capabilities.ts:15` for `plan` and `kinds.ts:532` for `"All projects"`, and a dotted or quoted token would ask `user-store.ts:571` for the literal `Scan.errors`. Each is a false positive on a correct anchor, and the check has to be silent on this file today. |
| 4 | A bare link is checked for existence, and its `#fragment` against the target's own headings when the target is markdown, slugged GitHub-style. A link text that looks like a filename — `name.ext`, optionally with `:line` — must equal the href's basename exactly, case included. A link whose href resolves outside the repository root is skipped entirely. | Existence is the cheapest real catch and it already covers the four bare links in `docs/status.md`. The fragment match is cheap because the headings are in the file being read anyway, and a sweep over every tracked markdown file found no broken fragment, so it costs nothing today and catches a renamed heading tomorrow. The escape rule is the constraint "reads nothing outside the repository root", and it is load-bearing: `README.md:155` links `../../releases`, which resolves on GitHub and nowhere else. |
| 5 | A `finding <n>` mention is checked against the count of top-level numbered items under the doc's own `## Open findings` heading, and is skipped in a doc that has no such heading. | `docs/status.md:25` says "the flake in finding 4" and the list at `:76` has nine items. The number is a cross-reference into a list that gets reordered, which is drift of the same kind. A doc without the heading has no list to count, so there is nothing the check could honestly say. |
| 6 | A finding names the **doc** and the **anchor's own line**, with a note carrying the target and the one reason: `../electron/main/workspace/scan.ts has 140 lines`, `no file at ../shared/contract.ts`, `link text says scan.ts, path says kinds.ts`, `overlapRefusal is not within 2 lines of 109`, `the Open findings list has 9 items`. | The anchor's line is the line somebody has to edit. The target's line is not — nothing is wrong there. The note is what turns "this anchor is stale" into a fix, and it stays inside the driver's existing `{classId, path, line, pattern, note}` shape and its `path:line  classId  (note)` printing. |
| 7 | The selftest fixture pair is one string: the doc, then a `--- targets` fence, then one `=== <path>` block per target file. The driver writes the doc at `fixturePath(det)` and each target at its named path inside the throwaway directory, then runs the real detector over that temp root. | The fixture has to carry targets, because the whole point of the kind is that it opens one. Writing them to disk and running the unmodified detector proves path resolution, line counting and the symbol window — more than 2.18.1's `extract` fixture, which compares two strings in memory and never compiles a glob. The fence follows that template's `--- paired` convention so the two stay recognisable as the same idea. |
| 8 | The doc globs are `docs/**/*.md`, `*.md`, `.github/**/*.md`, `.claude/rules/*.md` and `.claude/skills/**/*.md`. | Every tracked markdown file the driver's walk can reach, and no wider. `.claude/**` is deliberately not one glob: the driver's `SKIP_DIRS` does not exclude `.claude/worktrees/`, so a run from the main checkout while a worktree exists would read the worktree's own docs twice. `.jig/` is already in `SKIP_DIRS`, so `.jig/activation.md` is out of reach and is not claimed. `docs/**/*.md` comes first because `fixturePath` derives the fixture's name from the first glob, and `docs/fixture.md` is the name the fixture's relative targets need. |
| 9 | Line counting tolerates CRLF, and a target path is resolved against the doc's own directory with forward slashes. | `.gitattributes` sets no text conversion, so the tree holds LF but a Windows checkout can hand the check CRLF. Counting `\n` and stripping a trailing `\r` before the whole-word symbol search makes both readings agree. |

## Seam changes

None. Nothing in this entry touches `shared/contract.ts`, the preload bridge or
the renderer.

## Tests

- `node .jig/checks/run.mjs --selftest` — the new module is reported `caught`:
  its violation fixture fires on a stale line, a wrong basename, a missing
  target, an absent symbol and an out-of-range `finding` number, and its near
  miss, the same doc with all five correct, fires nothing.
- `node .jig/checks/run.mjs` — no findings on the tree at `f4fbb24`, then one
  anchor in `docs/status.md` seeded by hand to a line past its target's end,
  and the run names `docs/status.md`, that anchor's own line and the reason,
  exiting 1. The seed is reverted before anything is committed.

## Done when

`npm run guards`, the pre-commit hook and CI all read every `file:line` anchor
in the repository's markdown and refuse a stale one, naming the doc line to fix
and the reason it is wrong, with the six existing checks reporting exactly what
they reported before.
