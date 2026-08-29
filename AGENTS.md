# Operating manual

For every engineer working in this repo, human or AI agent. Short on purpose;
each rule links to the document that carries the detail.

## Read first

1. [docs/README.md](docs/README.md) — the documentation map and routing rule.
2. [docs/domain.md](docs/domain.md) — before touching any store adapter.
3. [docs/foundations.md](docs/foundations.md) — before moving code across the
   process seam.

## Hard rules

- **Never run mutating code against real stores during development.** Point
  everything at fixtures (the `test/helpers.ts` builders make temp-dir
  trees). The locator accepts injected roots for exactly this. Reading your own real store from the
  running app is fine; tests may not even do that
  ([docs/testing.md](docs/testing.md)).
- **The renderer never touches disk.** All I/O lives in `electron/main`
  behind the typed bridge. Adding `fs` anywhere under `src/` is a bug.
- **Respect the privacy boundary.** No code path opens project files outside
  `.claude` directories (ADR-0002). No network calls anywhere (SECURITY.md).
- **Docs move with code.** Learned a store fact → update domain.md (with a
  ✅/◇ marker). Made a lasting decision → add an ADR. Planned a feature →
  plan file first. A PR that leaves a doc wrong is incomplete.
- **Adapters degrade, never die.** Unknown files, malformed JSON, unreadable
  entries produce itemized errors alongside partial data (ADR-0005).

## Workflow

- `npm run dev` to run, `npm test` / `npm run typecheck` / `npm run lint`
  before calling anything done. All three must pass.
- TypeScript is strict everywhere. No `any` at the seam.
- Conventions, review bar, and PR checklist: [CONTRIBUTING.md](CONTRIBUTING.md).
