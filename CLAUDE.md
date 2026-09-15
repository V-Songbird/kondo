# kondo

Read [AGENTS.md](AGENTS.md) — it is the operating manual for this repo and
applies to you in full. Before picking up work, read
[docs/status.md](docs/status.md): what works on `main`, work in flight and its
branches, next steps and open findings.

## Commands

Scripts in `package.json`; Node 22.12 or later.

| Command | What it does |
|---|---|
| `npm run dev` | The app with hot reload (electron-vite) |
| `npm run guards` | Jig repository checks; the paired-change checks read the staged index and report skipped when nothing is staged |
| `npm test` | The vitest suite, against synthetic stores only |
| `npm run typecheck` | `tsc -b` over the app and Electron projects |
| `npm run lint` | oxlint |
| `npm run build`, then `npm run test:e2e` | Builds the app and drives it over Chromium's debugging port against a fixture, as CI's `smoke` job does |

Guards, tests, typecheck and lint must all pass before work is done. Every
command above except `npm run dev` ran on Windows on 2026-09-15; the results,
including the smoke's intermittent startup failure, are in
[docs/status.md](docs/status.md).

## Constraints

One warning worth repeating: this app reads and mutates real `~/.claude` data
(moves, trash and Undo; settings writes stay refused). Never point mutating
code at a real store while developing — build fixture trees with the helpers
in `test/helpers.ts`, and check UI changes with `.claude/skills/run-kondo/`.

- Start any store-adapter work from [docs/domain.md](docs/domain.md). The
  commit hook pairs a staged `electron/main/workspace/` change with a
  `docs/domain.md` edit, and a staged `shared/contract.ts` change with a
  `docs/adr/` edit.
- Documentation describes only what `main` does today; history lives in Git.
  Where each kind of knowledge belongs: [docs/README.md](docs/README.md).

## Where work is tracked

Open work is under "Now" in [ROADMAP.md](ROADMAP.md) and plans are indexed in
[docs/plans/README.md](docs/plans/README.md). Maintainers who use Foreman also
keep a local `ROADMAP.jsonl` queue that clones do not receive
([ADR-0013](docs/adr/0013-keep-working-records-local.md)).
