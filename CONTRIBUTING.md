# Contributing

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md) in project spaces.
Use the [issue forms](https://github.com/V-Songbird/kondo/issues/new/choose)
for bugs and feature requests. For vulnerabilities, follow
[SECURITY.md](SECURITY.md) instead of posting a public issue.

## Setup

- Node 22.12 or later. `.nvmrc` names the 22 line for `fnm use` / `nvm use`;
  check that `node -v` reports at least 22.12.
- `npm install`, then `npm run dev` for the app with hot reload.
- `npm run guards`, `npm test`, `npm run typecheck`, `npm run lint` must all
  pass before review. Tests use synthetic stores; never point tests at real data.
- On PowerShell with fnm, initialize each shell before Node/npm commands:
  `fnm env --use-on-cd | Out-String | Invoke-Expression`.

### Repository guards and optional commit hook

`npm run guards` runs Jig's repository checks for privacy, process boundaries
and paired documentation changes. Paired-change checks inspect the staged
index and report themselves skipped when nothing is staged. CI runs the
same runner plus `node .jig/checks/run.mjs --selftest` to exercise guard fixtures.

Hooks are a per-clone opt-in. Inspect `git config --show-origin --get core.hooksPath`
and any existing hooks before opting in with `git config --local core.hooksPath .jig/hooks`.
This redirects **all** hooks, not only pre-commit; preserve any previous setting.
To undo, restore that setting, or use `git config --local --unset core.hooksPath`
if no local value existed. [Jig activation](.jig/activation.md) describes a
clone that has opted in.
The hook skips checks if Node is unavailable in its environment; initialize
fnm before committing and run the checks explicitly. CI remains required.
The tracked hook file is not yet marked executable, so Git on macOS and Linux
may not run it (entry 126); run `npm run guards` before committing there.

## Repository shape

- `electron/main/` — main process: window, IPC registration, and the
  workspace (store locator, adapters, analysis). All disk I/O lives here.
- `electron/preload/` — the context-isolated bridge; the only renderer door.
- `src/` — renderer: React app (`app/`), feature folders (`features/`),
  shared UI primitives (`ui/`), utilities (`lib/`).
- `test/` — the suite plus `helpers.ts`, whose builders create the synthetic
  `.claude` trees every test runs against.
- `docs/` — see [docs/README.md](docs/README.md) for the map.

## Conventions

- TypeScript strict; no `any` on IPC contracts; shared seam types live in one
  place and are imported by both sides.
- Feature folders own their UI and state; `src/ui` stays generic primitives.
- Errors are values in adapter results, not exceptions across the seam.
- Comments state constraints the code cannot; no narration.
- Dependencies: adding a runtime dependency requires a sentence of
  justification in the PR. Prefer node stdlib.

## Changing the seam

`shared/contract.ts` is the IPC contract; changing it is a five-file move,
always in one PR: the contract (types + `channels`), the workspace method,
its registration in `electron/main/ipc.ts`, the preload line, and the renderer
usage. New work adds an operation on the generic entity channels rather than
a new channel (ADR-0004), and the paired-change guard reports a staged
contract change that has no staged ADR edit beside it. Add a case to
`test/workspace.test.ts` for any new method, and to the boundary sweep in
`test/boundary.test.ts` if it reads new paths. New error semantics get a
`ScanErrorCode` entry with a doc comment saying what the UI should do with
it. Renaming a channel string is a breaking change to nothing (both sides
ship together) — renaming an **id format** is not: ids are ADR-0008 surface
and need a migration note in the PR.

## Workflow

- Branch from `main`; small PRs; imperative-mood commit subjects.
- A feature starts with a plan in `docs/plans/` — scope, non-goals, seam
  changes, test plan. Land the plan, then the code.
- A bug fix lands with the test that would have caught it.

## Merge checks and remote enforcement

Local development changes may be integrated after owner review and the required
local checks above pass. Record the reviewed commit and local evidence. This
local integration does not accept a public or release candidate.

For shared changes integrated through a pull request, and before accepting a
public or release candidate, review successful hosted `verify` and `smoke`
results for Windows, macOS and Linux on the exact candidate commit, as well as
the change itself. Record that commit and the run links; a new candidate commit
needs new hosted check evidence. Release acceptance also requires the packaging
and publication gates in `docs/release.md`. Local hooks and green checks do not
establish server-enforced protection.

On 2026-09-08, GitHub denied reads of `main` protection and repository rulesets
with an explicit plan/visibility restriction. Until the owner enables and
verifies a supported protection configuration, maintainers must perform this
review manually; GitHub enforcement is not established. Do not change repository
visibility or buy a plan as part of routine contribution work. See the
[release gate](docs/release.md#security-maintenance-and-publication-gate) and
[capability record](docs/plans/112-security-reporting-maintenance.md#observed-capabilities).

## Review checklist

- [ ] Tests cover the change; suite green on your OS.
- [ ] No disk I/O in `src/`; no free-form paths across the seam.
- [ ] Privacy boundary intact (ADR-0002); no network.
- [ ] UI changes keyboard-reachable with visible focus; color never the only
      signal (staleness and problems also read as text).
- [ ] Docs updated per the [routing rule](docs/README.md#routing-rule).
- [ ] CHANGELOG entry if user-visible.
