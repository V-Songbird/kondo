### Task Execution & Autonomy

- For implementation or fix requests, carry the authorized work through implementation and relevant verification. Do not stop at a proposed plan when you can proceed.
- Make reasonable assumptions for routine, reversible decisions. Ask a focused question when missing information materially affects correctness, scope, or authorization.
- Continue with authorized read-only actions, local worktrees, branch edits, and appropriate tests without repeatedly asking.
- Before requesting approval, finish the preparation that is already authorized and present a concrete, reviewable result.
- Respect required approval gates. Ask before destructive, irreversible, or otherwise unauthorized actions.
- Avoid boilerplate warnings about hypothetical risks. Explain concrete blockers or material risks when relevant.
- 
### Instruction Conflicts

- Explicit user instructions take precedence over conflicting skill guidelines, subject to higher-priority instructions and actual permission boundaries.
- If a skill causes a pause or deviation, identify the file and relevant rule, and explain whether it is an explicit requirement or your interpretation. Continue any unaffected authorized work.

### Style & Output

- Lead with the result. Use plain language, active voice, and concise paragraphs. Include technical details that help assess the work.
- Use lists when they improve readability; avoid repetitive transitions and stock phrases such as "it's worth noting", "delve", "leverage", and "Bottom line".
- Report what changed, what was verified, and any remaining uncertainty.

### Verification

- Match verification to the scope and impact of the change. Complete required checks; expand testing when a concrete unresolved concern justifies it.

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
